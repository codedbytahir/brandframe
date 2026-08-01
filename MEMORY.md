# MEMORY.md — living project state for coding agents

**Read this FIRST at the start of every session. Update it at the END.**
This file is how agents avoid re-discovering state across turns.
Last updated: 2026-07-26 (initial scaffold + spec suite).

## 1. What this project is

BrandFrame — AI-native video platform with semantic search, chat-with-video, and
provenance-tracked in-scene pause ads, built for the **Backblaze Generative Media
Hackathon** (deadline Aug 3, 2026 5PM EDT = Aug 4 2AM PKT).
Stack: **Next.js 15 (App Router, RSC default, Server Actions) + Tailwind + shadcn/ui +
Drizzle/libsql + Genblaze Python SDK (child process) + Backblaze B2 + LanceDB on B2**.
No FastAPI. No extra servers. See `docs/specs/00-project-brief.md` for the thesis.

## 2. Current state (honest — update as you go)

### What's built (scaffold only — mostly stubs)
- Repo skeleton, configs (next.config, tailwind, tsconfig strict, drizzle), package.json with pinned deps.
- Root layout, dark default theme, header/footer shell, fonts (Inter, JetBrains Mono).
- Marketing `/` page with hero search form + demo player card + 3 feature cards.
- `/search?q=...` page (stub; hard-coded demo hit).
- `/watch/[videoId]` layout (stub) with chapters, AI Overview card, ChatPanel, demo ad cue at 8:00.
- `/studio` upload page with drag-drop upload form (fake progress).
- `/verify/[videoId]` stub page.
- UI primitives in `src/components/ui/`: button, card, input, badge, progress, skeleton, scroll-area (minimal).
- Player (hls.js) with play/pause/seek, timeupdate cue detection, demo pause-ad overlay using the public mux test stream.
- Chat panel (streaming stub).
- `src/lib/env.ts` (zod) + `isDemo` flag when B2 keys missing.
- `src/lib/utils.ts` (cn, formatTimestamp, shortId).
- `src/lib/types.ts` (Video, Segment, AdSlot, Brand, etc.).
- `src/lib/b2/{client,paths}.ts` — S3 client pointed at B2, key helpers.
- `src/lib/db/{index,schema}.ts` — Drizzle + libsql with tables: users, videos, segments, brands, ad_slots, breaks.
- `src/lib/pipelines/run.ts` — spawns `.venv/bin/python -m pipelines.cli ingest --key <key>` with onLog callback.
- `src/lib/rag/search.ts` — placeholder returning one demo hit.
- Python: `pipelines/{__init__,cli,config,requirements}.txt` + `scripts/setup-pipelines.sh`. CLI has stubs for all Steps (probe → asr → scenes → embed → slots → inpaint → manifest) emitting JSONL.
- **Full spec suite** in `docs/specs/00..12*.md` — read these before coding.

### What is NOT done yet (the actual work)
- `npm install` hasn't been run (needs network).
- `npm run db:push` hasn't been run (no brandframe.db yet).
- Python venv hasn't been created; pip install not run.
- shadcn primitives missing: dialog, tabs, tooltip, toast, separator, label, avatar, dropdown-menu.
- ThemeProvider (next-themes) + Toaster not mounted in layout.
- All API routes under `src/app/api/` are missing (upload, webhook/b2, pipelines/[videoId] SSE, chat, search, playback, slots).
- Python Steps are stubs that return hard-coded StepResult objects — no real Genblaze/Pipeline wiring, no real provider calls.
- LanceDB is never opened; `lib/rag/search.ts` is a stub.
- Player uses mux test stream, not signed HLS from B2.
- AI Overview and Chat don't call Vercel AI SDK yet.
- Presigned PUT upload, B2 webhook, SSE progress not implemented.
- Object Lock retention not set via boto3 yet.
- Genblaze Manifest embedding into MP4 not implemented.
- No seed data (no demo videos, no brands, no users).
- Brand portal UI, creator per-placement approval UI not implemented.
- The cue-planner that reads slots/breaks from DB and feeds the player isn't written.

### What currently works without env vars (demo mode)
- Marketing page, search stub, watch stub (mux HLS), studio stub (fake upload), verify stub.
- Player plays the public `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` test stream.
- The demo pause-ad cue fires at 480000ms (8:00) on the watch page (hard-coded in `src/app/(app)/watch/[videoId]/page.tsx`).

### What requires env keys
- Real uploads (B2_*).
- Real pipeline runs (B2_* + at least GMI/OpenAI for inpaint+LLM).
- LanceDB on B2 (B2_*).
- Vercel AI SDK chat/overview (OPENAI_API_KEY at minimum).

## 3. Commands I know work

