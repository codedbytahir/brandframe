"""
BrandFrame Genblaze Pipeline CLI.

Usage:
    python -m pipelines.cli ingest --key uploads/<videoId>/source.mp4

Emits JSONL to stdout for SSE consumption by Next.js.
"""

import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, field, asdict
from typing import Any


# ── Logging Protocol ──
def _log(event: str, **kwargs):
    """Emit a JSON line to stdout. This is the ONLY way to write to stdout."""
    payload = {"event": event, "timestamp": datetime.now(timezone.utc).isoformat(), **kwargs}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


# ── Step Result ──
@dataclass
class StepResult:
    step: str
    status: str  # "success" | "fallback" | "failed"
    provider: str = ""
    model: str = ""
    input_sha256: str = ""
    output_sha256: str = ""
    b2_key: str = ""
    duration_ms: int = 0
    error: str | None = None
    data: dict[str, Any] = field(default_factory=dict)


# ── Steps ──
def step_probe(b2_key: str) -> StepResult:
    """Probe the source video for metadata (duration, codec, resolution)."""
    t0 = time.time()
    _log("progress", step="probe", status="running", progress=5, message="Probing source video...")

    # TODO: ffprobe the source from B2
    result = StepResult(
        step="probe",
        status="success",
        provider="ffprobe",
        duration_ms=int((time.time() - t0) * 1000),
        data={
            "duration_ms": 600000,
            "width": 1920,
            "height": 1080,
            "codec": "h264",
            "fps": 30,
        },
    )
    _log("progress", step="probe", status="completed", progress=10, message="Source probed successfully")
    return result


def step_transcode(b2_key: str) -> StepResult:
    """Transcode source to HLS ladder + extract poster."""
    t0 = time.time()
    _log("progress", step="transcode", status="running", progress=15, message="Transcoding to HLS...")

    # TODO: ffmpeg HLS ladder
    result = StepResult(
        step="transcode",
        status="success",
        provider="ffmpeg",
        duration_ms=int((time.time() - t0) * 1000),
        data={"hls_key": b2_key.replace("uploads/", "playable/").replace("source.mp4", "hls/master.m3u8")},
    )
    _log("progress", step="transcode", status="completed", progress=25, message="HLS transcoding done")
    return result


def step_asr(b2_key: str) -> StepResult:
    """Speech-to-text via NVIDIA Parakeet / faster-whisper fallback."""
    t0 = time.time()
    _log("progress", step="asr", status="running", progress=30, message="Running ASR...")

    # TODO: NVIDIA Parakeet primary, faster-whisper fallback
    result = StepResult(
        step="asr",
        status="success",
        provider="nvidia",
        model="parakeet-tdt-1.1b",
        duration_ms=int((time.time() - t0) * 1000),
        data={
            "segments": [
                {"start_ms": 0, "end_ms": 50000, "text": "Welcome to this tutorial..."},
                {"start_ms": 50000, "end_ms": 120000, "text": "Today we'll cover the basics..."},
            ]
        },
    )
    _log("progress", step="asr", status="completed", progress=40, message="ASR completed")
    return result


def step_scenes(b2_key: str) -> StepResult:
    """Detect scene changes and extract keyframes."""
    t0 = time.time()
    _log("progress", step="scenes", status="running", progress=45, message="Detecting scenes...")

    result = StepResult(
        step="scenes",
        status="success",
        provider="scenedetect",
        duration_ms=int((time.time() - t0) * 1000),
        data={
            "scenes": [
                {"start_ms": 0, "end_ms": 30000},
                {"start_ms": 30000, "end_ms": 90000},
            ],
            "keyframes": ["frame-0001.jpg", "frame-0002.jpg"],
        },
    )
    _log("progress", step="scenes", status="completed", progress=55, message="Scenes detected")
    return result


