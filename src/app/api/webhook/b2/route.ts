import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { videos } from "@/lib/db/schema";
import { runIngestPipeline } from "@/lib/pipelines/run";
import { addPipelineLog } from "@/lib/pipelines/logs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Parse B2 Event Notification payload
    const records = body.records || body.Records || [];
    if (records.length === 0) {
      return NextResponse.json({ error: "No records" }, { status: 400 });
    }

    const record = records[0];

    // Handle different B2 notification formats
    const key = record.s3?.object?.key || record.objectKey || record.key || "";
    const eventName = record.eventName || record.Event || "s3:ObjectCreated:Put";

    // Only process ObjectCreated events
    if (!eventName.includes("ObjectCreated")) {
      return NextResponse.json({ status: "ignored", event: eventName });
    }

    // Extract videoId from key: uploads/<videoId>/source.mp4
    const match = key.match(/^uploads\/(vid_\w+)\//);
    if (!match) {
      return NextResponse.json({ error: "Invalid key pattern" }, { status: 400 });
    }

    const videoId = match[1];

    // Update video status to processing
    const now = new Date().toISOString();
    await db.update(videos)
      .set({ status: "processing", updatedAt: now })
      .where(eq(videos.id, videoId));

    addPipelineLog(videoId, JSON.stringify({ event: "progress", step: "init", status: "running", progress: 0, message: "Starting pipeline from B2 webhook..." }));

    // Spawn pipeline asynchronously
    const cancel = runIngestPipeline(
      videoId,
      key,
      (progress) => {
        addPipelineLog(videoId, JSON.stringify({ event: "progress", ...progress }));
      },
      (error) => {
        addPipelineLog(videoId, JSON.stringify({ event: "error", error }));
        db.update(videos)
          .set({ status: "failed", updatedAt: new Date().toISOString() })
          .where(eq(videos.id, videoId))
          .catch(console.error);
      },
      async (result) => {
        addPipelineLog(videoId, JSON.stringify({ event: "complete", data: result }));
        const finalStatus = result.success ? "ready" : "failed";
        await db.update(videos)
          .set({ status: finalStatus, updatedAt: new Date().toISOString() })
          .where(eq(videos.id, videoId));
      }
    );

    return NextResponse.json({ status: "processing", videoId });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
