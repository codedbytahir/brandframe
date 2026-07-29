# 07 — Genblaze Python Pipeline

Single entry point: `python -m pipelines.cli ingest --key <b2-source-key>`.
Invoked by Next.js (`src/lib/pipelines/run.ts`) via `child_process.spawn` in the
`.venv` created by `scripts/setup-pipelines.sh`.

The pipeline writes **all** durable state to B2 (assets, HLS, index, manifests)
and reports metadata back to SQLite. It never touches the network except to B2
and the configured AI providers.

## 1. Design rules

1.  **Genblaze-native.** Each Step is a `genblaze.Step` (subclass or factory)
    with:
    - a primary provider/model
    - at least one fallback provider (where possible)
    - retry budget (default 2 retries with exponential backoff)
    - timeout (per-step caps, see below)
2.  **JSONL stdout is the protocol.** Every Step emits `_log(...)` lines (see
    `cli.py:_log`) for SSE. No other prints to stdout. stderr is for human/debug
    output only.
3.  **Structured results.** Every Step returns a `StepResult` dataclass. They
    are aggregated into the manifest.
4.  **B2 ObjectStorageSink for outputs.** Never write final outputs to local
    disk — only `tmp/` for intermediates (cleaned up in a `finally:`).
5.  **Idempotency.** Re-running `ingest` for the same key must not corrupt
    state. Steps should check if their B2 output exists and skip (or overwrite)
    deterministically.
6.  **Fail-fast with graceful degradation.** If a non-critical Step fails after
    retries (e.g. inpaint), log `status: fallback` and continue — a video
    without ads is still usable. Failures in critical Steps (probe, asr, embed,
    manifest) mark the video `failed`.

## 2. DAG

```
probe ──► asr ──► transcode-hls ──► scenes+keyframes ──► vl-caption ──┐
                                                                      ├──► chunk ──► embed ──► (write LanceDB)
                           ┌──────────────────────────────────────────┘
                           ▼
              slots (VL detect) ──► brand-match ──► inpaint ──► critic ──┐
                                                                         ├──► manifest ──► lock ──► done
                           embeddings/segments ◄─────────────────────────┘
```

Linear for v1 (no parallelism) for simplicity; Genblaze can fan out later if needed.

## 3. Step contract

```py
@dataclass
class StepResult:
    name: str                           # e.g. "asr", "embed"
    status: Literal["ok","fallback","failed"]
    provider: str | None                # e.g. "nvidia", "openai", "local"
    model: str | None                   # e.g. "parakeet-tdt-1.1b", "bge-m3"
    latency_ms: int
    cost_usd: float
    output: dict[str, Any]              # step-specific; recorded in manifest
```

Every Step follows the pattern:

```py
def step_<name>(key: str, ctx: Ctx) -> StepResult:
    _log("step.start", name="<name>")
    t0 = time.time()
    try:
        # primary provider, wrapped by Genblaze Step with retries
        out = _primary(...)
        _log("step.ok", name="<name>", provider=..., model=..., output=out)
        return StepResult("<name>", "ok", ..., time.time()-t0, cost, out)
    except Exception as primary_err:
        _log("step.fallback", name="<name>", error=str(primary_err))
        try:
            out = _fallback(...)
            _log("step.ok", name="<name>", provider=..., model=..., output=out, fallback=True)
            return StepResult("<name>", "fallback", ..., time.time()-t0, cost, out)
        except Exception as fb_err:
            _log("step.failed", name="<name>", error=str(fb_err))
            # Critical steps re-raise to fail the whole pipeline
            raise RuntimeError(f"step <name> failed: {fb_err}") from fb_err
```

Add a `Ctx` dataclass that carries: `video_id`, `b2_client`, `s3fs`, `tmp_dir`,
`db_writer` (a tiny HTTP client that calls Next's `/api/pipeline/update` or
writes directly to SQLite if running locally) so Steps don't instantiate their own clients.

