"""
Unit tests for the Genblaze Pipeline CLI (Phase 2 real implementation).
"""

import json
import sys
import os
import io
from unittest.mock import patch, MagicMock
from dataclasses import dataclass, field
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ── Since the real pipeline requires B2/API access, we test the StepResult
#    dataclass, manifest generation, and JSONL protocol. Full E2E tests
#    require real credentials.

from pipelines.cli import StepResult, run_ingest

# Mock the step functions to test pipeline orchestration
def test_step_result_dataclass():
    """StepResult should store all fields correctly."""
    sr = StepResult(
        step="probe",
        status="success",
        provider="ffprobe",
        model="",
        input_sha256="abc",
        output_sha256="def",
        b2_key="uploads/vid_test/source.mp4",
        duration_ms=1500,
        data={"duration_ms": 600000, "width": 1920},
    )
    assert sr.step == "probe"
    assert sr.status == "success"
    assert sr.duration_ms == 1500
    assert sr.data["width"] == 1920


def test_step_result_fallback():
    """StepResult should support fallback status."""
    sr = StepResult(
        step="asr",
        status="fallback",
        provider="openai",
        model="whisper-1",
        duration_ms=5000,
        data={"segments_count": 42},
    )
    assert sr.status == "fallback"
    assert sr.provider == "openai"


def test_step_result_failed():
    """StepResult should support error messages."""
    sr = StepResult(
        step="embed",
        status="failed",
        provider="sentence-transformers",
        error="CUDA out of memory",
        duration_ms=30000,
        data={},
    )
    assert sr.status == "failed"
    assert "memory" in sr.error


def test_step_result_serialization():
    """StepResult should serialize to dict for manifest."""
    sr = StepResult(
        step="probe",
        status="success",
        provider="ffprobe",
        duration_ms=1000,
        data={"key": "value"},
    )
    import dataclasses
    d = dataclasses.asdict(sr)
    assert d["step"] == "probe"
    assert d["data"]["key"] == "value"


def test_run_ingest_emits_progress():
    """Full pipeline should emit progress JSONL events (mocked)."""
    captured = io.StringIO()

    with patch("sys.stdout", captured), \
         patch("pipelines.cli.step_probe") as mock_probe, \
         patch("pipelines.cli.step_transcode") as mock_transcode, \
         patch("pipelines.cli.step_asr") as mock_asr, \
         patch("pipelines.cli.step_scenes") as mock_scenes, \
         patch("pipelines.cli.step_vl_caption") as mock_vl, \
         patch("pipelines.cli.step_chunk") as mock_chunk, \
         patch("pipelines.cli.step_embed") as mock_embed, \
         patch("pipelines.cli.step_slots") as mock_slots, \
         patch("pipelines.cli.step_brand_match") as mock_brand, \
         patch("pipelines.cli.step_inpaint") as mock_inpaint, \
         patch("pipelines.cli.step_critic") as mock_critic, \
         patch("pipelines.cli.step_manifest") as mock_manifest:

        # Each mock returns a successful StepResult
        def make_result(step_name, data=None):
            return StepResult(step=step_name, status="success", provider="test",
                             duration_ms=100, data=data or {})

        mock_probe.return_value = make_result("probe", {"duration_ms": 600000})
        mock_transcode.return_value = make_result("transcode", {"hls_key": "playable/vid_test/hls/master.m3u8"})
        mock_asr.return_value = make_result("asr", {"segments_count": 20, "segments": [{"start_ms": 0, "end_ms": 5000, "text": "Hello"}]})
        mock_scenes.return_value = make_result("scenes", {"scenes_count": 5, "scenes": [{"start_ms": 0, "end_ms": 30000, "midpoint_ms": 15000}], "keyframes_count": 5, "keyframe_keys": ["kf1"]})
        mock_vl.return_value = make_result("vl-caption", {"captions_count": 5})
        mock_chunk.return_value = make_result("chunk", {"chunks_count": 10, "chunks": []})
        mock_embed.return_value = make_result("embed", {"vectors_count": 10})
        mock_slots.return_value = make_result("slots", {"slots_count": 2, "slots": [{"id": "slot_1", "surface": "mug", "bbox": [100, 200, 300, 400], "timestamp_ms": 15000, "confidence": 0.8}]})
        mock_brand.return_value = make_result("brand-match", {"slots": []})
        mock_inpaint.return_value = make_result("inpaint", {"slots_completed": 1, "inpainted": [{"slot_id": "slot_1", "surface": "mug"}]})
        mock_critic.return_value = make_result("critic", {"slots_passed": 1, "slots": [{"slot_id": "slot_1", "critic_passed": True}]})
        mock_manifest.return_value = make_result("manifest", {"manifest_id": "mfst_test", "manifest_key": "manifests/vid_test/manifest.json", "placements_count": 1})

        run_ingest("uploads/vid_test/source.mp4")

    output = captured.getvalue()
    lines = [l for l in output.strip().split("\n") if l.strip()]

    assert len(lines) > 0

    # Verify all lines are valid JSON
    for line in lines:
        parsed = json.loads(line)
        assert "event" in parsed
        assert "timestamp" in parsed

    # Verify progress events
    progress_events = [
        json.loads(l) for l in lines if json.loads(l)["event"] == "progress"
    ]
    assert len(progress_events) > 0

    # Verify final complete event
    complete_events = [
        json.loads(l) for l in lines if json.loads(l)["event"] == "complete"
    ]
    assert len(complete_events) == 1
    assert complete_events[0]["data"]["success"] is True
    assert complete_events[0]["data"]["video_id"] == "vid_test"


