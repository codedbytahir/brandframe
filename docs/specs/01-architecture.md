# 01 — Architecture

## 1. High-level system diagram

```
                         ┌─────────────────────────────┐
                         │  Browser (Next.js client)   │
                         │  - Player (hls.js)          │
                         │  - Search / Chat / Studio   │
                         └─────────────┬───────────────┘
                                       │ signed URL (PUT / GET .m3u8)
                                       ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                       Backblaze B2 (single bucket)               │
   │  uploads/  playable/  assets/  manifests/  index/  brands/  tmp/ │
   │                          ▲                                       │
   │            Event Notification (ObjectCreated:* , Object Lock)    │
   └──────────────────────────┼───────────────────────────────────────┘
                              │ webhook (POST)
                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                     Next.js 15 (Node, serverful)                 │
   │                                                                  │
   │  ┌─────────────┐   ┌──────────────┐   ┌───────────────────────┐  │
   │  │ App Router  │   │ Route Handlers│   │ Server Actions        │  │
   │  │ (RSC by     │   │ /api/upload   │   │ - studio upload flow  │  │
   │  │  default)   │   │ /api/webhook  │   │ - brand approval      │  │
   │  │             │   │   /b2         │   │ - chat (Vercel AI)    │  │
   │  │ (marketing) │   │ /api/pipelines│   └───────────────────────┘  │
   │  │ (app)       │   │   /[videoId]  │                              │
   │  │ search/     │   │ /api/search   │   ┌───────────────────────┐  │
   │  │             │   │ /api/chat     │◄──┤ child_process.spawn() │  │
   │  └─────────────┘   │ /api/playback │  │ .venv/bin/python -m    │  │
   │                    └───────┬───────┘  │ pipelines.cli ingest   │  │
   │                            │          └──────────┬────────────┘  │
   │                            │                     │ stdout (JSONL)│
   │                   ┌────────▼────────┐            │ SSE fan-out    │
   │                   │  libsql (SQLite)│            ▼                │
   │                   │  Drizzle ORM    │  ┌──────────────────────┐  │
   │                   │  brandframe.db  │  │ Genblaze Python      │  │
   │                   └─────────────────┘  │ Pipeline (child proc)│  │
   │                                        │                      │  │
   │  ┌──────────────────┐                  │ probe → asr → scenes │  │
   │  │ LanceDB on B2    │◄─────────────────┤ → embed → slots →    │  │
   │  │ (index/*.lance)  │   embeddings     │ inpaint → critic →   │  │
   │  │ opened via s3fs  │                  │ manifest → lock      │  │
   │  └──────────────────┘                  └──────────────────────┘  │
   └──────────────────────────────────────────────────────────────────┘
                                       │
                     HTTPS to provider APIs (Mistral AI, Google
                     Gemini, Deepgram — all free tier)
```

## 2. Components & responsibilities

| Runtime | Component | Responsibility |
|---|---|---|
| Browser | `src/components/player/player.tsx` | hls.js playback, timeupdate → cue detection, pause-ad overlay, seekTo |
| Browser | `src/components/player/chat-panel.tsx` | Streaming chat UI, clickable timestamp chips |
| Browser | `src/components/dashboard/upload-form.tsx` | Drag-drop, direct PUT to signed B2 URL, progress |
| Next.js (RSC) | `src/app/(marketing)/page.tsx` | Landing / hero / search bar |
| Next.js (RSC) | `src/app/search/page.tsx` | Query → `lib/rag/search` → AI Overview → hits |
| Next.js (RSC) | `src/app/(app)/watch/[videoId]/page.tsx` | Player layout + sidebar (chapters, chat, overview) |
| Next.js (RSC) | `src/app/(app)/studio/page.tsx` | Creator video list + upload |
| Next.js (RSC) | `src/app/(app)/verify/[videoId]/page.tsx` | Provenance: re-fetch manifest, verify hashes, list placements |
| Next.js (RH) | `/api/upload` | Return presigned PUT URL for direct browser→B2 upload |
| Next.js (RH) | `/api/webhook/b2` | Receive B2 Event Notification → enqueue spawn of Python pipeline |
| Next.js (RH) | `/api/pipelines/[videoId]` | SSE stream of JSONL progress lines from Python child process |
| Next.js (RH) | `/api/chat` | Vercel AI SDK streaming chat, RAG-grounded |
| Next.js (RH) | `/api/playback` | Return signed HLS URL (B2 GetObject) |
| Next.js (Server Action) | upload flow | Server-side orchestration for upload state |
| Next.js lib | `src/lib/b2/` | S3 client config, key-prefix helpers, signed URL helpers |
| Next.js lib | `src/lib/db/` | Drizzle client + schema |
| Next.js lib | `src/lib/rag/search.ts` | LanceDB hybrid search + rerank |
| Next.js lib | `src/lib/pipelines/run.ts` | Spawn `.venv/bin/python -m pipelines.cli` and tee stdout |
| Next.js lib | `src/lib/ai/` | Vercel AI SDK flows (overview generation, chat system prompt) |
| Python | `pipelines/cli.py` | Genblaze Pipeline DAG, all Steps, emits JSONL progress to stdout |

## 3. Data flow for a single video lifecycle

1.  **Creator uploads** in Studio:
    - Client calls `POST /api/upload` → receives presigned PUT URL + `videoId`.
    - Client PUTs mp4 directly to B2 at `uploads/<videoId>/source.mp4`.
    - Client writes `videos` row with status `uploaded` via Server Action.
