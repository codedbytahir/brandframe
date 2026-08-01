/**
 * Same-origin streaming proxy for HLS assets on Backblaze B2.
 *
 * Why a proxy instead of presigned URLs (see backblaze.com/apidocs — S3-
 * Compatible API): a presigned URL authorizes ONE object. An HLS master
 * playlist references variant playlists and segments by *relative* URI, and
 * hls.js fetches those without any signature — so presigning alone can't
 * protect a private bucket. Proxying keeps the bucket private (and Object
 * Lock intact) while giving the browser a same-origin URL space: relative
 * playlist URIs resolve right back through this route.
 *
 * Maps /api/playback/<videoId>/file/<...path> → b2://<bucket>/playable/<videoId>/<path>
 */
import { NextResponse } from "next/server";
import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getB2Client } from "@/lib/b2/client";
import { env, isDemo } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl",
  ts: "video/mp2t",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  vtt: "text/vtt; charset=utf-8",
  json: "application/json",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ videoId: string; path: string[] }> }
) {
  const { videoId, path } = await params;
  const rel = path.join("/");

  // Path traversal guard
  if (rel.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const video = await db.select().from(videos).where(eq(videos.id, videoId)).get();
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    if (video.status !== "ready") {
      return NextResponse.json(
        { error: "Video not ready yet", code: "VIDEO_NOT_READY", status: video.status },
        { status: 409 }
      );
    }
    if (isDemo) {
      return NextResponse.json(
        { error: "B2 not configured — demo mode serves streams from video.hlsUrl" },
        { status: 404 }
      );
    }

    const key = `playable/${videoId}/${rel}`;
    const range = req.headers.get("range") ?? undefined;

    const obj = await getB2Client().send(
      new GetObjectCommand({ Bucket: env.B2_BUCKET!, Key: key, Range: range })
    );

    const webStream = (
      obj.Body as { transformToWebStream?: () => ReadableStream<Uint8Array> } | undefined
    )?.transformToWebStream?.();
    if (!webStream) {
      return NextResponse.json({ error: "Empty object body" }, { status: 502 });
    }

    const ext = rel.split(".").pop()?.toLowerCase() ?? "";
    const headers = new Headers({
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      // Playlists must always be revalidated; immutable segments can be cached hard.
      "Cache-Control": ext === "m3u8" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    if (obj.ContentLength != null) headers.set("Content-Length", String(obj.ContentLength));
    if (obj.ContentRange) headers.set("Content-Range", obj.ContentRange);

    return new Response(webStream, {
      status: obj.ContentRange ? 206 : 200,
      headers,
    });
  } catch (err) {
    if (err instanceof S3ServiceException) {
      if (err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return NextResponse.json({ error: "Object not found" }, { status: 404 });
      }
      console.error(`[playback-proxy] B2 error: ${err.name} ${err.message}`);
      return NextResponse.json({ error: "Storage backend error" }, { status: 502 });
    }
    console.error("[playback-proxy] unexpected:", err);
    return NextResponse.json({ error: "Playback proxy failed" }, { status: 500 });
  }
}
