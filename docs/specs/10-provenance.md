# 10 — Provenance, Disclosure & Object Lock

This is one of BrandFrame's most important differentiators — and one of the
heaviest-weighted judging signals for "meaningful B2 use" and "meaningful
Genblaze use." Every AI-generated ad placement leaves an auditable, tamper-evident
trail anchored in Backblaze B2 Object Lock (WORM) and Genblaze Manifests.

## 1. Trust model

- **Anchor:** B2 Object Lock in COMPLIANCE mode on `manifests/` and
  GOVERNANCE mode on inpainted frames. COMPLIANCE objects cannot be overwritten
  or deleted by *anyone*, including the bucket owner, until the retention period
  expires. This makes our "we didn't alter the record later" claim externally verifiable.
- **Manifest:** a JSON document (schema in §05 §4) capturing every Genblaze Step
  that ran, every provider/model used, every placement with bbox + before/after
  SHA-256 hashes, creator approval timestamp, and the retention policy applied.
- **MP4 embedding:** the same manifest is embedded into the distributed MP4's
  `udta` atom so that even when a video is downloaded and re-uploaded
  elsewhere, the provenance travels with it (like C2PA content credentials).
- **Public verifier:** `/verify/[videoId]` is an unauthenticated page that
  fetches the manifest from B2, recomputes hashes of the source and all
  inpainted frames, checks Object Lock retention, and shows before/after
  sliders — all client-verifiable.

## 2. Genblaze Manifest primitives

Use Genblaze v0.6.0 APIs:

- `genblaze.Manifest` — the manifest container; supports `add_step(step_result)`,
  `add_asset(b2_key, sha256, role)`, `add_placement(slot)`, `sign(key_id)`,
  `to_json()`.
- `genblaze.ObjectStorageSink(b2_client, bucket, prefix, retention=...)` —
  writes objects to B2 with Object Lock retention set at PutObject time.
- `genblaze.EmbedPolicy.MP4` / `.PNG` / `.JPG` — tells Genblaze how to embed
  manifest bytes into the container's metadata atom (MP4 `udta`).

If any of the above APIs don't exactly match Genblaze 0.6.0, do the equivalent
manually with `boto3` + `ffmpeg -metadata` and file a GitHub issue — this is
Feedback Prize bait.

## 3. Lifecycle of a manifest

1.  **At ingest start (`pipeline.start`):** instantiate a Manifest with
    `manifest_version = "1.0.0"`, `run_id = "run_<unix>"`, `video_id`, source
    key + size.
2.  **At each Step completion:** call `manifest.add_step(step_result)` with the
    StepResult dataclass. Genblaze records latency/cost/provider/model.
3.  **At inpaint completion:** for each filled slot, add a Placement record
    (see §05 §4 schema) with before/after SHA-256, bbox, brand, critic score,
    and creator approval timestamp.
4.  **At manifest step:**
    - Finalize manifest JSON.
    - Compute SHA-256 of the source MP4 (range-read the first/last MiB + every 10th MiB for speed, or full object for short videos <200MB).
    - Compute SHA-256 of each inpainted frame + each before keyframe.
    - Call `b2.put_object` for `manifests/<videoId>/<runId>.json` with
      `ObjectLockMode=COMPLIANCE`, `ObjectLockRetainUntilDate=now+365d`.
    - Call `b2.put_object_retention` on each inpainted `afterKey` with
      mode=GOVERNANCE, retain_until=now+365d.
    - Embed manifest into MP4 via ffmpeg:
      ```
      ffmpeg -i source.mp4 -c copy -metadata com_brandframe_manifest="<json-or-b2key>"
             playable/<videoId>/provenanced-source.mp4
      ```
      (Prefer storing the B2 key of the manifest rather than inline JSON in metadata to avoid hitting MP4 atom size limits; MP4 atom metadata has practical limits ~64KB. Store the full manifest as a sidecar JSON on B2 with Object Lock, and embed a content identifier (run_id + SHA-256) in the MP4.)
5.  Emit `manifest.built` with run_id.

## 4. Object Lock configuration

Bucket must be created with Object Lock enabled. The manifest Step is
responsible for applying retention per object; don't set a bucket-level default
retention (that would lock everything including tmp/ uploads).

| Prefix | Mode | Retention | Applied by |
|---|---|---|---|
| `manifests/*.json` | COMPLIANCE | 365 days | manifest Step at PutObject |
| `assets/<id>/inpainted/*.jpg` | GOVERNANCE | 365 days | manifest Step after inpaint confirmed |
| everything else | (none/default) | — | — |

Use @aws-sdk/client-s3 from Node when you need to confirm retention (on the
/verify page), but the manifest Step sets it from Python via `boto3`'s
`put_object_retention` (or Genblaze ObjectStorageSink with retention param).

### Legal hold note

In COMPLIANCE mode, even the root account key cannot shorten or remove retention
until `retain_until` passes. This is the "provable" claim we show off in the demo.

## 5. The `/verify/[videoId]` page (public, unauthenticated)

Built as a React Server Component at `src/app/(app)/verify/[videoId]/page.tsx`.

