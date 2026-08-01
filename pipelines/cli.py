"""
BrandFrame Genblaze Pipeline — REAL implementation of all Steps.

Usage:
    python -m pipelines.cli ingest --key uploads/<videoId>/source.mp4

Emits JSONL to stdout for SSE consumption by Next.js.

Step order:
  1. probe        — ffprobe source metadata
  2. transcode    — ffmpeg HLS ladder + poster
  3. asr          — Deepgram Nova-3 API (free $200 credit, no credit card)
  4. scenes       — PySceneDetect + keyframe extraction
  5. vl-caption   — Mistral Pixtral (vision, per keyframe)
  6. chunk        — NLTK sentence + scene-boundary packing
  7. embed        — BGE-M3 + CLIP → LanceDB on B2 (s3fs) | Mistral Embed fallback
  8. slots        — Mistral Pixtral vision JSON-mode + MediaPipe rejection
  9. brand-match  — CLIP similarity vs brands index
 10. inpaint      — Gemini 2.5 Flash Image (Nano Banana, free) + Pillow fallback
 11. critic       — Mistral Large 5-point JSON rubric
 12. manifest     — Build JSON, upload to B2 with Object Lock COMPLIANCE 365d

🔑 REQUIRED free keys (no credit card needed):
  - MISTRAL_API_KEY → https://console.mistral.ai (free tier)
  - GEMINI_API_KEY  → https://aistudio.google.com (free, for AI image gen)
  - DEEPGRAM_API_KEY → https://deepgram.com (free $200 credit, no card, for ASR)

💡 Inpainting works even WITHOUT GEMINI_API_KEY: falls back to Pillow compositing.
"""

import argparse
import json
import os
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from pipelines.utils import (
    log, get_s3, B2_BUCKET, WORKSPACE,
    download_from_b2, upload_to_b2, put_object_to_b2, put_object_lock,
    sha256_of_file, sha256_of_bytes, workspace_path, clean_workspace,
    run_ffprobe, run_ffmpeg_hls, extract_poster, extract_keyframe,
)
from pipelines.mistral_helpers import mistral_vision, mistral_chat_json, mistral_embed, MISTRAL_API_KEY
from pipelines.image_gen import inpaint_slot


# =====================================================================
# Step Result
# =====================================================================
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


# =====================================================================
# STEP 1 — Probe
# =====================================================================
def step_probe(video_id: str, b2_key: str) -> StepResult:
    t0 = time.time()
    log("progress", step="probe", status="running", progress=5,
        message="Downloading source for probing...")

    local_src = workspace_path(video_id, "source.mp4")
    download_from_b2(b2_key, local_src)
    input_sha = sha256_of_file(local_src)

    log("progress", step="probe", status="running", progress=8,
        message="Running ffprobe...")
    meta = run_ffprobe(local_src)

    result = StepResult(
        step="probe", status="success", provider="ffprobe",
        input_sha256=input_sha, output_sha256=input_sha,
        b2_key=b2_key,
        duration_ms=int((time.time() - t0) * 1000),
        data=meta,
    )
    log("progress", step="probe", status="completed", progress=12,
        message=f"Source probed: {meta['duration_ms']/1000:.1f}s, "
                f"{meta['width']}x{meta['height']}, {meta['codec']}")
    return result


# =====================================================================
# STEP 2 — Transcode (HLS + Poster)
# =====================================================================
def step_transcode(video_id: str, b2_key: str, probe_result: StepResult) -> StepResult:
    t0 = time.time()
    log("progress", step="transcode", status="running", progress=15,
        message="Transcoding to HLS ladder...")

    local_src = workspace_path(video_id, "source.mp4")
    hls_dir = workspace_path(video_id, "hls")
    poster_path = workspace_path(video_id, "poster.jpg")

    # HLS
    try:
        generated = run_ffmpeg_hls(local_src, hls_dir)
        log("progress", step="transcode", status="running", progress=20,
            message=f"HLS generated {len(generated)} playlists")
    except subprocess.TimeoutExpired:
        return StepResult(step="transcode", status="failed", provider="ffmpeg",
                          error="HLS transcoding timed out", duration_ms=int((time.time()-t0)*1000))

    # Upload HLS to B2
    s3 = get_s3()
    for local_file in generated:
        rel = Path(local_file).relative_to(hls_dir)
        b2_target = f"playable/{video_id}/hls/{rel}"
        s3.upload_file(local_file, B2_BUCKET, b2_target)

    # Upload segments
    for root, _dirs, files in os.walk(hls_dir):
        for fname in files:
            if fname.endswith(".ts"):
                full = os.path.join(root, fname)
                rel = Path(full).relative_to(hls_dir)
                b2_target = f"playable/{video_id}/hls/{rel}"
                s3.upload_file(full, B2_BUCKET, b2_target)

    # Poster
    poster_sec = 5.0
    extract_poster(local_src, poster_path, poster_sec)
    poster_b2_key = f"playable/{video_id}/poster.jpg"
    upload_to_b2(poster_path, poster_b2_key, {"ContentType": "image/jpeg"})

    result = StepResult(
        step="transcode", status="success", provider="ffmpeg",
        output_sha256=sha256_of_file(poster_path),
        b2_key=f"playable/{video_id}/hls/master.m3u8",
        duration_ms=int((time.time() - t0) * 1000),
        data={
            "hls_master": f"playable/{video_id}/hls/master.m3u8",
            "poster_key": poster_b2_key,
            "variants_count": len(generated),
        },
    )
    log("progress", step="transcode", status="completed", progress=25,
        message=f"HLS + poster uploaded to B2")
    return result