Not yet tested — npm/venv install pending. Documented commands (from README/TASKS):
```bash
npm install
npm run db:push          # creates brandframe.db
npm run pipelines:install  # creates .venv and pip install -r pipelines/requirements.txt
npm run dev              # turbopack on :3000
npm run typecheck        # MUST be clean before ending
npm run lint
```

## 4. Key decisions already made (see DECISIONS.md for full ADRs)

- **Next.js only on the server** — no FastAPI/Express. Python is child_process.
- **SQLite (libsql) for metadata, B2 for everything binary, LanceDB on B2 for vectors.**
- **V1 in-scene ads are single-frame PAUSE**, not per-frame re-render.
- **3 ad layers with caps** — no "100 ads/10 min". Layer 3 max 1 per 3–5 min.
- **Inanimate-object slots only** (mug, laptop_lid, can, bottle, blank_sign, cereal_box, book_cover, screen). Face/hand rejection via MediaPipe.
- **Hybrid RAG: 0.5 dense (BGE-M3) + 0.2 BM25 + 0.3 visual (CLIP ViT-B/32)** → bge-reranker-v2-m3.
- **B2 us-west-004, bucket with Object Lock ENABLED (must be set at creation).**
- **Manifest retention: 365 days COMPLIANCE; inpainted frames 365 days GOVERNANCE.**
- **Dark theme by default; brand orange #f15a22.**
- **No real auth for v1** — demo user cookie stub; add NextAuth only if Phase 7 has time.
- **Single-brand-per-video for demo** (simplifies matching).
- **For v1, run inpaint immediately on ingest with status='filled'; creator can reject post-hoc** (rather than the preview-then-approve flow). This is a demo-time shortcut and is recorded in DECISIONS.md.

## 5. Conventions I must not break (see docs/specs/03-conventions.md)

- Server Components default; `"use client"` only when necessary (hls.js player, chat, upload with progress, before/after slider).
- TS strict on; no `any` without justification comment.
- All env reads go through `src/lib/env.ts` (Node) / `pipelines/config.py` (Python).
- B2 keys/paths always via `src/lib/b2/paths.ts` helpers — never hard-code strings.
- IDs use `shortId("prefix")` → `vid_abc123` etc. (videos `vid_`, segments `seg_`, slots `slot_`, brands `brd_`, breaks `brk_`, users `usr_`, runs `run_<unix>`).
- Timestamps in DB: integer milliseconds; datetimes ISO-8601 text.
- Tailwind only; CSS vars for theming in globals.css only.
- Python logging: only JSONL to stdout via `_log()`, everything else stderr.
- Components PascalCase, lib modules camelCase, kebab-case filenames.
- Update this file at end of every session.

## 6. File map (current reality)

```
brandframe/
├── package.json / tsconfig.json / next.config.ts / tailwind.config.ts / postcss.config.mjs
├── drizzle.config.ts / .env.example / .gitignore / next-env.d.ts
├── README.md / TASKS.md / MEMORY.md (you are here) / DECISIONS.md / AGENTS.md
├── docs/specs/00-12*.md         # the new spec suite
├── public/                       # empty
├── prisma/                       # empty dir (we use Drizzle, kept only for docs)
├── scripts/setup-pipelines.sh    # chmod +x done
├── src/
│   ├── app/
│   │   ├── layout.tsx            # header/footer, fonts, dark
│   │   ├── globals.css           # Tailwind + CSS vars
│   │   ├── (marketing)/page.tsx  # landing/hero
│   │   ├── search/page.tsx       # stub results
│   │   ├── (app)/
│   │   │   ├── studio/page.tsx
│   │   │   ├── watch/[videoId]/page.tsx  (stub, demo cue at 480000ms)
│   │   │   ├── verify/[videoId]/page.tsx (stub)
│   │   │   └── dashboard/        # empty dir
│   │   └── api/                  # EMPTY — routes not yet written
│   ├── components/
│   │   ├── ui/                   # button, card, input, badge, progress, skeleton, scroll-area
│   │   ├── player/player.tsx, chat-panel.tsx
│   │   └── dashboard/upload-form.tsx
│   ├── lib/
│   │   ├── env.ts, utils.ts, types.ts
│   │   ├── ai/                   # empty dir
│   │   ├── b2/{client,paths}.ts
│   │   ├── db/{index,schema}.ts
│   │   ├── pipelines/run.ts
│   │   └── rag/search.ts         # stub
│   └── types/global.d.ts
└── pipelines/
    ├── __init__.py, cli.py, config.py, requirements.txt, README.md
```

## 7. Active blockers / gotchas

