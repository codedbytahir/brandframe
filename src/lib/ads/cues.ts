/**
 * Server-side cue planner (docs/specs/09 §4): builds the ad cue list for a
 * video at page-load time — no client-side auction.
 *
 * Data: `ad_slots` ⨝ `brands` (Layer 3), `natural_breaks` (Layer 2, from the
 * pipeline `breaks` step or seeds; falls back to the B2 sidecar
 * `assets/<videoId>/breaks.json` when the DB has none but B2 is configured).
 *
 * Caps enforced here as defense-in-depth (pipeline also enforces):
 *   Layer 2: none in first 60s, ≥180s apart, score ≥55 (of 100).
 *   Layer 3: ≥180s between pause ads.
 *   Never stacked: within 10s of a Layer-3 cue, Layer-2 loses (spec §3.5).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { adSlots, brands, naturalBreaks, segments, videos } from "@/lib/db/schema";
import { getB2Json } from "@/lib/b2/client";
import { isDemo } from "@/lib/env";
import { listBrands, matchBrandIntent, type BrandRecord } from "./intent";

export interface PauseAdCue {
  kind: "pausead";
  slotId: string;
  ms: number;
  surfaceLabel: string;
  beforeFrameUrl: string;
  afterFrameUrl: string;
  brandName: string;
  brandColor: string;
  brandLogoUrl: string | null;
  copy: string;
  targetUrl: string;
}

export interface MidrollCue {
  kind: "midroll";
  breakId: string;
  ms: number;
  score: number;
  brandName: string;
  brandColor: string;
  creativeUrl: string;
  copy: string;
  targetUrl: string;
}

export interface AdCuePlan {
  pauseAds: PauseAdCue[];
  midrolls: MidrollCue[];
}

const BREAK_THRESHOLD_0_100 = 55;
const FIRST_ALLOWED_MS = 60_000;
const MIDROLL_SPACING_MS = 180_000;
const PAUSEAD_SPACING_MS = 180_000;
const CONFLICT_WINDOW_MS = 10_000; // pause ad wins within ±10s

async function loadBreaks(videoId: string): Promise<Array<{ id: string; ms: number; score: number }>> {
  const rows = await db
    .select()
    .from(naturalBreaks)
    .where(eq(naturalBreaks.videoId, videoId))
    .orderBy(asc(naturalBreaks.timestampMs));
  if (rows.length > 0) {
    return rows.map((r) => ({ id: r.id, ms: r.timestampMs, score: r.score }));
  }
  // Sidecar fallback: pipeline wrote breaks.json but webhook hasn't imported it
  if (!isDemo) {
    const sc = await getB2Json<{ breaks: Array<{ timestamp_ms: number; score: number }> }>(
      `assets/${videoId}/breaks.json`
    );
    if (sc?.breaks?.length) {
      return sc.breaks.map((b, i) => ({ id: `brk_side_${i}`, ms: b.timestamp_ms, score: b.score }));
    }
  }
  return [];
}

/** Max segment end = effective duration (pipeline stops writing DB duration). */
async function getDurationMs(videoId: string): Promise<number | null> {
  const rows = await db
    .select({ endMs: segments.endMs })
    .from(segments)
    .where(eq(segments.videoId, videoId));
  if (rows.length === 0) return null;
  return rows.reduce((m, r) => Math.max(m, r.endMs), 0);
}

/** One brand per video (demo simplification, spec §3.2): the brand already
 * attached to the video's slots, else a low-bar intent match on the video's
 * topics, else the first opted-in brand. */
async function pickVideoBrand(videoId: string, slotBrands: BrandRecord[]): Promise<BrandRecord | null> {
  if (slotBrands.length > 0) return slotBrands[0];

  const video = await db.select().from(videos).where(eq(videos.id, videoId)).get();
  const topics = await db
    .select({ topic: segments.topic })
    .from(segments)
    .where(eq(segments.videoId, videoId));
  const text = [video?.title ?? "", ...topics.map((t) => t.topic ?? "")].join(". ");

  const match = text.trim() ? await matchBrandIntent(text, 0.15) : null;
  if (match) return match.brand;

  const all = await listBrands();
  return all[0] ?? null;
}

