# 05 — Data Model

Three data stores. Each has a single owner and a single writer (except where noted):

| Store | Owner of truth | Writer | Readers |
|---|---|---|---|
| **libsql / SQLite** (`brandframe.db`, or Turso in production) | Metadata about videos, users, segments, slots, brands, breaks | Next.js Server Actions / Route Handlers; Python pipeline writes status updates via a small `/api/pipeline/update` Route Handler (or by writing directly to SQLite if invoked on same machine) | Next.js RSCs, Server Actions, Route Handlers |
| **Backblaze B2** (single bucket) | All binary assets (source MP4, HLS, keyframes, inpainted frames, thumbnails, brand assets, manifests, LanceDB index files, tmp) | Python pipeline (primary); Next.js via presigned PUT from browser | Browser via signed GET URLs; Next.js via S3 client; Python via boto3/s3fs |
| **LanceDB** (lives on B2 under `index/segments.lance`) | Multimodal embedding vectors + metadata for segments | Python pipeline (single writer during ingest); Next.js only writes on reindex admin action (v2) | Next.js search (read-only); Python verify checks |

## 1. Relational schema (Drizzle / SQLite)

Source of truth: `src/lib/db/schema.ts`. The tables below describe the current schema plus planned additions.

### 1.1 `users`
| Column | Type | Notes |
|---|---|---|
| id | text PK | `usr_<nanoid>` |
| email | text unique | |
| role | text enum | `creator` | `brand` | `admin` (default `creator`) |
| createdAt | text | ISO-8601 |

> Auth is stubbed for the hackathon. On first studio visit, create a demo user via a Server Action and store in a cookie (no NextAuth). Only add real auth if time permits in Phase 7.

### 1.2 `videos`
| Column | Type | Notes |
|---|---|---|
| id | text PK | `vid_<nanoid>` |
| creatorId | text FK → users.id | |
| title | text | From upload form, fallback to filename |
| description | text nullable | |
| sourceKey | text | B2 key of uploaded source, e.g. `uploads/vid_abc123/source.mp4` |
| hlsKey | text nullable | Set after transcode, e.g. `playable/vid_abc123/hls/master.m3u8` |
| durationMs | integer nullable | Set by probe step |
| lang | text nullable | `en`, `es`, etc. (from ASR) |
| status | text enum | `uploaded | processing | ready | failed` (default `uploaded`) |
| manifestRunId | text nullable | `run_<unix>` from manifest step → points to `manifests/<videoId>/<runId>.json` |
| errorMsg | text nullable | *(planned)* last pipeline error if `failed` |
| visibility | text enum | *(planned)* `private | unlisted | public` (default `private` for v1 demo; set `public` for the 5 seeded tutorials) |
| createdAt | text | |

### 1.3 `segments`
~20–45s scene/sentence-aligned chunks. One row per chunk; each chunk has 1 keyframe.
| Column | Type | Notes |
|---|---|---|
| id | text PK | `seg_<nanoid>` |
| videoId | text FK → videos.id | |
| seq | integer | Monotonic within video, starting at 0 |
| startMs | integer | |
| endMs | integer | |
| transcript | text | ASR text for the chunk |
| vlCaption | text nullable | Qwen-VL visual caption of the keyframe |
| ocr | text nullable | OCR text (if any) |
| keyframeKey | text nullable | B2 key of keyframe JPG (e.g. `assets/<videoId>/keyframes/<seq>.jpg`) |
| topic | text nullable | Short topic label (for chapters bar; LLM-generated) |

### 1.4 `brands`
| Column | Type | Notes |
|---|---|---|
| id | text PK | `brd_<nanoid>` |
| name | text | Display name ("Nestlé", "Huawei", ...) |
| logoKey | text nullable | `brands/<id>/logo.png` |
| heroKey | text nullable | Optional hero banner |
| categories | text | JSON array string: `["beverage","tech","snack",...]` — used for CLIP brand match filter |
| copy | text nullable | Default 1-liner marketing copy for in-ad overlay |
| targetUrl | text nullable | Click-through URL for placed ad |
| ownerId | text FK → users.id | Brand-portal account that owns it |
| unsafeCategories | text nullable | *(planned)* JSON array; force-reject matches with these video topics (e.g. kids content for alcohol) |
| embeddingKey | text nullable | *(planned)* B2 key of a precomputed CLIP embedding of logo+packshot (computed on brand upload) |

