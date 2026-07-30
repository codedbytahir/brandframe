import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Parse B2 Event Notification payload
    const { records } = body;
    if (!records || records.length === 0) {
      return NextResponse.json({ error: "No records" }, { status: 400 });
    }

    const record = records[0];
    const key = record.s3?.object?.key || record.objectKey;

    // Extract videoId from key: uploads/<videoId>/source.mp4
    const match = key?.match(/^uploads\/(vid_\w+)\//);
    if (!match) {
      return NextResponse.json({ error: "Invalid key pattern" }, { status: 400 });
    }

    const videoId = match[1];

    // Update video status to processing
    await db
      .update(videos)
      .set({ status: "processing", updatedAt: new Date().toISOString() })
      .where(eq(videos.id, videoId));

    // TODO: Trigger pipeline via runIngestPipeline

    return NextResponse.json({ status: "processing", videoId });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
