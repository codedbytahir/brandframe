import { NextRequest, NextResponse } from "next/server";
import { hybridSearch, generateAiOverview } from "@/lib/rag/search";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");
  const videoId = searchParams.get("videoId") || undefined;
  const limit = parseInt(searchParams.get("limit") || "5");

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
  }

  try {
    const results = await hybridSearch({ query, videoId, limit });
    const overview = await generateAiOverview(query, results);

    return NextResponse.json({ results, overview });
  } catch (error) {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
