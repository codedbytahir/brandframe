# 12 — Phases, Build Order & Definition of Done

This is the canonical execution plan. It mirrors `TASKS.md` at the root but
adds phase exit criteria (DoD) and references to detailed specs.

Each phase should land in a coherent state — i.e., after finishing a phase,
`npm run dev` boots, the UI that's built is usable, and no half-wired pages
throw. Tick off items in `TASKS.md` as you go and update `MEMORY.md` with
blockers and decisions.

## Timeline (9 days total)

| Phase | Name | Days | Target done |
|---|---|---|---|
| 1 | Foundation | 1 day | Day 1 (Jul 26) |
| 2 | Pipelines (Genblaze wiring) | 1.5 days | Day 2–3 (Jul 27–28) |
| 3 | Upload + Ingest | 1 day | Day 3 (Jul 28) |
| 4 | Player / Search / Overview / Chat | 2 days | Day 5 (Jul 30) |
| 5 | Ad engine (pause ad hero) | 1.5 days | Day 6–7 (Aug 1) |
| 6 | Provenance & verify | 1 day | Day 7 (Aug 2) |
| 7 | Polish, demo, submission | 1 day | Aug 3, 5PM EDT |

## Phase 1 — Foundation
**Spec refs:** §02 (tech stack), §03 (conventions), §04 (design system), §05 (data model), §11 (env).

Goal: ship the scaffolding that's already partially in place so the app boots cleanly.

- [x] Repo structure, config files, tailwind, tsconfig strict, next.config (external packages lancedb + arrow).
- [x] `src/lib/env.ts`, `src/lib/utils.ts`, `src/lib/types.ts`.
- [x] `src/lib/b2/{client,paths}.ts` and `src/lib/db/{index,schema}.ts`.
- [x] Root layout, globals.css, Inter + JetBrains Mono, top nav + footer, dark default.
- [x] Marketing page, search page (stub), watch page (stub), studio page (stub), verify page (stub).
- [x] UI primitives: button, card, input, badge, progress, skeleton, scroll-area.
- [x] Player (hls.js), chat-panel, upload-form components (stubbed).
- [x] Python skeleton `pipelines/{cli,config,requirements}.txt`, `scripts/setup-pipelines.sh`, `src/lib/pipelines/run.ts`.
- [ ] Install remaining shadcn primitives: `dialog`, `tabs`, `tooltip`, `toast`, `separator`, `label`, `avatar`, `dropdown-menu`.
- [ ] Add `ThemeProvider` (next-themes) to layout (dark default, toggle optional for demo).
- [ ] Add `Toaster` from @radix-ui/react-toast to layout.
- [ ] Complete CSS variables for light theme (optional, nice).
- [ ] Run `npm install` (needs network).
- [ ] Run `npm run db:push` to create `brandframe.db`.
- [ ] `npm run pipelines:install` (create venv + pip install).
- [ ] Boot `npm run dev` and confirm:
  - Home page renders with hero + search form.
  - /studio renders; upload drag-drop works (fake progress).
  - /watch/demo loads the mux test HLS stream and plays.
  - /verify/demo renders the stub verifier.
  - Console has no errors/warnings; `npm run typecheck` passes.

**DoD Phase 1:** clean typecheck + lint, app boots, all existing routes render without errors, UI primitives are in place, DB exists.

## Phase 2 — Genblaze Pipelines (Python)
**Spec refs:** §07 (pipeline), §05 §4 (manifest schema), §02 §3 (Python deps).

Goal: the CLI can ingest a real video from B2 end-to-end with real providers (with fallbacks).

- [ ] Flesh out each Step in `pipelines/cli.py` using Genblaze `Step`/`Pipeline` primitives.
  - [ ] `probe` — ffprobe (via ffmpeg-python or subprocess), write durationMs.
  - [ ] `transcode-hls` — ffmpeg to HLS ladder + poster.jpg → B2.
  - [ ] `asr` — Deepgram Nova-3 API primary, utterance/word timestamps.
  - [ ] `scenes+keyframes` — PySceneDetect + ffmpeg keyframe extraction.
  - [ ] `vl-caption` — Qwen-VL/GMI captions per keyframe.
  - [ ] `chunk` — NLTK-punctuation-respecting ~20–45s chunks, scene-boundary preference.
  - [ ] `embed` — BGE-M3 dense+sparse + CLIP to LanceDB on B2 (s3fs).
  - [ ] `slots` — Qwen-VL JSON-mode + MediaPipe face/hand reject + spacing + policy.
  - [ ] `brand-match` — CLIP similarity vs pre-seeded brand embeddings.
  - [ ] `inpaint` — Gemini 2.5 Flash Image primary, Pillow compositing fallback.
  - [ ] `critic` — Genblaze AgentLoop with 5-point rubric.
  - [ ] `manifest` — build manifest JSON, embed MP4 metadata, upload to B2 with Object Lock COMPLIANCE 365d.
