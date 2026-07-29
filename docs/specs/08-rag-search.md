# 08 — RAG, Search & AI Overview

This spec covers: (1) chunking, (2) embeddings, (3) LanceDB index on B2,
(4) hybrid retrieval + rerank, (5) AI Overview, (6) Chat-with-video.

## 1. Chunking (Python pipeline, `chunk` Step)

Goal: ~20–45s chunks that align with both speaker intent *and* scene boundaries,
so that search results jump to moments that **visually** match too.

Inputs:
- `asr_segments` (word-level timestamps from ASR step).
- `scenes` (scene cuts from scenedetect).

Algorithm:
1.  Sentencize the concatenated transcript using NLTK `punkt` (English; add
    language-specific tokenization later if needed). Each sentence retains its
    start_ms/end_ms by mapping words → sentences via cumulative timestamps.
2.  Greedy packing:
    - Initialize a new chunk starting at the first sentence; set `soft_target_start = chunk.start + 20s`, `hard_deadline = chunk.start + 45s`, `soft_minimum = chunk.start + 15s`.
    - Append sentences.
    - After each append, if current duration ≥ 20s, check:
      - If the next sentence would push past 45s → finalize chunk now.
      - Else if the current sentence end is within ±3s of a scene cut AND duration ≥ 20s → finalize at that scene cut.
      - Else if we've reached 45s → finalize at the next sentence boundary.
    - Merge back-to-back single-sentence chunks < 8s with the previous chunk if total stays ≤ 45s.
3.  Each chunk picks its keyframe as the closest keyframe-by-time to the chunk midpoint.
4.  Output ~13–25 chunks per 10-min video.

Each chunk stores (both in LanceDB and in the `segments` table):
- `seq`, `startMs`, `endMs`, `transcript`, `vlCaption`, `ocr?`, `keyframeKey`.
- In LanceDB we concatenate `transcript + " " + vlCaption` into a single `text` field for lexical search.

## 2. Embeddings

Three vectors per chunk, computed in the embed Step:

| Vector | Model | Dim | Produced by | Used for |
|---|---|---|---|---|
| `dense_vec` | `BAAI/bge-m3` | 1024 | FlagEmbedding (local) | Semantic text similarity |
| `sparse_vec` | `BAAI/bge-m3` (sparse mode) | Lexical (term→weight) | FlagEmbedding | Hybrid lexical weighting |
| `clip_vec`  | `openai/clip-vit-base-patch32` | 512 | transformers (local) | Visual similarity (keyframe) |

Brand vectors (stored in `index/brands.lance`):
- `clip_vec` of the brand packshot image (512-d).
- `text_vec` of `"Brand: {name}. Categories: {list}. Description: {copy}."` via `bge-m3` (1024-d) — used for intent-overlay matching in Layer 1 ads.

### Fallback chain for text embeddings
1.  `bge-m3` local (preferred; free; consistent).
2.  NVIDIA NIM `nv-embedqa-e5-v5` (if bge-m3 fails to load on first run).
3.  OpenAI `text-embedding-3-small` (last resort).

### Query embedding at search time
For a text query `q`:
- Compute `dense_vec` and `sparse_vec` via the **same** text embedding model used at
  index time (model is recorded in a tiny `index/meta.json` on B2 so we can detect mismatches).
- If the query contains an image (v2, not v1), compute CLIP vec from the image.
- v1 does NOT do CLIP-from-text-query (CLIP text encoder is different from BGE-M3
  and would hurt the hybrid score); keep visual search to the chunk keyframes only.

## 3. LanceDB index on B2

- **Location:** `s3://<bucket>/index/segments.lance/` (and `brands.lance/`, `meta.json`).
- **Opened via:** `s3fs` (Python writes) and the LanceDB Node binding with S3 storage options (Node reads).
  - LanceDB v0.16 supports object storage; pass `storageOptions` with B2 S3-compatible endpoint, keyId, secretKey, forcePathStyle.
- **Schema:** see §05 §3.1.
- **Indexes:**
  - `dense_vec`: IVF-PQ (nlist=256) for demo; upgrade to HNSW when >100k segments.
  - `text`: FTS/BM25 via `table.create_fts_index("text", use_tantivy=True)` (LanceDB supports this).
  - `clip_vec`: IVF (nlist=64) — small enough that we can skip PQ.
- **Write discipline:** single-writer (the Python embed Step). Node is read-only
  against LanceDB. If we need live updates later, swap to a write queue.

### Why not Pinecone / Weaviate / pgvector?
- Cost $0 (LanceDB files live on B2 we already pay for, in free tier).
- Tight multimodal support (native vectors + FTS + columnar filters in one).
- Avoids another vendor; keeps the "B2 is the single source of truth" story clean (judging +).

## 4. Retrieval pipeline

