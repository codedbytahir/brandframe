# AGENTS.md — Instructions for AI coding agents

This file is auto-detected by Cursor, Claude Code, Windsurf, Aider, and most
AI-coding tools. If you're an agent starting work on BrandFrame, **this is your
entry point** — read it first, follow its links, and you'll be productive
in seconds.

## 1. 60-second orientation

- **Project:** BrandFrame — AI-native video platform (semantic search, chat-with-video, provenance-tracked in-scene pause ads). Built for the **Backblaze Generative Media Hackathon** (deadline Aug 3, 2026 5PM EDT = Aug 4, 2026 2AM PKT).
- **Stack:** Next.js 15 (App Router, RSC by default, Server Actions) · TypeScript strict · Tailwind v3 · shadcn/ui-style primitives · Drizzle ORM (libsql/SQLite) · Vercel AI SDK · hls.js · @aws-sdk/client-s3 (for B2) · **Genblaze Python SDK** in a child process · LanceDB on B2.
- **Hard rule:** **No FastAPI, no Express, no separate backend server.** Python runs as a child process from Next.
- **One-sentence pitch:** Upload a video → Genblaze ingests it (ASR, scene cuts, embeddings, in-scene ad slots, FLUX inpaint, VL critic, manifest) → viewers can search, chat, jump to timestamps, and see AI in-scene ads that are always disclosed, creator-approved, and cryptographically provenance-locked on B2.

## 2. Read these files (in order) before touching code

1.  `MEMORY.md` — living state: what's built, what's broken, blockers, active session log.
2.  `TASKS.md` — phase-by-phase checklist; pick the first unchecked item in the current phase.
3.  `DECISIONS.md` — ADRs; don't re-litigate settled decisions.
4.  The spec that's relevant to the task:
    - UI/design → `docs/specs/04-design-system.md`, `docs/specs/03-conventions.md`
    - API/server → `docs/specs/06-api-routes.md`
    - Data/DB → `docs/specs/05-data-model.md`
    - Python pipeline → `docs/specs/07-pipeline.md`
    - Search/RAG → `docs/specs/08-rag-search.md`
    - Ads → `docs/specs/09-ad-engine.md`
    - Provenance → `docs/specs/10-provenance.md`
    - Full index → `docs/README.md`.

The full SRS with citations lives at `/home/user/brandframe-srs.html` (outside the repo);
reference it if you need citations, the demo script, or the judging matrix.

## 3. Non-negotiables (breaking these is a bug)

1.  **Server Components by default.** Only add `"use client"` when you need
    state/effects/browser APIs. Put client logic in the *leaf* component, not
    in the page.
2.  **All env reads through `src/lib/env.ts`** (zod) on Node; `pipelines/config.py` in Python.
3.  **B2 paths via helpers in `src/lib/b2/paths.ts`** — never build key strings inline.
4.  **TS strict on.** `any` requires a `// eslint-disable-next-line` and a comment.
5.  **Tailwind only for styles.** Don't add a CSS framework, styled-components, or CSS modules beyond globals.css.
6.  **Python only speaks JSONL on stdout** (`_log(...)` in `pipelines/cli.py`).
    Anything else goes to stderr.
7.  **Every AI ad placement must have** (a) "AI Ad · Why?" disclosure, (b) a Genblaze
    manifest entry, (c) B2 Object Lock retention, (d) creator approval row. No exceptions.
8.  **Inanimate-object slots only** (mug, laptop_lid, can, bottle, blank_sign,
    cereal_box, book_cover, screen). MediaPipe face/hand rejection.
9.  **Ad caps:** Layer 1 max 1 per query; Layer 2 max 1 per 3 min (no first-60s);
    Layer 3 max 1 per 3–5 min.
10. **Do not copy the Backblaze sample repos verbatim** — they are reference only.
11. **End every session by updating `MEMORY.md`** (section 8 — append a new entry)
    so the next agent doesn't have to diff your code.
12. **Before finishing a task:** run `npm run typecheck` and `npm run lint`; both must be clean.

## 4. Key files (shortcuts)

