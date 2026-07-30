"""
Unit tests for the Genblaze Pipeline CLI.
"""

import json
import sys
import io
from unittest.mock import patch

sys.path.insert(0, "pipelines")

from cli import (
    step_probe,
    step_asr,
    step_scenes,
    step_slots,
    step_inpaint,
    step_manifest,
    run_ingest,
)


def test_step_probe():
    """Probe step should return metadata."""
    result = step_probe("uploads/vid_test/source.mp4")
    assert result.step == "probe"
    assert result.status == "success"
    assert "duration_ms" in result.data


def test_step_asr():
    """ASR step should return segments."""
    result = step_asr("uploads/vid_test/source.mp4")
    assert result.step == "asr"
    assert result.status == "success"
    assert len(result.data.get("segments", [])) > 0


def test_step_scenes():
    """Scene detection should return scenes + keyframes."""
    result = step_scenes("uploads/vid_test/source.mp4")
    assert result.step == "scenes"
    assert result.status == "success"
    assert len(result.data.get("scenes", [])) > 0
    assert len(result.data.get("keyframes", [])) > 0


def test_step_slots():
    """Slot detection should find in-scene surfaces."""
    result = step_slots("uploads/vid_test/source.mp4")
    assert result.step == "slots"
    assert result.status == "success"
    assert len(result.data.get("slots", [])) > 0
    slot = result.data["slots"][0]
    assert "id" in slot
    assert "surface" in slot
    assert "timestamp_ms" in slot
    assert "bbox" in slot
    assert len(slot["bbox"]) == 4


def test_step_inpaint():
    """Inpaint step should complete successfully."""
    result = step_inpaint("uploads/vid_test/source.mp4")
    assert result.step == "inpaint"
    assert result.status == "success"
    assert result.data["slots_completed"] >= 0


def test_step_manifest():
    """Manifest step should return manifest metadata."""
    steps = [step_probe("uploads/vid_test/source.mp4")]
    result = step_manifest("uploads/vid_test/source.mp4", steps)
    assert result.step == "manifest"
    assert result.status == "success"
    assert "manifest" in result.data
    manifest = result.data["manifest"]
    assert manifest["version"] == "1.0"
    assert manifest["retention"]["mode"] == "COMPLIANCE"
    assert manifest["retention"]["days"] == 365
    assert len(manifest["entries"]) == 1


def test_run_ingest_emits_progress():
    """Full pipeline should emit progress JSONL events."""
    captured = io.StringIO()
    with patch("sys.stdout", captured):
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


if __name__ == "__main__":
    test_step_probe()
    test_step_asr()
    test_step_scenes()
    test_step_slots()
    test_step_inpaint()
    test_step_manifest()
    test_run_ingest_emits_progress()
    print("\nAll pipeline tests passed! ✓")