- **torch / transformers install can be slow in Pakistan** — prefer hosted provider calls (NVIDIA NIM, GMI, OpenAI) for the demo to keep local deps light.
- **Bucket Object Lock must be enabled at CREATION time** — if the bucket already exists without it, delete and recreate it.
- **lancedb and apache-arrow must be in `serverExternalPackages`** (already set in next.config.ts) or Next will try to bundle them for Edge and break.
- **HLS.js requires "use client"** (browser-only). Don't import hls.js in a Server Component.
- **`@aws-sdk/client-s3` v3 uses ES modules;** use `forcePathStyle: true` for B2.
- **`b2PublicUrl`** in `client.ts` derives the `f004` subdomain from the region suffix; if the region ever changes, this still works.
- **Python venv path** is configurable via `PIPELINE_VENV` env (default `.venv`).

## 8. Session log (append new entries at top)

### 2026-08-01 (Phase 7a) — Brand identity + landing + QA sweep (this agent)
- Pixel-art identity generated & shipped: `public/brand/{logo,hero,pipeline,feat-search,
  feat-ads,feat-verify}.webp` (9.4MB → ~460KB via downscale+WebP), favicon `src/app/icon.png`,
  `.pixelated`/`.pixel-frame` utilities in globals.css.
- Landing page fully rewritten (hero w/ stats, 3 feature cards → deep demo links,
  13-step pipeline explainer, 3-layer ad section, live-demo grid, FTC/EU trust note);
  broken Safari-only raw-HLS demo card removed. Header/footer got logo + Verify link.
- QA sweep: 409 VIDEO_NOT_READY path (temp row), 404s (playback/verify/watch ghosts),
  search ranking (useEffect → seg_203 ✓), chat `<ts>` stream, captions VTT, cue planner
  logs, approval queue (8 approve buttons), 8/8 pipeline tests, intent tuning — brand
  copies hardened (soda/soft drink → DemoCola now matches; coffee/laptop/cereal/books
  re-verified).
- QA lessons: React HTML comment markers around interpolations break exact-string grep
  checks — flight payload carries the authoritative strings.

### 2026-08-01 (latest) — Phase 6 REAL wiring complete (this agent)
Verify page was a hard-coded green banner with fake timeline. Now real:
- `src/lib/provenance/verify.ts`: real B2 verification — fetch manifest bytes,
  SHA-256 recompute (source full-hash <200MB, before/after frames), HeadObject
  Object Lock mode/retain-until → VerifyResult{verified|warning|no-manifest|demo}.
  Demo mode (no keys) synthesizes a clearly-labeled simulated manifest from DB.
- Manifest step enriched: run_id, source.sha256 (+hash_type), placements get
  brand/timestamp_ms/bbox (inpaint already sets GOVERNANCE 365d on after-frames).
- `/verify/[videoId]` rewritten per spec §5 (banner, custody timeline — 13 steps,
  placement cards, technical details + CopyButton). New: BeforeAfterSlider
  (range clip-path), `/api/verify-frames` (prefix-restricted public proxy, 24h
  cache — ADR-015). Disclosure copy now verbatim per spec §6.
- Verified live: demo001 renders banner + 13-step custody + 2 placement cards w/
  #slot anchors; demo003 hides placements; unknown id → 404. Tests+typecheck+build ✓.
- NOT live-tested (needs B2 creds): green verified path, amber mismatch path —
  code paths complete, exercised only in demo sim. Manual corruption test per spec §8 pending keys.

### 2026-08-01 (later) — Phase 5 REAL wiring complete (this agent)
Prior "Phase 5 done" was again optimistic: cues.ts was a pure client planner with
placeholder inputs, no pipeline breaks step existed, Layer 1/2 were unimplemented,
no creator approval UI. Completed for real:
- Pipeline: new `step_breaks` (13th step, deterministic weighted formula per spec §2)
  writing `assets/<id>/breaks.json` sidecar; **fixed latent negative-index bugs in
  run_ingest** (step_chunk got transcode instead of ASR; step_inpaint wrong input) —
  named refs now. New unit test `test_compute_breaks`. 8/8 pipeline tests ✓.
- `lib/ads/cues.ts` rewritten: server-side planner → PauseAdCue[] + MidrollCue[]
  (caps + pause-ad-wins de-conflict; breaks sidecar fallback; one-brand-per-video rule).
- `lib/ads/intent.ts`: Layer 1 brand intent (mistral-embed cache / lexical fallback
  with stopwords + camelCase + de-plural), 0.3 threshold.
- Player: Layer 2 mid-roll overlay (auto-pause ±400ms, Skip-in-6, auto-resume 8s),
  Layer 3 upgraded (auto-pause at cue, 200ms crossfade, copy/targetUrl/logo,
  "Play · Skip ad"), once-per-session cues, console.log impression/skip audit.