| Purpose | Path |
|---|---|
| B2 S3 client + public URL helper | `src/lib/b2/client.ts` |
| B2 key prefix helpers | `src/lib/b2/paths.ts` |
| Drizzle schema (source of truth) | `src/lib/db/schema.ts` |
| Types (Video, Segment, AdSlot, Brand…) | `src/lib/types.ts` |
| cn/formatTimestamp/shortId utils | `src/lib/utils.ts` |
| Env validation | `src/lib/env.ts` |
| Python runner (spawns .venv/bin/python) | `src/lib/pipelines/run.ts` |
| RAG search (stub in progress) | `src/lib/rag/search.ts` |
| Player (hls.js + pause-ad overlay) | `src/components/player/player.tsx` |
| Python CLI with all Steps (stubs) | `pipelines/cli.py` |
| Python config + B2 prefixes | `pipelines/config.py` |
| Pipelines venv setup script | `scripts/setup-pipelines.sh` |

## 5. ID and timestamp conventions

- IDs: `shortId("vid")` → `vid_<8-char>` in `lib/utils.ts`.
  Prefixes: `vid_` videos, `seg_` segments, `slot_` ad slots, `brd_` brands,
  `brk_` natural breaks, `usr_` users, `run_<unix>` pipeline runs.
- Times: integer **milliseconds** everywhere (DB, player cues, URLs like `?t=348000`).
- Datetimes: ISO-8601 strings in SQLite (text columns).
- Bbox: JSON `[x1,y1,x2,y2]` in normalized **0..1000** coordinates (resolution-independent).

## 6. Commands

```bash
npm install                      # install deps
npm run db:push                  # create / migrate brandframe.db
npm run pipelines:install        # create .venv and pip install
npm run dev                      # next dev (turbopack) on http://localhost:3000
npm run typecheck                # must be clean
npm run lint                     # must be clean
npm run db:studio                # drizzle-kit studio on :4983
npm run pipelines:ingest -- --key uploads/<vid>/source.mp4
```

## 7. Adding new things

- **New UI primitive?** Put it in `src/components/ui/`, follow the existing
  CVA/forwardRef pattern, or `npx shadcn@latest add <name>` then trim.
- **New page?** Put it under the right route group: `(marketing)` for public
  pre-auth pages, `(app)` for authenticated app pages. Use RSC (`async function
  Page()`) by default.
- **New API route?** `src/app/api/<segment>/route.ts` with zod-validated
  bodies; follow error shape `{ error: string, code?: string }`. See
  `docs/specs/06-api-routes.md`.
- **New DB column/table?** Add to `src/lib/db/schema.ts`, mirror the type in
  `src/lib/types.ts` if it crosses a boundary, run `npm run db:push`, update
  MEMORY.md.
- **New Python Step?** Add a `step_<name>(key, ctx)` function in `pipelines/cli.py`,
  follow the StepResult pattern with primary+fallback+retries, add it to the
  `ingest()` driver DAG, update `docs/specs/07-pipeline.md`.
- **New env var?** Add to `.env.example`, `src/lib/env.ts` schema, and
  `pipelines/config.py` if used in Python; add a row in
  `docs/specs/11-env-secrets.md`.

## 8. What to do first if you just started

1. Read `MEMORY.md` section 2 carefully ("What is NOT done yet").
2. Check `TASKS.md` for the first unchecked item in the earliest phase that's still open.
3. Read the relevant spec.
4. If npm/pip installs haven't been run yet, run them first (Phase 1 DoD).
5. Build one thing at a time, keep the app bootable after each change, and
   update TASKS.md + MEMORY.md when it lands.

## 9. Demo mode

If B2 keys are missing, `env.isDemo` is true. Pages render with demo/stub data
and a banner. Don't break demo mode when wiring real flows — the demo path must
keep working as a fallback.

## 10. Common gotchas

- **lancedb and apache-arrow** are in `serverExternalPackages` in `next.config.ts`
  — don't remove that or Next will try to bundle them for Edge runtime and crash.
- **Object Lock must be enabled at bucket creation time.** If a user forgot,
  tell them to recreate the bucket.
- **S3 endpoint for B2 needs `forcePathStyle: true`** (already set in `lib/b2/client.ts`).
- **HLS.js is browser-only** — the player must be `"use client"` and hls.js must
  not be imported in a Server Component.
- **Python venv path** is `.venv` by default but configurable via `PIPELINE_VENV`.
- **Torch / transformers are heavy.** Prefer hosted providers (NVIDIA NIM, GMI,
  OpenAI) where possible so local install stays light (important on slow networks in Pakistan).

## 11. Submission deadline

**Aug 3, 2026 5:00 PM EDT** = **Aug 4, 2026 2:00 AM PKT**.
Budget time for: recording the 3-min demo, writing the Devpost description,
filing 3–5 Genblaze GitHub issues, and deploying. Don't spend the last 12 hours
on features at the expense of submission polish.