## 4. Step detail

### 4.1 `probe`
- **Goal:** extract duration, resolution, fps, codec, audio channels.
- **Primary:** `ffmpeg.probe` via `ffmpeg-python` / `subprocess ffprobe`.
- **Outputs:** `{ duration_ms, width, height, fps, vcodec, acodec, size_bytes }`.
- **DB:** update `videos.duration_ms`.
- **Critical:** yes.

### 4.2 `transcode-hls`
- **Goal:** produce HLS ladder for streaming.
- **Implementation:** `ffmpeg -i <source-local-copy> -c:v libx264 -c:a aac -hls_time 6 -hls_playlist_type vod -hls_segment_filename "playable/<videoId>/hls/seg%d.ts" playable/<videoId>/hls/master.m3u8` (single-bitrate 1080p for v1).
- **Outputs:** HLS master + segments to B2 `playable/<id>/hls/` via ObjectStorageSink; also generate `poster.jpg` at 10s mark.
- **DB:** `videos.hlsKey = playable/.../master.m3u8`.
- **Critical:** yes.
- **Timeout:** 10 min for a 10-min video.

### 4.3 `asr` (automatic speech recognition)
- **Goal:** word-aligned transcript with timestamps.
- **Primary (NVIDIA NIM):** `parakeet-tdt-1.1b` via `genblaze[nvidia]` (returns word-level timestamps).
- **Fallback:** `faster-whisper large-v3` locally (CTranslate2).
- **Final fallback:** OpenAI Whisper API.
- **Outputs:** list of segments (start_ms, end_ms, text, words[]); write as JSON to `assets/<id>/transcript.json`.
- **DB:** no direct rows (used by chunk step).
- **Critical:** yes — search/chat/overview depend on transcript.

### 4.4 `scenes+keyframes`
- **Goal:** detect scene cuts; extract one keyframe JPG per scene (and per chunk later).
- **Tool:** `scenedetect` (ContentDetector, threshold 30) + ffmpeg for keyframe extraction at scene midpoints or every ~2.5s minimum, ~30s maximum.
- **Outputs:** JPGs at `assets/<id>/keyframes/<seq>.jpg` via ObjectStorageSink.
- **Critical:** no — if it fails, fall back to uniform keyframes every 10s.

### 4.5 `vl-caption`
- **Goal:** short (≤20 words) visual description of each keyframe (helps RAG recall for visual queries, e.g. "whiteboard diagram of flexbox").
- **Primary:** Qwen2.5-VL-7B on GMI (`genblaze[gmicloud]`).
- **Fallback:** GPT-4o-mini vision (OpenAI).
- **Outputs:** captions array keyed by keyframe seq; written to `assets/<id>/captions.json`.
- **Critical:** no.

### 4.6 `chunk`
- **Goal:** turn ASR segments into 20–45s chunks that respect punctuation and scene boundaries.
- **Implementation:**
  1. Concatenate ASR words; use NLTK `punkt` sentence tokenizer to split on sentence boundaries.
  2. Greedily pack sentences into chunks of ~20s min, ~45s max.
  3. Prefer chunk ends at scene cuts if within ±3s of target size.
- **Outputs:** list of chunks {seq, start_ms, end_ms, transcript, keyframe_seq, vl_caption, ocr (optional)}.
- **DB:** insert `segments` rows via `db_writer`.
- **Critical:** yes.

### 4.7 `embed`
- **Goal:** produce multimodal vectors per chunk and write to LanceDB on B2.
- **Embeddings:**
  - Text dense: `BAAI/bge-m3` (1024-d) via FlagEmbedding (local).
  - Text sparse: BGE-M3 sparse weights (LexicalPluggable in LanceDB).
  - Visual: `openai/clip-vit-base-patch32` (512-d) via transformers locally (on the keyframe JPG for the chunk).