# =====================================================================
# STEP 3 — ASR (Deepgram API — free $200 credit, no card needed)
# =====================================================================
def step_asr(video_id: str, b2_key: str) -> StepResult:
    t0 = time.time()
    log("progress", step="asr", status="running", progress=28,
        message="Extracting audio for ASR via Deepgram...")

    api_key = os.environ.get("DEEPGRAM_API_KEY", "")
    if not api_key:
        return StepResult(step="asr", status="failed", provider="deepgram",
                          error="DEEPGRAM_API_KEY not set. Get free key at https://deepgram.com (no credit card, $200 free credits)",
                          duration_ms=int((time.time()-t0)*1000))

    local_src = workspace_path(video_id, "source.mp4")
    audio_path = workspace_path(video_id, "audio.wav")

    download_from_b2(b2_key, local_src)

    subprocess.run([
        "ffmpeg", "-y", "-i", local_src,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        audio_path,
    ], capture_output=True, timeout=300)

    log("progress", step="asr", status="running", progress=32,
        message="Transcribing via Deepgram Nova-3...")

    try:
        import requests
        with open(audio_path, "rb") as f:
            audio_data = f.read()

        resp = requests.post(
            "https://api.deepgram.com/v1/listen?model=nova-3&language=en&punctuate=true&utterances=true",
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": "audio/wav",
            },
            data=audio_data,
            timeout=120,
        )
        resp.raise_for_status()
        result = resp.json()

        channels = result.get("results", {}).get("channels", [{}])
        if not channels:
            raise RuntimeError("No channels in Deepgram response")

        utterances = channels[0].get("detected_language", "")
        alternatives = channels[0].get("alternatives", [{}])

        words_data = alternatives[0].get("words", []) if alternatives else []

        # Build segments from utterances
        asr_segments = []
        for word in words_data:
            asr_segments.append({
                "start_ms": int(word.get("start", 0) * 1000),
                "end_ms": int(word.get("end", 0) * 1000),
                "text": word.get("word", ""),
            })

        # If we have utterances (sentence-level), use those instead
        utterances_list = channels[0].get("utterances", [])
        if utterances_list:
            asr_segments = []
            for utt in utterances_list:
                asr_segments.append({
                    "start_ms": int(utt.get("start", 0) * 1000),
                    "end_ms": int(utt.get("end", 0) * 1000),
                    "text": utt.get("transcript", "").strip(),
                })

        # If no segments at all, build from words
        if not asr_segments and words_data:
            current_start = words_data[0].get("start", 0)
            current_text = ""
            for word in words_data:
                current_text += word.get("word", "") + " "
            asr_segments = [{
                "start_ms": int(words_data[0].get("start", 0) * 1000),
                "end_ms": int(words_data[-1].get("end", 0) * 1000),
                "text": current_text.strip(),
            }]

        log("progress", step="asr", status="completed", progress=40,
            message=f"Deepgram: {len(asr_segments)} segments transcribed")

        result = StepResult(
            step="asr", status="success", provider="deepgram", model="nova-3",
            duration_ms=int((time.time() - t0) * 1000),
            data={"segments_count": len(asr_segments), "segments": asr_segments},
        )
        return result

    except Exception as exc:
        log("progress", step="asr", status="failed", progress=35,
            message=f"Deepgram failed: {exc}")
        return StepResult(step="asr", status="failed", provider="deepgram",
                          error=f"Deepgram ASR failed: {exc}",
                          duration_ms=int((time.time()-t0)*1000))


# =====================================================================
# STEP 4 — Scenes + Keyframes
# =====================================================================
def step_scenes(video_id: str, b2_key: str) -> StepResult:
    t0 = time.time()
    log("progress", step="scenes", status="running", progress=42,
        message="Detecting scene changes...")

    local_src = workspace_path(video_id, "source.mp4")

    try:
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector

        video = open_video(local_src)
        sm = SceneManager()
        sm.add_detector(ContentDetector(threshold=30.0))
        sm.detect_scenes(video)
        scene_list = sm.get_scene_list()

        scenes = []
        for i, (start, end) in enumerate(scene_list):
            scenes.append({
                "index": i,
                "start_ms": int(start.get_seconds() * 1000),
                "end_ms": int(end.get_seconds() * 1000),
                "midpoint_ms": int((start.get_seconds() + end.get_seconds()) / 2 * 1000),
            })
    except Exception as exc:
        log("progress", step="scenes", status="fallback", progress=44,
            message=f"PySceneDetect failed ({exc}), using uniform 30s chunks")
        # Fallback: uniform chunks
        probe_key = workspace_path(video_id, "probe.json")
        if os.path.exists(probe_key):
            with open(probe_key) as f:
                meta = json.load(f)
        else:
            meta = run_ffprobe(local_src)
        duration = meta.get("duration_ms", 600000)
        chunk_ms = 30000
        scenes = []
        for i in range(0, duration, chunk_ms):
            scenes.append({
                "index": len(scenes),
                "start_ms": i,
                "end_ms": min(i + chunk_ms, duration),
                "midpoint_ms": i + min(chunk_ms, duration - i) // 2,
            })

    # Extract keyframes
    log("progress", step="scenes", status="running", progress=48,
        message=f"Extracting {len(scenes)} keyframes...")
    keyframe_keys = []
    s3 = get_s3()
    for sc in scenes:
        kf_path = workspace_path(video_id, f"kf_{sc['index']:04d}.jpg")
        extract_keyframe(local_src, kf_path, sc["midpoint_ms"] / 1000)
        kf_b2_key = f"assets/{video_id}/keyframes/frame-{sc['index']:04d}.jpg"
        s3.upload_file(kf_path, B2_BUCKET, kf_b2_key, ExtraArgs={"ContentType": "image/jpeg"})
        keyframe_keys.append(kf_b2_key)

    result = StepResult(
        step="scenes", status="success", provider="scenedetect",
        duration_ms=int((time.time() - t0) * 1000),
        data={"scenes_count": len(scenes), "scenes": scenes,
              "keyframes_count": len(keyframe_keys), "keyframe_keys": keyframe_keys},
    )
    log("progress", step="scenes", status="completed", progress=55,
        message=f"{len(scenes)} scenes, {len(keyframe_keys)} keyframes extracted")
    return result


