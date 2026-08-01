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
  copy?: string;
  targetUrl?: string;
  brandLogoUrl?: string | null;
}

export interface MidrollAd {
  breakId: string;
  timestampMs: number;
  brandName: string;
  brandColor: string;
  creativeUrl: string;
  copy: string;
  targetUrl: string;
}

interface PlayerProps {
  videoId: string;
  startTime?: number;
  className?: string;
  onTimeUpdate?: (timeMs: number) => void;
  onCue?: (cue: { timestampMs: number; slotId: string }) => void;
  ads?: PlayerAd[];
  midrolls?: MidrollAd[];
}

interface PlaybackInfo {
  hlsUrl: string;
  posterUrl: string | null;
  captionsUrl: string;
}

export function Player({ videoId, startTime = 0, className, onTimeUpdate, onCue, ads = [], midrolls = [] }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentAd, setCurrentAd] = useState<PlayerAd | null>(null);
  const [showPauseAd, setShowPauseAd] = useState(false);
  const [currentMidroll, setCurrentMidroll] = useState<MidrollAd | null>(null);
  const [skipCountdown, setSkipCountdown] = useState(0);
  const hlsRef = useRef<Hls | null>(null);
  const pendingStartRef = useRef(startTime);
  // Each cue fires at most once per playback session
  const shownPauseAdsRef = useRef<Set<string>>(new Set());
  const shownMidrollsRef = useRef<Set<string>>(new Set());

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
      // Layer 3: auto-pause at the cue (±400ms), once per session (spec §3.5)
      if (
        Math.abs(timeMs - ad.timestampMs) <= 400 &&
        !shownPauseAdsRef.current.has(ad.slotId) &&
        !currentMidroll
      ) {
        shownPauseAdsRef.current.add(ad.slotId);
        console.log("[ads] ad_impression", { layer: 3, slotId: ad.slotId, ms: ad.timestampMs });
        video.pause();
        setCurrentAd(ad);
        setShowPauseAd(true);
        return; // one overlay at a time
      }
    }

    // Layer 2: natural-break mid-roll (±400ms), once per session
    if (!currentMidroll && !showPauseAd) {
      for (const m of midrolls) {
        if (Math.abs(timeMs - m.timestampMs) <= 400 && !shownMidrollsRef.current.has(m.breakId)) {
          shownMidrollsRef.current.add(m.breakId);
          console.log("[ads] ad_impression", { layer: 2, breakId: m.breakId, ms: m.timestampMs });
          video.pause();
          setCurrentMidroll(m);
          setSkipCountdown(6);
          break;
        }
      }
    }
  }, [ads, midrolls, currentMidroll, showPauseAd, onTimeUpdate, onCue]);

  // Mid-roll: 6s skip countdown; auto-resume after 8s total (spec §2 UX)
  useEffect(() => {
    if (!currentMidroll) return;
    const tick = setInterval(() => setSkipCountdown((c) => Math.max(0, c - 1)), 1000);
    const autoResume = setTimeout(() => {
      setCurrentMidroll(null);
      videoRef.current?.play().catch(() => {});
    }, 8000);
    return () => {
      clearInterval(tick);
      clearTimeout(autoResume);
    };
  }, [currentMidroll]);

  const dismissMidroll = useCallback(() => {
    if (currentMidroll) {
      console.log("[ads] ad_skipped", { layer: 2, breakId: currentMidroll.breakId });
    }
    setCurrentMidroll(null);
    videoRef.current?.play().catch(() => {});
  }, [currentMidroll]);

  const handlePause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const timeMs = Math.floor(video.currentTime * 1000);

    // Manual pause within a slot's cue window (5s) also surfaces the pause ad,
    // unless it already fired this session.
    const match = ads.find(
      (a) => a.timestampMs <= timeMs + 1000 && a.timestampMs + 5000 >= timeMs
    );
    if (match && !shownPauseAdsRef.current.has(match.slotId)) {
      shownPauseAdsRef.current.add(match.slotId);
      console.log("[ads] ad_impression", { layer: 3, slotId: match.slotId, ms: match.timestampMs });
      setCurrentAd(match);
      setShowPauseAd(true);
    }
  }, [ads]);

  const handlePlay = useCallback(() => {
    setShowPauseAd(false);
    setCurrentAd(null);
  }, []);

  const dismissAd = useCallback(() => {
    if (currentAd) {
      console.log("[ads] ad_skipped", { layer: 3, slotId: currentAd.slotId });
    }
    setShowPauseAd(false);
    setCurrentAd(null);
    videoRef.current?.play().catch(() => {});
  }, [currentAd]);

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

      {/* Layer 2 — Natural-break mid-roll */}
      {currentMidroll && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/85">
          <div className="relative w-full max-w-md rounded-lg bg-card p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="inline-flex items-center rounded-md border border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground">
                Sponsored
              </span>
              <span className="text-xs text-muted-foreground">
                Ad · {currentMidroll.brandName}
              </span>
            </div>

            {currentMidroll.creativeUrl ? (
              <a href={currentMidroll.targetUrl} target="_blank" rel="noopener noreferrer sponsored">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentMidroll.creativeUrl}
                  alt={`${currentMidroll.brandName} creative`}
                  className="mb-3 w-full rounded-md"
                />
              </a>
            ) : (
              <div
                className="mb-3 flex aspect-video items-center justify-center rounded-md text-lg font-semibold text-white"
                style={{ backgroundColor: currentMidroll.brandColor }}
              >
                {currentMidroll.brandName}
              </div>
            )}
            {currentMidroll.copy && (
              <p className="mb-3 text-sm text-muted-foreground">{currentMidroll.copy}</p>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Video resumes automatically</span>
              <button
                onClick={dismissMidroll}
                disabled={skipCountdown > 0}
                className="rounded-md bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
              >
                {skipCountdown > 0 ? `Skip in ${skipCountdown}` : "Skip"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Layer 3 — In-scene pause ad (crossfades to the inpainted frame) */}
      {showPauseAd && currentAd && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
          <div className="relative max-w-lg rounded-lg bg-card p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: currentAd.brandColor }}
              >
                {currentAd.brandLogoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={currentAd.brandLogoUrl} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                )}
                AI Ad · {currentAd.brandName}
              </span>
              <a
                href={`/verify/${videoId}#slot-${currentAd.slotId}`}
                className="inline-flex items-center gap-1 rounded-md bg-amber-600/20 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-600/30"
              >
                Why?
              </a>
            </div>
            {/* crossfade before → after (200ms per spec §3.5) */}
            <div className="relative mb-3 overflow-hidden rounded-md">
              {currentAd.beforeFrameUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentAd.beforeFrameUrl} alt="Original scene" className="w-full" />
              )}
              {currentAd.afterFrameUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentAd.afterFrameUrl}
                  alt="Brand-integrated scene"
                  className="absolute inset-0 h-full w-full animate-[crossfade_0.2s_ease-in_forwards] opacity-0"
                />
              )}
              {!currentAd.afterFrameUrl && !currentAd.beforeFrameUrl && (
                <div className="flex aspect-video items-center justify-center bg-muted text-sm text-muted-foreground">
                  {currentAd.surfaceLabel} → {currentAd.brandName}
                </div>
              )}
            </div>
            {currentAd.copy && <p className="mb-2 text-sm">{currentAd.copy}</p>}
            <p className="mb-4 text-xs text-muted-foreground">
              This placement was generated by AI, approved by the creator, and
              cryptographically recorded. ({currentAd.surfaceLabel} replaced in-scene.)
            </p>
            <div className="flex items-center justify-between gap-2">
              {currentAd.targetUrl && currentAd.targetUrl !== "#" ? (
                <a
                  href={currentAd.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="text-xs text-primary hover:underline"
                >
                  Learn more
                </a>
              ) : (
                <span />
              )}
              <button
                onClick={dismissAd}
                className="rounded-md bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90"
              >
                Play · Skip ad
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