### 1.5 `ad_slots`
One row per detected inanimate-object surface.
| Column | Type | Notes |
|---|---|---|
| id | text PK | `slot_<nanoid>` |
| videoId | text FK → videos.id | |
| timestampMs | integer | Pause timestamp |
| bbox | text | JSON `[x1,y1,x2,y2]` in **0..1000 normalized** coords (independent of frame resolution) |
| label | text | Surface class: `mug | laptop_lid | can | bottle | blank_sign | cereal_box | book_cover | screen` |
| surface | text nullable | Material descriptor (`matte`, `glossy`, `fabric`, ...) — for inpaint prompt |
| lighting | text nullable | `bright | dim | warm | cool | mixed` — for inpaint prompt |
| confidence | real | 0..1 VL detection confidence |
| brandId | text nullable FK → brands.id | Set after CLIP match + creator approval |
| beforeKey | text | Key of the original keyframe (full frame) |
| afterKey | text nullable | Key of inpainted pause-frame (only fills bbox region or full frame with inpaint) |
| criticScore | integer nullable | 0..5, set by AgentLoop critic; threshold ≥4 required |
| rejectReason | text nullable | *(planned)* `person_overlap | low_confidence | critic_fail | creator_rejected | policy_block` |
| status | text enum | `pending | approved | rejected | filled | skipped` |
| createdAt | text | |

### 1.6 `breaks`
Natural-break mid-roll candidates (Layer 2 ads).
| Column | Type | Notes |
|---|---|---|
| id | text PK | `brk_<nanoid>` |
| videoId | text FK → videos.id | |
| timestampMs | integer | |
| score | real | Weighted score (see §09-ad-engine) — top scores above threshold become mid-rolls |
| brandId | text nullable FK → brands.id | |
| creativeKey | text nullable | Key of uploaded mid-roll creative on B2 |

### 1.7 (planned) `placements` *(optional but useful)*
One row per ad *impression* shown to a viewer (overlays + mid-rolls + pause ads).
For v1 demo we don't need impressions — keep it simple, skip unless time permits.

### 1.8 Indexes

SQLite (Drizzle explicit index() calls):
- `segments.videoId_seq_idx` UNIQUE on (videoId, seq)
- `segments.videoId_startMs_idx` on (videoId, startMs) — for "what segment is at timestamp X?" queries
- `ad_slots.videoId_timestampMs_idx` on (videoId, timestampMs) — player cue lookup
- `ad_slots.status_idx` on (status) — studio pending queue
- `breaks.videoId_score_idx` on (videoId, score DESC)

### 1.9 Enums in TS

Keep in sync with Drizzle. Already in `src/lib/types.ts`:
```ts
export type VideoStatus = "uploaded" | "processing" | "ready" | "failed";
export type SlotStatus  = "pending"  | "approved" | "rejected" | "filled" | "skipped";
export type UserRole    = "creator"  | "brand"    | "admin";
```

When adding a column, always: (1) add to schema.ts, (2) add/update the TS type,
(3) run `npm run db:push`, (4) note the migration in `MEMORY.md`. Drizzle push
auto-creates migration-free changes for dev; for production we'll switch to
`npm run db:generate` before submission.

## 2. B2 object layout (single bucket)

Every binary file lives under a versioned prefix. Paths are generated by
`src/lib/b2/paths.ts` (Node) and `pipelines/config.py` (Python) — keep them in sync.

```
<bucket>/
├── uploads/<videoId>/source.<ext>              # raw upload (PUT by browser via presigned URL)
│
├── playable/<videoId>/hls/
│   ├── master.m3u8
│   └── seg<N>.ts                               # HLS segments (transcoded by ffmpeg step)
├── playable/<videoId>/poster.jpg               # thumbKey(videoId)
│
├── assets/<videoId>/
│   ├── keyframes/<seq>.jpg                     # extracted keyframe per segment
│   ├── inpainted/<slotId>.jpg                  # FLUX inpainted pause-frame
│   ├── audio.wav                               # normalized audio extracted for ASR
│   └── chapters.vtt                            # WebVTT chapters from chunk topics
│
├── manifests/<videoId>/<runId>.json            # Genblaze manifest, Object Lock COMPLIANCE 365d
├── manifests/<videoId>/<runId>.sig             # (optional) detached signature
│
├── index/
│   ├── segments.lance/                         # LanceDB multimodal index (written via s3fs)
│   └── brands.lance/                           # CLIP brand-embedding table
│
├── brands/<brandId>/
│   ├── logo.png
│   ├── packshot.jpg                            # hero product shot (for CLIP match + inpaint conditioning)
│   └── creatives/<filename>.mp4|jpg            # mid-roll creatives
│
└── tmp/<uuid>/…                                # scratch (ffmpeg intermediates, partial uploads)
                                                # lifecycle: delete after 48h
```

### Public vs private
- `uploads/`, `tmp/` → private (no public reads; access only via signed URLs).
- `playable/`, `assets/`, `brands/` → can be **public-read** for the demo to save on signing
  (set bucket public for those prefixes, or sign every URL — v1 uses signed URLs for everything to be safe).
- `manifests/` → public-read so `/verify` works without auth, but **Object Lock COMPLIANCE** prevents deletion/mutation.
- `index/` → private (only the server reads it; no direct browser access).

### Object Lock rules