- **Fallback for text dense:** OpenAI `text-embedding-3-small` (1536-d; down-project or use 1536-d LanceDB column).
- **Outputs:** LanceDB rows at `index/segments.lance` on B2 via s3fs.
- **DB:** update segments (no new columns; row is already inserted in chunk step).
- **Critical:** yes.
- **Timeout:** 15 min.

### 4.8 `slots` (detect inanimate surfaces)
- **Goal:** find candidate in-scene ad slots on keyframes.
- **Approach:**
  1. Call Qwen-VL in JSON-mode with a prompt constrained to inanimate object classes (mug | laptop_lid | can | bottle | blank_sign | cereal_box | book_cover | screen).
  2. Parse response into list of {label, bbox_norm:[x1,y1,x2,y2] (0-1000), confidence, surface, lighting}.
  3. Run MediaPipe FaceDetection + HandDetection on the keyframe; **reject** any bbox whose IoU > 0.05 with a face/hand detection (even if IoU is small with a face, be conservative and reject).
  4. Filter by confidence > 0.6.
  5. Spacing rule: at most one pause ad per 3 minutes per video (sort by confidence descending; greedily accept if ≥180s from last accepted).
  6. Reject slot if the chunk's transcript/topic hits content-policy denylist (child, political, health/medical, alcohol, tobacco, gambling, regulated finance).
- **Outputs:** list of candidate slots (beforeKey = keyframe JPG key).
- **DB:** insert `ad_slots` rows with `status='pending'`.
- **Critical:** no — if no slots found, skip Layers 1/3 ads.

### 4.9 `brand-match`
- **Goal:** choose the best-fitting brand for each slot (or reject if none fit).
- **Approach:**
  - Crop the slot bbox from the keyframe.
  - Compute CLIP similarity against precomputed `brands.lance` CLIP vectors.
  - Apply category compatibility (e.g., a mug slot can take beverages but not laptops).
  - Apply brand `unsafeCategories` denylist against video topic tags.
  - Threshold: similarity ≥ 0.28 otherwise leave `brandId=null` and skip.
- **Outputs:** `brandId` on each slot.
- **DB:** update `ad_slots.brandId`.
- **Critical:** no.

### 4.10 `inpaint` (per approved slot)
- **Goal:** produce a single inpainted pause-frame for each approved slot.
- **Trigger in v1:** at ingest time for slots auto-approved because the seeded demo creator has pre-approved all seeded brands. In production this runs on creator approval (Server Action 1.7 triggers a smaller `inpaint-one` sub-pipeline).
- **Primary:** FLUX.1-fill-pro via GMI (`genblaze[gmicloud]`), using the cropped bbox region, a prompt like `<brand name> <product> on a <surface>, <lighting> lighting, photorealistic, matching the scene`, and the original frame as image reference with mask derived from bbox.
- **Fallback:** FLUX.1-fill on Replicate.
- **Output:** inpainted full-frame JPG at `assets/<id>/inpainted/<slotId>.jpg`.
- **DB:** `ad_slots.afterKey = ...`, `ad_slots.status='filled'` only if critic passes.
- **Critical:** no (slot dropped on failure).

### 4.11 `critic` (AgentLoop)
- **Goal:** ensure the inpainted result looks natural.
- **Rubric (5 points, pass ≥4):**
  1. Object identity matches assigned brand.
  2. Lighting/color matches surrounding scene.
  3. No distortion, warped text, extra fingers/artifacts.
  4. Bbox region looks physically plausible (perspective, reflection).
  5. No human/face/hand altered (frame is inpainted only inside bbox).
- **Implementation:** Genblaze `AgentLoop` over Qwen-VL critic; re-prompt inpaint with feedback once if score 2–3, drop if still <4 after retry.
- **Outputs:** `criticScore` (0–5) per slot; drop slots scoring <4.
- **DB:** `ad_slots.criticScore`, `status='filled' | 'rejected'`.
- **Critical:** no.

