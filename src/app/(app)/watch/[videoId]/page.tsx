import { Suspense } from "react";
import { notFound } from "next/navigation";
import { asc, eq, inArray, and, desc } from "drizzle-orm";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Player, type PlayerAd } from "@/components/player/player";
import { WatchSidebar } from "@/components/player/watch-sidebar";
import { db } from "@/lib/db";
import { adSlots, brands, segments, videos } from "@/lib/db/schema";
import { formatTimestamp } from "@/lib/utils";

interface WatchPageProps {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ t?: string; segment?: string }>;
}

export default async function WatchPage({ params, searchParams }: WatchPageProps) {
  const { videoId } = await params;
  const { t, segment: segmentParam } = await searchParams;

  const video = await db.select().from(videos).where(eq(videos.id, videoId)).get();
  if (!video) notFound();

  const segs = await db
    .select()
    .from(segments)
    .where(eq(segments.videoId, videoId))
    .orderBy(asc(segments.index));

  // Layer 3 pause-ad cues: filled/approved in-scene slots joined to their brand.
  const adRows = await db
    .select({
      slotId: adSlots.id,
      timestampMs: adSlots.timestampMs,
      surfaceLabel: adSlots.surfaceLabel,
      beforeFrameUrl: adSlots.beforeFrameUrl,
      afterFrameUrl: adSlots.afterFrameUrl,
      brandName: brands.name,
      brandColor: brands.colorHex,
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
    .orderBy(desc(adSlots.timestampMs));

  const ads: PlayerAd[] = adRows.map((r) => ({
    slotId: r.slotId,
    timestampMs: r.timestampMs,
    surfaceLabel: r.surfaceLabel ?? "object",
    beforeFrameUrl: r.beforeFrameUrl ?? "",
    afterFrameUrl: r.afterFrameUrl ?? "",
    brandName: r.brandName,
    brandColor: r.brandColor,
  }));

  // Deep link: ?t=<ms> wins; otherwise ?segment=seg_x resolves via DB.
  let startTime = t ? parseInt(t, 10) || 0 : 0;
  if (!startTime && segmentParam) {
    const seg = segs.find((s) => s.id === segmentParam);
    if (seg) startTime = seg.startMs;
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1">
          <Suspense fallback={<Skeleton className="aspect-video w-full" />}>
            <Player videoId={videoId} startTime={startTime} ads={ads} />
          </Suspense>

          <div className="mt-4">
            <h1 className="text-2xl font-bold">{video.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Tutorial</Badge>
              <Badge variant={video.status === "ready" ? "default" : "secondary"}>
                {video.status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {video.durationMs ? formatTimestamp(video.durationMs) : "—"} ·{" "}
                {segs.length} chapters
              </span>
            </div>
            {video.status !== "ready" && (
              <p className="mt-3 rounded-md border border-amber-600/30 bg-amber-600/10 p-3 text-sm text-amber-400">
                This video is still being processed by the AI pipeline — playback will
                start automatically once the HLS ladder is ready.
              </p>
            )}
          </div>
        </div>

        <div className="w-full lg:w-96">
          <WatchSidebar
            videoId={videoId}
            segments={segs.map((s) => ({
              id: s.id,
              index: s.index,
              startMs: s.startMs,
              endMs: s.endMs,
              topic: s.topic,
              transcript: s.transcript,
            }))}
            meta={{
              id: video.id,
              title: video.title,
              status: video.status,
              durationMs: video.durationMs,
              sizeBytes: video.sizeBytes,
              createdAt: video.createdAt,
              segmentCount: segs.length,
            }}
          />
        </div>
      </div>
    </div>
  );
}
