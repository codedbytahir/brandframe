# 02 — Tech Stack

Versions are pinned to what is already in `package.json` / `pipelines/requirements.txt`.
Do not upgrade without a reason recorded in `DECISIONS.md`.

## 1. Frontend / Next.js (Node runtime)

| Library | Version | Why | Off-limits alternatives |
|---|---|---|---|
| `next` | ^15.0.3 | App Router, RSC, Server Actions, turbopack | Next 14, Pages Router, Remix, SvelteKit |
| `react` / `react-dom` | 19.0.0-rc-… | Needed by Next 15; newer `<form>` actions | React 18 stable (incompatible with chosen Next) |
| `typescript` | ^5.6.3 | Strict mode on | JS, CoffeeScript, Flow |
| `tailwindcss` | ^3.4.15 | Design system (v4 not yet stable; stick with v3) | CSS modules only, styled-components, Emotion, Panda |
| `tailwindcss-animate` | ^1.0.7 | shadcn/ui animations | framer-motion (add only if a component genuinely needs it) |
| `class-variance-authority` | ^0.7.1 | shadcn-style variant props |  |
| `clsx` + `tailwind-merge` | ^2.1.1 / ^2.5.4 | `cn()` helper for conditional classes |  |
| `lucide-react` | ^0.460.0 | Icon set (stroke-style) | heroicons, radix-icons (mixing looks inconsistent) |
| `next-themes` | ^0.4.3 | Dark/light class toggling | custom theme provider (already installed) |
| `react-hook-form` + `@hookform/resolvers` | ^7.53 / ^3.9 | Forms (creator onboarding, brand portal) | formik, final-form |
| `zod` | ^3.23.8 | Schema validation (env, forms, API I/O) | yup, joi, io-ts |
| `hls.js` | ^1.5.17 | HLS playback in non-Safari browsers | videojs, plyr (too heavy for v1) |
| `nanoid` | ^5.0.9 | Short IDs for videos/segments/slots | uuid (larger bundle; no need) |

### UI primitives (Radix → shadcn-style)

Install via `npx shadcn@latest add <name>`. Primitives already present in `src/components/ui/`:
`button`, `card`, `input`, `badge`, `progress`, `skeleton`, `scroll-area` (custom minimal).

Remaining to add during Phase 1 (per TASKS):
`dialog`, `tabs`, `tooltip`, `toast` (use @radix-ui/react-toast), `separator`, `label`, `avatar`, `dropdown-menu`.

Do **not** install a component library (MUI, Chakra, Ant, shadcn as a npm package). Copy-paste primitives only.

## 2. Backend / Node

| Library | Version | Why |
|---|---|---|
| `@aws-sdk/client-s3` | ^3.685.0 | B2 is S3-compatible (v3 modular, tree-shaken) |
| `@aws-sdk/s3-request-presigner` | ^3.685.0 | getSignedUrl for PUT/GET |
| `drizzle-orm` | ^0.36.4 | Lightweight ORM; SQL-first; great SQLite/libsql support |
| `drizzle-kit` (dev) | ^0.28.1 | `db:push`, `db:studio`, `db:generate` |
| `@libsql/client` | ^0.14.0 | SQLite client (works with local file and Turso cloud) |
| `ai` (Vercel AI SDK) | ^4.0.36 | `streamText`, tool calls, chat UI hooks for chat-with-video |
| `@ai-sdk/mistral` | ^1.2.8 | Mistral provider for Vercel AI SDK (chat, AI Overview, embeddings) |
| `lancedb` | ^0.16.0 | Embedded vector DB opened via S3-compatible endpoint to B2 |
| `apache-arrow` | (transitive) | Columnar format; listed in `serverExternalPackages` in next.config.ts |

### Explicitly NOT adding (for v1)
- **No FastAPI / Flask / Express** — Python is a child process only.
- **No BullMQ / Inngest / Temporal** — hackathon v1 just spawns; add later if needed (noted in TASKS Phase 3).
- **No Redis, no Postgres** — SQLite/Turso is enough for metadata; vectors live in LanceDB on B2.
- **No tRPC** — Route Handlers + Server Actions + Zod are sufficient.
- **No Prisma** — we committed to Drizzle; prisma/ dir is empty and kept only for reference docs.
- **No NextAuth/Auth.js v1** — hackathon demo uses no real auth; add a stub "Sign in with Google" only if time allows (Phase 7).
- **No Sentry/PostHog** — dev console + SSE logs are enough for the demo.

