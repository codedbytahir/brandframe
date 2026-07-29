# 11 — Environment Variables & Secrets

All env vars are declared in `.env.example` and validated at boot.

- **Next.js / Node:** validated by `zod` in `src/lib/env.ts`.
- **Python pipelines:** read through helpers in `pipelines/config.py`.

**Never commit `.env.local`**. `.env.example` is committed with empty values.

## 1. Variable reference

### Backblaze B2 (required for real uploads)

| Name | Required | Default | Purpose |
|---|---|---|---|
| `B2_KEY_ID` | yes | — | B2 application key ID (create at backblaze.com → App Keys. Limit to the single bucket if possible.) |
| `B2_APP_KEY` | yes | — | B2 application key secret. |
| `B2_BUCKET` | yes | — | Bucket name, e.g. `brandframe-demo`. Bucket **must** be created with Object Lock enabled. |
| `B2_REGION` | no | `us-west-004` | Region portion of the endpoint. |
| `B2_ENDPOINT` | no | `s3.us-west-004.backblazeb2.com` | S3-compatible endpoint hostname (no `https://` prefix — added by code). |

Public URL pattern derived from these: `https://f004.backblazeb2.com/file/<bucket>/<key>` (the `004` is the last segment of `B2_REGION` split on `-`).

### AI providers (all optional — see fallback chains in §07)

| Name | Used by | What for |
|---|---|---|
| `OPENAI_API_KEY` | Next.js chat/overview; Python Whisper/GPT-4o-mini fallback | LLM, Whisper ASR fallback, text-embeddings fallback |
| `GEMINI_API_KEY` | Next.js LLM fallback; Python VL fallback | Gemini 2.0 Flash, Gemini-VL |
| `NVIDIA_API_KEY` | Python (primary ASR + VL rerank + embeddings) | NVIDIA NIM: Parakeet ASR, Llama, NV-Embed |
| `GMI_API_KEY` | Python (primary VL + inpaint) | GMI / Black Forest Labs: Qwen2.5-VL, FLUX.1-fill-pro |
| `REPLICATE_API_TOKEN` | Python (fallback inpaint) | Replicate FLUX/SD3 inpaint models |
| `ELEVENLABS_API_KEY` | Python (optional post-v1) | Voice dubs |

For the demo you **must** have at least:
- `B2_*` set (the whole point is proving B2 + Genblaze).
- `GMI_API_KEY` or `REPLICATE_API_TOKEN` (for the inpaint/slot hero demo).
- `OPENAI_API_KEY` (easiest path for chat/overview embeddings fallback).

NVIDIA and Gemini are nice-to-haves that make the pipeline faster/cheaper but aren't strictly required if OpenAI + GMI are present.

### App config

| Name | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | no (auto-detect in Vercel) | `http://localhost:3000` | Absolute URL for webhook callbacks, share links, OG images. Must be set in production (Vercel sets `VERCEL_URL` automatically — use that if `NEXT_PUBLIC_APP_URL` is not set). |
| `DATABASE_URL` | no | `file:./brandframe.db` | libsql connection string. Local file for dev; `libsql://<db>.turso.io` for Turso production. |
| `PIPELINE_VENV` | no | `.venv` | Path (relative to repo root) of the Python virtualenv that Next spawns. |

### Optional / v2

| Name | Purpose |
|---|---|
| `B2_WEBHOOK_SECRET` | Shared secret that B2 signs Event Notifications with (validate HMAC in `/api/webhook/b2`). Skip for demo. |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | If we add Auth.js in Phase 7. |
| `SENTRY_DSN`, `POSTHOG_KEY` | Observability — skip for demo. |

## 2. How to obtain each key

- **B2:** sign up at https://www.backblaze.com/sign-up (10 GB free, no credit card for free tier).
  1. Create a bucket named e.g. `brandframe-<your-handle>` with Object Lock **Enabled**.
  2. Under App Keys → Add a New Application Key:
     - Name: `brandframe-dev`
     - Bucket: the bucket you just created
     - Type: Read and Write
     - Capabilities at minimum: `readFiles`, `writeFiles`, `deleteFiles`, `listBuckets`, `listFiles`, `writeBucketRetentions`, `writeFileRetentions`, `readBucketRetentions`, `readFileRetentions`
     - Save `keyID` and `applicationKey` — only shown once.
- **OpenAI:** https://platform.openai.com/api-keys (GPT-4o-mini is cheap; embed a few $ for demo).
- **GMI (Black Forest Labs FLUX + Qwen):** https://gmicloud.ai/ — apply for hackathon credits (Backblaze/GMI are partnered; first 270 submitters get credits per the hackathon rules).
- **NVIDIA NIM:** https://build.nvidia.com/ — free credits for hackathon participants.
- **Google Gemini:** https://aistudio.google.com/apikey (free tier generous).
- **Replicate:** https://replicate.com/api-token (pay-per-use; cheap for a few FLUX calls).
- **ElevenLabs:** https://elevenlabs.io/ (skip for v1).

## 3. Demo / offline mode

When `B2_KEY_ID` is empty, `src/lib/env.ts` exports `isDemo = true`. In demo mode:
- Upload widget shows "Demo mode" badge; uploads go to a local folder (skip), and a seeded demo video is used.
- Search/chat/player use hard-coded demo data (see `lib/rag/search.ts` stub) and the public mux test stream.
- No Python pipeline is spawned. Studio shows a banner: "Running in demo mode — set B2 keys in `.env.local` to enable real uploads."

This lets the UI be developed and the demo video be recorded even before B2 keys are available.

## 4. .env.example

Keep `.env.example` in sync with this spec. It currently lists:
```
B2_KEY_ID=
B2_APP_KEY=
B2_BUCKET=
B2_REGION=us-west-004
B2_ENDPOINT=s3.us-west-004.backblazeb2.com
OPENAI_API_KEY=
GEMINI_API_KEY=
NVIDIA_API_KEY=
GMI_API_KEY=
REPLICATE_API_TOKEN=
ELEVENLABS_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=file:./brandframe.db
PIPELINE_VENV=.venv
```

If you add a new env var, (1) add it to `.env.example`, (2) add it to `src/lib/env.ts`
zod schema, (3) if used in Python, add it to `pipelines/config.py`, (4) update this file.

## 5. Security rules

- Never log keys (even partially masked) to console or SSE.
- Never echo env in API responses.
- On Vercel, set keys via Project → Settings → Environment Variables (not in `.env.local` on the server).
- The B2 application key should be scoped to the single BrandFrame bucket with the smallest possible capability set.
- Webhook secret (v2) must be high-entropy (≥32 bytes).

## 6. Python environment

The Python virtualenv is created by `scripts/setup-pipelines.sh` (which is also
runnable via `npm run pipelines:install`). It installs `pipelines/requirements.txt`
into `.venv/`. The `.venv/` directory is in `.gitignore` and is **not**
committed. On first run on a new machine, run the install once; it takes a few
minutes (torch/transformers are heavy).

For dev machines with limited bandwidth/disk (common in Pakistan): set
`BRANDFRAME_LIGHTWEIGHT_PIPELINE=1` (stretch) to skip torch/transformers and use
hosted providers for all vision/embedding work. Implement this flag in the
pipeline only if needed.
