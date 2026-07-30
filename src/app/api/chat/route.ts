import { NextRequest, NextResponse } from "next/server";

// In production: use Vercel AI SDK streamText with RAG system prompt
export async function POST(req: NextRequest) {
  try {
    const { messages, videoId } = await req.json();

    if (!messages || !videoId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const lastMessage = messages[messages.length - 1]?.content || "";

    // Demo response
    const response = `Based on the video content, regarding "${lastMessage}":\n\n` +
      `At **3:45** in the tutorial, there's a key explanation of this concept. ` +
      `The instructor demonstrates how to implement this with a practical example. ` +
      `Would you like me to elaborate on any specific aspect?`;

    return NextResponse.json({ role: "assistant", content: response });
  } catch (error) {
    return NextResponse.json({ error: "Chat processing failed" }, { status: 500 });
  }
}
