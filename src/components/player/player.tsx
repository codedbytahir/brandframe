"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { cn } from "@/lib/utils";

interface PlayerProps {
  videoId: string;
  startTime?: number;
  className?: string;
  onTimeUpdate?: (timeMs: number) => void;
  onCue?: (cue: { timestampMs: number; slotId: string }) => void;
  ads?: Array<{
    slotId: string;
    timestampMs: number;
    brandName: string;
    brandColor: string;
    afterFrameUrl: string;
    beforeFrameUrl: string;
    surfaceLabel: string;
  }>;
}

export function Player({ videoId, startTime = 0, className, onTimeUpdate, onCue, ads = [] }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [currentAd, setCurrentAd] = useState<typeof ads[0] | null>(null);
  const [showPauseAd, setShowPauseAd] = useState(false);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const src = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (startTime > 0) video.currentTime = startTime / 1000;
        video.play().catch(() => {});
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      if (startTime > 0) video.currentTime = startTime / 1000;
    }

    return () => {
      hlsRef.current?.destroy();
    };
  }, [videoId, startTime]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const timeMs = Math.floor(video.currentTime * 1000);
    onTimeUpdate?.(timeMs);

    // Check for ad cues
    for (const ad of ads) {
      if (Math.abs(timeMs - ad.timestampMs) < 100) {
        onCue?.({ timestampMs: ad.timestampMs, slotId: ad.slotId });
      }
    }
  }, [ads, onTimeUpdate, onCue]);

  const handlePause = useCallback(() => {
    setIsPaused(true);
    const video = videoRef.current;
    if (!video) return;
    const timeMs = Math.floor(video.currentTime * 1000);

    // Find matching pause ad (Layer 3)
    const match = ads.find(
      (a) => a.timestampMs <= timeMs + 1000 && a.timestampMs + 5000 >= timeMs
    );
    if (match) {
      setCurrentAd(match);
      setShowPauseAd(true);
    }
  }, [ads]);

  const handlePlay = useCallback(() => {
    setIsPaused(false);
    setShowPauseAd(false);
    setCurrentAd(null);
  }, []);

  const dismissAd = useCallback(() => {
    setShowPauseAd(false);
    setCurrentAd(null);
    videoRef.current?.play().catch(() => {});
  }, []);

  return (
    <div ref={containerRef} className={cn("relative aspect-video overflow-hidden rounded-lg bg-black", className)}>
      <video
        ref={videoRef}
        className="h-full w-full"
        controls
        onTimeUpdate={handleTimeUpdate}
        onPause={handlePause}
        onPlay={handlePlay}
      />

      {/* Pause Ad Overlay */}
      {showPauseAd && currentAd && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
          <div className="relative max-w-lg rounded-lg bg-card p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: currentAd.brandColor }}
              >
                {currentAd.brandName}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-600/20 px-2 py-0.5 text-xs text-amber-400">
                AI Ad · Why?
              </span>
            </div>
            {currentAd.afterFrameUrl ? (
              <img
                src={currentAd.afterFrameUrl}
                alt="Pause ad"
                className="mb-3 w-full rounded-md"
              />
            ) : (
              <div className="mb-3 flex aspect-video items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                {currentAd.surfaceLabel} → {currentAd.brandName}
              </div>
            )}
            <p className="mb-4 text-xs text-muted-foreground">
              This ad replaces a {currentAd.surfaceLabel} in the scene. Creator-approved.
              <a href={`/verify/${videoId}`} className="ml-1 text-primary hover:underline">Learn more</a>
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={dismissAd}
                className="rounded-md bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