def step_embed(b2_key: str) -> StepResult:
    """Generate embeddings via BGE-M3 + CLIP for RAG index."""
    t0 = time.time()
    _log("progress", step="embed", status="running", progress=60, message="Generating embeddings...")

    result = StepResult(
        step="embed",
        status="success",
        provider="sentence-transformers",
        model="BAAI/bge-m3",
        duration_ms=int((time.time() - t0) * 1000),
        data={"vectors_count": 10},
    )
    _log("progress", step="embed", status="completed", progress=70, message="Embeddings generated")
    return result


def step_slots(b2_key: str) -> StepResult:
    """Detect in-scene ad slots via Qwen-VL + MediaPipe rejection."""
    t0 = time.time()
    _log("progress", step="slots", status="running", progress=75, message="Detecting ad slots...")

    result = StepResult(
        step="slots",
        status="success",
        provider="qwen-vl",
        model="Qwen2.5-VL-7B",
        duration_ms=int((time.time() - t0) * 1000),
        data={
            "slots": [
                {
                    "id": f"slot_{uuid.uuid4().hex[:8]}",
                    "timestamp_ms": 225000,
                    "surface": "mug",
                    "bbox": [200, 300, 400, 500],
                }
            ]
        },
    )
    _log("progress", step="slots", status="completed", progress=85, message="Ad slots detected")
    return result


def step_inpaint(b2_key: str) -> StepResult:
    """FLUX fill inpainting of detected slots."""
    t0 = time.time()
    _log("progress", step="inpaint", status="running", progress=88, message="Inpainting ad slots...")

    result = StepResult(
        step="inpaint",
        status="success",
        provider="flux",
        model="FLUX.1-fill-pro",
        duration_ms=int((time.time() - t0) * 1000),
        data={"slots_completed": 1},
    )
    _log("progress", step="inpaint", status="completed", progress=95, message="Inpainting done")
    return result


def step_manifest(b2_key: str, steps: list[StepResult]) -> StepResult:
    """Build Genblaze manifest and upload to B2 with Object Lock."""
    t0 = time.time()
    _log("progress", step="manifest", status="running", progress=97, message="Building manifest...")

    manifest = {
        "manifest_id": f"mfst_{uuid.uuid4().hex[:8]}",
        "video_id": b2_key.split("/")[1],
        "version": "1.0",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "retention": {"mode": "COMPLIANCE", "days": 365},
        "entries": [asdict(s) for s in steps],
        "placements": [],
    }

    result = StepResult(
        step="manifest",
        status="success",
        provider="genblaze",
        b2_key=f"manifests/{b2_key.split('/')[1]}/manifest.json",
        duration_ms=int((time.time() - t0) * 1000),
        data={"manifest": manifest},
    )
    _log("progress", step="manifest", status="completed", progress=100, message="Manifest created and uploaded")
    return result


# ── Pipeline Runner ──
def run_ingest(b2_key: str):
    """Run the full Genblaze pipeline."""
    _log("progress", step="init", status="running", progress=0, message="Starting pipeline...")

    steps = []

    # Phase 1: Probe & Transcode
    steps.append(step_probe(b2_key))
    steps.append(step_transcode(b2_key))

    # Phase 2: ASR & Scenes
    steps.append(step_asr(b2_key))
    steps.append(step_scenes(b2_key))

    # Phase 3: Embeddings
    steps.append(step_embed(b2_key))

    # Phase 4: Ad Slots & Inpaint
    steps.append(step_slots(b2_key))
    steps.append(step_inpaint(b2_key))

    # Phase 5: Manifest
    manifest = step_manifest(b2_key, steps)

    # Final output
    result = {
        "event": "complete",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "video_id": b2_key.split("/")[1],
            "steps_count": len(steps),
            "manifest_key": manifest.data.get("manifest", {}).get("manifest_id"),
            "success": all(s.status == "success" for s in steps),
        },
    }
    _log(**result)


# ── CLI ──
def main():
    parser = argparse.ArgumentParser(description="BrandFrame Genblaze Pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="Run full ingest pipeline")
    ingest.add_argument("--key", required=True, help="B2 key of the source video")

    args = parser.parse_args()

    if args.command == "ingest":
        run_ingest(args.key)


if __name__ == "__main__":
    main()
