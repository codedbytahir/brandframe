import type { Cue, SlotLayer } from "@/lib/types";

export interface CuePlannerOptions {
  videoId: string;
  durationMs: number;
  slots: Array<{
    id: string;
    layer: SlotLayer;
    timestampMs: number;
    brandName: string;
    brandColor: string;
    afterFrameUrl: string;
    beforeFrameUrl: string;
    surfaceLabel: string;
  }>;
  breaks: Array<{ timestampMs: number; score: number }>;
  currentTimeMs?: number;
}

export function planCues(options: CuePlannerOptions): Cue[] {
  const { slots, breaks, durationMs, currentTimeMs = 0 } = options;
  const cues: Cue[] = [];

  // Layer 3 — Pause ads (max 1 per 3-5 min)
  const layer3Slots = slots
    .filter((s) => s.layer === 3)
    .filter((s) => s.timestampMs >= 180000); // Not in first 3 min

  // Pick one slot per 3-5 minute window
  let lastLayer3Ms = -300000;
  for (const slot of layer3Slots) {
    if (slot.timestampMs - lastLayer3Ms >= 180000 && slot.timestampMs + 300000 <= durationMs) {
      cues.push({
        slotId: slot.id,
        videoId: options.videoId,
        layer: 3,
        timestampMs: slot.timestampMs,
        durationMs: 0, // pause ad - no duration
        brandName: slot.brandName,
        brandColor: slot.brandColor,
        afterFrameUrl: slot.afterFrameUrl,
        beforeFrameUrl: slot.beforeFrameUrl,
        surfaceLabel: slot.surfaceLabel,
      });
      lastLayer3Ms = slot.timestampMs;
    }
  }

  // Layer 2 — Natural break mid-rolls (max 1 per 3 min, not first 60s)
  const layer2Slots = slots.filter((s) => s.layer === 2);
  let lastBreakMs = -180000;
  for (const brk of breaks) {
    if (brk.timestampMs < 60000) continue; // Not in first 60s
    if (brk.timestampMs - lastBreakMs < 180000) continue;

    const match = layer2Slots.find(
      (s) => Math.abs(s.timestampMs - brk.timestampMs) < 5000
    );
    if (match) {
      cues.push({
        slotId: match.id,
        videoId: options.videoId,
        layer: 2,
        timestampMs: brk.timestampMs,
        durationMs: 6000,
        brandName: match.brandName,
        brandColor: match.brandColor,
        afterFrameUrl: match.afterFrameUrl,
        beforeFrameUrl: match.beforeFrameUrl,
        surfaceLabel: match.surfaceLabel,
      });
      lastBreakMs = brk.timestampMs;
    }
  }

  return cues;
}
