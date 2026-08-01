/**
 * Loads the searchable corpus: segments from SQLite, optionally enriched with
 * the pipeline-written index sidecar on B2 (`index/<videoId>/segments.json`,
 * produced by pipelines/cli.py step_embed).
 *
 * B2 is the source of truth for pipeline-produced embeddings; SQLite covers
 * metadata, seeded demo data, and the offline demo path.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { segments, videos } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getB2Client } from "@/lib/b2/client";
import { env, isDemo } from "@/lib/env";

export interface CorpusSegment {
  id: string; // DB segment id (or generated for sidecar-only rows)
  videoId: string;
  videoTitle: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string; // transcript (+ vl caption when present)
  topic: string | null;
  keyframeUrl: string | null;
  /** Pipeline-provided vector (sidecar) with the model that produced it. */
  sidecarVector?: number[];
  sidecarModel?: string;
}

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

async function fetchSidecar(videoId: string): Promise<SidecarFile | null> {
  try {
    const res = await getB2Client().send(
      new GetObjectCommand({ Bucket: env.B2_BUCKET!, Key: `index/${videoId}/segments.json` })
    );
    const body = (res.Body as { transformToString?: () => Promise<string> } | undefined)
      ?.transformToString;
    if (!body) return null;
    return JSON.parse(await body.call(res.Body)) as SidecarFile;
  } catch {
    return null; // No sidecar for this video (or B2 unreachable) — fine.
  }
}

export async function loadCorpus(videoId?: string): Promise<CorpusSegment[]> {
  const where = videoId
    ? and(eq(segments.videoId, videoId), eq(videos.status, "ready"))
    : eq(videos.status, "ready");

  const rows = await db
    .select({
      id: segments.id,
      videoId: segments.videoId,
      videoTitle: videos.title,
      index: segments.index,
      startMs: segments.startMs,
      endMs: segments.endMs,
      transcript: segments.transcript,
      topic: segments.topic,
      keyframeUrl: segments.keyframeUrl,
    })
    .from(segments)
    .innerJoin(videos, eq(segments.videoId, videos.id))
    .where(where)
    .orderBy(segments.videoId, segments.index);

  const corpus: CorpusSegment[] = rows.map((r) => ({ ...r, text: r.transcript }));

  // Enrich with B2 sidecars when B2 is configured (real pipeline output).
  if (!isDemo && rows.length > 0) {
    const videoIds = [...new Set(rows.map((r) => r.videoId))];
    const sidecars = await Promise.all(videoIds.map(async (v) => [v, await fetchSidecar(v)] as const));
    const byVideo = new Map(sidecars.filter(([, s]) => s !== null) as Array<readonly [string, SidecarFile]>);

    // index → sidecar segment per video
    for (const seg of corpus) {
      const sc = byVideo.get(seg.videoId);
      const scSeg = sc?.segments.find((s) => s.index === seg.index);
      if (scSeg) {
        if (scSeg.text && scSeg.text.length > seg.text.length) seg.text = scSeg.text;
        if (scSeg.embedding && sc) {
          seg.sidecarVector = scSeg.embedding;
          seg.sidecarModel = sc.model;
        }
      }
    }
  }

  return corpus;
}
