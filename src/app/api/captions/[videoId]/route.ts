/**
 * WebVTT captions generated from the segments table (ASR + chunk pipeline
 * output, or seeded data). Real captions toggle in the player's native controls.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { segments } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

export const runtime = "nodejs";

function vttTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  try {
    const rows = await db
      .select()
      .from(segments)
      .where(eq(segments.videoId, videoId))
      .orderBy(asc(segments.index));

    const cues = rows
      .map(
        (r, i) =>
          `${i + 1}\n${vttTime(r.startMs)} --> ${vttTime(r.endMs)}\n${r.transcript}\n`
      )
      .join("\n");

    return new Response(`WEBVTT\n\n${cues}`, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("[captions] failed:", error);
    return NextResponse.json({ error: "Captions failed" }, { status: 500 });
  }
}
