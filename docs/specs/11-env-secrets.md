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

### AI providers (canonical stack — all free tier, no credit card)

| Name | Used by | What for |
|---|---|---|
| `MISTRAL_API_KEY` | Next.js (chat, AI Overview, query/segment embeddings); Python (vl-caption Pixtral, slot detection, embed fallback, critic) | `mistral-large-latest`, `pixtral-large-latest`, `mistral-embed` |
| `GEMINI_API_KEY` | Python inpaint step | Gemini 2.5 Flash Image ("Nano Banana") via `google-genai` |
| `DEEPGRAM_API_KEY` | Python asr step | Nova-3 speech-to-text ($200 free credit ≈ 430h) |

**OpenAI, NVIDIA, Replicate, Groq, ElevenLabs were removed from the stack** —
the pipeline and Node app call only Mistral, Gemini, and Deepgram.

For the demo you **must** have at least:
- `B2_*` set (the whole point is proving B2 + Genblaze).
- `MISTRAL_API_KEY` (search/chat overview + vision + embeddings all use it).
- `GEMINI_API_KEY` (for the inpaint hero demo — without it, Pillow compositing still fills slots).
- `DEEPGRAM_API_KEY` (ASR for real uploads).

All three AI keys are free with no credit card (see §2).

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
- **Mistral AI:** https://console.mistral.ai → API keys (free tier, no credit card).
- **Google Gemini:** https://aistudio.google.com/apikey (free tier ≈ 500 image gens/day, no credit card).
- **Deepgram:** https://deepgram.com — $200 free credits, no credit card.

## 3. Demo / offline mode

When `B2_KEY_ID` is empty, `src/lib/env.ts` exports `isDemo = true`. In demo mode:
- The seeded 5-video corpus drives real BM25 search, chat (segment-grounded), playback (public test stream), captions, and the verify page (simulated manifest, clearly labeled).
- The ad engine works end-to-end (intent overlays, mid-rolls, pause ads from seeded slots).
- No Python pipeline is spawned; upload falls back to a simulated progression.

Without MISTRAL_API_KEY, dense search degrades to BM25-only and chat/overview use deterministic segment-grounded fallbacks — same citation UX, no LLM.

## 4. .env.example

Keep `.env.example` in sync with this spec. It currently lists:
```
B2_KEY_ID=
B2_APP_KEY=
B2_BUCKET=brandframe-demo
B2_REGION=us-west-004
B2_ENDPOINT=s3.us-west-004.backblazeb2.com
MISTRAL_API_KEY=
GEMINI_API_KEY=
DEEPGRAM_API_KEY=
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
