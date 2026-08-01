/**
 * Layer 1 — intent matching between a user query (or video topics) and brands.
 *
 * Spec (docs/specs/09 §1): show a sponsored card when the query's textual
 * similarity to a brand's text vector (= BGE-M3/mistral-embed of name +
 * categories + copy) is ≥ 0.3 — one card per query max.
 *
 * Brand vectors are embedded once and cached in-process (5 seeded brands — a
 * table would be overkill). Without a Mistral key, a deterministic lexical
 * scorer keeps the feature demonstrable offline.
 */
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { embedQuery, cosineSim } from "@/lib/rag/embed";
import { tokenF1 } from "@/lib/rag/bm25";
import { isMistralEnabled } from "@/lib/env";

export const INTENT_THRESHOLD = 0.3;

export interface BrandRecord {
  id: string;
  name: string;
  category: string;
  logoUrl: string | null;
  packshotUrl: string | null;
  copy: string;
  targetUrl: string;
  colorHex: string;
  allowedSurfaces: string[];
}

export interface BrandIntentMatch {
  brand: BrandRecord;
  score: number;
  method: "embedding" | "lexical";
}

function brandText(b: { name: string; category: string; copy: string }): string {
  return `Brand: ${b.name}. Categories: ${b.category}. ${b.copy}`;
}

export async function listBrands(): Promise<BrandRecord[]> {
  const rows = await db.select().from(brands);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    logoUrl: r.logoUrl,
    packshotUrl: r.packshotUrl,
    copy: r.copy,
    targetUrl: r.targetUrl,
    colorHex: r.colorHex,
    allowedSurfaces: JSON.parse(r.allowedSurfaces || "[]") as string[],
  }));
}

// In-process brand-vector cache (server lifetime)
const brandVecCache = new Map<string, number[]>();

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "on", "in", "with", "how",
  "what", "best", "is", "are", "do", "does", "my", "need", "want", "get", "your",
  "you", "can", "it", "this", "that", "before", "after",
]);

function tokenizeBrandText(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2") // split camelCase brand names
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map((t) => (t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t)); // naive de-plural
}

/** Lexical fallback scorer, tuned so obvious matches clear the 0.3 bar. */
function lexicalScore(query: string, brand: BrandRecord): number {
  const q = query.toLowerCase();
  const qTokens = new Set(
    tokenizeBrandText(query)
  );
  const nameTokens = tokenizeBrandText(brand.name);
  const catTokens = tokenizeBrandText(brand.category);
  const copyTokens = tokenizeBrandText(brand.copy);

  let score = 0;
  if (brand.name.toLowerCase() && q.includes(brand.name.toLowerCase())) score = Math.max(score, 0.65);
  if (nameTokens.some((c) => qTokens.has(c))) score = Math.max(score, 0.6);
  if (catTokens.some((c) => qTokens.has(c))) score = Math.max(score, 0.55);
  const copyHits = copyTokens.filter((c) => qTokens.has(c)).length;
  if (copyHits > 0) score = Math.max(score, 0.35 + 0.1 * Math.min(copyHits, 3));
  score = Math.max(score, 0.9 * tokenF1(query, brandText(brand)));
  return Math.min(score, 0.95);
}

/** Score all brands against a query/paragraph. Best match above threshold wins. */
export async function matchBrandIntent(
  query: string,
  threshold: number = INTENT_THRESHOLD
): Promise<BrandIntentMatch | null> {
  const allBrands = await listBrands();
  if (allBrands.length === 0 || !query.trim()) return null;

  // Dense path when Mistral is available
  if (isMistralEnabled) {
    try {
      const qVec = await embedQuery(query);
      if (qVec) {
        const missing = allBrands.filter((b) => !brandVecCache.has(b.id));
        for (const b of missing) {
          // Sequential: 5 seeded brands — one call each, then cached.
          const v = await embedQuery(brandText(b));
          if (v) brandVecCache.set(b.id, v);
        }
        let best: BrandIntentMatch | null = null;
        for (const b of allBrands) {
          const v = brandVecCache.get(b.id);
          if (!v) continue;
          // mistral-embed cosine lives roughly in [0.2, 0.8] for text pairs;
          // rescale so the 0.3 threshold is meaningful for semantic matches.
          const raw = cosineSim(qVec, v);
          const score = Math.max(0, Math.min(1, (raw - 0.2) / 0.5));
          if (score >= threshold && (!best || score > best.score)) {
            best = { brand: b, score, method: "embedding" };
          }
        }
        if (best) return best;
      }
    } catch (err) {
      console.error("[intent] embedding path failed, lexical fallback:", err);
    }
  }

  // Lexical fallback (also the keyless demo path)
  let best: BrandIntentMatch | null = null;
  for (const b of allBrands) {
    const score = lexicalScore(query, b);
    if (score >= threshold && (!best || score > best.score)) {
      best = { brand: b, score, method: "lexical" };
    }
  }
  return best;
}