Implemented in `src/lib/rag/search.ts`:

```ts
search(q: string, opts?: { videoId?: string; limit?: number; brandScoped?: boolean }): Promise<SearchHit[]>
```

Pipeline:
1.  **Embed query:** `dense_q`, `sparse_q` = bge-m3(q). For now call OpenAI
    `text-embedding-3-small` as a v0 fallback since bge-m3 in Node is heavy;
    swap to `@xenova/transformers` (WASM) for local embed when we have time.
2.  **Dense search:** `table.search(dense_q, "dense_vec").nprobes(20).limit(20)` → top 20 with dense scores.
3.  **BM25 search:** `table.search(q, query_type="fts", vector_column_name="text")` → top 20 BM20 hits (use BGE-M3 sparse weights if available, else tantivy BM25).
4.  **Visual search (optional in v1):** skip unless query is visual; when added, `table.search(clip_q, "clip_vec").limit(20)`.
5.  **Reciprocal Rank Fusion or weighted merge** — use weighted linear blend as
    stated in the SRS (simpler and easier to tune):
    ```
    fused = 0.5 * norm(dense) + 0.2 * norm(bm25) + 0.3 * norm(clip or 0)
    ```
    Each score is min-max normalized across the candidate set.
6.  **Filter:** if `opts.videoId` is given (chat mode), restrict to that video;
    apply content policy filter (don't return hidden videos).
7.  **Rerank:** top-20 → `bge-reranker-v2-m3` cross-encoder (hosted via
    Transformers.js in Node, or via NVIDIA NIM rerank endpoint). Take top-5.
8.  **Return:** for each hit return `{ videoId, startMs, endMs, snippet, score, keyframeSignedUrl }`.

### "AI Overview" (on `/search` page, and at top of `/watch` sidebar)

After retrieval:
1.  Take top-3 segments.
2.  Build a prompt:
    ```
    Answer the user's question in 2-4 sentences, grounded only in the segments below.
    Each time you reference a segment, cite it as "[N](t:MM:SS)". Use no other sources.
    Question: {q}
    Segments:
    [1] (t:3:48) ...transcript...
    [2] (t:2:10) ...transcript...
    [3] (t:7:22) ...transcript...
    ```
3.  Call LLM via Vercel AI SDK `generateText` (non-streaming is fine; this is above
    results, so render it after the results promise resolves, with a skeleton).
4.  Render as a Card with a `Sparkles` icon and an "AI Overview" heading.
5.  Citations like `[1](t:3:48)` are rendered as clickable chips that link to `/watch/[videoId]?t=228000`.

Provider chain: GPT-4o-mini → Gemini 2.0 Flash → Llama 3.1 70B on NIM. All calls
server-side; keys never reach browser.

## 5. Chat-with-video

- Endpoint: `POST /api/chat` (Vercel AI SDK `streamText`).
- Uses `ai/react` `useChat` on the client.
- System prompt:
  - Ground in retrieved segments only; say "The video doesn't cover that" if nothing matches.
  - Emit inline `<ts ms="123456" seg="seg_abc">2:03</ts>` tags for every moment referenced.
  - Keep answers ≤ 150 words for long-form; offer "Show more" if the model wants to expand.
- Retrieval per turn: `search(userMessage, { videoId, limit: 5 })` (RAG on the current video).
  - For multi-turn, include the last 6 messages for context but only embed the last user message for retrieval (simple "chat history as context" baseline — no re-query with history for v1).
- Client side parses assistant tokens; when the `<ts …>` tag is complete, swap it for a clickable `<button className="…" onClick={() => seekTo(ms)}>` chip styled with mono font + `bg-muted rounded px-1.5`.

## 6. URL deep-links

- `/search?q=foo` — RSC runs search server-side and renders.
- `/watch/[videoId]?t=348000` — player auto-seeks to `t` ms on load (player exposes `seekTo(ms)`; call it in a `useEffect` when `searchParams.t` is set).
- `/watch/[videoId]?segment=seg_abc` — look up segment from DB, seek to `startMs`.
- Chat timestamp chips navigate via router.push with `?t=` to keep URLs shareable.

## 7. Observability / quality

- Log retrieval: for each search, log `{query, top5:[{segId,score}], latency_ms}` to stdout (visible during dev). In production add a `queries` table if time.
- Tune weights by running a small labelled set (50 CC-tutorial queries we
  handcraft in Phase 7) — just adjust weights in code; no fancy eval framework needed for hackathon.
- If CLIP hits are consistently garbage (low visual relevance), reduce `w_clip` from 0.3 to 0.15.

## 8. Performance targets

- p50 search latency < 600ms, p95 < 1.5s (including embedding and rerank).
- Chat first-token < 900ms (with prefetch of retrieval before stream).
- LanceDB queries over 100k segments should stay under 200ms with IVF-PQ.