| Prefix | Mode | Retention | Rationale |
|---|---|---|---|
| `manifests/*` | COMPLIANCE | 365 days | Core provability claim; cannot be shortened or deleted even by root key |
| `uploads/<videoId>/source.*` | GOVERNANCE (optional) | 30 days | Lets the creator re-process / delete if needed |
| `playable/*`, `assets/*/keyframes/*` | None | — | Derived; can be regenerated |
| `assets/*/inpainted/*` | GOVERNANCE | 365 days | Evidence of AI alteration — same reasoning as manifests |
| `brands/*` | None | — | Brand-owned; can be deleted by brand |
| `tmp/*` | None | 48h lifecycle delete | Scratch |

Enable Object Lock at **bucket creation time**. Manifests and inpainted frames get
`PutObjectRetention` set by the manifest Python Step.

## 3. LanceDB schemas

### 3.1 `segments` table (video chunk index)

```
{
  id:          string     # segments.id
  videoId:     string     # segments.videoId
  startMs:     int32
  endMs:       int32
  text:        string     # transcript + " " + vlCaption (used for BM25/lexical)
  dense_vec:   float32[1024]   # BGE-M3 dense
  sparse_vec:  dict<term:float>  # BGE-M3 sparse (LexicalPluggable)
  clip_vec:    float32[512]    # CLIP ViT-B/32
  keyframeKey: string     # back-reference to B2
}
```
Partition key: none for v1 (<100k segments). Add partitioning by `videoId.hash % N` if corpus grows.
Indexes:
- IVF-PQ on `dense_vec` (nlist=256 for demo, nprobes=20 at query) — HNSW if corpus > 1M.
- BM25 inverted index over `text` (LanceDB FTS).
- Linear/IVF on `clip_vec`.

Hybrid weights (final ranking score, see §08):
`score = 0.5 * dense + 0.2 * bm25 + 0.3 * clip`
Top-20 → bge-reranker-v2-m3 cross-encoder → top-5.

### 3.2 `brands` table

```
{
  brandId:    string
  name:       string
  categories: string[]
  clip_vec:   float32[512]    # CLIP embedding of packshot+logo
  text_vec:   float32[1024]   # BGE-M3 embedding of name + description (for intent overlay match)
}
```
Used by slot detection to choose which brand fits a slot. For v1 we pre-compute
at brand upload. With 5 seeded brands this is trivial; for 1k+ brands, add an
ANN index.

## 4. Genblaze Manifest schema (JSON, on B2)

Written by the manifest Step at `manifests/<videoId>/<runId>.json`. Version `1.0.0`.

```jsonc
{
  "manifest_version": "1.0.0",
  "run_id": "run_1729000000",
  "video_id": "vid_abc123",
  "source": {
    "key": "uploads/vid_abc123/source.mp4",
    "sha256": "<hex>",
    "size_bytes": 123456789,
    "duration_ms": 604000
  },
  "steps": [
    {
      "name": "asr",
      "provider": "nvidia",
      "model": "parakeet-tdt-1.1b",
      "status": "ok | fallback | failed",
      "latency_ms": 1850,
      "cost_usd": 0.008,
      "outputs": { "transcript_key": "assets/...", "segments_count": 42 }
    }
    // ... one per Step
  ],
  "placements": [
    {
      "slot_id": "slot_xyz",
      "timestamp_ms": 228000,
      "label": "mug",
      "bbox": [420, 310, 560, 460],
      "brand_id": "brd_nestle",
      "before_key": "assets/vid_abc123/keyframes/22.jpg",
      "after_key": "assets/vid_abc123/inpainted/slot_xyz.jpg",
      "before_sha256": "<hex>",
      "after_sha256": "<hex>",
      "critic_score": 5,
      "creator_approved_at": "<ISO-8601>",
      "creator_id": "usr_...",
      "disclosure": "AI Ad · Nestlé"
    }
  ],
  "providers": ["mistral","deepgram","google"],
  "object_lock": {
    "mode": "COMPLIANCE",
    "retain_until": "<ISO-8601 now+365d>",
    "b2_bucket": "<bucket>"
  },
  "created_at": "<ISO-8601>",
  "signed_by": { "key_id": "..." }
}
```

The manifest is also embedded into the MP4's `udta` atom under a `----:com.brandframe:manifest` metadata field (full JSON) so that a downloaded MP4 still carries the provable record. The `/verify` page reconciles:

1. `manifest.source.sha256` vs re-hash of uploaded source byte-range.
2. Each `placement.before_sha256` / `after_sha256` vs re-hash of B2 objects.
3. HeadObject on manifest → check Object Lock retention matches `object_lock.retain_until`.

## 5. ID generation

Use `shortId(prefix)` from `src/lib/utils.ts`: returns `<prefix>_<8 chars base36>`.
- Videos: `vid_`
- Users: `usr_`
- Segments: `seg_`
- Ad slots: `slot_`
- Brands: `brd_`
- Breaks: `brk_`
- Pipeline runs: `run_<unix-seconds>` (matches Python's `f"run_{int(time.time())}"`)
