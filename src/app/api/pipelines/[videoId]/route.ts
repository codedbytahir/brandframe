import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { getPipelineLogs } from "@/lib/pipelines/logs";
import { startIngestPipeline, isPipelineRunning } from "@/lib/pipelines/start";

/**
 * POST /api/pipelines/[videoId]
 * Trigger the ingest pipeline for a video after upload completes.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;

  const video = await db
    .select()
    .from(videos)
    .where(eq(videos.id, videoId))
    .get();

  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  if (!video.b2Key) {
    return NextResponse.json(
      { error: "Video has no B2 key" },
      { status: 400 }
    );
  }

  // If already processing or ready, return current status without re-spawning
  if (
    video.status === "processing" ||
    video.status === "ready" ||
    isPipelineRunning(videoId)
  ) {
    return NextResponse.json({ status: video.status, videoId });
  }

  await startIngestPipeline(videoId, video.b2Key);
  return NextResponse.json({ status: "processing", videoId });
}

/**
 * GET /api/pipelines/[videoId]
 * SSE stream that tails pipeline log lines and sends a "done" event
 * when the video reaches a terminal status ("ready" or "failed").
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let sentCount = 0;
      let closed = false;

      const enqueue = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // Controller already closed
          closed = true;
        }
      };

      // Replay existing buffer
      const buf = getPipelineLogs(videoId);
      for (const line of buf) {
        enqueue(JSON.stringify({ line }));
      }
      sentCount = buf.length;

      // Poll every 1s for new lines + check terminal status
      const interval = setInterval(async () => {
        if (closed) {
          clearInterval(interval);
          return;
        }

        // Stream any new log lines
        const currentBuf = getPipelineLogs(videoId);
        while (sentCount < currentBuf.length) {
          enqueue(JSON.stringify({ line: currentBuf[sentCount] }));
          sentCount++;
        }

        // Check DB for terminal status
        try {
          const video = await db
            .select({ status: videos.status })
            .from(videos)
            .where(eq(videos.id, videoId))
            .get();

          if (video && (video.status === "ready" || video.status === "failed")) {
            enqueue(JSON.stringify({ done: true, status: video.status }));
            clearInterval(interval);
            closed = true;
            controller.close();
          }
        } catch {
          // DB read failed — keep polling
        }
      }, 1000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed
        }
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
