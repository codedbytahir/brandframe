# DECISIONS.md — Architecture Decision Records (ADRs)

When you make a decision that future agents would otherwise re-litigate, add it here.
Each entry has: context (why it was on the table), decision, consequences, date.

Keep entries chronological (newest at bottom). Format:

```
## ADR-NNN — Title
**Date:** YYYY-MM-DD
**Status:** accepted | superseded-by ADR-NNN | deprecated
### Context
…
### Decision
…
### Consequences / tradeoffs
…
```

---

## ADR-001 — Next.js only, no separate Python backend
**Date:** 2026-07-25
**Status:** accepted
### Context
The user initially said "never use fast api." We needed a server-side home for Genblaze (which is Python-only) and for signed-URL/auth/DB logic.
### Decision
Next.js 15 App Router is the only server. The Genblaze Python pipeline is invoked as a child process via `child_process.spawn`. No FastAPI, Express, Flask, or separate worker service for v1.
### Consequences
- Keeps deploy story simple (Vercel for Next; only one thing to ship).
- Genblaze is still usable (Python runs as CLI).
- Long-running spawns can be cold-start-sensitive on serverless; document that SSE/pipeline endpoints need Node serverful runtime; add Fly.io worker later if Vercel can't hold long-lived child processes.
- Cannot horizontally scale pipeline workers independently. Acceptable for a hackathon.

## ADR-002 — SQLite (libsql) + B2 + LanceDB-on-B2 — no Postgres/Redis/Pinecone
**Date:** 2026-07-25
**Status:** accepted
### Context
We needed stores for (a) relational metadata, (b) large binary assets, (c) vector+FTS index. Using a managed Postgres + Pinecone + S3 would mean three vendors and dilute the B2 story.
### Decision
- Libsql/SQLite local dev (Turso if we need production) for metadata.
- B2 for ALL binaries (source, HLS, keyframes, inpainted frames, manifests, brand assets, LanceDB files, tmp).
- LanceDB opened directly on B2 via s3fs for vectors+FTS.
### Consequences
- "B2 is the single source of truth" is a meaningful judging claim.
- Zero marginal infra cost (B2 free tier is enough for the demo).
- LanceDB on S3 has single-writer semantics — fine for ingest-only writes + read-mostly search.
- SQLite is fine for ≤100k videos; if we ever scale we can swap the libsql connection to Turso without code changes.

## ADR-003 — Single-frame pause ad (no per-frame re-render)
**Date:** 2026-07-25
**Status:** accepted
### Context
The user's original idea was to inpaint every frame of a video (like Rembrand does with Generative Fusion). That requires expensive video models (Veo/Kling) or per-frame diffusion that would cost dollars per placement and risk uncanny-valley artifacts.
### Decision
V1 pause ads are a **single AI-generated frame** shown only when the video is paused at an in-scene slot. The video underneath continues from the original frames when play resumes.
### Consequences
- Cost ~$0.05/placement instead of $5–50.
- Inpaint is just FLUX fill on one frame — fast, high quality, easy to critic with a single VL call.
- Less magical than continuous in-content placement, but the disclosure/verification story becomes stronger because "the underlying content was never altered, only a paused overlay was shown."
- Removes the need for video generation models entirely.
- V2 can add multi-second video inpaint once the basics are proven.

## ADR-004 — Three ad layers with strict caps; reject "100 ads / 10 min"
**Date:** 2026-07-25
**Status:** accepted
### Context
User initially proposed 100 ad slots per 10-minute video (one every 6 seconds) to maximize density.
### Decision
Three layers with strict caps:
- Layer 1 (intent overlay): max 1 per query.
- Layer 2 (natural-break mid-roll): max 1 per 3 minutes, never first 60s.
- Layer 3 (in-scene pause ad): max 1 per 3–5 minutes.
All ads 6s-skippable (Layers 1/3 skip immediately).
### Consequences
- Demo is watchable; judges don't bounce.
- FTC disclosure still clean (one obvious "AI Ad" per viewing session is enough to prove the feature).
- Leaves room for "our ad density is low because we respect viewers" as a product talking point.

## ADR-005 — Inanimate-object slots only, MediaPipe face/hand rejection, policy denylist
**Date:** 2026-07-25
**Status:** accepted
### Context
Inpainting on/around people raises likeness rights, safety, and uncanny-valley risks; Chinese AI ad-tech faced an April 2026 ban on unauthorized actor likeness/voice use.
### Decision
Slot detection is restricted to an allowlist of 8 inanimate surfaces (mug, laptop_lid, can, bottle, blank_sign, cereal_box, book_cover, screen). MediaPipe face/hand detection rejects any bbox that overlaps a person. Content-policy denylist blocks child/political/health/alcohol/tobacco/gambling/regulated-finance content.
### Consequences
- Safe, respectful defaults. Strong narrative for judges ("we said no to the creepy version").
- Fewer slots per video (acceptable given caps in ADR-004).

