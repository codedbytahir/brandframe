# BrandFrame — Task Checklist

> **Coding agents:** before ticking boxes, read `AGENTS.md` → `MEMORY.md` → the relevant spec in `docs/specs/`.
> Update `MEMORY.md` at the end of every session. Detailed phase DoD lives in
> `docs/specs/12-phases-and-tasks.md`.

Stack: Next.js 15 (App Router, RSC default, Server Actions), TypeScript strict,
Tailwind v3, shadcn/ui-style primitives, Drizzle/libsql, Vercel AI SDK, hls.js,
@aws-sdk/client-s3 (for B2), Genblaze Python SDK as a child process, LanceDB on B2.
**No FastAPI. No separate backend server.** B2 is the single source of truth for binaries.

---

## Phase 1 — Foundation (do first)
- [x] Initialize repo structure (`src/app`, `src/components`, `src/lib`, `pipelines/`, `docs/specs/`)
- [x] `package.json`, `tsconfig.json` (strict, `@/*` paths), `tailwind.config.ts` (brand orange #f15a22, CSS-variable tokens), `next.config.ts` (serverExternalPackages: lancedb+arrow, B2 remotePatterns, 250mb serverActions), `.env.example`
- [x] Drizzle schema (`src/lib/db/schema.ts`): users, videos, segments, brands, ad_slots, breaks
- [x] `src/lib/env.ts` (zod) with `isDemo` fallback when B2 keys missing
- [x] `src/lib/b2/{client,paths}.ts` — S3Client pointed at B2 + public URL helper + key-prefix helpers
- [x] `src/lib/utils.ts` — cn, formatTimestamp (ms → `M:SS` / `H:MM:SS`), shortId
- [x] `src/lib/types.ts` — Video, Segment, AdSlot, Brand, SlotStatus, VideoStatus
- [x] `src/lib/pipelines/run.ts` — spawns `.venv/bin/python -m pipelines.cli ingest --key <key>`
- [x] `src/lib/rag/search.ts` (stub returning demo hit)
- [x] Root layout: Inter + JetBrains Mono, dark default, header/footer shell, metadata
- [x] Marketing `/`, `/search`, `/watch/[videoId]`, `/studio`, `/verify/[videoId]` pages (stubs + demo data)
- [x] UI primitives: button, card, input, badge (default/secondary/outline/success/warning/danger), progress, skeleton, scroll-area (minimal)
- [x] Player component (hls.js + play/pause/seek/cue detection + demo pause-ad overlay, mux test stream)
- [x] Chat panel (streaming stub)
- [x] Upload form (drag-drop with simulated progress)
- [x] Python skeleton: `pipelines/{__init__,cli,config,requirements}.txt` with stub Steps emitting JSONL
- [x] `scripts/setup-pipelines.sh` (chmod +x)
- [x] Spec suite: `docs/specs/00..12-*.md`, `AGENTS.md`, `DECISIONS.md`, `MEMORY.md`
- [ ] Install remaining shadcn/ui primitives: dialog, tabs, tooltip, toast, separator, label, avatar, dropdown-menu
- [ ] Mount `ThemeProvider` (next-themes, dark default) and `Toaster` in root layout
- [ ] Add light-theme CSS variables in `globals.css` (nice-to-have)
- [ ] Run `npm install`
- [ ] Run `npm run db:push` to create `brandframe.db`
- [ ] Run `npm run pipelines:install` to create `.venv` and pip install
- [ ] Boot `npm run dev` and confirm all existing routes render without errors; `npm run typecheck` and `npm run lint` clean

## Phase 2 — Python Pipelines (Genblaze)
Spec: `docs/specs/07-pipeline.md`. Schema: `docs/specs/05-data-model.md`.
- [x] `pipelines/requirements.txt` (genblaze adapters, faster-whisper, pyannote, scenedetect, opencv, mediapipe, lancedb, pyarrow, s3fs, flagembedding, transformers, torch, pillow, ffmpeg-python, boto3)
- [x] `scripts/setup-pipelines.sh` (npm script `pipelines:install`)
- [x] CLI entry point `pipelines/cli.py` with `ingest --key <b2-key>`
- [ ] Wire real Genblaze Steps with retry + fallback (per §07 §3–4):
  - [ ] `probe` — ffprobe → duration/codec/resolution
  - [ ] `transcode-hls` — ffmpeg HLS ladder + poster
  - [ ] `asr` — NVIDIA Parakeet (nvidia/parakeet-tdt-1.1b) primary, faster-whisper large-v3 fallback, Whisper-API last resort
  - [ ] `scenes+keyframes` — PySceneDetect + ffmpeg keyframe extraction
  - [ ] `vl-caption` — Qwen2.5-VL-7B (GMI) primary, GPT-4o-mini vision fallback
  - [ ] `chunk` — NLTK punctuation + scene-boundary 20–45s chunks
  - [ ] `embed` — BGE-M3 dense+sparse + CLIP ViT-B/32 → LanceDB at `index/segments.lance` on B2 (s3fs)
  - [ ] `slots` — Qwen-VL JSON-mode + MediaPipe face/hand reject + spacing + content-policy
  - [ ] `brand-match` — CLIP vs `brands.lance` + category matrix
  - [ ] `inpaint` — FLUX.1-fill-pro (GMI) primary, Replicate fallback
  - [ ] `critic` — Genblaze AgentLoop, 5-point rubric, retry once, drop on fail
  - [ ] `manifest` — build manifest, embed MP4 metadata pointer, put to `manifests/` with B2 Object Lock COMPLIANCE 365d
- [ ] Per-step progress % emitted via `_log` for SSE
- [ ] Write `scripts/seed-brands.ts` (or `.py`): insert 5 mock brands, upload logos/packshots, compute CLIP+text vectors
- [ ] End-to-end test on a short sample video

## Phase 3 — Upload + Ingest
Spec: `docs/specs/06-api-routes.md` §1–3.
- [ ] `POST /api/upload` — presigned PUT URL (900s TTL), size cap 5GB, video/* only, insert video row
- [ ] Replace fake progress in upload form: XHR PUT direct to B2 with `upload.onprogress`
- [ ] Configure B2 Event Notification on `ObjectCreated: uploads/*` → `<APP_URL>/api/webhook/b2`
- [ ] `POST /api/webhook/b2` — parse payload, set status=processing, spawn pipeline, buffer JSONL
- [ ] `GET /api/pipelines/[videoId]` — SSE (replay buffer → tail → ping 15s → end on done/failed)
- [ ] Studio UI: live step list with spinner/check/X, % progress, elapsed time
- [ ] Retry action (Server Action) for failed videos
- [ ] B2 Lifecycle Rule: `tmp/` delete after 48h

## Phase 4 — Player, Search, AI Overview, Chat
Spec: `docs/specs/08-rag-search.md`, `docs/specs/06-api-routes.md` §4–6.
- [ ] Wire `lib/rag/search.ts` to LanceDB on B2: BGE-M3 (OpenAI fallback) → hybrid 0.5dense+0.2bm25+0.3clip → top-20 → cross-encoder (Transformers.js or NIM) → top-5
- [ ] `/search` RSC: render timestamped result cards, `<mark>` query term, signed thumbnails
- [ ] AI Overview card (top of results + watch sidebar): top-3 segments → LLM via Vercel AI SDK `generateText` with `[N](t:MM:SS)` citations
- [ ] `POST /api/chat` — Vercel AI SDK `streamText` with RAG system prompt + `<ts ms="…">X:XX</ts>` tag format
- [ ] Chat panel: `useChat`, render `<ts>` tags as clickable chips that call `player.seekTo(ms)`
- [ ] `GET /api/playback/[videoId]` — return signed HLS URL (+ poster), 409 if not ready
- [ ] Player: swap mux test stream for signed HLS URL, support `?t=<ms>` deep link
- [ ] Chapters bar (from `segments.topic`), WebVTT captions, keyboard shortcuts (space/arrows/f/m/0–9)
- [ ] Watch page: 3/4 player + 1/4 sidebar tabs (Chapters | Chat | About) on lg

## Phase 5 — Ad Engine (three layers)
Spec: `docs/specs/09-ad-engine.md`.
- [ ] Add `ad_slots.rejectReason`, optional `placements` table if needed
- [ ] Server cue-planner `lib/ads/cues.ts` — query breaks + approved+filled slots, enforce caps, return sorted Cue[]
- [ ] Player: wire real cues from server; mid-roll card (Layer 2) + pause-ad overlay (Layer 3) + intent overlay (Layer 1 in search/chat)
- [ ] Layer 3 pause-ad UX finalized: crossfade to inpainted `<img>`, "AI Ad · Why?" badge, Skip + Learn more, Resume returns to live video at timestamp
- [ ] Layer 2 natural-break detection: weighted formula `w1·scene_cut + w2·silence + w3·topic_shift − w4·mid_sentence`, min-60s-start, 180s between
- [ ] Layer 1 sponsored card in search/chat when brand match score ≥ 0.3
- [ ] Creator Studio approval UI (before/after thumbnails, Approve/Reject Server Actions) — auto-approve seeded brands for demo
- [ ] Seed 5 mock brands pre-matched to slots in demo corpus so pause ad fires in the recorded demo

## Phase 6 — Provenance & Disclosure
Spec: `docs/specs/10-provenance.md`.
- [ ] Manifest Step: put to B2 with Object Lock COMPLIANCE 365d; set GOVERNANCE 365d on inpainted frames; embed manifest-pointer in MP4 `udta` metadata
- [ ] `/verify/[videoId]` RSC: fetch manifest, HeadObject to verify lock headers, re-hash source + before/after, render green/amber/red banner, step timeline, placement cards
- [ ] `BeforeAfterSlider` "use client" component (range input cross-fades two signed-URL `<img>`s)
- [ ] Player "Why?" link → `/verify/[videoId]#slot-<slotId>` deep-scroll highlight
- [ ] (Stretch) Ed25519 manifest signature, public key on /verify

## Phase 7 — Polish & Submission
Spec: `docs/specs/00-project-brief.md` §7, `docs/specs/12-phases-and-tasks.md` Phase 7.
- [ ] Demo corpus: 5 CC-licensed tutorials ingested, 5 mock brands
- [ ] Final README pass with architecture diagram + quickstart
- [ ] A11y pass: keyboard nav, ARIA, contrast, captions toggle, no color-only states
- [ ] Empty/error states filled
- [ ] Deploy: Vercel (Next.js) + Fly.io worker if needed for long-lived spawns
- [ ] Record 3-min demo video per SRS script
- [ ] Devpost submission (features, providers list, screenshots, demo link, repo with `b2genblaze` collaborator)
- [ ] File 3–5 high-quality Genblaze GitHub issues (Feedback Prize)
- [ ] Submit by **Aug 3, 2026 5:00 PM EDT**