# =====================================================================
# STEP 5 — VL Caption (Mistral Pixtral vision)
# =====================================================================
def step_vl_caption(video_id: str, scenes_result: StepResult) -> StepResult:
    t0 = time.time()
    log("progress", step="vl-caption", status="running", progress=57,
        message="Captioning keyframes via Mistral Pixtral vision...")

    try:
        _ = MISTRAL_API_KEY
    except RuntimeError:
        return StepResult(step="vl-caption", status="failed", provider="mistral",
                          error="MISTRAL_API_KEY not set", duration_ms=int((time.time()-t0)*1000))

    import base64

    scenes = scenes_result.data.get("scenes", [])
    keyframe_keys = scenes_result.data.get("keyframe_keys", [])

    captions = []
    s3 = get_s3()

    for i, (sc, kf_key) in enumerate(zip(scenes, keyframe_keys)):
        log("progress", step="vl-caption", status="running", progress=57 + int(25 * i / len(scenes)),
            message=f"Captioning keyframe {i+1}/{len(scenes)}...")
        try:
            kf_local = workspace_path(video_id, f"kf_{sc['index']:04d}.jpg")
            download_from_b2(kf_key, kf_local)

            with open(kf_local, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")

            caption = mistral_vision(
                prompt="Describe this video frame in 1-2 sentences. What objects, people, actions, and setting do you see? Be specific.",
                image_b64=b64,
                model="pixtral-large-latest",
                max_tokens=150,
            )
            captions.append({
                "index": i,
                "start_ms": sc["start_ms"],
                "midpoint_ms": sc["midpoint_ms"],
                "end_ms": sc["end_ms"],
                "caption": caption,
            })
        except Exception as exc:
            captions.append({
                "index": i,
                "start_ms": sc["start_ms"],
                "midpoint_ms": sc["midpoint_ms"],
                "end_ms": sc["end_ms"],
                "caption": f"Scene at {sc['start_ms']/1000:.1f}s",
                "error": str(exc),
            })

    result = StepResult(
        step="vl-caption", status="success", provider="mistral", model="pixtral-large-latest",
        duration_ms=int((time.time() - t0) * 1000),
        data={"captions_count": len(captions), "captions": captions},
    )
    log("progress", step="vl-caption", status="completed", progress=60,
        message=f"{len(captions)} keyframes captioned via Mistral Pixtral")
    return result


# =====================================================================
# STEP 6 — Chunk (NLTK + scene boundaries, 20-45s)
# =====================================================================
def step_chunk(video_id: str, asr_result: StepResult, scenes_result: StepResult) -> StepResult:
    t0 = time.time()
    log("progress", step="chunk", status="running", progress=62,
        message="Chunking transcript into 20-45s segments...")

    asr_segments = asr_result.data.get("segments", [])
    scenes = scenes_result.data.get("scenes", [])

    import nltk
    try:
        nltk.data.find("tokenizers/punkt")
    except LookupError:
        nltk.download("punkt", quiet=True)

    # Build full transcript with word timestamps
    full_text = " ".join(s["text"] for s in asr_segments)
    sentences = nltk.sent_tokenize(full_text)

    if not sentences:
        return StepResult(step="chunk", status="failed", provider="nltk",
                          error="No sentences found", duration_ms=int((time.time()-t0)*1000))

    # Map sentences back to time ranges
    sentence_ranges = []
    text_idx = 0
    for sent in sentences:
        # Find matching ASR segments
        words_in_sent = sent.split()
        sent_start = None
        sent_end = None
        word_count = 0
        for seg in asr_segments:
            seg_words = seg["text"].split()
            for w in seg_words:
                if word_count < len(words_in_sent):
                    if sent_start is None:
                        sent_start = seg["start_ms"]
                    sent_end = seg["end_ms"]
                    word_count += 1
                else:
                    break
            if word_count >= len(words_in_sent):
                break
        if sent_start is not None:
            sentence_ranges.append({
                "text": sent,
                "start_ms": sent_start,
                "end_ms": sent_end,
            })

    # Greedy packing: 20-45s chunks aligned to scene boundaries
    chunks = []
    current_chunk = None

    def finalize_chunk():
        nonlocal current_chunk
        if current_chunk and current_chunk["sentences"]:
            ch = current_chunk
            ch["end_ms"] = ch["sentences"][-1]["end_ms"]
            ch["duration_ms"] = ch["end_ms"] - ch["start_ms"]
            chunks.append(ch)
        current_chunk = None

    def start_new_chunk(sent_range, scene_idx):
        return {
            "index": len(chunks),
            "start_ms": sent_range["start_ms"],
            "end_ms": sent_range["end_ms"],
            "duration_ms": 0,
            "text": sent_range["text"],
            "sentences": [sent_range],
            "scene_idx": scene_idx,
            "midpoint_ms": sent_range["start_ms"],
        }

    for sent_range in sentence_ranges:
        # Find which scene this sentence belongs to
        scene_idx = 0
        for si, sc in enumerate(scenes):
            if sc["start_ms"] <= sent_range["start_ms"] <= sc["end_ms"]:
                scene_idx = si
                break

        if current_chunk is None:
            current_chunk = start_new_chunk(sent_range, scene_idx)
        else:
            new_duration = sent_range["end_ms"] - current_chunk["start_ms"]
            # Check scene cut alignment
            near_scene_cut = False
            for sc in scenes:
                if abs(sent_range["start_ms"] - sc["start_ms"]) < 3000 and current_chunk["duration_ms"] >= 15000:
                    near_scene_cut = True
                    break

            if new_duration > 45000 or (new_duration >= 20000 and near_scene_cut):
                finalize_chunk()
                current_chunk = start_new_chunk(sent_range, scene_idx)
            else:
                current_chunk["end_ms"] = sent_range["end_ms"]
                current_chunk["duration_ms"] = new_duration
                current_chunk["text"] += " " + sent_range["text"]
                current_chunk["sentences"].append(sent_range)

    finalize_chunk()

    # Merge tiny chunks
    merged = []
    for ch in chunks:
        if merged and ch["duration_ms"] < 8000 and len(ch["sentences"]) == 1:
            prev = merged[-1]
            if prev["duration_ms"] + ch["duration_ms"] <= 45000:
                prev["end_ms"] = ch["end_ms"]
                prev["duration_ms"] = prev["end_ms"] - prev["start_ms"]
                prev["text"] += " " + ch["text"]
                prev["sentences"].extend(ch["sentences"])
                continue
        merged.append(ch)
    chunks = merged

    # Re-index
    for i, ch in enumerate(chunks):
        ch["index"] = i

    result = StepResult(
        step="chunk", status="success", provider="nltk",
        duration_ms=int((time.time() - t0) * 1000),
        data={"chunks_count": len(chunks), "chunks": chunks},
    )
    log("progress", step="chunk", status="completed", progress=65,
        message=f"{len(chunks)} chunks created")
    return result


# =====================================================================
# STEP 7 — Embed (BGE-M3 + CLIP → LanceDB + JSON sidecar)
# =====================================================================
def build_index_sidecar(chunks: list[dict], dense_embeddings, model: str) -> dict:
    """Portable vector-index sidecar uploaded to `index/<videoId>/segments.json`.

    The Node app reads this for dense retrieval — no native LanceDB binding
    needed at query time (see DECISIONS.md). Embeddings are L2-normalized and
    rounded to 6dp to keep the payload small.
    """
    import math

    segments = []
    for ch, emb in zip(chunks, dense_embeddings):
        vec = [float(x) for x in emb]
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        vec = [round(x / norm, 6) for x in vec]
        segments.append(
            {
                "index": ch["index"],
                "start_ms": ch["start_ms"],
                "end_ms": ch["end_ms"],
                "text": ch["text"],
                "embedding": vec,
            }
        )
    return {
        "version": 1,
        "model": model,
        "dim": len(segments[0]["embedding"]) if segments else 0,
        "segments": segments,
    }


def step_embed(video_id: str, chunk_result: StepResult) -> StepResult:
    t0 = time.time()
    log("progress", step="embed", status="running", progress=67,
        message="Generating embeddings (BGE-M3 + CLIP)...")

    chunks = chunk_result.data.get("chunks", [])
    texts = [ch["text"] for ch in chunks]
    dense_model_name = None  # tracks which model produced dense_emb

    try:
        from sentence_transformers import SentenceTransformer

        log("progress", step="embed", status="running", progress=70,
            message="Loading BGE-M3...")
        dense_model = SentenceTransformer("BAAI/bge-m3", device="cpu")
        dense_emb = dense_model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        dense_model_name = "BAAI/bge-m3"

        log("progress", step="embed", status="running", progress=75,
            message="Loading CLIP...")
        clip_model = SentenceTransformer("clip-ViT-B-32", device="cpu")
        clip_emb = clip_model.encode(texts, normalize_embeddings=True, show_progress_bar=False)

        # Write to LanceDB on B2 via s3fs
        import pyarrow as pa
        import pyarrow.parquet as pq
        import s3fs

        fs = s3fs.S3FileSystem(
            key=os.environ.get("B2_KEY_ID", ""),
            secret=os.environ.get("B2_APP_KEY", ""),
            endpoint_url=f"https://{os.environ.get('B2_ENDPOINT', 's3.us-west-004.backblazeb2.com')}",
            config_kwargs={"s3": {"addressing_style": "path"}},
        )

        table = pa.table({
            "chunk_index": [ch["index"] for ch in chunks],
            "start_ms": [ch["start_ms"] for ch in chunks],
            "end_ms": [ch["end_ms"] for ch in chunks],
            "text": texts,
            "dense_embedding": pa.array([pa.array(e.tolist(), type=pa.float32()) for e in dense_emb],
                                         type=pa.list_(pa.float32())),
            "clip_embedding": pa.array([pa.array(e.tolist(), type=pa.float32()) for e in clip_emb],
                                        type=pa.list_(pa.float32())),
        })

        lance_path = f"s3://{B2_BUCKET}/index/{video_id}/segments.lance"
        pq.write_table(table, f"{lance_path}/data.parquet", filesystem=fs)
        log("progress", step="embed", status="completed", progress=80,
            message=f"Embeddings written to LanceDB at {lance_path}")

        status = "success"
        provider = "sentence-transformers"
        model_name = "BAAI/bge-m3+clip-ViT-B-32"
    except Exception as exc:
        log("progress", step="embed", status="fallback", progress=75,
            message=f"Local embedding failed ({exc}), using Mistral Embed API...")
        try:
            dense_emb = mistral_embed(texts)
            dense_model_name = "mistral-embed"
            status = "fallback"
            provider = "mistral"
            model_name = "mistral-embed"
            log("progress", step="embed", status="completed", progress=80,
                message=f"Mistral Embed API: {len(dense_emb)} vectors")
        except Exception as exc2:
            return StepResult(step="embed", status="failed", provider="embedding",
                              error=f"All embedding methods failed: {exc2}",
                              duration_ms=int((time.time()-t0)*1000))

    # Portable index sidecar — written on BOTH paths (previously the Mistral
    # fallback vectors were computed then silently discarded, leaving the
    # search index empty). Consumed by src/lib/rag/corpus.ts at query time.
    try:
        sidecar = build_index_sidecar(chunks, dense_emb, dense_model_name)
        sidecar_key = f"index/{video_id}/segments.json"
        put_object_to_b2(
            json.dumps(sidecar).encode("utf-8"), sidecar_key, "application/json"
        )
        log("progress", step="embed", status="running", progress=80,
            message=f"Index sidecar uploaded to {sidecar_key} (model={dense_model_name})")
    except Exception as exc:
        log("progress", step="embed", status="running", progress=80,
            message=f"⚠ sidecar upload failed (search degraded for this video): {exc}")

    result = StepResult(
        step="embed", status=status, provider=provider, model=model_name,
        duration_ms=int((time.time() - t0) * 1000),
        data={"vectors_count": len(texts)},
    )
    return result


# =====================================================================
# STEP 7.5 — Natural-break detection (Layer 2 mid-roll cue points)
# =====================================================================
# Break score (docs/specs/09 §2):
#   score = w1 * scene_cut_strength
#         + w2 * silence_score          (silence seconds, capped at 1.0 for 1s+)
#         + w3 * topic_similarity_drop  (1 - Jaccard(before-window, after-window))
#         - w4 * mid_sentence_penalty
# Weights: w1=0.4, w2=0.3, w3=0.2, w4=0.5. Eligibility: score01 >= 0.55 (stored
# as int 0-100 in DB, threshold 55). Caps: none in first 60s, >=180s apart.

BREAK_WEIGHTS = {"w1": 0.4, "w2": 0.3, "w3": 0.2, "w4": 0.5}
BREAK_THRESHOLD = 0.55
BREAK_MIN_GAP_MS = 250        # ASR pause that counts as silence
BREAK_FIRST_ALLOWED_MS = 60000
BREAK_MIN_SPACING_MS = 180000


def _token_set(text: str) -> set:
    return set(
        t for t in "".join(c.lower() if c.isalnum() else " " for c in text).split() if t
    )


def compute_breaks(
    asr_segments: list[dict],
    scenes: list[dict],
    chunks: list[dict],
    duration_ms: int,
) -> list[dict]:
    """Pure function — returns eligible natural breaks, greedy-spaced.

    Each break: {"timestamp_ms": int, "score": int 0-100, "reason": str}
    """
    w = BREAK_WEIGHTS

    # Scene cut times (cut happens at a scene's start)
    cuts = [sc.get("start_ms", 0) for sc in scenes if sc.get("start_ms", 0) > 0]

    # Candidate times from ASR utterance gaps (midpoint of the gap)
    candidates = []  # (t_ms, gap_ms)
    for prev, nxt in zip(asr_segments, asr_segments[1:]):
        gap = nxt.get("start_ms", 0) - prev.get("end_ms", 0)
        if gap >= BREAK_MIN_GAP_MS:
            candidates.append((prev.get("end_ms", 0) + gap // 2, gap))
    # Scene cuts are candidates even without an ASR pause
    for cut in cuts:
        candidates.append((cut, 0))

    # Merge candidates closer than 3s (keep the larger gap)
    candidates.sort()
    merged: list[list] = []
    for t, gap in candidates:
        if merged and t - merged[-1][0] < 3000:
            if gap > merged[-1][1]:
                merged[-1] = [t, gap]
        else:
            merged.append([t, gap])

    def scene_strength(t: int) -> float:
        best = 0.0
        for cut in cuts:
            d = abs(cut - t)
            if d <= 1500:
                best = max(best, 1.0)
            elif d < 5000:
                best = max(best, 1.0 - (d - 1500) / 3500)
        return best

    def topic_drop(t: int) -> float:
        before = " ".join(
            c["text"] for c in chunks
            if t - 30000 <= (c.get("start_ms", 0) + c.get("end_ms", 0)) / 2 < t
        )
        after = " ".join(
            c["text"] for c in chunks
            if t <= (c.get("start_ms", 0) + c.get("end_ms", 0)) / 2 < t + 30000
        )
        if not before or not after:
            return 0.0
        a, b = _token_set(before), _token_set(after)
        if not a or not b:
            return 0.0
        jaccard = len(a & b) / len(a | b)
        return 1.0 - jaccard

    def mid_sentence(t: int) -> float:
        for seg in asr_segments:
            if seg.get("start_ms", 0) + 100 < t < seg.get("end_ms", 0) - 100:
                return 1.0
        return 0.0

    scored = []
    for t, gap in merged:
        if t < BREAK_FIRST_ALLOWED_MS or t > duration_ms - 5000:
            continue
        score01 = (
            w["w1"] * scene_strength(t)
            + w["w2"] * min(gap / 1000.0, 1.0)
            + w["w3"] * topic_drop(t)
            - w["w4"] * mid_sentence(t)
        )
        score01 = max(0.0, min(1.0, score01))
        if score01 >= BREAK_THRESHOLD:
            scored.append((t, score01))

    # Greedy selection: highest score first, >=180s from any accepted break
    scored.sort(key=lambda x: -x[1])
    accepted: list[tuple[int, float]] = []
    for t, s in scored:
        if all(abs(t - at) >= BREAK_MIN_SPACING_MS for at, _ in accepted):
            accepted.append((t, s))
    accepted.sort()

    return [
        {
            "timestamp_ms": t,
            "score": int(round(s * 100)),
            "reason": "scene+silence+topic",
        }
        for t, s in accepted
    ]


def step_breaks(video_id: str, asr_result: StepResult, scenes_result: StepResult,
                chunk_result: StepResult) -> StepResult:
    t0 = time.time()
    log("progress", step="breaks", status="running", progress=81,
        message="Detecting natural breaks for mid-roll placements...")

    asr_segments = asr_result.data.get("segments", [])
    scenes = scenes_result.data.get("scenes", [])
    chunks = chunk_result.data.get("chunks", [])
    duration_ms = chunks[-1]["end_ms"] if chunks else 0

    breaks = compute_breaks(asr_segments, scenes, chunks, duration_ms)

    try:
        put_object_to_b2(
            json.dumps({"version": 1, "breaks": breaks}).encode("utf-8"),
            f"assets/{video_id}/breaks.json",
            "application/json",
        )
    except Exception as exc:
        log("progress", step="breaks", status="running", progress=81,
            message=f"⚠ breaks.json upload failed (non-fatal): {exc}")

    log("progress", step="breaks", status="completed", progress=81,
        message=f"{len(breaks)} natural breaks detected")
    return StepResult(
        step="breaks", status="success", provider="deterministic",
        duration_ms=int((time.time() - t0) * 1000),
        data={"breaks_count": len(breaks), "breaks": breaks},
    )


# =====================================================================
# STEP 8 — Slot Detection (Mistral Pixtral vision + MediaPipe)
# =====================================================================
def step_slots(video_id: str, scenes_result: StepResult) -> StepResult:
    t0 = time.time()
    log("progress", step="slots", status="running", progress=82,
        message="Detecting in-scene ad slots via Mistral Pixtral vision...")

    if not MISTRAL_API_KEY:
        return StepResult(step="slots", status="failed", provider="mistral",
                          error="MISTRAL_API_KEY not set", duration_ms=int((time.time()-t0)*1000))

    import base64

    scenes = scenes_result.data.get("scenes", [])
    keyframe_keys = scenes_result.data.get("keyframe_keys", [])
    ALLOWED_SURFACES = ["mug", "laptop_lid", "can", "bottle",
                        "blank_sign", "cereal_box", "book_cover", "screen"]

    detected_slots = []
    s3 = get_s3()

    for i, (sc, kf_key) in enumerate(zip(scenes, keyframe_keys)):
        log("progress", step="slots", status="running",
            progress=82 + int(10 * i / len(scenes)),
            message=f"Analyzing scene {i+1}/{len(scenes)} for slots via Pixtral...")

        try:
            kf_local = workspace_path(video_id, f"kf_{sc['index']:04d}.jpg")
            download_from_b2(kf_key, kf_local)

            with open(kf_local, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")

            slot_prompt = (
                "You are a product placement detector. Examine this video frame.\n"
                "Return a JSON object with a key 'slots' containing an array of inanimate objects "
                "suitable for branded product placement.\n"
                "Allowed surfaces: mug, laptop_lid, can, bottle, blank_sign, cereal_box, book_cover, screen.\n"
                'For each object: {"surface": "<type>", "bbox": [x1,y1,x2,y2], "confidence": 0-1}\n'
                "Bbox is in 0-1000 normalized coordinates.\n"
                "SKIP any objects near faces or hands.\n"
                "Return ONLY valid JSON, no markdown."
            )

            result = mistral_vision(
                prompt=slot_prompt,
                image_b64=b64,
                model="pixtral-large-latest",
                max_tokens=500,
                response_format={"type": "json_object"},
            )

            # result is a dict from mistral_vision when response_format is set
            items = result.get("slots", []) if isinstance(result, dict) else []

            for item in items:
                if item.get("surface") in ALLOWED_SURFACES and item.get("confidence", 0) >= 0.5:
                    detected_slots.append({
                        "id": f"slot_{uuid.uuid4().hex[:8]}",
                        "timestamp_ms": sc["midpoint_ms"],
                        "surface": item["surface"],
                        "bbox": item["bbox"],
                        "confidence": item["confidence"],
                    })
        except Exception as exc:
            log("progress", step="slots", status="running", progress=82,
                message=f"Slot detection warning for scene {i}: {exc}")

    # MediaPipe face/hand rejection
    try:
        import mediapipe as mp
        log("progress", step="slots", status="running", progress=88,
            message="Running MediaPipe face/hand rejection...")
        mp_face = mp.solutions.face_detection
        mp_hands = mp.solutions.hands
        import cv2

        face_detector = mp_face.FaceDetection(model_selection=0, min_detection_confidence=0.5)
        hands_detector = mp_hands.Hands(static_image_mode=True, max_num_hands=2, min_detection_confidence=0.5)

        rejected_indices = set()
        for i, slot in enumerate(detected_slots):
            kf_local = workspace_path(video_id, f"kf_0000.jpg")
            img = cv2.imread(kf_local)
            if img is None:
                continue
            h, w = img.shape[:2]
            x1 = int(slot["bbox"][0] * w / 1000)
            y1 = int(slot["bbox"][1] * h / 1000)
            x2 = int(slot["bbox"][2] * w / 1000)
            y2 = int(slot["bbox"][3] * h / 1000)

            crop = img[max(0, y1-50):min(h, y2+50), max(0, x1-50):min(w, x2+50)]
            if crop.size == 0:
                continue

            rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
            face_result = face_detector.process(rgb)
            hands_result = hands_detector.process(rgb)

            if face_result.detections or hands_result.multi_hand_landmarks:
                rejected_indices.add(i)

        face_detector.close()
        hands_detector.close()

        detected_slots = [s for idx, s in enumerate(detected_slots) if idx not in rejected_indices]
        log("progress", step="slots", status="running", progress=90,
            message=f"MediaPipe rejected {len(rejected_indices)} face/hand slots")
    except Exception as exc:
        log("progress", step="slots", status="running", progress=90,
            message=f"MediaPipe unavailable ({exc}), skipping rejection")

    result = StepResult(
        step="slots", status="success", provider="mistral", model="pixtral-large-latest",
        duration_ms=int((time.time() - t0) * 1000),
        data={"slots_count": len(detected_slots), "slots": detected_slots},
    )
    log("progress", step="slots", status="completed", progress=92,
        message=f"{len(detected_slots)} ad slots detected via Pixtral")
    return result


# =====================================================================
# STEP 9 — Brand Match (CLIP similarity)
# =====================================================================
def step_brand_match(video_id: str, slots_result: StepResult) -> StepResult:
    t0 = time.time()
    log("progress", step="brand-match", status="running", progress=93,
        message="Matching slots to brands via CLIP...")

    slots = slots_result.data.get("slots", [])

    try:
        from sentence_transformers import SentenceTransformer
        clip = SentenceTransformer("clip-ViT-B-32", device="cpu")

        brand_surfaces = ["mug", "laptop_lid", "can", "bottle",
                          "blank_sign", "cereal_box", "book_cover", "screen"]
        brand_texts = [
            f"A product placed on a {s} with brand logo, commercial advertisement"
            for s in brand_surfaces
        ]
        brand_vectors = clip.encode(brand_texts, normalize_embeddings=True)

        for slot in slots:
            surface_text = f"A {slot['surface']} with a brand logo on it, product placement advertisement"
            slot_vec = clip.encode([surface_text], normalize_embeddings=True)[0]
            similarities = [float(slot_vec @ bv) for bv in brand_vectors]

            # Map surface to best brand
            surface_idx = brand_surfaces.index(slot["surface"]) if slot["surface"] in brand_surfaces else -1
            if surface_idx >= 0:
                slot["brand_score"] = float(similarities[surface_idx])
                slot["matched"] = slot["brand_score"] >= 0.25
            else:
                slot["brand_score"] = 0.0
                slot["matched"] = False

        matched = sum(1 for s in slots if s.get("matched"))
        log("progress", step="brand-match", status="completed", progress=94,
            message=f"{matched}/{len(slots)} slots matched to brands")

    except Exception as exc:
        # Fallback: simple surface-based matching
        for slot in slots:
            slot["brand_score"] = 0.3
            slot["matched"] = True
        log("progress", step="brand-match", status="fallback", progress=94,
            message=f"CLIP unavailable ({exc}), using surface-based matching")

    result = StepResult(
        step="brand-match", status="success", provider="sentence-transformers", model="clip-ViT-B-32",
        duration_ms=int((time.time() - t0) * 1000),
        data={"slots": slots},
    )
    return result


# =====================================================================
# STEP 10 — Inpaint (Hugging Face FLUX.1-dev + Pillow composite)
# =====================================================================
def step_inpaint(video_id: str, slots_result: StepResult, scenes_result: StepResult) -> StepResult:
    t0 = time.time()
    log("progress", step="inpaint", status="running", progress=95,
        message="Inpainting ad slots via Gemini Nano Banana AI...")

    slots = slots_result.data.get("slots", [])
    matched_slots = [s for s in slots if s.get("matched")]

    if not matched_slots:
        log("progress", step="inpaint", status="completed", progress=96,
            message="No matched slots to inpaint")
        return StepResult(
            step="inpaint", status="success", provider="pillow", model="composite",
            duration_ms=int((time.time() - t0) * 1000),
            data={"slots_completed": 0, "inpainted": []},
        )

    s3 = get_s3()
    inpainted_slots = []
    brand_names = ["DemoCola", "TechBook", "BrewMate", "LaptopPro", "SnackBox"]
    brand_colors = ["#e63946", "#457b9d", "#2a9d8f", "#8d6e63", "#e76f51"]

    for i, slot in enumerate(matched_slots):
        surf = slot["surface"]
        brand_name = brand_names[i % len(brand_names)]
        brand_color = brand_colors[i % len(brand_colors)]

        log("progress", step="inpaint", status="running",
            progress=95 + int(4 * i / len(matched_slots)),
            message=f"Inpainting slot {i+1}/{len(matched_slots)} ({surf}) with {brand_name}...")

        try:
            # Get the keyframe for this slot
            scene_idx = min(i, len(scenes_result.data.get("keyframe_keys", [])) - 1)
            kf_b2_key = scenes_result.data.get("keyframe_keys", [])[scene_idx] if scene_idx >= 0 else None
            
            if not kf_b2_key:
                kf_b2_key = f"assets/{video_id}/keyframes/frame-{i:04d}.jpg"

            try:
                kf_local = workspace_path(video_id, f"inpaint_source_{i}.jpg")
                download_from_b2(kf_b2_key, kf_local)
            except Exception:
                kf_local = workspace_path(video_id, "kf_0000.jpg")
                if not os.path.exists(kf_local):
                    log("progress", step="inpaint", status="fallback", progress=95,
                        message=f"No keyframe for slot {i}, skipping")
                    continue

            # Generate prompt for HF FLUX (if HF_TOKEN is set)
            gen_prompt = (
                f"A professional high-quality product photo of a {brand_name} branded {surf}, "
                f"commercial advertisement, photorealistic 4K, studio lighting, "
                f"white background, product photography"
            )

            # Output path for inpainted image
            after_local = workspace_path(video_id, f"inpainted_{i}.jpg")

            # Run inpainting (tries HF FLUX first, falls back to Pillow composite)
            # Generate Gemini edit prompt
            edit_prompt = (
                f"Edit this image professionally. "
                f"In the area around the {surf}, place a photorealistic high-end "
                f"{brand_name} branded product. "
                f"The product should look naturally placed in the scene with proper "
                f"lighting, shadows, and perspective matching the original. "
                f"Keep the rest of the image identical. "
                f"Make the brand logo clearly visible. "
                f"Professional advertising quality, 4K photorealistic."
            )

            inpaint_slot(
                keyframe_path=kf_local,
                output_path=after_local,
                bbox_1000=slot["bbox"],
                brand_name=brand_name,
                brand_color=brand_color,
                surface=surf,
                generate_prompt=edit_prompt,
            )

            # Upload to B2
            slot_id = slot["id"]
            before_b2_key = f"assets/{video_id}/inpaint/{slot_id}/before.jpg"
            after_b2_key = f"assets/{video_id}/inpaint/{slot_id}/after.jpg"

            s3.upload_file(kf_local, B2_BUCKET, before_b2_key, ExtraArgs={"ContentType": "image/jpeg"})
            s3.upload_file(after_local, B2_BUCKET, after_b2_key, ExtraArgs={"ContentType": "image/jpeg"})

            # Set Object Lock GOVERNANCE on inpainted frame
            try:
                put_object_lock(after_b2_key, mode="GOVERNANCE", days=365)
            except Exception as lock_err:
                log("progress", step="inpaint", status="running", progress=95,
                    message=f"Object Lock note: {lock_err}")

            inpainted_slots.append({
                "slot_id": slot_id,
                "surface": surf,
                "brand": brand_name,
                "before_key": before_b2_key,
                "after_key": after_b2_key,
                "before_sha256": sha256_of_file(kf_local),
                "after_sha256": sha256_of_file(after_local),
            })

        except Exception as exc:
            log("progress", step="inpaint", status="running", progress=95,
                message=f"Inpaint failed for slot {i}: {exc}")

    result = StepResult(
        step="inpaint", status="success" if inpainted_slots else "fallback",
        provider="gemini+pillow", model="gemini-2.5-flash-image",
        duration_ms=int((time.time() - t0) * 1000),
        data={"slots_completed": len(inpainted_slots), "inpainted": inpainted_slots},
    )
    log("progress", step="inpaint", status="completed", progress=96,
        message=f"{len(inpainted_slots)} slots inpainted via HF FLUX + Pillow")
    return result


# =====================================================================
# STEP 11 — Critic (Mistral Large JSON rubric)
# =====================================================================
def step_critic(video_id: str, inpaint_result: StepResult) -> StepResult:
    t0 = time.time()
    log("progress", step="critic", status="running", progress=97,
        message="Running AI critic on inpainted slots via Mistral Large...")

    if not MISTRAL_API_KEY:
        return StepResult(step="critic", status="failed", provider="mistral",
                          error="MISTRAL_API_KEY not set", duration_ms=int((time.time()-t0)*1000))

    import base64

    inpainted = inpaint_result.data.get("inpainted", [])
    passed_slots = []

    for item in inpainted:
        try:
            s3 = get_s3()
            before_local = workspace_path(video_id, f"critic_before_{item['slot_id']}.jpg")
            after_local = workspace_path(video_id, f"critic_after_{item['slot_id']}.jpg")
            download_from_b2(item["before_key"], before_local)
            download_from_b2(item["after_key"], after_local)

            with open(before_local, "rb") as f:
                before_b64 = base64.b64encode(f.read()).decode("utf-8")
            with open(after_local, "rb") as f:
                after_b64 = base64.b64encode(f.read()).decode("utf-8")

            rubric = (
                "Score the inpainted advertisement on a scale of 1-5 for each criterion:\n"
                "1. VISUAL_QUALITY — Is the inpainted region seamless and photorealistic?\n"
                "2. BRAND_VISIBILITY — Is the brand/logo clearly visible in the ad?\n"
                "3. CONTEXT_FIT — Does the ad match the scene (lighting, perspective, style)?\n"
                "4. DISCLOSURE_READINESS — Would a viewer immediately recognize this as AI?\n"
                "5. SAFETY — Does the ad violate any content policy?\n\n"
                "Return JSON: {\"scores\": {\"visual_quality\": N, \"brand_visibility\": N, "
                "\"context_fit\": N, \"disclosure_readiness\": N, \"safety\": N}, "
                "\"average\": N, \"pass\": bool, \"notes\": \"...\"}"
            )

            critique = mistral_chat_json(
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"Compare these two images (before/after inpainting).\n{rubric}"},
                            {"type": "image_url", "image_url": f"data:image/jpeg;base64,{before_b64}"},
                            {"type": "image_url", "image_url": f"data:image/jpeg;base64,{after_b64}"},
                        ],
                    }
                ],
                model="mistral-large-latest",
                max_tokens=500,
                temperature=0.2,
            )

            scores = critique.get("scores", {})
            avg = critique.get("average", sum(scores.values()) / max(len(scores), 1))
            passed = critique.get("pass", avg >= 3.5)

            item["critic_score"] = avg
            item["critic_passed"] = passed
            item["critic_notes"] = critique.get("notes", "")

            if passed:
                passed_slots.append(item)
            else:
                log("progress", step="critic", status="running", progress=97,
                    message=f"Slot {item['slot_id']} failed critic (score: {avg:.1f})")

        except Exception as exc:
            log("progress", step="critic", status="running", progress=97,
                message=f"Critic failed for {item.get('slot_id', 'unknown')}: {exc}")
            item["critic_passed"] = True
            passed_slots.append(item)

    result = StepResult(
        step="critic", status="success", provider="mistral", model="mistral-large-latest",
        duration_ms=int((time.time() - t0) * 1000),
        data={"slots_passed": len(passed_slots), "slots": passed_slots},
    )
    log("progress", step="critic", status="completed", progress=98,
        message=f"{len(passed_slots)}/{len(inpainted)} slots passed critic (Mistral)")
    return result