def test_run_ingest_handles_errors():
    """Pipeline should emit error event on crash."""
    captured = io.StringIO()

    with patch("sys.stdout", captured), \
         patch("pipelines.cli.step_probe", side_effect=RuntimeError("B2 connection failed")):

        run_ingest("uploads/vid_test/source.mp4")

    output = captured.getvalue()
    lines = [l for l in output.strip().split("\n") if l.strip()]

    # Should have a complete event with success=false
    complete_events = [
        json.loads(l) for l in lines if json.loads(l)["event"] == "complete"
    ]
    assert len(complete_events) == 1
    assert complete_events[0]["data"]["success"] is False


def test_build_index_sidecar():
    """Index sidecar must carry normalized vectors + chunk timing for the Node RAG."""
    import math
    from pipelines.cli import build_index_sidecar

    chunks = [
        {"index": 0, "start_ms": 0, "end_ms": 30000, "text": "intro to grid"},
        {"index": 1, "start_ms": 30000, "end_ms": 65000, "text": "centering with place-items"},
    ]
    # works with plain lists (Mistral path) and anything iterable (numpy path)
    embeddings = [[3.0, 4.0], [1.0, 0.0]]

    sc = build_index_sidecar(chunks, embeddings, "mistral-embed")

    assert sc["version"] == 1
    assert sc["model"] == "mistral-embed"
    assert sc["dim"] == 2
    assert len(sc["segments"]) == 2

    seg0 = sc["segments"][0]
    assert seg0["index"] == 0 and seg0["start_ms"] == 0 and seg0["text"] == "intro to grid"
    # L2-normalized: [3,4] → [0.6, 0.8]
    assert math.isclose(seg0["embedding"][0], 0.6, abs_tol=1e-6)
    assert math.isclose(seg0["embedding"][1], 0.8, abs_tol=1e-6)
    # unit norm
    for s in sc["segments"]:
        norm = math.sqrt(sum(x * x for x in s["embedding"]))
        assert math.isclose(norm, 1.0, abs_tol=1e-4)

    # empty chunks shouldn't crash
    empty = build_index_sidecar([], [], "mistral-embed")
    assert empty["dim"] == 0 and empty["segments"] == []


def test_compute_breaks():
    """Natural-break formula: weighted scene+silence+topic, minus mid-sentence."""
    from pipelines.cli import compute_breaks

    # ASR utterances with a 1.2s pause at ~2:00 and none elsewhere
    asr_segments = [
        {"start_ms": 0, "end_ms": 60000, "text": "first minute of intro content"},
        {"start_ms": 60500, "end_ms": 120000, "text": "explaining grid fundamentals"},
        {"start_ms": 121200, "end_ms": 180000, "text": "moving on to columns"},
        {"start_ms": 180400, "end_ms": 240000, "text": "named areas now"},
        {"start_ms": 240300, "end_ms": 300000, "text": "summary time"},
    ]
    # Scene cuts at 2:01 and 4:00
    scenes = [
        {"start_ms": 0, "end_ms": 121000},
        {"start_ms": 121000, "end_ms": 240000},
        {"start_ms": 240000, "end_ms": 300000},
    ]
    chunks = [
        {"index": 0, "start_ms": 0, "end_ms": 130000, "text": "grid intro basics rows columns"},
        {"index": 1, "start_ms": 130000, "end_ms": 250000, "text": "columns responsive minmax autofit"},
        {"index": 2, "start_ms": 250000, "end_ms": 300000, "text": "summary recap thanks goodbye"},
    ]
    breaks = compute_breaks(asr_segments, scenes, chunks, 300000)

    # The ~2:00 gap aligns with the 2:01 scene cut → should be accepted
    assert len(breaks) >= 1
    t = breaks[0]["timestamp_ms"]
    assert 115000 < t < 130000
    assert breaks[0]["score"] >= 55

    # Caps respected: nothing in first 60s, >=180s spacing
    assert all(b["timestamp_ms"] >= 60000 for b in breaks)
    ts = [b["timestamp_ms"] for b in breaks]
    assert all(b - a >= 180000 for a, b in zip(ts, ts[1:]))

    # Mid-sentence candidates get rejected: transcript with zero pauses → no breaks
    no_pause = [{"start_ms": 0, "end_ms": 290000, "text": "one uninterrupted wall of speech"}]
    scenes_none = [{"start_ms": 0, "end_ms": 300000}]
    assert compute_breaks(no_pause, scenes_none, chunks, 300000) == []


if __name__ == "__main__":
    test_step_result_dataclass()
    test_step_result_fallback()
    test_step_result_failed()
    test_step_result_serialization()
    test_run_ingest_emits_progress()
    test_run_ingest_handles_errors()
    test_build_index_sidecar()
    test_compute_breaks()
    print("\nAll pipeline tests passed! ✓")
