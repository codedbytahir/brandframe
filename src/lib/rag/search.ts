export interface SearchResult {
  videoId: string;
  videoTitle: string;
  segmentId: string;
  startMs: number;
  endMs: number;
  transcript: string;
  topic: string | null;
  thumbnailUrl: string | null;
  score: number;
}

export interface SearchOptions {
  query: string;
  videoId?: string;
  limit?: number;
}

export async function hybridSearch(options: SearchOptions): Promise<SearchResult[]> {
  const { query, videoId, limit = 5 } = options;

  // For demo: return stub results
  // In production: LanceDB hybrid search with BGE-M3 dense + BM25 + CLIP

  const demoResults: SearchResult[] = [
    {
      videoId: "vid_demo001",
      videoTitle: "Getting Started with CSS Grid",
      segmentId: "seg_001",
      startMs: 120000,
      endMs: 150000,
      transcript: `So to center a div using CSS Grid, you set display: grid on the parent and place-items: center on the container.`,
      topic: "CSS Grid Basics",
      thumbnailUrl: null,
      score: 0.92,
    },
    {
      videoId: "vid_demo001",
      videoTitle: "Getting Started with CSS Grid",
      segmentId: "seg_002",
      startMs: 180000,
      endMs: 210000,
      transcript: `Grid template columns lets you define the column structure. You can use repeat, auto-fill, and minmax for responsive layouts.`,
      topic: "Grid Columns",
      thumbnailUrl: null,
      score: 0.85,
    },
  ];

  return demoResults.slice(0, limit);
}

export async function generateAiOverview(
  query: string,
  results: SearchResult[]
): Promise<string> {
  // In production: Vercel AI SDK generateText with RAG context
  const overview = `Based on the search results for "${query}":\n\n` +
    results
      .map(
        (r, i) =>
          `[${i + 1}] At **${Math.floor(r.startMs / 60000)}:${String(Math.floor((r.startMs % 60000) / 1000)).padStart(2, "0")}** - ${r.transcript}`
      )
      .join("\n\n");

  return overview;
}