### 4.12 `manifest`
- **Goal:** build the Genblaze Manifest dataclass, embed into MP4, write to B2, set Object Lock.
- **Steps:**
  1. Compute SHA-256 of source MP4 and of each inpainted frame (and before keyframe).
  2. Build manifest JSON (schema in §05-Data-Model §4) with all StepResults and placement records.
  3. Embed manifest JSON into MP4 `udta` atom (use `ffmpeg -metadata` or `mutagen`/`pymediainfo`; simplest: write to a `com.brandframe.manifest` metadata tag via ffmpeg on a copy to `playable/<id>/master-provenanced.mp4` and also reference it in HLS — for v1 it's enough to store the manifest alongside and write a `X-Genblaze-Manifest` header on the master.m3u8).
  4. Upload manifest JSON to `manifests/<id>/<runId>.json`.
  5. Call `s3.putObjectRetention` with COMPLIANCE mode, retain until UTC now+365d.
  6. Upload inpainted frames and mark Object Lock GOVERNANCE 365d.
  7. Emit `manifest.built` event with `run_id`.
- **DB:** `videos.manifestRunId = runId`, `videos.status='ready'`.
- **Critical:** yes.

## 5. Cost & latency budget

For a single 10-minute 1080p video (hackathon budget target ~$0.50/video):

| Step | Provider/model | Latency (est) | Cost (est) |
|---|---|---|---|
| probe | ffmpeg | <1s | $0 |
| transcode-hls | ffmpeg (local) | 1–2 min | $0 |
| asr | parakeet (NIM) / fw fallback | 15–30s | $0.008 |
| scenes+keyframes | scenedetect+ffmpeg | 20s | $0 |
| vl-caption (15–25 frames) | qwen-vl (GMI) | 30s | $0.02 |
| chunk | local | <1s | $0 |
| embed (text+visual for ~20 chunks) | bge-m3+clip local | 1–3 min | $0 (local) |
| slots | qwen-vl (GMI) | 20s | $0.01 |
| brand-match | CLIP local | <5s | $0 |
| inpaint+critic (≤3 slots) | flux-fill-pro + qwen-vl critic | 60–90s | $0.05–0.15/slot |
| manifest+lock | local + boto3 | 5s | $0 |
| **Total** | | **3–6 min** | **~$0.15–0.50** |

## 6. Log events reference

Python emits these `event` values. The SSE endpoint and Studio UI key off them:

| event | Fields | Meaning |
|---|---|---|
| `pipeline.start` | `key` | Ingest started |
| `step.start` | `name` | Step began |
| `step.fallback` | `name`, `error` | Primary failed; trying fallback |
| `step.ok` | `name`, `provider`, `model`, `latency_ms`, `output` | Step succeeded (ok or fallback) |
| `step.failed` | `name`, `error` | Step failed (may abort pipeline) |
| `manifest.built` | `run_id`, `steps`, `object_lock` | Manifest built and locked |
| `pipeline.done` | `key`, `duration_ms`, `total_cost_usd`, `video_status` | Pipeline completed |
| `pipeline.failed` | `key`, `error` | Pipeline aborted |

Add `progress` events (0–100) per Step for long-running Steps (transcode, embed).

## 7. Testing

- Unit tests (pytest, optional for hackathon): chunking logic, bbox rejection, slot spacing, critic rubric parsing.
- Manual: run `npm run pipelines:ingest -- --key uploads/<id>/source.mp4` for a seeded video; tail logs; verify DB rows + B2 objects.
- Smoke script: `scripts/smoke-pipeline.sh` that runs the CLI on a tiny local fixture and asserts `pipeline.done` (write in Phase 7 if time).

## 8. Configuration

All env is read via `pipelines/config.py`. Required keys mirror `.env.example`
(B2_*, plus any provider keys actually used by the steps you implement). If a
provider key is missing, skip that provider and use the fallback rather than
crashing at import time.
