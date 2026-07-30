import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getB2Client } from "@/lib/b2/client";
import { uploadKey } from "@/lib/b2/paths";
import { env } from "@/lib/env";
import { shortId } from "@/lib/utils";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filename, contentType, sizeBytes, title } = body;

    if (!filename || !contentType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!contentType.startsWith("video/")) {
      return NextResponse.json({ error: "Only video files are allowed" }, { status: 400 });
    }

    if (sizeBytes > 5 * 1024 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 5GB)" }, { status: 400 });
    }

    const videoId = shortId("vid");
    const key = uploadKey(videoId);

    const s3 = getB2Client();
    const command = new PutObjectCommand({
      Bucket: env.B2_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    return NextResponse.json({
      videoId,
      uploadUrl: presignedUrl,
      key,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }
}
