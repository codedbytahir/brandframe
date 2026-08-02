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
import { segments, segmentEmbeddings, naturalBreaks, adSlots, brands } from "@/lib/db/schema";
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

interface BreaksFile {
  version?: number;
  breaks?: Array<{ timestamp_ms: number; score: number; reason?: string }>;
}

/**
 * Pulls `assets/<videoId>/breaks.json` into the naturalBreaks table so the
 * cue planner works from the DB (it also has a sidecar fallback; DB rows are
 * the canonical path). Idempotent replace.
 */
export async function ingestBreaksFromSidecar(
  videoId: string,
  breaksOverride?: BreaksFile | null
): Promise<number> {
  const data =
    breaksOverride !== undefined
      ? breaksOverride
      : isDemo
        ? null
        : await getB2Json<BreaksFile>(`assets/${videoId}/breaks.json`);
  const list = data?.breaks ?? [];

  await db.delete(naturalBreaks).where(eq(naturalBreaks.videoId, videoId));
  const now = new Date().toISOString();
  let n = 0;
  for (const b of list) {
    await db.insert(naturalBreaks).values({
      id: `brk_${videoId}_${n}`,
      videoId,
      timestampMs: b.timestamp_ms,
      score: Math.max(0, Math.min(100, Math.round(b.score))),
      createdAt: now,
    });
    n++;
  }
  return n;
}

interface ManifestPlacement {
  slot_id?: string;
  surface?: string;
  timestamp_ms?: number;
  brand?: string;
  bbox?: number[];
  before_key?: string;
  after_key?: string;
  critic_passed?: boolean;
  critic_score?: number;
  critic_notes?: string;
}
interface ManifestFile {
  placements?: ManifestPlacement[];
}

/**
 * Pulls manifest placements into the ad_slots table. Critic-passed placements
 * enter the Studio approval queue as "pending" (spec's human-approval gate);
 * critic-failed ones land as "rejected" with the reason. Skips placements
 * whose brand name isn't in the brands table rather than orphaning the join.
 * Idempotent replace per pipeline run.
 */
export async function ingestPlacementsFromManifest(
  videoId: string,
  manifestOverride?: ManifestFile | null
): Promise<number> {
  const mf =
    manifestOverride !== undefined
      ? manifestOverride
      : isDemo
        ? null
        : await getB2Json<ManifestFile>(`manifests/${videoId}/manifest.json`);
  const placements = mf?.placements ?? [];
  if (placements.length === 0) return 0;

  const brandRows = await db.select({ id: brands.id, name: brands.name }).from(brands);
  const brandIdByName = new Map(brandRows.map((b) => [b.name.toLowerCase(), b.id]));

  await db.delete(adSlots).where(eq(adSlots.videoId, videoId));
  const now = new Date().toISOString();
  let n = 0;
  for (const p of placements) {
    const brandId = p.brand ? brandIdByName.get(p.brand.toLowerCase()) : undefined;
    if (!brandId) continue;
    const passed = p.critic_passed !== false;
    await db.insert(adSlots).values({
      id: p.slot_id || `slot_${videoId}_${n}`,
      videoId,
      segmentId: null,
      layer: 3,
      timestampMs: p.timestamp_ms ?? 0,
      status: passed ? "pending" : "rejected",
      surfaceLabel: p.surface ?? null,
      bbox: p.bbox ? JSON.stringify(p.bbox) : null,
      brandId,
      beforeFrameUrl: p.before_key
        ? `/api/verify-frames/${videoId}?key=${encodeURIComponent(p.before_key)}`
        : null,
      afterFrameUrl: p.after_key
        ? `/api/verify-frames/${videoId}?key=${encodeURIComponent(p.after_key)}`
        : null,
      rejectReason: passed
        ? null
        : `AI critic score ${p.critic_score ?? "?"} below pass threshold`,
      manifestEntry: JSON.stringify(p),
      createdAt: now,
      updatedAt: now,
    });
    n++;
  }
  return n;
}

/** All three pipeline-artifact ingests, run on completion/backfill. */
export async function ingestPipelineArtifacts(videoId: string) {
  const segs = await ingestSegmentsFromSidecar(videoId);
  const brks = await ingestBreaksFromSidecar(videoId);
  const slots = await ingestPlacementsFromManifest(videoId);
  return { segments: segs, breaks: brks, placements: slots };
}
