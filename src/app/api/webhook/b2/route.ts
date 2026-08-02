import { NextRequest, NextResponse } from "next/server";
import { startIngestPipeline } from "@/lib/pipelines/start";

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
    await startIngestPipeline(videoId, key);

    return NextResponse.json({ status: "processing", videoId });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
