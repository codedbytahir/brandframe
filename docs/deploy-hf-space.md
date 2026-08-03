# Deploying BrandFrame to Hugging Face Spaces (free tier)

One container, everything inside: Next.js app **and** the 13-step Python pipeline
(ffmpeg, Deepgram, Mistral, Gemini, BGE-M3) **and** seeded SQLite.
Stable public URL: `https://<you>-brandframe.hf.space` — use it for the demo
video recording AND as the judge demo link.

## 1. Create the Space

- https://huggingface.co/new-space → name `brandframe`, **SDK: Docker**, visibility **Public**.
- (With an access token this step can also be done via `huggingface_hub.HfApi.create_repo(space_sdk="docker")`.)

## 2. Push this repo to the Space's git remote

```bash
git remote add hf https://huggingface.co/spaces/<you>/brandframe
git push hf main
```

The Space builds `Dockerfile` automatically (first build ≈ 15–25 min — Python venv +
torch are heavy; later builds are cached). `scripts/docker-start.sh` runs
`drizzle-kit push` + both seed scripts on first boot (filesystems on free Spaces are
ephemeral, so the DB re-seeds on every container start — by design for a demo).

## 3. Space secrets (Settings → Variables and secrets)

Add exactly these — same names as `.env.example`, values from your Codespace secrets:

```
B2_KEY_ID  B2_APP_KEY  B2_BUCKET  B2_REGION  B2_ENDPOINT
MISTRAL_API_KEY  GEMINI_API_KEY  DEEPGRAM_API_KEY
```

Then **Factory rebuild** (or just Restart) so the app sees them.

## 4. B2 CORS (only if you want live uploads from the Space URL)

Browser PUT to B2 goes direct from the `hf.space` origin — add it alongside your
Codespace origin in the bucket CORS: `https://<you>-brandframe.hf.space`
(allow PUT + GET, expose ETag). Playback/HLS needs nothing — it's same-origin via
`/api/playback/.../file/...` proxy.

## Notes

- Free CPU Space (2 vCPU / 16 GB) is fine for the web app and demo-sized ingests;
  BGE-M3/CLIP download on first ingest (~3 GB, then cached for that container's life).
- Space sleeps after ~48 h idle; first hit after sleep cold-starts (~1–2 min), then it's live.
- Keep the GitHub repo as source of truth; push the same `main` to both remotes.
