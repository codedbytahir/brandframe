/**
 * Ingests pipeline output from the B2 index sidecar
 * (`index/<videoId>/segments.json`, written by pipelines/cli.py step_embed)
 * into the local SQLite DB.
 *
 * The RAG corpus, chat, and watch-page chapters all read from the `segments`
 * table — a freshly ingested real video has rows on B2 but none locally until
 * this runs (demo videos get theirs from scripts/seed-demo-data.py). Called
 * automatically on pipeline completion, and on-demand as a backfill via
 * POST /api/pipelines/[videoId] for videos that finished before this existed.
 */
import { db } from "@/lib/db";
import { segments, segmentEmbeddings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getB2Json } from "@/lib/b2/client";
import { isDemo } from "@/lib/env";

interface SidecarSegment {
  index: number;
  start_ms: number;
  end_ms: number;
  text: string;
  embedding?: number[];
}
interface SidecarFile {
  version: number;
  model: string;
  dim: number;
  segments: SidecarSegment[];
}

/**
 * Returns the number of segments ingested (0 when no sidecar exists, e.g.
 * demo mode, failed pre-embed runs, or empty transcripts).
 * Idempotent: an existing set for this video is replaced wholesale.
 * `sidecarOverride` exists for tests/devtools — bypasses the B2 fetch.
 */
export async function ingestSegmentsFromSidecar(
  videoId: string,
  sidecarOverride?: SidecarFile | null
): Promise<number> {
  const sidecar =
    sidecarOverride !== undefined
      ? sidecarOverride
      : isDemo
        ? null
        : await getB2Json<SidecarFile>(`index/${videoId}/segments.json`);

  if (!sidecar || !Array.isArray(sidecar.segments) || sidecar.segments.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();

  // Idempotent re-ingest (e.g. video re-uploaded / pipeline re-run)
  const existing = await db
    .select({ id: segments.id })
    .from(segments)
    .where(eq(segments.videoId, videoId));
  if (existing.length > 0) {
    await db
      .delete(segmentEmbeddings)
      .where(inArray(segmentEmbeddings.segmentId, existing.map((e) => e.id)));
    await db.delete(segments).where(eq(segments.videoId, videoId));
  }

  let inserted = 0;
  for (const s of sidecar.segments) {
    const segId = `seg_${videoId}_${s.index}`;
    await db.insert(segments).values({
      id: segId,
      videoId,
      index: s.index,
      startMs: s.start_ms,
      endMs: s.end_ms,
      transcript: s.text ?? "",
      topic: null,
      keyframeUrl: null,
      createdAt: now,
    });
    if (Array.isArray(s.embedding) && s.embedding.length > 0) {
      await db.insert(segmentEmbeddings).values({
        segmentId: segId,
        model: sidecar.model || "unknown",
        dim: s.embedding.length,
        vector: JSON.stringify(s.embedding), // sidecar vectors are L2-normalized
        createdAt: now,
      });
    }
    inserted++;
  }

  return inserted;
}
