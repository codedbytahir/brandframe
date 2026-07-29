# 06 — API Routes & Server Actions

All network-exposed endpoints are either **Next.js Route Handlers** (in
`src/app/api/**/route.ts`) or **Server Actions** (co-located with components or
under `src/app/_actions/`). No other servers.

Every endpoint with a request body must be validated by **Zod**. All endpoints
return **JSON** (except SSE, HLS playback, and binary assets).

## 1. Route Handlers

### 1.1 `POST /api/upload` — presign a direct-to-B2 PUT

Called by the upload form after the user selects a file. Returns a short-TTL
signed URL the browser uses for the upload.

**Request (JSON):**
```ts
z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().regex(/^video\//),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024 * 1024), // 5 GB cap for v1
  title: z.string().min(1).max(200).optional(),
});
```

**Response 200:**
```ts
{
  videoId: string;           // "vid_abc123"
  uploadUrl: string;         // presigned B2 PUT URL
  key: string;               // "uploads/vid_abc123/source.mp4"
  expectedContentType: string;
  expiresAt: string;         // ISO time, ~15min
}
```

**Implementation notes:**
- Generate `videoId` via `shortId("vid")`; insert `videos` row with `status='uploaded'` only **after** the webhook confirms the object exists (see 1.2). For now insert with `status='uploaded'` here, and let webhook transition to `processing`.
- Use `@aws-sdk/s3-request-presigner` `getSignedUrl` with `PutObjectCommand` for 900s TTL.
- ACL: `private`; do not set public-read.
- Set `B2_ENDPOINT` / region / forcePathStyle as in `lib/b2/client.ts`.

### 1.2 `POST /api/webhook/b2` — B2 Event Notification receiver

B2 calls this on `ObjectCreated: uploads/*`. It's the trigger that kicks off processing.

**Request (JSON):** B2 Event Notification payload (matches S3 event shape):
```ts
z.object({
  eventName: z.string(),        // e.g. "ObjectCreated:Put"
  objectName: z.string(),       // "uploads/vid_abc123/source.mp4"
  bucketName: z.string(),
  size: z.number().int().optional(),
  contentType: z.string().optional(),
  eventTime: z.string().optional(),
  // ... other fields ignored
});
```
(Allow extra keys; B2 payload may evolve.)

**Response 200:** `{ received: true }` within 3 seconds. Spawn the pipeline asynchronously — **do not await it in the handler** (B2 webhooks have short timeouts).

**Behavior:**
1. Parse `videoId` from key (`uploads/<videoId>/source.<ext>`).
2. Update `videos.status = 'processing'` (DB).
3. Call `runIngestPipeline({ videoKey: objectName, onLog })` — do NOT await; tee logs to a per-video in-memory buffer (or to B2 `tmp/<videoId>/pipeline.log`) so the SSE endpoint can replay.
4. Wrap in try/catch; on error set `videos.status='failed'`, `videos.errorMsg=err.message`.

**Security (v1 — tighten in Phase 6):**
- Check `User-Agent` starts with `BackblazeB2/`.
- Optional (if we have time): shared-secret HMAC signature header; document but skip for demo.

### 1.3 `GET /api/pipelines/[videoId]` — SSE progress stream

Studio UI subscribes during upload/pipeline to render step progress.

**Request:** `GET /api/pipelines/vid_abc123`

**Response:** `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`.
Event stream replays existing buffered JSONL lines and then tails new ones until
`pipeline.done` or `pipeline.failed`.

Each `data:` line is a JSON object matching the Python `_log` schema:
```jsonc
{
  "event": "pipeline.start" | "step.start" | "step.ok" | "manifest.built" | "pipeline.done" | "pipeline.failed",
  "ts": 1729000000.123,
  // event-specific fields
}
```
Send a `: ping\n\n` comment every 15s to keep the connection alive. End the
stream when `pipeline.done` / `pipeline.failed` is observed.

### 1.4 `GET /api/search` — semantic search (optional; can also be a Server Action)

Because the homepage uses a plain `<form action="/search" method="get">`, the
`/search` page is an RSC that calls search directly. This API route exists for
client-side typeahead (Phase 4 stretch).

**Querystring:** `?q=...&limit=5`

**Response 200:**
```ts
{
  query: string;
  hits: Array<{
    videoId: string;
    videoTitle: string;
    startMs: number;
    endMs: number;
    snippet: string;      // HTML-safe, with <mark> around query terms
    score: number;
    keyframeUrl: string;  // signed B2 URL
  }>;
}
```

### 1.5 `POST /api/chat` — Vercel AI SDK streaming chat

Streams assistant tokens with embedded timestamp citations.

**Request (JSON):**
```ts
z.object({
  videoId: z.string(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string()
  })),
});
```

**Response:** Vercel AI SDK `streamText` response (data stream protocol).

