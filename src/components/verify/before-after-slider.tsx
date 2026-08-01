"use client";

import { useState } from "react";

/**
 * Before/after comparison slider (docs/specs/10 §5.4) — a range input
 * cross-fades between the original frame and the AI-inpainted frame.
 */
export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  label,
}: {
  beforeUrl: string;
  afterUrl: string;
  label: string;
}) {
  // 1 = show "before" fully; 0 = show "after" fully. Start mid for affordance.
  const [pos, setPos] = useState(0.5);

  if (!beforeUrl && !afterUrl) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
        Frames unavailable in demo mode
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-md bg-black select-none">
        {/* after (AI placement) as the base layer */}
        {afterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={afterUrl}
            alt={`After: AI ${label} placement`}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        )}
        {/* before clipped by slider position */}
        {beforeUrl && (
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ clipPath: `inset(0 ${100 - pos * 100}% 0 0)` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={beforeUrl}
              alt={`Before: original ${label}`}
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
          </div>
        )}
        {/* divider line */}
        <div
          className="absolute inset-y-0 w-0.5 bg-white/80 shadow-[0_0_8px_rgba(0,0,0,0.8)]"
          style={{ left: `${pos * 100}%` }}
        />
        {/* corner labels */}
        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Before
        </span>
        <span className="absolute right-2 top-2 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
          After · AI
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(pos * 100)}
        onChange={(e) => setPos(Number(e.target.value) / 100)}
        className="w-full accent-primary"
        aria-label={`Compare before and after frames for ${label}`}
      />
    </div>
  );
}
