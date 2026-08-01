/**
 * Provenance verification engine (docs/specs/10 §5).
 *
 * Real mode (B2 configured): fetches `manifests/<videoId>/manifest.json`,
 * recomputes SHA-256 of the source MP4 + every before/after placement frame,
 * and reads Object Lock mode/retention via HeadObject. Result is a typed
 * VerifyResult the /verify RSC renders.
 *
 * Demo mode (no B2 keys): synthesizes a Manifest-shaped structure from the DB
 * so the full disclosure UX is demonstrable offline — clearly labeled
 * `simulated`, never presented as a cryptographic verification.
 */
import { createHash } from "crypto";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { adSlots, brands, users, videos } from "@/lib/db/schema";
import { getB2Bytes, getB2Client } from "@/lib/b2/client";
import { env, isDemo } from "@/lib/env";

export type VerifyState = "verified" | "warning" | "no-manifest" | "demo";

export interface StepEntry {
  step: string;
  status: string;
  provider: string;
  model: string;
  durationMs: number;
  error: string | null;
}

export interface HashCheck {
  expected: string;
  actual: string | null;
  match: boolean | null; // null = not checked
}

export interface PlacementVerification {
  slotId: string;
  surface: string;
  timestampMs: number;
  brand: string;
  criticScore: number;
  beforeHash: HashCheck;
  afterHash: HashCheck;
  lock: { mode: string | null; retainUntil: string | null };
  beforeUrl: string;
  afterUrl: string;
}

export interface VerifyResult {
  state: VerifyState;
  simulated: boolean;
  video: {
    id: string;
    title: string;
    durationMs: number | null;
    creator: string;
    processedAt: string | null;
  };
  runId: string | null;
  manifestId: string | null;
  manifestSha256: string | null;
  retainUntil: string | null;
  lockMode: string | null;
  sourceHash: HashCheck & { type: string } | null;
  steps: StepEntry[];
  placements: PlacementVerification[];
  summary: { totalSteps: number; successfulSteps: number; fallbackSteps: number; failedSteps: number } | null;
}

interface ManifestPlacement {
  slot_id: string;
  surface: string;
  timestamp_ms?: number;
  brand?: string;
  before_sha256: string;
  after_sha256: string;
  critic_score?: number;
  before_key: string;
  after_key: string;
}

