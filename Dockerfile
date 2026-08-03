# BrandFrame — all-in-one image (Hugging Face Spaces / any Docker host)
# Runs the FULL stack in one container: Next.js app + 13-step Python pipeline
# (ffmpeg, Deepgram, Mistral, Gemini, BGE-M3) + SQLite. One stable public URL.

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip ffmpeg git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Node deps ──
COPY package.json package-lock.json ./
RUN npm ci

# ── Python pipeline venv (heavy: torch, mediapipe, opencv, lancedb) ──
COPY pipelines/requirements.txt pipelines/requirements.txt
RUN python3 -m venv .venv \
    && .venv/bin/pip install --no-cache-dir --upgrade pip \
    && .venv/bin/pip install --no-cache-dir -r pipelines/requirements.txt

# ── App source ──
COPY . .

# NLTK tokenizer data at image time (pinned <3.10; kill switch is insurance)
RUN NLTK_DISABLE_IMPORT_SECURITY=1 PYTHONSAFEPATH=1 PYTHONPATH=/app \
    .venv/bin/python -c "import nltk; [nltk.download(p, quiet=True) for p in ('punkt', 'punkt_tab')]"

# ── Production build (keyless: demo-mode fallbacks compile fine) ──
ENV NODE_ENV=production
RUN npm run build

# HF Spaces serves the single exposed port
ENV PORT=7860
EXPOSE 7860

CMD ["bash", "scripts/docker-start.sh"]
