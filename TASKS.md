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

## Phase 5 — Ad Engine (three layers) ✅ DONE (real wiring, 2026-08-01)
Spec: `docs/specs/09-ad-engine.md`.
- [x] `lib/ads/cues.ts` — rewritten as the server-side cue planner (spec §4): Layer 3 from `ad_slots`⨝`brands` (filled/approved, ≥180s spacing), Layer 2 from `natural_breaks` + B2 `assets/<id>/breaks.json` fallback, greedy ≥180s spacing, ≥55/100 threshold, ≥60s, pause-ad-wins ±10s de-conflict
- [x] Player: real cues from server in watch RSC; Layer 2 mid-roll card (auto-pause at break ±400ms, Sponsored badge, Skip-in-6 countdown, auto-resume 8s, creative → targetUrl) + Layer 3 pause ad (auto-pause at slot ±400ms, 200ms crossfade, "AI Ad · <brand>" badge, Why? → /verify#slot-<id>, "Play · Skip ad", Learn more) — each cue once per session, impression/skip `console.log` audit events
- [x] Layer 2 natural-break detection: Python `step_breaks` — weighted formula `0.4·scene_strength + 0.3·silence + 0.2·topic_drop − 0.5·mid_sentence`, ≥180s greedy spacing, sidecar `assets/<id>/breaks.json` + manifest entry; unit-tested
- [x] Layer 1 intent overlays: `lib/ads/intent.ts` — mistral-embed brand text vectors (in-process cache) with lexical fallback (stopwords/camelCase/de-plural), 0.3 threshold; Sponsored card on `/search` (below AI Overview) and in chat (below latest answer, via `/api/ads/intent`)
- [x] Creator Studio approval UI: `/studio/slots` queue with before/after thumbs + Approve/Reject/Reset Server Actions; linked from `/studio`
- [x] Pipeline latent-bug fixes: `run_ingest` negative-index drift — `step_chunk` received the **transcode** result instead of ASR; `step_inpaint` received vl-caption/chunk instead of scenes (would break any real E2E run). Now named references.
- [x] Brands schema extended (`copy`, `target_url`) + richer seeds (logos, packshots, copy, target URLs)
- [x] `run_ingest` now 13 steps (added breaks between embed and slots)

## Phase 6 — Provenance & Disclosure ✅ DONE (real wiring, 2026-08-01)
Spec: `docs/specs/10-provenance.md`.
- [x] Manifest Step enriched: `run_id`, `manifest_version`, `source` block with full SHA-256 + hash_type, placements carry brand/timestamp_ms/bbox; COMPLIANCE 365d on manifest, GOVERNANCE 365d on inpainted frames (was already set in inpaint step)
- [x] `/verify/[videoId]` RSC: fetches manifest from B2, HeadObject lock checks (mode + retain-until), recomputes SHA-256 of source MP4 + every before/after frame, typed `VerifyResult` (`src/lib/provenance/verify.ts`)
- [x] Status banners: green verified / amber warning (hash mismatch or lock missing) / red no-manifest / blue demo-simulated (never presented as cryptographic)
- [x] `BeforeAfterSlider` client component (range-input clip-path crossfade + divider, ARIA label)
- [x] Page sections per spec §5: video summary, chain-of-custody timeline (13 steps: provider/model/latency/status dot), placement cards (slider, critic stars, surface/brand, approved line, "Why did we place this?" expandable, `#slot-<id>` anchors), technical details (manifest SHA-256 + copy button, source hash match, bucket/endpoint/lock/retention, how-it-works blurb w/ Genblaze + B2 links)
- [x] `/api/verify-frames/[videoId]` — prefix-restricted public frame proxy (assets/ + manifests/ only, 24h immutable cache) so shared verify links don't expire
- [x] Disclosure copy aligned to spec §6 verbatim: pause-ad "generated by AI, approved by the creator, and cryptographically recorded"; Sponsored card "content-matched brand, not user-targeted"; mid-roll "Sponsored" + "Ad · <brand>" + Skip-in-X
- [x] Player "Why?" link → `/verify/<id>#slot-<slotId>` deep-scroll (scroll-mt set)

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
