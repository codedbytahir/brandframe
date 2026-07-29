# 00 — Project Brief

## 1. What is BrandFrame?

BrandFrame is an **AI-native long-form video platform** purpose-built for the
**Backblaze Generative Media Hackathon** (Aug 3, 2026 · 5pm EDT deadline).
It combines three things that existing YouTube/TikTok/etc. don't do well together:

1.  **Timestamped semantic search** — jump to the exact second that answers a question, across a whole library.
2.  **Chat-with-video** — ask follow-ups against an AI overview grounded in transcribed + visual chunks.
3.  **Provenance-tracked in-scene "pause ads"** — AI replaces inanimate objects in the frame (mug → brand can, laptop lid → brand laptop) on a single paused frame, with:
    - Visible "AI Ad · Why?" disclosure
    - Creator double-opt-in (brand allow-list + per-placement approval)
    - Cryptographic Genblaze manifest embedded in the MP4 and WORM-locked on B2 for 365 days
    - Public `/verify/[id]` page that re-checks hashes

The product exists primarily to **win the hackathon**, but the architecture is
real (Next.js 15 + Genblaze + B2 + LanceDB) and could be extended into a real
product post-submission.

## 2. The hackathon

| Field | Value |
|---|---|
| Name | Backblaze Generative Media Hackathon |
| Deadline | **Aug 3, 2026 5:00 PM EDT** = **Aug 4, 2026 2:00 AM PKT** |
| Prizes | $7k / $2k / $1k + Feedback Prize (best Genblaze issues) |
| Submission | Devpost: working URL + public/private repo (add `b2genblaze` collaborator) + provider list + ≤3 min demo video |
| Rules | https://backblaze-generative-media.devpost.com/rules |
| Eligibility | Pakistan is NOT an excluded region; age of majority 18+ (user is eligible) |
| GMI credits | First 270 eligible submitters (we are early) |

### Judging criteria (4-way equal weight, tiebreak in this order)
1.  **Utility** — real problem, works end-to-end, not a toy.
2.  **Production-readiness** — code quality, error handling, architecture that scales past the demo.
3.  **Backblaze B2 usage** — *meaningful* use: Object Lock, Event Notifications, Lifecycle Rules, signed URLs, S3-compatible API. Just dumping files doesn't score.
4.  **Genblaze SDK usage** — *meaningful* use: Pipeline/Step/Manifest/AgentLoop/ObjectStorageSink/EmbedPolicy, not just a trivial wrapper.

Tiebreak order (per rules): **Utility → Production → B2 → Genblaze**.
BrandFrame scores **10 / 8 / 10 / 10** on this rubric (Production slightly lower
because it's a hackathon demo; the other three are maxed by design).

## 3. Core product pillars (for demo)

1.  **Upload works end-to-end** — signed PUT → B2 Event Notification → Genblaze ingest → HLS + index.
2.  **Search returns timestamped hits** with an AI Overview card citing timestamps.
3.  **Chat-with-video streams** answers with clickable "Jump to 3:48" chips.
4.  **In-scene pause ad triggers at the right moment** with disclosure + "Why?" link.
5.  **Verify page proves it** — shows Genblaze manifest hash, Object Lock retention, before/after thumbnails.
6.  **3-minute demo video** scripted in `../brandframe-srs.html` §11 walks every pillar.

## 4. Hard constraints (non-negotiable)

- **Stack: Next.js 15 ONLY on the server.** No FastAPI, no Express, no separate Python web server.
  The Genblaze Python SDK is invoked from Next.js via `child_process.spawn` (see `src/lib/pipelines/run.ts`).
- **No copying reference samples verbatim.** The Backblaze samples (video-semantic-search,
  personal-video-ai-search, video-to-insights, lance-multimodal-search, genblaze-*-sample)
  are for *reference architecture only*.
- **Every AI ad placement is disclosed and provenanced.** No "stealth" inpainting. This is
  both a product differentiator and an FTC/C2PA compliance requirement.
- **Inanimate-object slots only** (mug, laptop_lid, can, bottle, blank_sign, cereal_box,
  book_cover, screen). MediaPipe face/hand detection rejects any bbox that overlaps a person.
- **Content-policy blocks** for child-directed, political, health/medical, alcohol/tobacco,
  gambling, and regulated-finance content.
- **V1 in-scene ads are SINGLE-FRAME PAUSE**, not per-frame re-render. This keeps cost
  (~$0.05/placement) and latency within hackathon budget and avoids uncanny valley.

## 5. Ad-layer caps (already decided, do NOT revisit)

The user's original "100 ads per 10 minutes" idea was rejected. Three layers with strict caps:

| Layer | Type | Cap | Trigger |
|---|---|---|---|
| 1 | Intent overlay card | max 1 per query/chat turn | User asks a brand-relevant question |
| 2 | Natural-break mid-roll | max 1 per 3 min, *never* in first 60s | Weighted score: `w1·scene_cut + w2·silence + w3·topic_shift − w4·mid_sentence` |
| 3 | In-scene pause ad | max 1 per 3–5 min | VL-detected inanimate slot + CLIP brand match + critic pass |

All layers: 6-second skip after which the ad is suppressed for that slot in future views.

## 6. Reference reading for agents

- **SRS (full):** `/home/user/brandframe-srs.html` — IEEE-830 style with 30 cited references.
- **Research docs** (in `/home/user/`, not in repo): `open-source-genai-media-b2-genblaze.md`,
  `hackathon-battle-plan.html`, `social-ai-cn-adtech-research.html`, `brandframe-idea-validation.html`.
- **Genblaze SDK:** https://github.com/backblaze-labs/genblaze (MIT, v0.6.0, released July 22, 2026)
- **B2 docs:** https://www.backblaze.com/cloud-storage — endpoint `s3.<region>.backblazeb2.com`,
  public URL `https://f<NNN>.backblazeb2.com/file/<bucket>/<key>`.
- **Key competitor (inspiration only, not copy):** Rembrand — raised $23M Series A
  (Greycroft/UTA/L'Oréal BOLD), "Generative Fusion" physics-informed in-scene ads;
  B2B-enterprise, no self-serve, no built-in disclosure/provenance.

## 7. What "done" looks like by submission

- [ ] `npm run dev` boots cleanly; `npm run typecheck` passes.
- [ ] 5 CC-licensed demo tutorials pre-ingested; 5 mock brands in DB.
- [ ] Signed upload → webhook → ingest → HLS plays in the browser.
- [ ] Search returns real timestamped hits from LanceDB-on-B2.
- [ ] AI Overview and Chat stream via Vercel AI SDK with timestamp chips.
- [ ] At least one in-scene pause ad fires with disclosure → /verify shows manifest.
- [ ] 3-min demo video recorded and linked.
- [ ] Devpost submission drafted with providers list.
- [ ] 3–5 high-quality Genblaze GitHub issues filed (Feedback Prize hedge).
