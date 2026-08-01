"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { cn } from "@/lib/utils";

/** Custom event so chat/citation chips can seek the player (and vice versa). */
export const SEEK_EVENT = "brandframe:seek";

export interface PlayerAd {
  slotId: string;
  timestampMs: number;
  brandName: string;
  brandColor: string;
  afterFrameUrl: string;
  beforeFrameUrl: string;
  surfaceLabel: string;
}

interface PlayerProps {
  videoId: string;
  startTime?: number;
  className?: string;
  onTimeUpdate?: (timeMs: number) => void;
  onCue?: (cue: { timestampMs: number; slotId: string }) => void;
  ads?: PlayerAd[];
}

interface PlaybackInfo {
  hlsUrl: string;
  posterUrl: string | null;
  captionsUrl: string;
}

export function Player({ videoId, startTime = 0, className, onTimeUpdate, onCue, ads = [] }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentAd, setCurrentAd] = useState<PlayerAd | null>(null);
  const [showPauseAd, setShowPauseAd] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  const pendingStartRef = useRef(startTime);

  // ── Resolve playback source (real B2 proxy or demo fallback) ─────────────
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const res = await fetch(`/api/playback/${videoId}`);
        if (res.status === 409) {
          // Still processing — poll until ready.
          if (!cancelled) {
            setLoadError("Video is still processing — retrying…");
            retry = setTimeout(load, 5000);
          }
          return;
        }
        if (!res.ok) throw new Error(`playback ${res.status}`);
        const info = (await res.json()) as PlaybackInfo;
        if (!cancelled) {
          setPlayback(info);
          setLoadError(null);
        }
      } catch {
        if (!cancelled) setLoadError("Couldn't load the stream. Is the app configured?");
      }
    }
    load();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [videoId]);

  // ── Attach HLS once the source is known (source changes only) ────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playback?.hlsUrl) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(playback.hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (pendingStartRef.current > 0) video.currentTime = pendingStartRef.current / 1000;
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setLoadError("Stream error — the HLS ladder may not exist on B2 yet.");
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playback.hlsUrl;
      if (pendingStartRef.current > 0) video.currentTime = pendingStartRef.current / 1000;
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [playback?.hlsUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── External seeks: citation chips / deep links. No stream reload. ───────
  useEffect(() => {
    pendingStartRef.current = startTime;
    const video = videoRef.current;
    if (video && startTime > 0 && video.readyState >= 1) {
      video.currentTime = startTime / 1000;
    }
  }, [startTime]);

  useEffect(() => {
    function onSeek(e: Event) {
      const ms = (e as CustomEvent<{ ms: number }>).detail?.ms;
      const video = videoRef.current;
      if (typeof ms === "number" && video) {
        video.currentTime = ms / 1000;
        video.play().catch(() => {});
      }
    }
    window.addEventListener(SEEK_EVENT, onSeek);
    return () => window.removeEventListener(SEEK_EVENT, onSeek);
  }, []);

  // ── Keyboard shortcuts (player focused): ←/→ 5s, space/k, f, m ───────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const video = videoRef.current;
    if (!video) return;
    switch (e.key) {
      case "ArrowLeft":
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;
      case "ArrowRight":
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
        break;
      case " ":
      case "k":
        e.preventDefault();
        if (video.paused) video.play().catch(() => {});
        else video.pause();
        break;
      case "f":
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else containerRef.current?.requestFullscreen().catch(() => {});
        break;
      case "m":
        video.muted = !video.muted;
        break;
      default:
        return;
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const timeMs = Math.floor(video.currentTime * 1000);
    onTimeUpdate?.(timeMs);

    for (const ad of ads) {
      if (Math.abs(timeMs - ad.timestampMs) < 100) {
        onCue?.({ timestampMs: ad.timestampMs, slotId: ad.slotId });
      }
    }
  }, [ads, onTimeUpdate, onCue]);

  const handlePause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const timeMs = Math.floor(video.currentTime * 1000);

    // Layer 3 pause ad: slot whose cue window contains the pause point
    const match = ads.find(
      (a) => a.timestampMs <= timeMs + 1000 && a.timestampMs + 5000 >= timeMs
    );
    if (match) {
      setCurrentAd(match);
      setShowPauseAd(true);
    }
  }, [ads]);

  const handlePlay = useCallback(() => {
    setShowPauseAd(false);
    setCurrentAd(null);
  }, []);

  const dismissAd = useCallback(() => {
    setShowPauseAd(false);
    setCurrentAd(null);
    videoRef.current?.play().catch(() => {});
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative aspect-video overflow-hidden rounded-lg bg-black outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className
      )}
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        controls
        playsInline
        poster={playback?.posterUrl ?? undefined}
        onTimeUpdate={handleTimeUpdate}
        onPause={handlePause}
        onPlay={handlePlay}
      >
        {playback?.captionsUrl && (
          <track kind="captions" src={playback.captionsUrl} srcLang="en" label="English" default />
        )}
      </video>

      {/* Load / processing state */}
      {loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-6 text-center text-sm text-muted-foreground">
          {loadError}
        </div>
      )}

      {/* Layer 3 Pause Ad Overlay */}
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
              <a
                href={`/verify/${videoId}#slot-${currentAd.slotId}`}
                className="inline-flex items-center gap-1 rounded-md bg-amber-600/20 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-600/30"
              >
                AI Ad · Why?
              </a>
            </div>
            {/* crossfade before → after */}
            <div className="relative mb-3 overflow-hidden rounded-md">
              {currentAd.beforeFrameUrl && (
                <img src={currentAd.beforeFrameUrl} alt="Original scene" className="w-full" />
              )}
              {currentAd.afterFrameUrl && (
                <img
                  src={currentAd.afterFrameUrl}
                  alt="Brand-integrated scene"
                  className="absolute inset-0 h-full w-full animate-[crossfade_1.2s_ease-in_forwards] opacity-0"
                />
              )}
              {!currentAd.afterFrameUrl && !currentAd.beforeFrameUrl && (
                <div className="flex aspect-video items-center justify-center bg-muted text-sm text-muted-foreground">
                  {currentAd.surfaceLabel} → {currentAd.brandName}
                </div>
              )}
            </div>
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