### Sections (top to bottom)

1.  **Status banner (Card with success/warning/danger Badge):**
    - Green (success): "Provenance verified. Manifest is WORM-locked on Backblaze B2 until <date>."
    - Amber (warning): "Manifest found but one or more hashes did not match."
    - Red (danger): "No manifest recorded for this video" (e.g., user-uploaded video not processed by BrandFrame).
2.  **Video summary:** title, duration, creator, processed_at, run_id (monospace).
3.  **Chain-of-custopy timeline:** vertical list of Step cards, each with provider, model, latency, cost_usd, status dot (green/amber/red).
4.  **Placements table/grid:** for each placement:
    - Before/after slider (`<input type="range">` cross-fades two `<img>`s — implement a small client component `BeforeAfterSlider`).
    - Label (`mug`, `laptop_lid`, ...), brand name, critic score (0–5 with stars), bbox (coords, hover to highlight on image).
    - Creator approved timestamp (or "auto-approved for demo").
    - "Why did we place this?" expandable: VL detection confidence, CLIP match score, policy checks passed.
    - Deep link: anchor `#slot-<slotId>` so the player's "Why?" link jumps directly to it.
5.  **Technical details (collapsible by default):**
    - Manifest SHA-256 (click to copy).
    - Source MP4 SHA-256 (recomputed, matches/mismatch).
    - B2 bucket + endpoint, Object Lock mode, retention period.
    - "How this works" paragraph explaining Genblaze + B2 Object Lock.
    - Link to Genblaze SDK and to Backblaze Object Lock docs.

### Verification flow server-side

In the page's RSC body:
1.  Load the `videos` row. If `manifestRunId` is null, render the red "no manifest" state.
2.  Fetch manifest JSON from B2 (`manifests/<videoId>/<runId>.json`) via a simple
    GetObject call with the S3 client (no signing needed if manifests are public; otherwise sign with long TTL).
3.  For the source and each placement's before/after key, call HeadObject to
    confirm Object Lock retention is set (check `x-amz-object-lock-mode` and
    `x-amz-object-lock-retain-until-date` response headers), and range-GetObject
    (or GetObject for small jpgs) to recompute SHA-256 and compare.
4.  For the MP4 source, range-read the first 1 MiB + last 1 MiB + every 20th MiB
    for a probabilistic hash (or a full read for small demo videos). Record in
    the manifest whether it's a partial or full hash.
5.  Pass a typed `VerifyResult` object to client components.

Signed URLs for the before/after images have a long TTL (24h) so the verifier
doesn't break when users share the link.

## 6. Disclosure copy (visible to viewers)

These strings are **required by regulation and by hackathon judging** — don't soften them.

### On the pause ad overlay (always visible while ad is shown)
> **AI Ad · {{brandName}}**<br/>
> This placement was generated by AI, approved by the creator, and cryptographically recorded.<br/>
> [Why? →](/verify/{{videoId}}#slot-{{slotId}})

### On search/chat sponsored cards
> **Sponsored** — content-matched brand, not user-targeted.

### On natural-break mid-rolls
> **Ad · {{brandName}}**  **Skip in Xs**

### /verify page top summary (success state)
> **Provenance verified.** Every AI-generated placement in this video has a SHA-256 hash recorded in a Genblaze manifest. The manifest is WORM-locked on Backblaze B2 in COMPLIANCE mode until **{{retainUntil}}** — it cannot be altered or deleted, even by BrandFrame.

### /verify "How it works" blurb
> BrandFrame uses [Genblaze](https://github.com/backblaze-labs/genblaze) to
> build an auditable manifest of every AI step it runs (ASR, scene detection,
> slot detection, brand match, FLUX inpainting, VL critic) and stores that
> manifest on [Backblaze B2](https://www.backblaze.com/cloud-storage) under
> Object Lock COMPLIANCE retention for 365 days. The manifest's SHA-256 is
> also embedded in the MP4's metadata, so a copy of the video carries its own
> provenance. Click any placement above to toggle before/after frames and see
> the critic score.

## 7. C2PA alignment (post-v1, noted in comments)

For the demo we don't implement full C2PA manifest JUMBF boxes, but the
architecture is designed to be upgrade-compatible:
- Our JSON manifest can be signed with an Ed25519 key (add to manifest Step in Phase 6 if time).
- A future pass can wrap the manifest in a C2PA assertion and write it into a
  `c2pa` MP4 uuid box instead of (or alongside) the `com_brandframe_manifest` atom.
- File a Genblaze GitHub issue: "C2PA/JUMBF manifest embedding for MP4" — Feedback Prize bait.

## 8. Testing verification

- Seed a demo video + one inpainted slot in dev, run ingest end-to-end, load
  `/verify/demo`, confirm green banner, hashes match, before/after slider works.
- Manually corrupt an object in B2 (upload a different file to an `afterKey`
  with governance temporarily lifted) and confirm the /verify page shows the amber state.
- Test "manifest deleted" path by pointing the page to a video with no
  manifestRunId — confirm red state renders without throwing.
