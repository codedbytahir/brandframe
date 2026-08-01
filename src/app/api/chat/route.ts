import { NextResponse } from "next/server";
import { streamText } from "ai";
import { createMistral } from "@ai-sdk/mistral";
import { hybridSearch } from "@/lib/rag/search";
import { env, isMistralEnabled } from "@/lib/env";

export const runtime = "nodejs";

interface IncomingMessage {
  role: string;
  content: string;
}

function msToTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function buildSystemPrompt(
  hits: Awaited<ReturnType<typeof hybridSearch>>
): string {
  const segLines = hits
    .map(
      (h, i) =>
        `[${i + 1}] (start_ms=${h.startMs}, t=${msToTimestamp(h.startMs)}–${msToTimestamp(h.endMs)}, segment="${h.segmentId}") ${h.transcript}`
    )
    .join("\n");

  return `You are BrandFrame's chat-with-video assistant. Answer using ONLY the video transcript segments below. Rules:
- Ground every claim in the segments; if none match the question, reply exactly: "The video doesn't cover that." (you may suggest a nearby covered topic).
- Every time you reference a moment, cite it inline as <ts ms="START_MS">M:SS</ts> using that segment's start_ms. Example: The instructor centers a div with place-items at <ts ms="120000">2:00</ts>.
- Keep answers under 150 words. Be direct; no preamble.
- Never invent timestamps or content not present in the segments.

Retrieved segments:
${segLines || "(no segments matched)"}`;
}

/** Demo-mode stream: grounded in real DB segments, no LLM key required. */
function demoStream(hits: Awaited<ReturnType<typeof hybridSearch>>): Response {
  const encoder = new TextEncoder();
  const text =
    hits.length === 0
      ? "The video doesn't cover that. Try asking about one of the chapters listed on this page."
      : `Here's what I found in the video:\n\n` +
        hits
          .slice(0, 3)
          .map(
            (h) =>
              `At <ts ms="${h.startMs}">${msToTimestamp(h.startMs)}</ts>${h.topic ? ` (${h.topic})` : ""}: ${h.transcript}`
          )
          .join("\n\n") +
        `\n\n_Add MISTRAL_API_KEY for full conversational answers — demo mode retrieves real segments from the database._`;

  const stream = new ReadableStream({
    async start(controller) {
      // Chunk by sentence-ish pieces so the client visibly streams.
      for (const piece of text.split(/(?<=\n|\. )/)) {
        controller.enqueue(encoder.encode(piece));
        await new Promise((r) => setTimeout(r, 25));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  let body: { messages?: IncomingMessage[]; videoId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { messages, videoId } = body;
  if (!messages?.length || !videoId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const query = lastUser?.content ?? messages[messages.length - 1].content;

    // Retrieval first (prefetch before stream → faster first token)
    const hits = await hybridSearch({ query, videoId, limit: 5 });

    if (!isMistralEnabled) {
      return demoStream(hits);
    }

    const mistral = createMistral({ apiKey: env.MISTRAL_API_KEY });
    const coreMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-6) // last 6 messages for context; only last user msg drove retrieval
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const result = streamText({
      model: mistral("mistral-large-latest"),
      system: buildSystemPrompt(hits),
      messages: coreMessages,
      maxTokens: 400,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("[chat] failed:", error);
    return NextResponse.json({ error: "Chat processing failed" }, { status: 500 });
  }
}