## 3. Python (pipelines/ only, .venv, Python 3.10+)

| Package | Version range | Why |
|---|---|---|
| `genblaze[core,s3]` | >=0.6.0 | SDK umbrella; Pipeline/Step/Manifest/ObjectStorageSink/AgentLoop |
| `google-genai` | >=1.0 | Gemini 2.5 Flash Image (Nano Banana) inpainting |
| `boto3` | latest | Direct S3 calls where Genblaze S3 sink isn't enough (Object Lock, presign) |
| `requests` | latest | Mistral AI + Deepgram Nova-3 REST calls (no SDK weight) |
| `scenedetect[opencv]` | latest | Scene cut detection for mid-roll score |
| `opencv-python-headless` | latest | Frame extraction, MediaPipe pre-processing |
| `mediapipe` | latest | Face/hand detection to reject unsafe ad slots |
| `lancedb` | latest | Write vector index; same version as Node side |
| `pyarrow` | latest | Parquet/Arrow IPC for LanceDB |
| `s3fs` | latest | FSSpec S3 backend so LanceDB can read/write to B2 |
| `flagembedding` | latest | BGE-M3 dense+sparse embeddings (FlagEmbedding/bge-m3) |
| `transformers` + `torch` | latest | CLIP ViT-B/32 visual embeddings, bge-reranker-v2-m3 reranker |
| `pillow` | latest | Image manip for inpaint compositing |
| `ffmpeg-python` or subprocess | latest | HLS transcode, keyframe extraction (assume ffmpeg binary on PATH) |

> **Note:** installing torch on a local machine in Pakistan can be slow. The
> canonical providers are all hosted free tiers (Mistral, Gemini, Deepgram), and
> the pipeline auto-falls back to `mistral-embed` if local BGE-M3/CLIP can't load
> — torch is optional.

## 4. Python vs Node boundary

The ONLY way Next.js and Python communicate:

- **Next → Python:** `child_process.spawn('.venv/bin/python', ['-m', 'pipelines.cli', 'ingest', '--key', key])`.
  Env is inherited. Working directory is the repo root.
- **Python → Next:** stdout is one JSON object per line (`{"event": "...", "ts": ..., ...}`).
  stderr is logged verbatim with an `[stderr]` prefix. Exit code 0 = success, non-zero = failure.

No HTTP server, no gRPC, no queue, no sockets (except SSE which is Next↔browser, not Next↔Python).
B2 is used for large payload interchange (keyframes, embeddings, HLS segments).

## 5. B2-specific choices

- **Region:** `us-west-004` (default, cheap, close to US west for demo).
- **Endpoint:** `s3.us-west-004.backblazeb2.com` (S3-compatible; always HTTPS).
- **Public URL pattern:** `https://f004.backblazeb2.com/file/<bucket>/<key>` (suffix is last segment of region split by `-`).
- **Bucket settings** (must be set at creation for Object Lock):
  - Object Lock: **Enabled** (Compliance mode for manifests/, Governance optional for others).
  - Event Notifications: `ObjectCreated: uploads/*` → webhook URL.
  - Lifecycle: `tmp/` prefix → delete after 48h.
- **Object Lock retention:** 365 days COMPLIANCE mode on `manifests/*` (cannot be shortened or deleted by anyone, including root account key — this is a demo of "provable AI alteration").

## 6. Version-control / tooling

- **Package manager:** npm (no yarn, no pnpm) — lockfile `package-lock.json`.
- **Linting:** eslint via `next lint` (extends `next/core-web-vitals` and `@typescript-eslint`).
- **Formatting:** Prettier is NOT added; rely on eslint + 2-space indent + semicolons (TS defaults).
- **Git:** main branch; no PR process needed for hackathon, but commit in coherent steps with messages like `feat(player): pause-ad overlay detects cue and renders disclosure`.

## 7. Browsers & a11y targets

- Target evergreen Chrome/Edge/Safari/Firefox on desktop (mobile responsive is nice-to-have, not required for demo).
- WCAG AA contrast minimum (Tailwind colors already chosen to satisfy this on dark default).
- Keyboard-navigable player (space=play/pause, arrows=seek/volume, f=fullscreen).
- All images need `alt`; all `Icon` components get `aria-hidden="true"` if decorative.
