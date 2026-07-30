"""
BrandFrame Pipeline — Shared utilities for B2, ffmpeg, and logging.
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import boto3
from botocore.config import Config as BotoConfig

# ── Config ──
B2_KEY_ID = os.environ.get("B2_KEY_ID", "")
B2_APP_KEY = os.environ.get("B2_APP_KEY", "")
B2_BUCKET = os.environ.get("B2_BUCKET", "brandframe-demo")
B2_REGION = os.environ.get("B2_REGION", "us-west-004")
B2_ENDPOINT = os.environ.get("B2_ENDPOINT", f"s3.{B2_REGION}.backblazeb2.com")

# ── Logging ──
def log(event: str, **kwargs):
    """Emit a JSON line to stdout — the ONLY stdout output."""
    payload = {"event": event, "timestamp": datetime.now(timezone.utc).isoformat(), **kwargs}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()

# ── B2 S3 Client ──
_s3_client = None

def get_s3():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://{B2_ENDPOINT}",
            region_name=B2_REGION,
            aws_access_key_id=B2_KEY_ID,
            aws_secret_access_key=B2_APP_KEY,
            config=BotoConfig(s3={"addressing_style": "path"}),
        )
    return _s3_client

def download_from_b2(b2_key: str, local_path: str) -> str:
    """Download a file from B2 to a local path. Returns local_path."""
    s3 = get_s3()
    s3.download_file(B2_BUCKET, b2_key, local_path)
    return local_path

def upload_to_b2(local_path: str, b2_key: str, extra_args: dict | None = None) -> str:
    """Upload a local file to B2. Returns the B2 key."""
    s3 = get_s3()
    extra = extra_args or {}
    s3.upload_file(local_path, B2_BUCKET, b2_key, ExtraArgs=extra or None)
    return b2_key

def put_object_to_b2(body: bytes, b2_key: str, content_type: str = "application/json") -> str:
    """Put a bytes object directly to B2."""
    s3 = get_s3()
    s3.put_object(Bucket=B2_BUCKET, Key=b2_key, Body=body, ContentType=content_type)
    return b2_key

def head_object(b2_key: str) -> dict:
    """Get object metadata from B2."""
    s3 = get_s3()
    return s3.head_object(Bucket=B2_BUCKET, Key=b2_key)

def put_object_lock(b2_key: str, mode: str = "COMPLIANCE", days: int = 365):
    """Set Object Lock retention on an object."""
    s3 = get_s3()
    s3.put_object_retention(
        Bucket=B2_BUCKET,
        Key=b2_key,
        Retention={
            "Mode": mode,
            "RetainUntilDate": datetime.now(timezone.utc).isoformat(),
        },
        BypassGovernanceRetention=True,
    )

def sha256_of_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

# ── Temporary workspace ──
WORKSPACE = Path(tempfile.mkdtemp(prefix="brandframe-"))

def workspace_path(*parts: str) -> str:
    p = WORKSPACE.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)

def clean_workspace():
    import shutil
    shutil.rmtree(WORKSPACE, ignore_errors=True)

# ── ffmpeg helpers ──
def run_ffprobe(video_path: str) -> dict:
    """Run ffprobe and return parsed metadata."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    fmt = data.get("format", {})

    video_stream = next((s for s in streams if s["codec_type"] == "video"), {})
    audio_stream = next((s for s in streams if s["codec_type"] == "audio"), {})

    duration_ms = int(float(fmt.get("duration", 0)) * 1000)
    width = int(video_stream.get("width", 0))
    height = int(video_stream.get("height", 0))
    codec = video_stream.get("codec_name", "")
    fps_parts = video_stream.get("r_frame_rate", "30/1").split("/")
    fps = round(int(fps_parts[0]) / int(fps_parts[1])) if len(fps_parts) == 2 else 30

    return {
        "duration_ms": duration_ms,
        "width": width,
        "height": height,
        "codec": codec,
        "fps": fps,
        "audio_codec": audio_stream.get("codec_name", ""),
        "size_bytes": int(fmt.get("size", 0)),
        "bitrate": int(fmt.get("bit_rate", 0)),
    }

def run_ffmpeg_hls(input_path: str, output_dir: str) -> list[str]:
    """Create HLS ladder: 1080p, 720p, 480p, 360p. Returns variant playlist paths."""
    os.makedirs(output_dir, exist_ok=True)
    output_playlist = os.path.join(output_dir, "master.m3u8")

    variants = [
        {"name": "360p", "width": 640, "height": 360, "bitrate": "800k", "maxrate": "856k", "bufsize": "1200k"},
        {"name": "480p", "width": 854, "height": 480, "bitrate": "1400k", "maxrate": "1498k", "bufsize": "2100k"},
        {"name": "720p", "width": 1280, "height": 720, "bitrate": "2800k", "maxrate": "2996k", "bufsize": "4200k"},
        {"name": "1080p", "width": 1920, "height": 1080, "bitrate": "5000k", "maxrate": "5350k", "bufsize": "7500k"},
    ]

    generated_paths = []
    cmd = ["ffmpeg", "-y", "-i", input_path]
    map_flags = []
    for v in variants:
        v_dir = os.path.join(output_dir, v["name"])
        os.makedirs(v_dir, exist_ok=True)
        v_playlist = os.path.join(v_dir, f"{v['name']}.m3u8")
        v_segment = os.path.join(v_dir, f"{v['name']}_%04d.ts")
        generated_paths.append(v_playlist)
        cmd += [
            "-map", "0:v:0", "-map", "0:a:0?",
            "-s:v:0", f"{v['width']}x{v['height']}",
            "-b:v:0", v["bitrate"],
            "-maxrate:v:0", v["maxrate"],
            "-bufsize:v:0", v["bufsize"],
            "-c:v:0", "libx264",
            "-preset", "fast",
            "-g", "60",
            "-sc_threshold", "0",
            "-b:a:0", "128k",
            "-c:a", "aac",
            "-f", "hls",
            "-hls_time", "6",
            "-hls_list_size", "0",
            "-hls_segment_filename", v_segment,
            v_playlist,
        ]

    # Add master playlist
    master_lines = ["#EXTM3U"]
    for v in variants:
        bw = v["bitrate"].replace("k", "000")
        master_lines.append(f"#EXT-X-STREAM-INF:BANDWIDTH={bw},RESOLUTION={v['width']}x{v['height']},CODECS=\"avc1.64001f,mp4a.40.2\"")
        master_lines.append(f"{v['name']}/{v['name']}.m3u8")
    with open(output_playlist, "w") as f:
        f.write("\n".join(master_lines) + "\n")

    subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    return generated_paths + [output_playlist]

def extract_poster(input_path: str, output_path: str, time_sec: float = 5.0):
    """Extract a poster frame at the given time."""
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path,
        "-ss", str(time_sec),
        "-vframes", "1",
        "-q:v", "2",
        output_path,
    ], capture_output=True, timeout=60)

def extract_keyframe(input_path: str, output_path: str, time_sec: float):
    """Extract a single keyframe at the given time."""
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path,
        "-ss", str(time_sec),
        "-vframes", "1",
        "-q:v", "2",
        output_path,
    ], capture_output=True, timeout=60)
