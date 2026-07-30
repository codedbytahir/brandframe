import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { b2PublicUrl } from "@/lib/b2/client";
import { env } from "@/lib/env";

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
        { error: "Video not ready yet", status: video.status },
        { status: 409 }
      );
    }

    const bucket = env.B2_BUCKET || "";

    return NextResponse.json({
      videoId: video.id,
      hlsUrl: video.hlsUrl || b2PublicUrl(bucket, video.b2Key.replace("uploads/", "playable/").replace("source.mp4", "hls/master.m3u8")),
      posterUrl: video.posterUrl || null,
      title: video.title,
      durationMs: video.durationMs,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to get playback URL" }, { status: 500 });
  }
}