export async function buildAdCues(videoId: string): Promise<AdCuePlan> {
  // ── Layer 3: pause ads from filled/approved slots ───────────────────────
  const slotRows = await db
    .select({
      slotId: adSlots.id,
      ms: adSlots.timestampMs,
      surfaceLabel: adSlots.surfaceLabel,
      beforeFrameUrl: adSlots.beforeFrameUrl,
      afterFrameUrl: adSlots.afterFrameUrl,
      brandName: brands.name,
      brandColor: brands.colorHex,
      brandLogoUrl: brands.logoUrl,
      copy: brands.copy,
      targetUrl: brands.targetUrl,
      brandId: brands.id,
      brandCategory: brands.category,
      brandPackshot: brands.packshotUrl,
      allowedSurfaces: brands.allowedSurfaces,
    })
    .from(adSlots)
    .innerJoin(brands, eq(adSlots.brandId, brands.id))
    .where(
      and(
        eq(adSlots.videoId, videoId),
        eq(adSlots.layer, 3),
        inArray(adSlots.status, ["filled", "approved"])
      )
    )
    .orderBy(asc(adSlots.timestampMs));

  const pauseAds: PauseAdCue[] = [];
  let lastPauseMs = -PAUSEAD_SPACING_MS;
  const slotBrands: BrandRecord[] = [];
  for (const s of slotRows) {
    if (s.ms - lastPauseMs < PAUSEAD_SPACING_MS) continue;
    lastPauseMs = s.ms;
    pauseAds.push({
      kind: "pausead",
      slotId: s.slotId,
      ms: s.ms,
      surfaceLabel: s.surfaceLabel ?? "object",
      beforeFrameUrl: s.beforeFrameUrl ?? "",
      afterFrameUrl: s.afterFrameUrl ?? "",
      brandName: s.brandName,
      brandColor: s.brandColor,
      brandLogoUrl: s.brandLogoUrl,
      copy: s.copy,
      targetUrl: s.targetUrl,
    });
    slotBrands.push({
      id: s.brandId,
      name: s.brandName,
      category: s.brandCategory,
      logoUrl: s.brandLogoUrl,
      packshotUrl: s.brandPackshot,
      copy: s.copy,
      targetUrl: s.targetUrl,
      colorHex: s.brandColor,
      allowedSurfaces: JSON.parse(s.allowedSurfaces || "[]") as string[],
    });
  }

  // ── Layer 2: natural-break mid-rolls ────────────────────────────────────
  const breaks = await loadBreaks(videoId);
  const midrollBrand = await pickVideoBrand(videoId, slotBrands);

  // Duration-adaptive bounds: the long-form defaults (60s / 180s) exclude
  // short clips entirely — scale proportionally (mirrors compute_breaks).
  const durationMs = await getDurationMs(videoId);
  const firstAllowed = durationMs
    ? Math.min(FIRST_ALLOWED_MS, Math.floor(durationMs * 0.15))
    : FIRST_ALLOWED_MS;
  const spacing = durationMs
    ? Math.min(MIDROLL_SPACING_MS, Math.max(30_000, Math.floor(durationMs * 0.25)))
    : MIDROLL_SPACING_MS;

  const midrolls: MidrollCue[] = [];
  if (midrollBrand) {
    const eligible = breaks
      .filter((b) => b.ms >= firstAllowed && b.score >= BREAK_THRESHOLD_0_100)
      .sort((a, b) => b.score - a.score);

    const accepted: typeof eligible = [];
    for (const brk of eligible) {
      if (!accepted.every((a) => Math.abs(a.ms - brk.ms) >= spacing)) continue;
      // Pause ad wins within ±10s (spec §3.5: never stacked)
      if (pauseAds.some((p) => Math.abs(p.ms - brk.ms) < CONFLICT_WINDOW_MS)) continue;
      accepted.push(brk);
    }
    accepted.sort((a, b) => a.ms - b.ms);

    for (const brk of accepted) {
      midrolls.push({
        kind: "midroll",
        breakId: brk.id,
        ms: brk.ms,
        score: brk.score,
        brandName: midrollBrand.name,
        brandColor: midrollBrand.colorHex,
        creativeUrl: midrollBrand.packshotUrl ?? midrollBrand.logoUrl ?? "",
        copy: midrollBrand.copy,
        targetUrl: midrollBrand.targetUrl,
      });
    }
  }

  const plan = { pauseAds, midrolls };
  console.log(
    `[ads] cues for ${videoId}: ${plan.pauseAds.length} pause-ads, ${plan.midrolls.length} mid-rolls`
  );
  return plan;
}