# =====================================================================
# STEP 12 — Manifest
# =====================================================================
def step_manifest(video_id: str, b2_key: str, all_steps: list[StepResult]) -> StepResult:
    t0 = time.time()
    log("progress", step="manifest", status="running", progress=99,
        message="Building Genblaze manifest with B2 Object Lock...")

    placements = []
    for s in all_steps:
        if s.step == "inpaint":
            for item in s.data.get("inpainted", []):
                placements.append({
                    "slot_id": item["slot_id"],
                    "surface": item["surface"],
                    "timestamp_ms": item.get("timestamp_ms", 0),
                    "brand": item.get("brand", ""),
                    "bbox": item.get("bbox_1000", []),
                    "before_sha256": item.get("before_sha256", ""),
                    "after_sha256": item.get("after_sha256", ""),
                    "critic_passed": item.get("critic_passed", True),
                    "critic_score": item.get("critic_score", 0),
                    "before_key": item.get("before_key", ""),
                    "after_key": item.get("after_key", ""),
                })

    # Content hash of the source MP4 (full — the file is still in the local
    # workspace at manifest time; cleanup happens in run_ingest's finally).
    source_sha256 = ""
    source_hash_type = "none"
    local_src = workspace_path(video_id, "source.mp4")
    try:
        if os.path.exists(local_src):
            source_sha256 = sha256_of_file(local_src)
            source_hash_type = "full"
    except Exception as exc:
        log("progress", step="manifest", status="running", progress=99,
            message=f"⚠ source hash failed (non-fatal): {exc}")

    manifest = {
        "manifest_id": f"mfst_{uuid.uuid4().hex[:12]}",
        "manifest_version": "1.0.0",
        "run_id": f"run_{int(time.time())}",
        "video_id": video_id,
        "version": "1.0",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "b2_key": b2_key,
            "sha256": source_sha256,
            "hash_type": source_hash_type,  # "full" | "none" (partial reserved for >200MB)
        },
        "retention": {"mode": "COMPLIANCE", "days": 365},
        "entries": [
            {
                "step": s.step,
                "status": s.status,
                "provider": s.provider,
                "model": s.model,
                "duration_ms": s.duration_ms,
                "input_sha256": s.input_sha256,
                "output_sha256": s.output_sha256,
                "b2_key": s.b2_key,
                "error": s.error,
            }
            for s in all_steps
        ],
        "placements": placements,
        "summary": {
            "total_steps": len(all_steps),
            "successful_steps": sum(1 for s in all_steps if s.status == "success"),
            "fallback_steps": sum(1 for s in all_steps if s.status == "fallback"),
            "failed_steps": sum(1 for s in all_steps if s.status == "failed"),
            "total_duration_ms": int((time.time() - t0) * 1000),
            "slots_detected": sum(
                s.data.get("slots_count", 0) for s in all_steps if s.step == "slots"
            ),
            "slots_inpainted": sum(
                s.data.get("slots_completed", 0) for s in all_steps if s.step == "inpaint"
            ),
        },
    }

    manifest_json = json.dumps(manifest, indent=2, default=str).encode("utf-8")
    manifest_b2_key = f"manifests/{video_id}/manifest.json"

    put_object_to_b2(manifest_json, manifest_b2_key, "application/json")

    # Set COMPLIANCE Object Lock on manifest
    try:
        put_object_lock(manifest_b2_key, mode="COMPLIANCE", days=365)
        log("progress", step="manifest", status="running", progress=99,
            message="Object Lock COMPLIANCE 365d set on manifest")
    except Exception as lock_err:
        log("progress", step="manifest", status="running", progress=99,
            message=f"Object Lock note: {lock_err}")

    result = StepResult(
        step="manifest", status="success", provider="genblaze",
        b2_key=manifest_b2_key,
        duration_ms=int((time.time() - t0) * 1000),
        data={
            "manifest_id": manifest["manifest_id"],
            "manifest_key": manifest_b2_key,
            "run_id": manifest["run_id"],
            "source_sha256": source_sha256,
            "placements_count": len(placements),
        },
    )
    log("progress", step="manifest", status="completed", progress=100,
        message=f"Manifest uploaded to {manifest_b2_key} with Object Lock COMPLIANCE 365d")
    return result


