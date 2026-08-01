# BrandFrame — Task Checklist

> **Coding agents:** before ticking boxes, read `AGENTS.md` → `MEMORY.md` → the relevant spec in `docs/specs/`.
> Update `MEMORY.md` at the end of every session. Detailed phase DoD lives in
> `docs/specs/12-phases-and-tasks.md`.

Stack: Next.js 15 (App Router, RSC default, Server Actions), TypeScript strict,
Tailwind v3, shadcn/ui-style primitives, Drizzle/libsql, Vercel AI SDK, hls.js,
@aws-sdk/client-s3 (for B2), Genblaze Python SDK as a child process, LanceDB on B2.
**No FastAPI. No separate backend server.** B2 is the single source of truth for binaries.

---

## Phase 1 — Foundation (done)
- [x] All items complete (repo scaffold, configs, types, DB schema, env, all UI pages, components, Player, Chat, Upload form)

## Phase 2 — Python Pipelines (Genblaze) ✅ DONE
All 12 Steps are **fully implemented with real provider code** in `pipelines/cli.py`:

- [x] `pipelines/requirements.txt` — all deps
- [x] `pipelines/utils.py` — B2 s3 client, ffprobe, ffmpeg HLS, workspace helpers, logging
- [x] CLI entry point `pipelines/cli.py` with `ingest --key <b2-key>`
- [x] **`probe`** — Real ffprobe → duration/codec/resolution from B2
- [x] **`transcode-hls`** — Real ffmpeg HLS ladder (1080p→360p) + poster
- [x] **`asr`** — faster-whisper large-v3 primary, OpenAI Whisper-API fallback
- [x] **`scenes+keyframes`** — PySceneDetect ContentDetector + ffmpeg keyframe extraction
- [x] **`vl-caption`** — GPT-4o-mini vision per keyframe
- [x] **`chunk`** — NLTK punctuation + scene-boundary 20–45s packing
- [x] **`embed`** — BGE-M3 dense + CLIP ViT-B/32 → LanceDB on B2 (s3fs), OpenAI fallback
- [x] **`slots`** — GPT-4o vision JSON-mode + MediaPipe face/hand reject
- [x] **`brand-match`** — CLIP surface similarity scoring
- [x] **`inpaint`** — Replicate FLUX.1-fill-pro + mask generation, GOVERANCE 365d lock
- [x] **`critic`** — GPT-4o-mini 5-point rubric, retry once, drop on fail
- [x] **`manifest`** — Build JSON, upload to B2 with Object Lock COMPLIANCE 365d
- [x] Per-step progress % emitted via `_log` for SSE
- [ ] **Stretch:** scripts/seed-brands.py — insert 5 mock brands
- [ ] **Stretch:** End-to-end test on a short sample video (needs B2 + API keys)

