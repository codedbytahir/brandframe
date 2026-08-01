import { NextRequest, NextResponse } from "next/server";
import { matchBrandIntent } from "@/lib/ads/intent";

export const runtime = "nodejs";

/**
 * Layer 1 intent match for a query — used by the chat panel (client) after
 * each assistant answer. The /search page calls matchBrandIntent server-side
 * directly. One card per query max; nothing below the 0.3 threshold.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const match = await matchBrandIntent(q.trim());
    return NextResponse.json({ match });
  } catch (error) {
    console.error("[ads/intent] failed:", error);
    return NextResponse.json({ error: "Intent match failed" }, { status: 500 });
  }
}
