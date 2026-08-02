import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { runIngestPipeline } from "@/lib/pipelines/run";
import { addPipelineLog } from "@/lib/pipelines/logs";
import { ingestPipelineArtifacts } from "@/lib/rag/ingest";

/** Track running pipelines to prevent duplicate starts */
const runningPipelines = new Set<string>();

/**
 * Returns true if a pipeline is currently running for the given videoId.
 */
export function isPipelineRunning(videoId: string): boolean {
  return runningPipelines.has(videoId);
}

/**
 * Start the ingest pipeline for a video. No-op if already running.
 * Sets status to "processing", spawns the Python child process,
 * and wires progress/error/complete callbacks to DB + log buffer.
 *
 * Returns true if the pipeline was started, false if it was already running.
 */
export async function startIngestPipeline(
  videoId: string,
  b2Key: string
): Promise<boolean> {
  if (runningPipelines.has(videoId)) {
    return false;
  }
  runningPipelines.add(videoId);

  // Set video status to processing
  const now = new Date().toISOString();
  await db
    .update(videos)
    .set({ status: "processing", updatedAt: now })
    .where(eq(videos.id, videoId));

  addPipelineLog(
    videoId,
    JSON.stringify({
      event: "progress",
      step: "init",
      status: "running",
      progress: 0,
      message: "Starting ingest pipeline...",
    })
  );

  runIngestPipeline(
    videoId,
    b2Key,
    (progress) => {
      addPipelineLog(
        videoId,
        JSON.stringify({ event: "progress", ...progress })
      );
    },
    (error) => {
      addPipelineLog(videoId, JSON.stringify({ event: "error", error }));
      db.update(videos)
        .set({ status: "failed", updatedAt: new Date().toISOString() })
        .where(eq(videos.id, videoId))
        .then(() => runningPipelines.delete(videoId))
        .catch((err) => {
          console.error("Failed to update video status:", err);
          runningPipelines.delete(videoId);
        });
    },
    async (result) => {
      addPipelineLog(
        videoId,
        JSON.stringify({ event: "complete", data: result })
      );
      const finalStatus = result.success ? "ready" : "failed";
      // Index the pipeline's B2 sidecar into SQLite so the video shows up in
      // search/chat/chapters. Failure here must not sink a successful ingest.
      if (result.success) {
        try {
          const idx = await ingestPipelineArtifacts(videoId);
          addPipelineLog(
            videoId,
            JSON.stringify({
              event: "progress",
              step: "index",
              status: "completed",
              progress: 100,
              message: `Indexed into DB: ${idx.segments} segments, ${idx.breaks} breaks, ${idx.placements} placements (search/chat/ads/approvals)`,
            })
          );
        } catch (err) {
          console.error("Sidecar ingest failed:", err);
          addPipelineLog(
            videoId,
            JSON.stringify({
              event: "raw",
              source: "stdout",
              line: `[index] sidecar ingest failed: ${String(err).slice(0, 200)}`,
            })
          );
        }
      }
      try {
        await db
          .update(videos)
          .set({
            status: finalStatus,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(videos.id, videoId));
      } catch (err) {
        console.error("Failed to update video status:", err);
      } finally {
        runningPipelines.delete(videoId);
      }
    },
    // Raw stdout/stderr noise (warnings, progress bars, nltk logs) — keep in
    // the log buffer for SSE replay/debugging, but never fail the video on it.
    // The SSE client ignores unknown "raw" events.
    (line, source) => {
      addPipelineLog(videoId, JSON.stringify({ event: "raw", source, line }));
    }
  );

  return true;
}
