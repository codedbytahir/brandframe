/**
 * Classic BM25 (Okapi) over segment transcripts — the lexical leg of the
 * hybrid retrieval. k1 = 1.5, b = 0.75 (standard defaults).
 */

export interface Bm25Doc {
  id: string;
  text: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const K1 = 1.5;
const B = 0.75;

/** Score every doc against the query. Returns Map docId → raw BM25 score. */
export function bm25Scores(query: string, docs: Bm25Doc[]): Map<string, number> {
  const scores = new Map<string, number>();
  const qTerms = [...new Set(tokenize(query))];
  if (qTerms.length === 0 || docs.length === 0) return scores;

  const docTokens = docs.map((d) => tokenize(d.text));
  const avgDl = docTokens.reduce((s, t) => s + t.length, 0) / docs.length || 1;

  // document frequency per query term
  const df = new Map<string, number>();
  for (const term of qTerms) {
    let count = 0;
    for (const tokens of docTokens) if (tokens.includes(term)) count++;
    df.set(term, count);
  }

  const N = docs.length;
  for (let i = 0; i < docs.length; i++) {
    const tokens = docTokens[i];
    const dl = tokens.length;
    let score = 0;
    for (const term of qTerms) {
      const n = df.get(term) ?? 0;
      if (n === 0) continue;
      // Robertson-Sparck Jones IDF, floored at 0 to avoid negative scores
      const idf = Math.max(0, Math.log((N - n + 0.5) / (n + 0.5) + 1));
      const tf = tokens.filter((t) => t === term).length;
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl) / avgDl)));
    }
    scores.set(docs[i].id, score);
  }
  return scores;
}

/** Token-level F1 overlap — cheap reranking signal for the cross-encoder slot. */
export function tokenF1(query: string, text: string): number {
  const q = tokenize(query);
  const d = new Set(tokenize(text));
  if (q.length === 0 || d.size === 0) return 0;
  const overlap = q.filter((t) => d.has(t)).length;
  if (overlap === 0) return 0;
  const precision = overlap / q.length;
  const recall = overlap / Math.max(d.size, q.length);
  return (2 * precision * recall) / (precision + recall);
}
