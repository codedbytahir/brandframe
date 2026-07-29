# 09 — Ad Engine (three layers)

BrandFrame serves ads through three layers. Each layer has its own trigger,
cap, disclosure, and UX. None of them are "interrupt-every-6-seconds"
pre/mid/roll spam (the user's original "100 ads per 10 minutes" idea was
rejected for UX, FTC-disclosure, and hackathon-quality reasons).

## 0. Guiding principles

1.  **Every ad is AI-assisted**, and every AI-generated creative is:
    - disclosed to the viewer (`AI Ad · Why?` badge, visible at all times the ad is shown),
    - recorded in a Genblaze manifest,
    - WORM-locked on B2 (365 days COMPLIANCE for manifests, 365 days GOVERNANCE for inpainted frames),
    - approved by the creator (brand allow-list + per-placement approval),
    - visible on the public `/verify` page.
2.  **No person/face/hand/skin is ever altered or overlaid.** MediaPipe
    face+hand detection rejects slots.
3.  **Content policy block:** slots are not filled on chunks whose
    transcript/topic hits any of: children (kids cartoons, "for kids", toy
    unboxings targeting <13), political content (campaigns, elections,
    candidates), health/medical (drugs, symptoms, treatment, telehealth),
    alcohol/tobacco/cannabis, gambling, regulated finance (payday loans,
    crypto get-rich-quick), weapons, adult content. This is a simple keyword + topic-classifier
    check in the slots Step.
4.  **Skip after 6s** (overlays and mid-rolls) or immediately (pause ads — clicking
    Skip or pressing Resume resumes playback and records an `ad_skipped` event for audit).
5.  **Caps per video:** Layer 1 — one per user query (not per video); Layer 2 —
    one per 3 min (never first 60s); Layer 3 — one per 3–5 min.

## 1. Layer 1 — Intent overlay cards (search/chat)

**Trigger:** when a user's search query or chat message has high textual
similarity to a brand's `text_vec` (BGE-M3 embedding of brand name + categories
+ copy) AND high similarity to at least one segment. Example: "how do I track
runs on iPhone" matches a running-watch brand whose packshot appears on a desk
in a tutorial.

**Where:** in the search results page, above the organic hit list but below the
AI Overview (clearly labeled "Sponsored"), and in chat as a small "Sponsored"
card below the assistant answer.