- [ ] Define the JSONL event shape as a typed dict; emit progress % per step.
- [ ] Small HTTP update callback so Python can update SQLite (or write to a JSON sidecar that Next reads — decide and document in DECISIONS.md).
- [ ] Script `scripts/seed-brands.py` (or ts) to insert 5 mock brands + upload packshots + compute CLIP/text vectors.
- [ ] Manually test pipeline on 5 seeded CC-tutorial videos (or shorter samples if bandwidth is tight).
- [ ] Ensure `pip install` works from a clean venv without network-critical failures (vendor nothing, but catch import errors and show a friendly "pip install first" message).

**DoD Phase 2:** `npm run pipelines:ingest -- --key <sample-key>` completes successfully, B2 prefixes are populated, DB rows inserted, manifest written with Object Lock.

## Phase 3 — Upload + Ingest flow
**Spec refs:** §06 §1-3 (upload/webhook/SSE routes).

Goal: a creator can upload a video from the UI and watch live progress until it's ready.

- [ ] `POST /api/upload` — presign PUT (zod validation, size cap, video content-type, create video row).
- [ ] Replace fake progress in `upload-form.tsx` with real PUT via XHR (track `upload.onprogress`), then mark uploaded.
- [ ] Configure B2 Event Notifications in the B2 console: ObjectCreated on `uploads/*` → `<APP_URL>/api/webhook/b2`.
- [ ] `POST /api/webhook/b2` — parse event, set video status `processing`, spawn pipeline, tee logs to per-video buffer (in-memory `Map<string, string[]>` is fine for v1 single-instance; persist to B2 `tmp/<id>/pipeline.log` if we want survive-restart).
- [ ] `GET /api/pipelines/[videoId]` — SSE: replay buffered lines, tail new lines, end on `pipeline.done`/`pipeline.failed`, 15s keepalive pings, clean abort.
- [ ] Studio page shows live step list (status, spinner/check/X, % progress per step, elapsed time).
- [ ] `/api/pipelines/[videoId]/retry` action (or Server Action) — set status back to `processing`, re-spawn.
- [ ] Error UI: if pipeline fails, show error message + Retry button.
- [ ] Lifecycle rule in B2 console: `tmp/` expires in 48h (document setup steps in `scripts/setup-b2.md` if needed).

**DoD Phase 3:** Browser → signed PUT → B2 → webhook → pipeline → SSE progress → video.status=ready end-to-end.

## Phase 4 — Player, Search, AI Overview, Chat
**Spec refs:** §08 (RAG/search), §06 §4-5 (chat/playback routes), §04 (layout).

Goal: search returns real hits; AI Overview cites timestamps; chat streams with clickable chips; player jumps to timestamps and plays signed HLS from B2.

- [ ] Wire `lib/rag/search.ts` to LanceDB: open `s3://bucket/index/segments.lance` with S3 storage options → mistral-embed query vectors (BM25-only keyless fallback) → hybrid (0.5 dense + 0.2 BM25) → top-20 → token-F1 rerank → top-5.
- [ ] `/search` RSC: call search, render result cards with timestamp chips, `<mark>` query in snippet, thumbnails signed.
- [ ] AI Overview Card: take top-3 hits, call LLM via Vercel AI SDK `generateText` with citations as `[N](t:MM:SS)` links.
- [ ] `/api/chat` route using Vercel AI SDK `streamText` with retrieval-augmented system prompt and `<ts ms=...>` tag format.
- [ ] Chat panel: use `useChat`, parse assistant tokens for `<ts>` tags and render as clickable chips that call `playerRef.seekTo(ms)`.
- [ ] Player:
  - [ ] Fetch signed HLS from `/api/playback/[videoId]` instead of mux test stream.
  - [ ] Support `?t=<ms>` start time (read in watch page via `searchParams` and pass to player).
  - [ ] Chapters bar (rendered from segments with topic labels).
  - [ ] WebVTT captions track from ASR segments.
  - [ ] Keyboard shortcuts (space, arrows, f, m, 0–9).
- [ ] Watch page layout: 3/4 player + 1/4 sidebar with Tabs (Chapters | Chat | About) on lg, stacked on mobile.

**DoD Phase 4:** Type "how do I center a div" → real timestamped results with AI Overview → click a chip → player jumps and plays → ask follow-up in chat → click a chip mid-chat → player jumps.

## Phase 5 — Ad engine
**Spec refs:** §09 (all three layers).

Goal: the in-scene pause ad (Layer 3) fires during playback with full disclosure; Layers 1 and 2 show up in basic form.