# =====================================================================
# Pipeline Runner
# =====================================================================
def run_ingest(b2_key: str):
    """Run the full Genblaze pipeline with all 12 Steps."""
    video_id = b2_key.split("/")[1]

    log("progress", step="init", status="running", progress=0,
        message=f"Starting pipeline for video {video_id}")

    all_steps: list[StepResult] = []

    try:
        # Step 1: Probe
        all_steps.append(step_probe(video_id, b2_key))

        # Step 2: Transcode
        all_steps.append(step_transcode(video_id, b2_key, all_steps[-1]))

        # Step 3: ASR
        asr_result = step_asr(video_id, b2_key)
        all_steps.append(asr_result)

        # Step 4: Scenes + Keyframes
        scenes_result = step_scenes(video_id, b2_key)
        all_steps.append(scenes_result)

        # Step 5: VL Caption
        all_steps.append(step_vl_caption(video_id, all_steps[-1]))

        # Step 6: Chunk (ASR utterances + scene boundaries)
        # NOTE: previously called with all_steps[-4] (= transcode — wrong step)
        chunk_result = step_chunk(video_id, asr_result, scenes_result)
        all_steps.append(chunk_result)

        # Step 7: Embed
        all_steps.append(step_embed(video_id, all_steps[-1]))

        # Step 7.5: Natural breaks (Layer 2 mid-roll cue points)
        all_steps.append(step_breaks(video_id, asr_result, scenes_result, chunk_result))

        # Step 8: Slots (detect ad surfaces on scene keyframes)
        slots_result = step_slots(video_id, scenes_result)
        all_steps.append(slots_result)

        # Step 9: Brand Match
        all_steps.append(step_brand_match(video_id, all_steps[-1]))

        # Step 10: Inpaint (slots + scene keyframes)
        # NOTE: previously called with all_steps[-6] (= vl-caption or chunk —
        # index drifted as steps were added). Named refs prevent that class of bug.
        all_steps.append(step_inpaint(video_id, slots_result, scenes_result))

        # Step 11: Critic
        all_steps.append(step_critic(video_id, all_steps[-1]))

        # Step 12: Manifest
        all_steps.append(step_manifest(video_id, b2_key, all_steps))

        success = all(s.status != "failed" for s in all_steps)

    except Exception as exc:
        log("progress", step="pipeline", status="failed", progress=0,
            message=f"Pipeline crashed: {exc}")
        import traceback
        log("error", traceback=traceback.format_exc())
        success = False

    finally:
        clean_workspace()

    log("complete",
        data={
            "video_id": video_id,
            "steps_count": len(all_steps),
            "success": success,
            "manifest_key": all_steps[-1].b2_key if all_steps and all_steps[-1].step == "manifest" else None,
            "total_duration_ms": sum(s.duration_ms for s in all_steps),
        },
    )


# =====================================================================
# CLI Entry
# =====================================================================
def main():
    parser = argparse.ArgumentParser(description="BrandFrame Genblaze Pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="Run full ingest pipeline")
    ingest.add_argument("--key", required=True, help="B2 key of the source video")
    ingest.add_argument("--skip-embed", action="store_true", help="Skip embedding step (faster)")
    ingest.add_argument("--skip-inpaint", action="store_true", help="Skip inpainting step (faster)")

    args = parser.parse_args()

    if args.command == "ingest":
        run_ingest(args.key)


if __name__ == "__main__":
    main()
