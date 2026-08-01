/**
 * Hybrid retrieval: 0.5 dense (Mistral mistral-embed) + 0.2 BM25 → top-20 →
 * token-F1 rerank → top-N. CLIP query-vectors intentionally skipped per
 * docs/specs/08 §2 ("v1 does NOT do CLIP-from-text-query") — its 0.3 weight is
 * redistributed by score normalization.
 *
 * Fallback chain:
 *   1. Dense + BM25 (MISTRAL_API_KEY present)
 *   2. BM25 only (no key / API failure)
 *   3. Demo stubs (empty corpus — keeps the UI alive before seeding)
 */
import { generateText } from "ai";
import { createMistral } from "@ai-sdk/mistral";
import { bm25Scores, tokenF1 } from "./bm25";
import { embedQuery, getSegmentEmbeddings, cosineSim, EMBED_MODEL } from "./embed";
import { loadCorpus, type CorpusSegment } from "./corpus";
import { env, isMistralEnabled } from "@/lib/env";

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

const W_DENSE = 0.5;
const W_BM25 = 0.2;
const CANDIDATES = 20;

function minMaxNormalize(scores: Map<string, number>): Map<string, number> {
  const vals = [...scores.values()];
  const out = new Map<string, number>();
  if (vals.length === 0) return out;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min;
  for (const [k, v] of scores) out.set(k, span === 0 ? (max > 0 ? 1 : 0) : (v - min) / span);
  return out;
}

function demoResults(limit: number): SearchResult[] {
  const demo: SearchResult[] = [
    {
      videoId: "vid_demo001",
      videoTitle: "Getting Started with CSS Grid",
      segmentId: "seg_001",
      startMs: 120000,
      endMs: 150000,
      transcript:
        "So to center a div using CSS Grid, you set display: grid on the parent and place-items: center on the container.",
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
      transcript:
        "Grid template columns lets you define the column structure. You can use repeat, auto-fill, and minmax for responsive layouts.",
      topic: "Grid Columns",
      thumbnailUrl: null,
      score: 0.85,
    },
  ];
  return demo.slice(0, limit);
}

export async function hybridSearch(options: SearchOptions): Promise<SearchResult[]> {
  const { query, videoId, limit = 5 } = options;
  const t0 = Date.now();

  const corpus = await loadCorpus(videoId);
  if (corpus.length === 0) return demoResults(limit);

  // ── Dense leg ──────────────────────────────────────────────────────────
  // Prefer pipeline sidecar vectors when the model matches the query model;
  // otherwise use (cached) freshly-embedded segment vectors.
  const queryVec = await embedQuery(query);
  const denseScores = new Map<string, number>();
  if (queryVec) {
    const needEmbedding = corpus.filter(
      (s) => !(s.sidecarVector && s.sidecarModel === EMBED_MODEL)
    );
    const embedded = await getSegmentEmbeddings(
      needEmbedding.map((s: CorpusSegment) => ({ id: s.id, text: s.text }))
    );
    for (const seg of corpus) {
      const vec =
        seg.sidecarVector && seg.sidecarModel === EMBED_MODEL
          ? seg.sidecarVector
          : embedded.get(seg.id);
      if (vec) denseScores.set(seg.id, cosineSim(queryVec, vec));
    }
  }

  // ── BM25 leg (transcript + topic) ──────────────────────────────────────
  const bm25 = bm25Scores(
    query,
    corpus.map((s) => ({ id: s.id, text: `${s.text} ${s.topic ?? ""}` }))
  );

  // ── Weighted fusion on min-max-normalized scores ───────────────────────
  const normDense = minMaxNormalize(denseScores);
  const normBm25 = minMaxNormalize(bm25);
  const fused = new Map<string, number>();
  for (const seg of corpus) {
    fused.set(
      seg.id,
      W_DENSE * (normDense.get(seg.id) ?? 0) + W_BM25 * (normBm25.get(seg.id) ?? 0)
    );
  }

  // ── Top-20 candidates → rerank (token-F1 cross-encoder slot) → top-N ───
  const byId = new Map(corpus.map((s) => [s.id, s]));
  const top20 = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CANDIDATES)
    .filter(([, score]) => score > 0);

  const reranked = top20
    .map(([id, fusedScore]) => {
      const seg = byId.get(id)!;
      const finalScore = 0.85 * fusedScore + 0.15 * tokenF1(query, seg.text);
      return { seg, finalScore };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);

  const results = reranked.map(({ seg, finalScore }) => ({
    videoId: seg.videoId,
    videoTitle: seg.videoTitle,
    segmentId: seg.id,
    startMs: seg.startMs,
    endMs: seg.endMs,
    transcript: seg.text,
    topic: seg.topic,
    thumbnailUrl: seg.keyframeUrl,
    score: Math.round(finalScore * 1000) / 1000,
  }));

  // Observability (spec §7)
  console.log(
    `[search] query="${query}" dense=${denseScores.size > 0} latency_ms=${Date.now() - t0} top=${JSON.stringify(
      results.slice(0, 5).map((r) => ({ seg: r.segmentId, score: r.score }))
    )}`
  );

  return results;
}

// ── AI Overview ────────────────────────────────────────────────────────────

const mistral = createMistral({ apiKey: env.MISTRAL_API_KEY || "unset" });

function msToTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function overviewPrompt(query: string, results: SearchResult[]): string {
  const segs = results
    .slice(0, 3)
    .map((r, i) => `[${i + 1}] (t:${msToTimestamp(r.startMs)}) ${r.transcript}`)
    .join("\n");
  return `Answer the user's question in 2-4 sentences, grounded only in the segments below. Each time you reference a segment, cite it as "[N](t:MM:SS)" using the segment's number and start time. Use no other sources. If the segments don't answer the question, say so plainly.

Question: ${query}
Segments:
${segs}`;
}

export async function generateAiOverview(
  query: string,
  results: SearchResult[]
): Promise<string> {
  if (results.length === 0) {
    return `No video segments matched "${query}". Try different keywords or browse the catalog.`;
  }

  if (isMistralEnabled) {
    try {
      const { text } = await generateText({
        model: mistral("mistral-large-latest"),
        prompt: overviewPrompt(query, results),
        maxTokens: 300,
      });
      return text.trim();
    } catch (err) {
      console.error("[overview] Mistral generateText failed, using fallback:", err);
    }
  }

  // Deterministic fallback — still emits real [N](t:MM:SS) citations so the
  // citation-chip UI works without a key.
  const lines = results.slice(0, 3).map((r, i) => {
    const t = msToTimestamp(r.startMs);
    return `At [${i + 1}](t:${t}) of **${r.videoTitle}**, the instructor explains: ${r.transcript}`;
  });
  return `Based on the top segments for "${query}":\n\n${lines.join("\n\n")}`;
}