- [ ] DB: extend schema if needed (ad_slots.criticScore exists; add `rejectReason`, `placements` table only if impressions are needed).
- [ ] Server cue-planner: a function `getCuesForVideo(videoId): Promise<Cue[]>` that queries breaks + approved+filled ad_slots, enforces caps, returns a sorted cue list.
- [ ] Player: wire cues into `timeupdate` detection (expand from existing demo cue logic).
- [ ] Layer 3 — Pause ad:
  - [ ] Overlay UI as specified in §09 §3.5 (brand logo, copy, disclosure badge "AI Ad · Why?" linking to /verify#slot-id, Skip button, Learn more).
  - [ ] Crossfade between video frame and inpainted pause-frame `<img>` on top of video.
  - [ ] Resume returns to original frame and plays from timestampMs.
- [ ] Layer 2 — Mid-roll card (8s creative image, "Skip in 6s" countdown, "Sponsored" label).
- [ ] Layer 1 — Intent overlay: in search page, if top brand score ≥ threshold, show "Sponsored" card above results (below AI Overview).
- [ ] Creator approval UI in Studio: list pending/filled slots with before/after, Approve/Reject buttons that call Server Action. For the demo auto-approve the seeded creators' slots but still show the list.
- [ ] Seed 5 mock brands + pre-match them to a slot in at least one seeded demo video so the pause ad is guaranteed to fire in the recorded demo.

**DoD Phase 5:** During playback of a seeded demo video, the player pauses at the expected timestamp, shows the inpainted frame with the brand, disclosure badge and "Why?" link work; Skip resumes cleanly; a mid-roll fires at a natural break; search shows a sponsored card.

## Phase 6 — Provenance & disclosure
**Spec refs:** §10.

Goal: `/verify/[videoId]` is a green-check public page that demonstrably proves the manifest is locked and hashes match.

- [ ] Manifest Step final polish: embed run_id manifest pointer into MP4 metadata, apply Object Lock COMPLIANCE 365d to `manifests/*` and GOVERNANCE 365d to inpainted frames.
- [ ] `/verify/[videoId]` RSC:
  - Load video row; if no manifestRunId → red state.
  - Fetch manifest JSON from B2.
  - HeadObject to verify lock headers; re-hash source range and before/after frames; compare.
  - Render green/amber/red banner; step timeline; placement cards with `BeforeAfterSlider` client component; technical-details collapsible.
- [ ] `BeforeAfterSlider` ("use client"): range input cross-fades two `<img>`s with signed URLs.
- [ ] Deep links: player's "Why?" button links to `/verify/[videoId]#slot-<slotId>` which auto-scrolls to the placement card and highlights it.
- [ ] `Why?` tooltip on pause ad (small `Info` icon hover) with one-line explanation, links to verify.
- [ ] If there is time: Ed25519 signature of manifest, public key on /verify.

**DoD Phase 6:** Clicking "Why?" on a pause ad opens /verify; green banner shows retention date; before/after slider works; tampering with an afterKey in B2 flips the banner to amber.

## Phase 7 — Polish, demo, submission
**Spec refs:** §00 §6-7.

- [ ] Seed 5 CC-licensed tutorial videos in the corpus (CSS centering, React hooks, Git branching, Linux commands, Python venv — simple, search-friendly topics).
- [ ] Seed 5 mock brands (Nestlé coffee mug, Huawei laptop skin, Coca-Cola can, fake SaaS sticker, fake cereal).
- [ ] Accessibility pass: keyboard player nav, ARIA labels, focus rings, captions toggle, color-only indicators replaced with icons.
- [ ] README updated with architecture ASCII diagram, quickstart, demo video link.
- [ ] Empty/error states filled (no videos, no search results, pipeline failed).
- [ ] Deploy: Vercel for Next; optionally a small Fly.io worker for webhook/SSE if Vercel cold starts cause problems (test early).
- [ ] Smoke-test on deployed URL (not just localhost).
- [ ] Record 3-minute demo video per script:
  1. 0:00–0:30 — pain + homepage
  2. 0:30–1:05 — upload live with SSE progress
  3. 1:05–1:25 — search "how to center a div" → AI Overview → jump to timestamp
  4. 1:25–1:45 — chat-with-video follow-up with chip
  5. 1:45–2:05 — in-scene pause ad fires → disclosure → "Why?" → verify page
  6. 2:05–2:25 — verify page walkthrough (Object Lock/365d, before/after)
  7. 2:25–2:55 — B2 console walkthrough (prefixes, Object Lock, lifecycle), Genblaze manifest excerpt
  8. 2:55–3:00 — CTA, hackathon pitch
- [ ] Devpost submission: title, tagline, description, screenshots, demo video link, repo link (add `b2genblaze` collaborator), providers list (Backblaze B2, Genblaze, Mistral AI, Google Gemini 2.5 Flash Image, Deepgram Nova-3), built-with list.
- [ ] File 3–5 high-quality Genblaze GitHub issues (feature requests, e.g., C2PA embedding, LanceDB s3fs example, ffmpeg Step primitive, AgentLoop VL rubric helper, ObjectStorageSink retention param).
- [ ] Submit by Aug 3, 5PM EDT.

**DoD Phase 7 (final):** Public deployed URL loads; demo video walks every judging pillar; Devpost submitted; GitHub issues filed; `MEMORY.md` archived.

## Definition of Done for any individual task

(Repeated from §03 for emphasis.)
1. Code matches conventions in §03.
2. `npm run typecheck` clean; `npm run lint` clean.
3. UI that's touched still renders; no new console errors.
4. Appropriate spec file(s) updated if you add a file/column/env var/route.
5. `TASKS.md` checkbox ticked, `MEMORY.md` updated at session end.