**Behavior (server):**
1. On each new user message, retrieve top-5 segments (RAG call to `lib/rag/search`, scoped to the video, with cross-encoder rerank).
2. Build a system prompt listing the segments with ids and timestamps:
   ```
   You are a helpful assistant answering questions about a video.
   Use ONLY the provided segments. When you reference a moment, emit a
   citation tag exactly as:
     <ts ms="{start_ms}" seg="{seg_id}">{human label, e.g. "3:48"}</ts>
   Segments:
   [seg_abc | 3:20–3:45] ...transcript...
   ```
3. Stream the response with `ai/react` `useChat` on the client.
4. Client parses `<ts …>` tags and renders clickable chips that call `seekTo(ms)`.

### 1.6 `GET /api/playback/[videoId]` — signed HLS URL

Player calls this to get a signed URL for `master.m3u8` (and optionally for
segments — simpler: sign the master with a long TTL and make prefix public-read
for demo; or use B2 signed URL auth on whole prefix).

**Response 200:**
```ts
{ hlsUrl: string; posterUrl: string; expiresAt: string; }
```

If `videos.status !== 'ready'`, return `409 Conflict` with `{ status: string, progress?: number }`.

### 1.7 `POST /api/slots/[slotId]/approve` — creator approves/rejects a slot

Server Action (also exposed as POST) called from the Studio pending-slots UI.

**Request:** `{ action: "approve" | "reject", reason?: string }`
**Response 200:** `{ ok: true, slot: SerializedAdSlot }`

Updates `ad_slots.status` to `approved`/`rejected`. Once approved, the inpaint
Step (or an on-demand inpaint for v1) generates the pause frame and sets
`afterKey` + `status='filled'`.

### 1.8 (stretch) `GET /api/brands`, `POST /api/brands`, etc. — brand portal

Self-explanatory CRUD; add only if Phase 5 has time. Seed 5 mock brands via a
script (`scripts/seed.ts`) so demo works without brand-portal UI.

## 2. Server Actions

Server Actions are for form submissions and mutations where you don't need a
custom client-side fetch. Use them for:

| Action | Location | Purpose |
|---|---|---|
| `createVideo(videoId, title)` | `src/app/_actions/videos.ts` | Initial row insert after upload |
| `approveSlot(slotId, action)` | `src/app/_actions/slots.ts` | Creator approval (same as 1.7 — pick one) |
| `retryPipeline(videoId)` | `src/app/_actions/pipelines.ts` | Re-trigger ingest on failure |
| `deleteVideo(videoId)` | `src/app/_actions/videos.ts` | Delete row + schedule B2 delete (lifecycle or explicit) |

Actions return `{ ok: true } | { ok: false, error: string }`. Use `revalidatePath("/studio")` after mutations.

## 3. SSE / streaming conventions

- Content-Type: `text/event-stream`; flush with the `TransformStream` pattern recommended by Next.js docs.
- Every event: `event: <name>\ndata: <json>\n\n`. We mostly use `event: message` (implicit default) with a `data.event` field — pick one and be consistent; **default to message event with a JSON `event` field inside `data`** (matches the Python JSONL shape).
- End the stream cleanly on client disconnect (`request.signal.addEventListener('abort', ...)`).

## 4. Error response shape

All non-streaming errors:
```ts
{ error: string;           // short human message
  code?: string;           // machine-friendly e.g. "VIDEO_NOT_READY"
  details?: unknown;       // debug info (only in dev)
}
```
Status codes:
- 400 — Zod validation error (`error: 'Invalid request'`, `details: zod.flatten()`)
- 401/403 — not used in v1 (no auth)
- 404 — resource not found
- 409 — state conflict (e.g. video not ready, pipeline already running)
- 413 — payload too large (file >5GB)
- 500 — unhandled error (log server-side, return generic message)

## 5. Public pages (non-API)

| Path | Type | Auth | Purpose |
|---|---|---|---|
| `/` | RSC | public | Marketing/hero + search bar |
| `/search?q=...` | RSC | public | AI Overview + results (calls `lib/rag/search` server-side) |
| `/studio` | RSC | demo user | Creator studio (upload + list) |
| `/studio/slots` | RSC | demo user | Pending approval queue |
| `/watch/[videoId]?t=<ms>` | RSC | public | Player + chapters + chat |
| `/verify/[videoId]` | RSC | public | Provenance verifier (public trust anchor) |
| `/brands` (stretch) | RSC | demo user | Brand portal |

## 6. Edge vs Node runtime

- Default **Node runtime** for all routes (LanceDB, native deps, Python spawning require it).
- Do **not** set `export const runtime = 'edge'` on any route that talks to SQLite,
  LanceDB, or spawns Python — Edge runtime cannot do those things.

## 7. CORS / cache headers

- API routes default to no-cache (`cache: 'no-store'`) for mutations.
- SSE sets `no-transform` so proxies don't buffer.
- Public pages are static where possible; dynamic pages (watch, verify, studio) set `revalidate = 0` or rely on Next defaults for dynamic RSCs.