- Layer 1 surfaces: SponsoredCard on /search (server) + chat panel (client, via
  `/api/ads/intent`). Verified: coffee→BrewMate, laptop skin→LaptopPro, cereal→
  SnackBox, programming books→TechBook, gibberish→null (lexical path).
- Creator approvals: `/studio/slots` + Server Actions (approve/reject/reset),
  linked from /studio. Brands schema +`copy`,`target_url` (run drizzle push + reseed).
- ADR-014 logged. typecheck/build clean; dev smoke ✓ (cues: vid_demo001 = 1 pause-ad
  + 2 mid-rolls, correct spacing/de-conflict).
- NOT YET live-tested: mid-roll/pause-ad overlays in a real browser (logic smoke-
  tested server-side only); embedding intent path needs MISTRAL_API_KEY.

### 2026-08-01 — Phase 4 REAL wiring complete (this agent)
Found TASKS.md was accurate and the prior "Phase 4 done" handover was optimistic: search/
chat/overview were stubs, watch/search pages hard-coded, chat panel fake, player on the
mux test stream, only 1 seeded video. Completed Phase 4 for real:
- `src/lib/rag/`: `corpus.ts` (SQLite + B2 sidecar), `embed.ts` (mistral-embed + SQLite
  cache, new `segment_embeddings` table — run `npx drizzle-kit push`), `bm25.ts` (BM25 +
  token-F1 rerank), `search.ts` (0.5 dense/0.2 BM25 hybrid, Mistral `generateText`
  overview with `[N](t:MM:SS)` citations; fallbacks: BM25-only → demo stubs).
- `/api/chat`: real `streamText` (mistral-large-latest) + RAG system prompt with
  `<ts ms>` instructions; text-stream protocol; demo mode streams DB-grounded answers.
- Chat panel: `useChat` (ai/react), `<ts>` chips seek player (custom event
  `brandframe:seek` + `router.push ?t=`); new `ui/tabs.tsx` (radix).
- Playback: same-origin B2 HLS proxy `/api/playback/[videoId]/file/[...path]` (Range,
  206, content-types; see ADR-011), main playback route returns proxy URL in real mode /
  DB `hlsUrl` in demo; new `/api/captions/[videoId]` (WebVTT from segments).
- Player: resolves source via API, split source/seek effects, seek-event listener,
  keyboard shortcuts (←/→ space/k f m), captions track, 409 poll while processing,
  crossfade pause-ad wired from DB cues.
- Watch page: real video/segments/slots from DB, sidebar tabs (AI Chat | Chapters |
  About), `?t=` and `?segment=` deep links, `notFound()` on unknown id.
- Search page: real results, `<mark>`, AI Overview (Suspense+Skeleton), citation chips.
- Python `step_embed`: writes `index/<videoId>/segments.json` sidecar on BOTH paths
  (fallback vectors were previously discarded); `build_index_sidecar` + unit test.
- Seeds: 5 videos / 21 segments / 16 breaks / 4 slots (`scripts/seed-demo-data.py`).
- Docs: TASKS.md Phase 4 ticked; ADR-011 (HLS proxy), ADR-012 (sidecar RAG), ADR-013
  (text-stream chat).
- Verified: `drizzle-kit push`, both seed scripts, `python3 tests/test_pipeline.py` (7 ✓),
  `npm run typecheck` clean, `npm run build` clean, live smoke tests of search/playback/
  captions/chat/search-page/watch-page in demo mode (BM25 search 3–7 ms).
- NOT YET: live test with real MISTRAL_API_KEY + B2 creds (sandbox has no keys) — the
  dense leg, Mistral chat/overview, and B2 proxy are coded but only the fallbacks were
  exercised. Next session: add keys to `.env`, re-verify, then Phase 7 submission work
  (README, demo video, Devpost).

### 2026-07-26 — Initial scaffold + spec suite (prior agent + this agent)
- Bootstrapped repo with Next 15, Tailwind, Drizzle, Radix primitives.
- Scaffolded marketing, search, watch, studio, verify pages (all stubs with demo data).
- Built hls.js player with pause-ad overlay; demo cue fires at 8:00 on mux test stream.
- Wrote Python CLI skeleton with 7 stub Steps + JSONL logging.
- Wrote full spec suite `docs/specs/00..12` covering brief, architecture, tech stack, conventions, design, data model, API, pipeline, RAG, ads, provenance, env, phases.
- Wrote MEMORY.md (this), DECISIONS.md, AGENTS.md.
- Did **not** run npm install or pip install (next session task); no real B2 wiring; no real AI calls yet.
- **Next session should:** run `npm install`, `npm run db:push`, add missing shadcn primitives, mount ThemeProvider+Toaster, verify app boots; then start Phase 2 (real Python Steps) or Phase 3 (API routes) depending on which is more valuable for momentum.