## ADR-006 — Hybrid RAG: 0.5 BGE-M3 dense + 0.2 BM25 + 0.3 CLIP, cross-encoder rerank
**Date:** 2026-07-26
**Status:** accepted
### Context
Intra-video search needs to find answers by text, by visible thing, and by exact phrase. Vector-only search is bad at exact phrases; BM25-only is bad at semantic matches; visual-only misses conceptual queries.
### Decision
Three vectors per chunk (BGE-M3 dense, BGE-M3 sparse/BM25, CLIP visual). Weighted linear fusion (0.5/0.2/0.3) of min-max-normalized scores, top-20 → bge-reranker-v2-m3 cross-encoder → top-5.
### Consequences
- Tunable weights; no magic.
- Requires storing 3 vectors per chunk (storage cost trivial at demo scale).
- Cross-encoder reranker is small (bge-reranker-v2-m3 ≈ 500MB) and runs locally; can be swapped for NIM-hosted if local perf is bad.
- Why these weights: dense text is the primary signal in a tutorial corpus (people ask questions like "how do I center a div"), BM25 catches exact-keyword matches that dense misses, and CLIP boosts visual moments (e.g., "whiteboard", "diagram").

## ADR-007 — Manifest retention 365 days COMPLIANCE on manifests, 365 GOVERNANCE on inpainted frames
**Date:** 2026-07-26
**Status:** accepted
### Context
We needed to make the "provable AI alteration" story real.
### Decision
- Manifests: B2 Object Lock COMPLIANCE mode, 365 days — can't be shortened or deleted by anyone.
- Inpainted frames: GOVERNANCE mode 365 days — can be removed by root key with special action (so we can respond to takedowns), but normal deletes are blocked.
### Consequences
- Strongest possible "we can't rewrite history" claim for the manifest (anchor of trust).
- Flexibility on inpainted frames for legal takedowns / creator opt-outs.
- Bucket must be created with Object Lock ENABLED. One-shot decision at setup time.

## ADR-008 — No auth in v1; demo user cookie
**Date:** 2026-07-26
**Status:** accepted
### Context
Full NextAuth takes time and isn't core to the judging criteria; we have 9 days.
### Decision
Skip real auth. On first Studio visit, generate a demo user and set a cookie. All demo videos are owned by that user. Seeded demo content is public.
### Consequences
- Saves ~1 day of work.
- Brand portal features under creator/brand roles are stubbed.
- Add NextAuth in Phase 7 only if time.

## ADR-009 — Inpaint runs at ingest time with post-hoc reject (not preview-then-approve)
**Date:** 2026-07-26
**Status:** accepted
### Context
The ideal flow is: detect → show preview inpaint → creator approves → do the expensive final inpaint. That requires running inpaint twice or using a cheap-preview model, which adds complexity.
### Decision
For v1/demo, inpaint runs on ingest for slots from pre-approved brands and `status='filled'` is set after critic passes. Creators can reject after the fact (hides the ad on future views), which is a simpler double-opt-in for demo purposes.
### Consequences
- Higher wasted inpaint cost on slots the creator would have rejected, but for 5 seeded videos × ~2 slots each this is <$5.
- Simpler pipeline (no human-in-the-loop gating before inpaint).
- Will be replaced by preview-then-approve post-hackathon.

## ADR-010 — Logging protocol: JSONL to stdout from Python, SSE fans out to browser
**Date:** 2026-07-26
**Status:** accepted
### Context
We needed Next.js to surface live pipeline progress to the browser without a job queue or Redis pub/sub.
### Decision
Python writes one JSON object per line to stdout (`_log(event, …)`). Node's `runIngestPipeline` splits on newlines and calls `onLog`. The SSE endpoint keeps an in-memory per-video ring buffer and tails new lines to the browser. stderr is prefixed `[stderr]` and forwarded for debugging.
### Consequences
- No extra infra. Works on a single server instance.
- In-memory buffer doesn't survive Next.js restarts; acceptable for v1 (demo can be re-run). The pipeline can also write a sidecar log to B2 `tmp/<videoId>/pipeline.log` for restart recovery if needed.
- If we later deploy to Vercel, SSE + long-lived spawn may require a separate Node server (Fly.io). Document this but don't implement until it's a real problem.