2.  **B2 Event Notification** fires `ObjectCreated: uploads/*` → `POST /api/webhook/b2`.
3.  **Webhook** sets video status to `processing` and spawns `pipelines.cli ingest --key …`.
4.  **Pipeline Steps run (Python, Genblaze):**
    - `probe` — ffprobe duration/codec → update `videos.duration_ms`.
    - `asr` — Deepgram Nova-3 API → utterance/word-aligned transcript.
    - `scenes` — PySceneDetect + keyframe extraction (ffmpeg) → Qwen-VL caption per keyframe → upload keyframes to `assets/<id>/keyframes/`.
    - `chunk+embed` — punctuation-respecting ~20–45s chunks, BGE-M3 (dense+sparse) + CLIP ViT-B/32 embeddings → write to LanceDB at `index/segments.lance` on B2 via s3fs; insert `segments` rows.
    - `slots` — Qwen-VL JSON-mode detection of inanimate-object bounding boxes → MediaPipe face/hand reject filter → CLIP brand-match against `brands/` embeddings → insert `ad_slots` rows (status `pending`).
    - `inpaint` — per filled slot, FLUX.1-fill-pro inpaint → VL-critic AgentLoop (5-point rubric, retry once, else drop) → upload before/after frames to `assets/<id>/inpainted/`.
    - `manifest` — Genblaze Manifest build → embed into MP4 udta atom → copy to `manifests/<id>/<runId>.json` with `ObjectLockRetention` (COMPLIANCE, 365d) → set video `manifestRunId`, status `ready`.
5.  **SSE progress** from Python stdout → Next `/api/pipelines/[videoId]` → Studio UI updates.
6.  **Viewer watches** at `/watch/[videoId]`:
    - Player fetches signed HLS URL from `/api/playback`.
    - Chapters/chips come from `segments` (Drizzle query in RSC).
    - Cues (mid-rolls at high-score breaks, pause-ads at approved slots) loaded from DB.
    - Timeupdate hits cue → pause + in-scene overlay (if pause ad) or 6s mid-roll card.
    - Disclosure badge "AI Ad · Why?" links to `/verify/<videoId>#slot-<slotId>`.
7.  **Search:**
    - Home/Studio search box → `/search?q=…` (GET, RSC).
    - `lib/rag/search.ts` embeds query (BGE-M3 dense+sparse, CLIP if visual query),
      hybrid search over LanceDB: `score = 0.5·dense + 0.2·BM25 + 0.3·visual`,
      bge-reranker-v2-m3 cross-encoder rerank top-20 → top-5.
    - Top-3 snippets → LLM (GPT-4o-mini / Gemini Flash) for AI Overview with cited timestamps.
8.  **Chat:**
    - Client streams `POST /api/chat` (Vercel AI SDK `streamText`).
    - System prompt grounds on top-k retrieved segments (tool-call or pre-retrieve).
    - Model emits timestamp citations as `<ts ms=123456 />` tags, rendered in chat panel as clickable chips.
9.  **Verify:**
    - RSC loads manifest JSON from B2, recomputes SHA-256 of the source MP4 range + inpainted frames,
      checks Object Lock retention via HeadObject, shows before/after sliders.

## 4. Deployment topology (hackathon)

- **Next.js:** Vercel free tier (Node serverful; Server Actions + streaming work).
  Server Components that need the Python venv must run on a serverful target — if Vercel
  can't keep `.venv/`, add a tiny Fly.io worker for `/api/webhook/b2` + `/api/pipelines/[videoId]`,
  but prefer running locally for the demo recording and use Vercel for the public URL with
  a deployed pipeline worker as fallback. Decision tracked in `DECISIONS.md`.
- **B2:** Single bucket `brandframe-<handle>` in `us-east-005`. Object Lock enabled at bucket creation (can't be added later). Lifecycle rule: `tmp/` expires after 48 hours. Event Notifications: `ObjectCreated: uploads/*` → Vercel/Fly webhook URL.
- **SQLite:** Local `brandframe.db` for dev; for Vercel deploy use Turso/libsql cloud (swap `DATABASE_URL`). No schema changes needed.
- **LanceDB:** Lives on B2 under `index/`. Opened from Next.js via `lancedb.connect('s3://bucket/index', { storageOptions })` OR from Python via `s3fs`. **Single-writer (Python ingest) / multi-reader (Next search).**
- **Python venv:** created by `scripts/setup-pipelines.sh`, not committed.

## 5. Trust boundaries

1.  **Client → B2:** always via signed URLs (short TTL, e.g., 15 min for PUT, 1 hour for GET).
    Never expose B2 credentials to the browser.
2.  **B2 → Next:** webhook should verify B2 signing secret (v1: just verify `User-Agent` + IP range; v2: HMAC).
3.  **Next → Python:** spawning local child process only; no network access to the Python runner.
4.  **Next → Providers:** server-side only (Mistral/Gemini/Deepgram keys never reach the browser).
5.  **Manifests:** WORM-locked — cannot be deleted or mutated for 365 days. This is the trust anchor for the /verify page.

## 6. Failure handling & fallbacks

- **ASR:** Deepgram Nova-3 (free $200 credit, no local install).
- **VL caption/slots:** Qwen2.5-VL-7B (GMI) → Qwen-VL-Max (Alibaba/DashScope if key present) → GPT-4o-mini vision.
- **Inpaint:** Google Gemini 2.5 Flash Image (Nano Banana) → Pillow compositing (keyless fallback).
- **LLM (overview/chat):** Mistral Large (`mistral-large-latest`) via Vercel AI SDK.
- **Embeddings:** Mistral `mistral-embed` (indexed via JSON sidecar; pipeline also tries local BGE-M3 first).
- **If pipeline fails:** video.status = `failed`, SSE emits `pipeline.failed`, Studio shows retry button. Partially uploaded B2 objects under `tmp/` are cleaned up by lifecycle rule.
