# BrandFrame

AI-native long-form video platform built for the **Backblaze Generative Media Hackathon** (deadline Aug 3, 2026 5PM EDT).

- **Stack:** Next.js 15 (App Router, Server Components, Server Actions), TypeScript strict, Tailwind v3, shadcn/ui-style primitives, Drizzle ORM/libsql, Vercel AI SDK, hls.js, @aws-sdk/client-s3.
- **AI/media pipeline:** [Genblaze](https://github.com/backblaze-labs/genblaze) Python SDK orchestrating ASR, VL captioning, embeddings, in-scene ad-slot detection, FLUX inpainting, and a VL-critic AgentLoop — invoked from Next.js as a child process (**no FastAPI / separate backend**).
- **Storage & search:** Backblaze B2 (raw / HLS / keyframes / brand assets / manifests under Object Lock), LanceDB (vector + FTS index) living on B2 via S3 fsspec — B2 is the single source of truth.
- **Ads:** three layers — intent overlays, natural-break mid-rolls, and the novel in-scene **pause ad** (single AI-generated frame with "AI Ad · Why?" disclosure, creator double-opt-in, cryptographic provenance).
- **Provenance:** every AI alteration is recorded in a SHA-256 Genblaze manifest, embedded into the MP4, WORM-locked on B2 for 365 days (COMPLIANCE), with a public `/verify/[id]` page.

## For coding agents (Cursor / Claude / Windsurf / Aider / etc.)

Start here → **`AGENTS.md`**. It points you to `MEMORY.md` (current state), `TASKS.md` (what to build next), `DECISIONS.md` (ADRs), and the full spec suite under `docs/specs/`.

## Documentation

| File | Purpose |
|---|---|
| `AGENTS.md` | Entry point for AI coding agents (read first) |
| `MEMORY.md` | Living project state — what's built, what's broken, blockers |
| `DECISIONS.md` | Architecture Decision Records |
| `TASKS.md` | Phase-by-phase checklist |
| `docs/specs/00–12` | Spec suite: brief, architecture, tech stack, conventions, design system, data model, API routes, pipeline, RAG, ad engine, provenance, env, phases |
| `/home/user/brandframe-srs.html` | Full IEEE-830 SRS with 30 cited references (outside repo) |

## Quickstart

```bash
# 1. install deps
npm install

# 2. copy env and fill B2 + provider keys (see docs/specs/11-env-secrets.md)
cp .env.example .env.local

# 3. create local sqlite db
npm run db:push

# 4. install python pipeline dependencies (one-time; creates .venv/)
npm run pipelines:install

# 5. run dev (turbopack)
npm run dev
```

Open http://localhost:3000. The app runs in **demo mode** (stub data, public mux test stream) until you set `B2_KEY_ID`, `B2_APP_KEY`, and `B2_BUCKET` in `.env.local`.

### Useful commands

```bash
npm run typecheck        # tsc --noEmit (must be clean)
npm run lint             # next lint
npm run db:studio        # drizzle-kit studio on :4983
npm run pipelines:ingest -- --key uploads/<videoId>/source.mp4
```

## Repository layout

```
src/
  app/                   # Next.js App Router
    (marketing)/         # public pages (home, search results)
    (app)/               # app pages (studio, watch, verify)
    api/                 # Route Handlers (upload, webhook, sse, chat, search, playback)
  components/
    ui/                  # shadcn-style primitives (button, card, badge, …)
    player/              # hls.js player + chat panel
    dashboard/           # upload form + studio widgets
  lib/
    ai/                  # Vercel AI SDK flows (chat, overview)
    b2/                  # S3 client, key-prefix helpers, public URL
    db/                  # Drizzle client + schema
    pipelines/           # Node-side Python runner (child_process.spawn)
    rag/                 # LanceDB hybrid search + rerank
    env.ts  utils.ts  types.ts
  types/global.d.ts
pipelines/               # Genblaze Python pipelines (invoked by Next.js)
  cli.py                 # DAG of Steps (probe → asr → … → manifest)
  config.py              # env helpers + B2 prefixes (keep in sync with src/lib/b2/paths.ts)
  requirements.txt
scripts/                 # setup, seed, smoke tests
docs/specs/              # spec suite (read AGENTS.md for the map)
public/
```
