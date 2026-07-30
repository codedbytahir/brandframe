import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adSlots } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  try {
    const slots = await db
      .select()
      .from(adSlots)
      .where(eq(adSlots.videoId, videoId))
      .all();

    return NextResponse.json({ slots });
  } catch (error) {
    return NextResponse.json({ error: "Failed to get slots" }, { status: 500 });
  }
}
