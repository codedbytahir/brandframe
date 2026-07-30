"""Pipeline configuration — read env vars the same way as Next.js."""

import os
from pathlib import Path

# ── B2 ──
B2_KEY_ID = os.environ.get("B2_KEY_ID", "")
B2_APP_KEY = os.environ.get("B2_APP_KEY", "")
B2_BUCKET = os.environ.get("B2_BUCKET", "")
B2_REGION = os.environ.get("B2_REGION", "us-west-004")
B2_ENDPOINT = os.environ.get("B2_ENDPOINT", f"s3.{B2_REGION}.backblazeb2.com")

# ── AI Providers ──
MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")

# ── Paths (keep in sync with src/lib/b2/paths.ts) ──
def upload_key(video_id: str) -> str:
    return f"uploads/{video_id}/source.mp4"

def hls_key(video_id: str) -> str:
    return f"playable/{video_id}/hls/"

def poster_key(video_id: str) -> str:
    return f"playable/{video_id}/poster.jpg"

def keyframe_key(video_id: str, index: int) -> str:
    return f"assets/{video_id}/keyframes/frame-{index:04d}.jpg"

def manifest_key(video_id: str) -> str:
    return f"manifests/{video_id}/manifest.json"

def tmp_key(video_id: str, name: str) -> str:
    return f"tmp/{video_id}/{name}"

# ── Misc ──
IS_DEMO = not B2_KEY_ID or B2_KEY_ID == "demo"
