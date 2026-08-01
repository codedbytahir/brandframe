/**
 * Mistral embeddings for query-time and segment-time vectors.
 * Model: mistral-embed (1024-d). Free tier — https://console.mistral.ai
 *
 * Vectors are L2-normalized so cosine similarity === dot product.
 * Segment vectors are cached in the `segment_embeddings` SQLite table so
 * repeated searches don't re-embed the corpus.
 */
import { db } from "@/lib/db";
import { segmentEmbeddings } from "@/lib/db/schema";
import { env, isMistralEnabled } from "@/lib/env";
import { eq } from "drizzle-orm";

export const EMBED_MODEL = "mistral-embed";
const MISTRAL_EMBED_URL = "https://api.mistral.ai/v1/embeddings";

function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Cosine similarity for L2-normalized vectors (dot product). */
export function cosineSim(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Call Mistral embeddings API. Returns null when no key or on failure. */
async function mistralEmbedBatch(texts: string[]): Promise<number[][] | null> {
  if (!isMistralEnabled || texts.length === 0) return null;
  try {
    const res = await fetch(MISTRAL_EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });
    if (!res.ok) {
      console.error(`[embed] Mistral embed failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => l2Normalize(d.embedding));
  } catch (err) {
    console.error("[embed] Mistral embed error:", err);
    return null;
  }
}

/** Embed a single query string. Null when unavailable (→ BM25-only search). */
export async function embedQuery(query: string): Promise<number[] | null> {
  const out = await mistralEmbedBatch([query]);
  return out?.[0] ?? null;
}

/**
 * Get embeddings for a list of segments, using the SQLite cache first and
 * batch-embedding the misses. Returns a Map segmentId → vector (subset when
 * the API is unavailable).
 */
export async function getSegmentEmbeddings(
  segs: Array<{ id: string; text: string }>
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (segs.length === 0) return out;

  // 1) Cache hits
  const missing: Array<{ id: string; text: string }> = [];
  for (const seg of segs) {
    try {
      const row = await db
        .select()
        .from(segmentEmbeddings)
        .where(eq(segmentEmbeddings.segmentId, seg.id))
        .get();
      if (row && row.model === EMBED_MODEL) {
        out.set(seg.id, JSON.parse(row.vector) as number[]);
        continue;
      }
    } catch {
      // Table may not exist yet (pre `drizzle-kit push`) — degrade silently.
    }
    missing.push(seg);
  }

  // 2) Embed the misses in one batch, upsert cache
  const embedded = await mistralEmbedBatch(missing.map((m) => m.text));
  if (embedded) {
    for (let i = 0; i < missing.length; i++) {
      const vec = embedded[i];
      if (!vec) continue;
      out.set(missing[i].id, vec);
      try {
        await db
          .insert(segmentEmbeddings)
          .values({
            segmentId: missing[i].id,
            model: EMBED_MODEL,
            dim: vec.length,
            vector: JSON.stringify(vec),
          })
          .onConflictDoUpdate({
            target: segmentEmbeddings.segmentId,
            set: { model: EMBED_MODEL, dim: vec.length, vector: JSON.stringify(vec) },
          });
      } catch {
        // Cache write failure is non-fatal.
      }
    }
  }
  return out;
}