interface ManifestFile {
  manifest_id: string;
  run_id?: string;
  created_at: string;
  source?: { b2_key: string; sha256: string; hash_type: string };
  retention?: { mode: string; days: number };
  entries?: Array<{
    step: string;
    status: string;
    provider: string;
    model?: string;
    duration_ms?: number;
    error?: string | null;
  }>;
  placements?: ManifestPlacement[];
  summary?: {
    total_steps: number;
    successful_steps: number;
    fallback_steps: number;
    failed_steps: number;
  };
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

interface LockInfo {
  mode: string | null;
  retainUntil: string | null;
}

async function headLock(key: string): Promise<LockInfo> {
  try {
    const res = await getB2Client().send(
      new HeadObjectCommand({ Bucket: env.B2_BUCKET!, Key: key })
    );
    return {
      mode: (res as { ObjectLockMode?: string }).ObjectLockMode ?? null,
      retainUntil: res.ObjectLockRetainUntilDate
        ? res.ObjectLockRetainUntilDate.toISOString()
        : null,
    };
  } catch {
    return { mode: null, retainUntil: null };
  }
}

const FULL_HASH_LIMIT_BYTES = 200 * 1024 * 1024; // spec: full hash for <200MB

async function hashPlacement(key: string, expected: string): Promise<HashCheck> {
  if (!expected) return { expected, actual: null, match: null };
  const bytes = await getB2Bytes(key);
  if (!bytes) return { expected, actual: null, match: false };
  const actual = sha256Hex(bytes);
  return { expected, actual, match: actual === expected };
}

/** Deterministic pseudo-manifest from DB rows — demo mode only. */
async function demoVerify(videoId: string): Promise<VerifyResult> {
  const video = await db.select().from(videos).where(eq(videos.id, videoId)).get();
  if (!video) throw new Error("video not found");
  const creator = await db.select().from(users).where(eq(users.id, video.userId)).get();

  const slotRows = await db
    .select({
      slotId: adSlots.id,
      timestampMs: adSlots.timestampMs,
      surfaceLabel: adSlots.surfaceLabel,
      beforeFrameUrl: adSlots.beforeFrameUrl,
      afterFrameUrl: adSlots.afterFrameUrl,
      brandName: brands.name,
    })
    .from(adSlots)
    .innerJoin(brands, eq(adSlots.brandId, brands.id))
    .where(eq(adSlots.videoId, videoId))
    .orderBy(asc(adSlots.timestampMs));

  const demoSteps: StepEntry[] = [
    { step: "probe", status: "success", provider: "ffprobe", model: "", durationMs: 1200, error: null },
    { step: "transcode-hls", status: "success", provider: "ffmpeg", model: "", durationMs: 45000, error: null },
    { step: "asr", status: "success", provider: "deepgram", model: "nova-3", durationMs: 18000, error: null },
    { step: "scenes", status: "success", provider: "scenedetect", model: "ContentDetector", durationMs: 9000, error: null },
    { step: "vl-caption", status: "success", provider: "mistral", model: "pixtral-large-latest", durationMs: 22000, error: null },
    { step: "chunk", status: "success", provider: "nltk", model: "", durationMs: 300, error: null },
    { step: "embed", status: "fallback", provider: "mistral", model: "mistral-embed", durationMs: 4000, error: null },
    { step: "breaks", status: "success", provider: "deterministic", model: "", durationMs: 150, error: null },
    { step: "slots", status: "success", provider: "mistral", model: "pixtral-large-latest", durationMs: 26000, error: null },
    { step: "brand-match", status: "success", provider: "deterministic", model: "", durationMs: 400, error: null },
    { step: "inpaint", status: "success", provider: "google", model: "gemini-2.5-flash-image", durationMs: 31000, error: null },
    { step: "critic", status: "success", provider: "mistral", model: "mistral-large-latest", durationMs: 9000, error: null },
    { step: "manifest", status: "success", provider: "genblaze", model: "", durationMs: 800, error: null },
  ];

  return {
    state: "demo",
    simulated: true,
    video: {
      id: video.id,
      title: video.title,
      durationMs: video.durationMs,
      creator: creator?.name ?? "Demo Creator",
      processedAt: video.createdAt,
    },
    runId: "run_demo",
    manifestId: "mfst_demo",
    manifestSha256: null,
    retainUntil: null,
    lockMode: "COMPLIANCE (simulated)",
    sourceHash: null,
    steps: demoSteps,
    placements: slotRows.map((s, i) => ({
      slotId: s.slotId,
      surface: s.surfaceLabel ?? "object",
      timestampMs: s.timestampMs,
      brand: s.brandName,
      criticScore: 4.2 + (i % 3) * 0.3, // simulated — labeled as such on the page
      beforeHash: { expected: "", actual: null, match: null },
      afterHash: { expected: "", actual: null, match: null },
      lock: { mode: null, retainUntil: null },
      beforeUrl: s.beforeFrameUrl ?? "",
      afterUrl: s.afterFrameUrl ?? "",
    })),
    summary: {
      totalSteps: demoSteps.length,
      successfulSteps: demoSteps.filter((s) => s.status === "success").length,
      fallbackSteps: 1,
      failedSteps: 0,
    },
  };
}

export async function verifyVideo(videoId: string): Promise<VerifyResult> {
  if (isDemo) return demoVerify(videoId);

  const video = await db.select().from(videos).where(eq(videos.id, videoId)).get();
  if (!video) throw new Error("video not found");
  const creator = await db.select().from(users).where(eq(users.id, video.userId)).get();

  // 1) Manifest bytes (hash the exact bytes, parse separately)
  const manifestKey = `manifests/${videoId}/manifest.json`;
  const manifestBytes = await getB2Bytes(manifestKey);
  if (!manifestBytes) {
    return {
      state: "no-manifest",
      simulated: false,
      video: {
        id: video.id,
        title: video.title,
        durationMs: video.durationMs,
        creator: creator?.name ?? "—",
        processedAt: video.updatedAt,
      },
      runId: null,
      manifestId: null,
      manifestSha256: null,
      retainUntil: null,
      lockMode: null,
      sourceHash: null,
      steps: [],
      placements: [],
      summary: null,
    };
  }

  const manifestSha256 = sha256Hex(manifestBytes);
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf-8")) as ManifestFile;

  // 2) Object Lock on the manifest itself
  const manifestLock = await headLock(manifestKey);

  // 3) Source hash recompute (full for demo-scale videos)
  let sourceHash: VerifyResult["sourceHash"] = null;
  if (manifest.source?.sha256) {
    const sourceBytes = await getB2Bytes(manifest.source.b2_key);
    if (sourceBytes && sourceBytes.length <= FULL_HASH_LIMIT_BYTES) {
      const actual = sha256Hex(sourceBytes);
      sourceHash = {
        expected: manifest.source.sha256,
        actual,
        match: actual === manifest.source.sha256,
        type: manifest.source.hash_type,
      };
    } else {
      sourceHash = { expected: manifest.source.sha256, actual: null, match: null, type: manifest.source.hash_type };
    }
  }

  // 4) Placements: re-hash frames + GOVERNANCE lock reads
  const placements: PlacementVerification[] = [];
  for (const p of manifest.placements ?? []) {
    const [beforeHash, afterHash, afterLock] = await Promise.all([
      hashPlacement(p.before_key, p.before_sha256),
      hashPlacement(p.after_key, p.after_sha256),
      headLock(p.after_key),
    ]);
    placements.push({
      slotId: p.slot_id,
      surface: p.surface,
      timestampMs: p.timestamp_ms ?? 0,
      brand: p.brand ?? "",
      criticScore: p.critic_score ?? 0,
      beforeHash,
      afterHash,
      lock: afterLock,
      // Public frame proxy (long cache TTL so shared verify links don't break)
      beforeUrl: `/api/verify-frames/${videoId}?key=${encodeURIComponent(p.before_key)}`,
      afterUrl: `/api/verify-frames/${videoId}?key=${encodeURIComponent(p.after_key)}`,
    });
  }

  const hashMismatch = placements.some(
    (p) => p.beforeHash.match === false || p.afterHash.match === false
  ) || sourceHash?.match === false;
  const lockOk = manifestLock.mode === "COMPLIANCE";
  const state: VerifyState = !lockOk || hashMismatch ? "warning" : "verified";

  return {
    state,
    simulated: false,
    video: {
      id: video.id,
      title: video.title,
      durationMs: video.durationMs,
      creator: creator?.name ?? "—",
      processedAt: manifest.created_at,
    },
    runId: manifest.run_id ?? null,
    manifestId: manifest.manifest_id,
    manifestSha256,
    retainUntil: manifestLock.retainUntil,
    lockMode: manifestLock.mode ?? manifest.retention?.mode ?? null,
    sourceHash,
    steps: (manifest.entries ?? []).map((e) => ({
      step: e.step,
      status: e.status,
      provider: e.provider,
      model: e.model ?? "",
      durationMs: e.duration_ms ?? 0,
      error: e.error ?? null,
    })),
    placements,
    summary: manifest.summary
      ? {
          totalSteps: manifest.summary.total_steps,
          successfulSteps: manifest.summary.successful_steps,
          fallbackSteps: manifest.summary.fallback_steps,
          failedSteps: manifest.summary.failed_steps,
        }
      : null,
  };
}
