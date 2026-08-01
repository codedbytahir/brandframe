import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isDemo } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  try {
    const video = await db
      .select()
      .from(videos)
      .where(eq(videos.id, videoId))
      .get();

    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    if (video.status !== "ready") {
      return NextResponse.json(
        { error: "Video not ready yet", code: "VIDEO_NOT_READY", status: video.status },
        { status: 409 }
      );
    }

    // Real mode: route HLS + poster through the same-origin B2 proxy (see the
    // file/[...path] route for why presigned URLs can't cover HLS playlists).
    // Demo mode: no B2 — use the URL recorded in the DB (seed corpus uses a
    // public test stream so playback works offline).
    const hlsUrl = isDemo
      ? video.hlsUrl
      : `/api/playback/${video.id}/file/hls/master.m3u8`;
    const posterUrl = video.posterUrl
      ? video.posterUrl
      : isDemo
        ? null
        : `/api/playback/${video.id}/file/poster.jpg`;

    if (!hlsUrl) {
      return NextResponse.json(
        { error: "No playable rendition available", code: "VIDEO_NOT_READY", status: video.status },
        { status: 409 }
      );
    }

    return NextResponse.json({
      videoId: video.id,
      hlsUrl,
      posterUrl,
      title: video.title,
      durationMs: video.durationMs,
      captionsUrl: `/api/captions/${video.id}`,
    });
  } catch (error) {
    console.error("[playback] failed:", error);
    return NextResponse.json({ error: "Failed to get playback URL" }, { status: 500 });
  }
}