## Phase 3 — Upload + Ingest ✅ DONE
- [x] `POST /api/upload` — presigned PUT URL (900s TTL), size cap 5GB, video/* only, insert video row
- [x] Replace fake progress in upload form: XHR PUT direct to B2 with `upload.onprogress`
- [ ] **Manual:** Configure B2 Event Notification on `ObjectCreated: uploads/*` → `<APP_URL>/api/webhook/b2`
- [x] `POST /api/webhook/b2` — parse payload, set status=processing, spawn pipeline, buffer JSONL
- [x] `GET /api/pipelines/[videoId]` — SSE (replay buffer → tail → ping 15s → end on done/failed)
- [x] Studio UI: live step list with spinner/check/X, % progress, elapsed time
- [ ] **Manual:** Retry action (Server Action) for failed videos
- [ ] **Manual:** B2 Lifecycle Rule: `tmp/` delete after 48h

## Phase 4 — Player, Search, AI Overview, Chat ✅ DONE (real wiring, 2026-08-01)
Spec: `docs/specs/08-rag-search.md`, `docs/specs/06-api-routes.md` §4–6.
- [x] `lib/rag/` real hybrid retrieval: Mistral `mistral-embed` dense (SQLite-cached) + BM25 → 0.5/0.2 weighted fusion on min-max-normalized scores → top-20 → token-F1 rerank → top-N. CLIP query vectors skipped per spec §2. Corpus from SQLite + B2 index sidecar `index/<videoId>/segments.json` (`lib/rag/corpus.ts`).
- [x] `/search` RSC: real results, `<mark>` query highlighting, timestamp chips, thumbnails, AI Overview in Suspense with skeleton
- [x] AI Overview card: Vercel AI SDK `generateText` (`mistral-large-latest`) + `[N](t:MM:SS)` citations rendered as clickable chips → `/watch/<vid>?t=<ms>`; keyless fallback keeps citation format
- [x] `POST /api/chat` — Vercel AI SDK `streamText` (Mistral) with RAG system prompt, `<ts ms="…">X:XX</ts>` citations, last-6-messages context; demo mode streams a DB-grounded answer (text-stream protocol)
- [x] Chat panel: `useChat` (`streamProtocol: "text"`), `<ts>` tags → clickable seek chips (player seek + shareable `?t=` URL), **bold** inline rendering
- [x] `GET /api/playback/[videoId]` — real mode: same-origin B2 HLS proxy URL (+ poster, captions); 409 if not ready with `code: VIDEO_NOT_READY`; demo mode: seeded stream URL
- [x] `GET /api/playback/[videoId]/file/[...path]` — B2 streaming proxy (Range/206, content types, cache headers) — chosen over presigned URLs because HLS playlists use relative URIs (see DECISIONS.md, refs backblaze.com/apidocs)
- [x] Player: resolves real source via API, `?t=<ms>` + `?segment=` deep links, `brandframe:seek` custom-event seeking, WebVTT captions track (`/api/captions/[videoId]`), keyboard shortcuts (←/→ space/k f m), 409 auto-retry while processing
- [x] Chapters from `segments.topic`; watch page = 3/4 player + 1/4 sidebar tabs (AI Chat | Chapters | About) on lg; real video metadata; Layer-3 pause-ad cues wired from DB (slots ⨝ brands)
- [x] Pipeline `step_embed`: writes portable index sidecar `index/<videoId>/segments.json` on BOTH local and Mistral-fallback paths (previously fallback vectors were discarded); + unit test
- [x] Demo corpus: 5 videos (`vid_demo001..005`), 21 segments, 16 breaks, 4 ad slots (`scripts/seed-demo-data.py`)

## Phase 5 — Ad Engine (three layers)
Spec: `docs/specs/09-ad-engine.md`.
- [ ] `lib/ads/cues.ts` exists — wire to real server data
- [ ] Player: wire real cues from server; mid-roll card (Layer 2) + pause-ad overlay (Layer 3) + intent overlay (Layer 1)
- [ ] Layer 3 pause-ad UX finalized: crossfade to inpainted `<img>`, "AI Ad · Why?" badge, Skip + Learn more
- [ ] Layer 2 natural-break detection: weighted formula
- [ ] Layer 1 sponsored card in search/chat when brand match score ≥ 0.3
- [ ] Creator Studio approval UI (before/after thumbnails, Approve/Reject Server Actions)

## Phase 6 — Provenance & Disclosure
Spec: `docs/specs/10-provenance.md`.
- [x] Manifest Step: put to B2 with Object Lock COMPLIANCE 365d; GOVERNANCE on inpainted frames
- [ ] `/verify/[videoId]` RSC: fetch manifest from B2, HeadObject lock check, re-hash source/before/after
- [ ] `BeforeAfterSlider` component (range input cross-fades two signed-URL `<img>`s)
- [ ] Player "Why?" link → `/verify/[videoId]#slot-<slotId>` deep-scroll

## Phase 7 — Polish & Submission (deadline Aug 3, 5PM EDT)
- [ ] Demo corpus: 5 CC-licensed tutorials ingested, 5 mock brands
- [ ] Final README pass with architecture diagram + quickstart
- [ ] A11y pass: keyboard nav, ARIA, contrast, captions toggle, no color-only states
- [ ] Empty/error states filled
- [ ] Deploy: Vercel (Next.js) + Fly.io worker if needed
- [ ] Record 3-min demo video per SRS script
- [ ] Devpost submission (features, providers list, screenshots, demo link, repo with `b2genblaze` collaborator)
- [ ] File 3–5 high-quality Genblaze GitHub issues (Feedback Prize)
- [ ] Submit by **Aug 3, 2026 5:00 PM EDT**
