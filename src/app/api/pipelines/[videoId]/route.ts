import { NextRequest, NextResponse } from "next/server";
import { getPipelineLogs } from "@/lib/pipelines/logs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Replay buffer
      const buf = getPipelineLogs(videoId);
      for (const line of buf) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
      }

      // Tail new lines (simplified - in production use a pub/sub mechanism)
      const interval = setInterval(() => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ping: true })}\n\n`));
      }, 15000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