**Data needed at query time:**
- Top-3 organic search hits (from RAG).
- Top-1 brand match (CLIP+text) scored against the query AND against the surface
  labels visible in top-3 hits (so we don't show a laptop-skin brand for a coffee-mug video).

**UX:**
- Card `border-l-4 border-brand`, badge `Sponsored` (outline, muted), logo,
  1-line copy, "Learn more" → `targetUrl`.
- One card per query max. If score < 0.3, don't show anything.
- Click-through is tracked (v1: console log, v2: `placement_events` table).

**Disclosure:** word "Sponsored" is mandatory on the card (FTC "clear and conspicuous" standard).

## 2. Layer 2 — Natural-break mid-rolls

**Trigger:** server-detected "natural break points" computed by the pipeline and stored in
the `breaks` table.

**Break score (computed in Python from ASR + scene data):**

```
score = w1 * scene_cut_strength
      + w2 * silence_duration_ms / 1000
      + w3 * topic_similarity_drop     # 1 - cosine(embedding[t], embedding[t-30s])
      - w4 * mid_sentence_penalty      # large negative if break is inside a sentence
```

Default weights: `w1 = 0.4, w2 = 0.3, w3 = 0.2, w4 = 0.5` (tunable).
Threshold for eligibility: `score ≥ 0.55`.

**Caps:**
- No mid-roll in the first 60 seconds of the video.
- Minimum 180s between any two mid-rolls.
- Maximum 1 per 3 min.
- Greedy selection: sort eligible breaks by score descending, accept if ≥180s from last accepted, until score falls below threshold.

**Creative:** for v1 demo, mid-rolls use uploaded brand creatives (jpg/mp4 in
`brands/<id>/creatives/`) — NOT AI-generated. Pick the brand that best matches
the video's topic/categories (same brand-match as Layer 3, but text-only).

**UX (player):**
- When player's `timeupdate` reaches a break timestamp (±400ms), pause video, show
  mid-roll card on top: brand creative (jpg or short mp4), "Ad · <brand>" label,
  "Skip in 6" countdown → "Skip" button after 6s.
- Click on the creative opens `targetUrl` in new tab.
- After skip or after creative finishes (jpg: 8s; mp4: length of creative capped at 15s), resume playback from break point.
- An "AI Ad · Why?" link is NOT needed here (creative is supplied, not generated), but
  do show a "Sponsored" badge.

## 3. Layer 3 — In-scene "pause ad" (the novel hackathon bit)

This is the product's hero feature and the strongest driver of scores on B2/Genblaze.

### 3.1 Slot detection (pipeline `slots` Step — see §07 §4.8)

- Runs Qwen-VL (JSON mode) on every keyframe asking for bboxes of inanimate object
  surfaces from the allowlist:
  `mug | laptop_lid | can | bottle | blank_sign | cereal_box | book_cover | screen`.
- Post-filter with MediaPipe FaceDetection + HandDetection; reject bbox if any
  IoU with a detected face/hand is > 0.05 (conservative — better to miss a slot than to risk altering a person).
- Confidence ≥ 0.6; surface+lighting labels captured for the inpaint prompt.
- Spacing: one slot per 180–300s of video (choose highest-confidence slot in each window).
- Topic/content-policy denylist applied.

### 3.2 Brand match (pipeline `brand-match` Step — §07 §4.9)

- CLIP similarity between the cropped slot image and each brand's pre-computed
  `clip_vec` packshot.
- Category compatibility matrix (mug/cup → beverages; laptop_lid/screen → tech/software;
  cereal_box/snack → snack food; blank_sign/book_cover → any; bottle → beverage/personal-care).
- Brand `unsafeCategories` respected.
- Score threshold: ≥ 0.28, else leave unassigned.
- For v1 demo with 5 seeded brands, allow at most one brand per video to keep it simple
  (choose highest-scoring across all slots).

### 3.3 Creator approval (double opt-in)

1.  **Brand allow-list** — each creator selects which brands may place ads in
    their videos (Studio → Monetization → Brands UI; for demo seed the creator
    with all 5 seeded brands opted in).
2.  **Per-placement approval** — slots enter Studio with status `pending`;
    creator sees before/after thumbnails (wait — `afterKey` is set by inpaint,
    which hasn't run yet. Solution: run a **mock low-quality inpaint first as
    a preview** (cheap flux-schnell), show that, then on approval do the
    pro inpaint. For v1/demo we shortcut: run inpaint immediately on ingest,
    set status to `filled`, and the creator can **reject** after the fact
    (which hides the ad on future views and logs rejection — simpler for the demo).
    Track this decision in DECISIONS.md.

### 3.4 Inpaint + Critic (§07 §4.10–§4.11)

- FLUX.1-fill-pro inpaint of the bbox region only; prompt like
  `"photorealistic <brand product name> on a <surface>, <lighting> lighting, same camera angle, no text artifacts"`.
- Genblaze `AgentLoop` VL critic on 5-point rubric (object identity, lighting,
  artifacts, plausibility, person-alteration guard). Score ≥ 4 required; retry
  once with feedback; else drop the slot.
- Output: full-frame JPG where only the bbox region is replaced
  (`assets/<id>/inpainted/<slotId>.jpg`).

### 3.5 Player UX (pause ad)

This is the surface the viewer actually sees. Implement in
`src/components/player/player.tsx`.

- When `timeupdate` reaches a slot `timestampMs` (±400ms):
  1. Pause the video.
  2. Freeze on the original frame, then crossfade (200ms) to the inpainted frame overlaid on top (or swap the `<video>` element's `poster` to the inpainted key and hide the video behind an `<img>`).
  3. Render a centered dark overlay card with:
     - Top-right: `Sparkles` badge **"AI Ad · <Brand name>"** + `Info` "Why?" link → `/verify/<videoId>#slot-<slotId>`.
     - Center: brand logo (small, not intrusive), 1-line brand copy.
     - Bottom: "This scene contains an AI-generated placement. We disclosed it, approved it, and locked the record." (short).
     - Primary button: `Play · Skip ad` (resumes to original video immediately). Secondary: small "Learn more" → targetUrl.
     - Countdown: no forced-watch; Skip is available immediately (better UX; FTC doesn't require forced watch for disclosed AI placements).
  4. On Resume:
     - Fade the overlay out (200ms), seek video to `timestampMs` (same frame), play; the
       video continues from the real (non-inpainted) frames. The ad is a single paused
       frame, NOT a continuous re-render. This is the key cost/quality control.
  5. Record impression event (v1: console.log).
- Pause ads are never stacked (if both mid-roll and pause-ad fall within 10s of
  each other, choose the pause ad; it's the hero feature).

### 3.6 Before/after disclosure

On `/verify/<videoId>` each filled slot shows:
- Thumbnail slider comparing before/after frames.
- Critic score.
- Which model filled it (FLUX.1-fill-pro on GMI).
- Creator approval timestamp.
- Manifest hash link (anchored deep link to the placement in the manifest JSON).

## 4. Ad selection at playback time

A tiny "cue planner" (server-side, in a Server Component or in `/api/playback`)
builds the list of cues to send to the player:

```ts
type Cue =
  | { kind: "midroll"; ms: number; brandId: string; creativeUrl: string }
  | { kind: "pausead"; ms: number; slotId: string; afterKey: string; brandId: string; copy: string; logoUrl: string; targetUrl: string }
  | { kind: "chapter"; ms: number; label: string }
  | { kind: "overlay"; ms?: never; trigger: "query"; brandId: string; copy: string };
```

For v1, compute this on the server when the watch page loads (RSC) based on
`breaks` and `ad_slots` tables. No client-side auction.

## 5. Brand portal (Phase 5 stretch, seeded for demo)

Even if we don't build the full brand portal UI by submission, we need:
- `scripts/seed-brands.ts` that inserts 5 mock brands into the DB (Nestlé coffee mug,
  Huawei laptop, Coca-Cola can, a fake SaaS sticker pack, a fake cereal brand) and uploads
  their logos/packshots to `brands/<id>/`.
- Brand metadata: name, categories, copy, targetUrl (can be brand site or "#"),
  pre-computed CLIP text/visual vectors.

## 6. Non-goals (explicitly out of scope)

- Programmatic real-time ad auction / RTB.
- Per-user targeting (we don't track viewers for v1 — ads are contextual to the video content only).
- Per-frame video inpainting (Veo/Kling-style). V1 is single-frame pause, which is
  cheaper, faster, and less uncanny.
- Dynamic ad insertion into HLS (server-side ad stitching). Our ads are all
  client-side overlays, which is simpler and keeps B2/HLS as pure content.
- Monetization payouts / revenue split UI (would come post-hackathon).

## 7. Regulatory note (for copy / /verify)

- **FTC 16 CFR Part 255** (endorsements & testimonials): the "Sponsored" / "AI Ad"
  labels satisfy disclosure for material connection.
- **C2PA / YouTube 2026 AI labels (May 27, 2026):** the Genblaze manifest + MP4
  embedding is our equivalent of C2PA content credentials, and we plan to add
  C2PA manifest generation post-v1. The `/verify` page is our public disclosure.
- **EU AI Act:** AI-generated ads in video must be disclosed; our disclosure is
  visible and persistent, satisfying the transparency tier for generative content.
