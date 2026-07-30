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

## Phase 4 — Player, Search, AI Overview, Chat (STUBS — need real wiring)
Spec: `docs/specs/08-rag-search.md`, `docs/specs/06-api-routes.md` §4–6.
- [ ] Wire `lib/rag/search.ts` to LanceDB on B2: BGE-M3 (OpenAI fallback) → hybrid 0.5dense+0.2bm25+0.3clip → top-20 → cross-encoder → top-5
- [ ] `/search` RSC: render timestamped result cards, `<mark>` query term, signed thumbnails
- [ ] AI Overview card: Vercel AI SDK `generateText` with RAG context + `[N](t:MM:SS)` citations
- [ ] `POST /api/chat` — Vercel AI SDK `streamText` with RAG system prompt + `<ts ms="…">X:XX</ts>`
- [ ] Chat panel: `useChat` hook, render `<ts>` as clickable seek chips
- [ ] `GET /api/playback/[videoId]` — return signed HLS URL (+ poster), 409 if not ready
- [ ] Player: swap mux test stream for signed HLS URL, support `?t=<ms>` deep link
- [ ] Chapters bar (from `segments.topic`), WebVTT captions, keyboard shortcuts
- [ ] Watch page: 3/4 player + 1/4 sidebar tabs (Chapters | Chat | About) on lg

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
