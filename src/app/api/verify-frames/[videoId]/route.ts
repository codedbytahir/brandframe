/**
 * Public frame proxy for the /verify page — streams before/after placement
 * frames (and only those) from the private B2 bucket so the unauthenticated
 * verifier page works without expiring signed URLs. Long cache TTL: verify
 * links are meant to be shared (docs/specs/10 §5).
 *
 * Prefix-restricted to assets/ and manifests/ — never proxies arbitrary keys.
 */
import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { getB2Client } from "@/lib/b2/client";
import { env, isDemo } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_PREFIXES = ["assets/", "manifests/"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  const key = req.nextUrl.searchParams.get("key") ?? "";

  if (
    !key ||
    key.includes("..") ||
    !ALLOWED_PREFIXES.some((p) => key.startsWith(p)) ||
    !key.includes(videoId) // frames must belong to the video being verified
  ) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  if (isDemo) {
    return NextResponse.json({ error: "B2 not configured" }, { status: 404 });
  }

  try {
    const obj = await getB2Client().send(
      new GetObjectCommand({ Bucket: env.B2_BUCKET!, Key: key })
    );
    const webStream = (
      obj.Body as { transformToWebStream?: () => ReadableStream<Uint8Array> } | undefined
    )?.transformToWebStream?.();
    if (!webStream) {
      return NextResponse.json({ error: "Empty object" }, { status: 502 });
    }

    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    const contentType =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : "application/octet-stream";

    return new Response(webStream, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable", // 24h per spec §5
        ...(obj.ContentLength != null ? { "Content-Length": String(obj.ContentLength) } : {}),
      },
    });
  } catch (err) {
    if (err instanceof S3ServiceException) {
      return NextResponse.json({ error: "Frame not found" }, { status: 404 });
    }
    console.error("[verify-frames] failed:", err);
    return NextResponse.json({ error: "Frame proxy failed" }, { status: 500 });
  }
}
