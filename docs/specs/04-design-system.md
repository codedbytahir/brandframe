# 04 — Design System & UX

BrandFrame is a **developer-tool / creative-pro tool**, not a consumer social app.
The aesthetic is: **dark-first, high-contrast, orange (B2 brand) accent, geometric,
monospace used for technical metadata (timestamps, hashes, IDs).**

## 1. Brand colors

All colors are exposed as CSS variables in `src/app/globals.css` and mapped through
`tailwind.config.ts`. Never hard-code hex/HSL outside this spec.

### Semantic palette (dark theme default)

| Token | HSL | Tailwind class | Usage |
|---|---|---|---|
| `--background` | `20 20% 6%` (≈ `#0f0b09`) | `bg-background` | Page background |
| `--foreground` | `30 10% 95%` | `text-foreground` | Body text |
| `--card` | `20 18% 9%` | `bg-card` | Card surfaces |
| `--card-foreground` | `30 10% 95%` | `text-card-foreground` | Card text |
| `--muted` | `20 12% 15%` | `bg-muted` | Chips, skeletons, idle progress tracks |
| `--muted-foreground` | `25 6% 55%` | `text-muted-foreground` | Secondary labels, meta text |
| `--border` | `20 10% 20%` | `border-border` | Dividers, input outlines |
| `--input` | `20 10% 20%` | `border-input bg-background` | Form fields |
| `--primary` | `18 88% 54%` (#f15a22) | `bg-primary text-primary-foreground` | Primary CTAs, progress fill, hero dots |
| `--primary-foreground` | `0 0% 100%` | | Text on primary |
| `--secondary` | `20 12% 18%` | `bg-secondary text-secondary-foreground` | Secondary buttons |
| `--accent` | `20 25% 22%` | `bg-accent` | Hover/selected |
| `--destructive` | `0 72% 51%` | `bg-destructive` | Errors, rejected-slot states |
| `--ring` | `18 88% 54%` | `ring-ring` | Focus outlines |
| `--radius` | `0.75rem` | — | Default border radius (12px) |

### Brand accent variants (non-CSStoken Tailwind colors)

| Name | Hex | Use |
|---|---|---|
| `brand.DEFAULT` | `#f15a22` | Brand dot, "BrandFrame" wordmark emphasis, primary CTAs |
| `brand.soft` | `#ff7a45` | Gradient stops, hover state |
| `brand.dim` | `#7a2e09` | Deep brand for pressed/active |

A white/surface-style light theme can be toggled via `next-themes` but defaults dark
(we ship `.dark` on `<html>` in `layout.tsx`). Add light tokens to `globals.css` under
`.light { … }` if Phase 7 has time.

## 2. Typography

| Role | Face | Size | Weight | Tracking |
|---|---|---|---|---|
| Display / h1 | Inter | 48–56px (`text-4xl md:text-5xl`) | 700 | `-0.02em` |
| h2 | Inter | 30px (`text-3xl`) | 600 | `-0.01em` |
| h3 / Card title | Inter | 18px (`text-lg`) | 600 | 0 |
| Body | Inter | 14px (`text-sm`) | 400 | 0 |
| Small / meta | Inter | 12px (`text-xs`) | 500 | `0.01em` |
| Code / timestamps / hashes | JetBrains Mono | 13px | 400 | 0 |
| Buttons | Inter | 14px | 500 | 0 |

Line heights:
- Body: `leading-relaxed` (≈1.6)
- Headings: `leading-tight` (≈1.15)

Use `prose` classes only if you add `@tailwindcss/typography` (not installed for v1).

## 3. Icons

- **Set:** lucide-react. Use stroke (default, 2px). Icons are 16px for inline, 20px for buttons, 24px for hero/CTA.
- **Icon vocabulary (stick to these; don't swap in synonyms):**
  - Play/Pause/Skip/Volume: `Play`, `Pause`, `SkipForward`, `Volume2`
  - Search: `Search`
  - Upload: `Upload`
  - Verified/lock: `ShieldCheck`, `Lock`
  - Ad disclosure: `Sparkles` (AI) + `Info` (why)
  - AI Overview: `Wand2` or `Sparkles`
  - Chat: `MessageSquare`
  - Studio/Videos: `Film`, `Clapperboard`
  - Alerts/warnings: `AlertTriangle`, `AlertCircle`, `CheckCircle2`, `XCircle`
  - Brand portal: `Store` or `Briefcase`
- Always pair an icon with a text label on first render; icon-only buttons need `aria-label`.

## 4. Components (existing and planned)

See `src/components/ui/` for existing primitives (button, card, input, badge, progress, skeleton, scroll-area).

### Badge variants (already defined)

| Variant | Style | Use |
|---|---|---|
| `default` | primary | Selected, active |
| `secondary` | bg-secondary | Generic tag |
| `outline` | transparent border | "Beta", "New", hackathon badge |
| `success` | emerald | "Ready", "Approved", "Provenance verified" |
| `warning` | amber | "Processing", "Pending approval" |
| `danger` | rose | "Failed", "Rejected", "Blocked content" |

### Button variants

`default | secondary | outline | ghost | destructive | link` × `default | sm | lg | icon`.
Primary CTA (e.g. "Upload video", "Search") uses `size="lg"` on marketing pages and `size="default"` inside app UIs.

### Cards

Three usages:
1.  **Feature/marketing cards** — `Card` with `CardHeader` (title + description) and `CardContent`.
2.  **Info/metadata cards** (verify page, side panel) — `Card` with `CardContent` and no header, tighter spacing.
3.  **Interactive cards** (search results, video list rows) — hover: `hover:bg-accent transition-colors`, cursor pointer, onClick → navigate.

## 5. Layout

### Shared shell (`src/app/layout.tsx`)
- Height: header `h-14`, main area `py-8`, footer `py-6`.
- Max content width: `container` (1280px at 2xl), centered, 1rem padding.
- Breakpoints: use `md:` (768px) for two-column splits, `lg:` (1024px) for three-column feature grids.

### Page patterns

**Marketing page (/)** — hero left/right (text / demo player card), then 3-column feature grid, then how-it-works timeline, then CTA.

**Search results (/search?q=…):**
1.  AI Overview card at top (outlined, left accent bar `border-l-4 border-brand`).
2.  Result list (Cards); each card has: video thumbnail + title, timestamp chip (mono), snippet with **query bolded**, "Jump to" button.
3.  Sidebar (filters: duration, channel/creator) — optional, can be omitted for demo.

**Watch page (/watch/[videoId]):**
- Two-column layout: player (left, ~3/4 width) + right sidebar (~1/4) on lg; stacked on mobile.
- Sidebar tabs: Chapters / Chat / About.
- Player chrome: center big play, bottom scrub bar, timestamp (mono), volume, fullscreen.
- Pause-ad overlay: centered card on darkened video, brand logo + 1-line copy, "Skip in Xs" countdown, "Why? →" link, disclosure badge top-right `Sparkles AI Ad`.

**Studio (/studio):**
- Top: Upload widget (drag-drop zone = dashed `border-2 border-dashed border-border rounded-xl p-12`, hover: `border-brand/60 bg-brand/5`).
- Below: Video list table/grid — thumb, title, status badge, duration, created-at, action menu.

**Verify (/verify/[videoId]):**
- Hash/lock status card at top (ShieldCheck, "365-day Object Lock · COMPLIANCE").
- Manuscript/step timeline (probe → asr → scenes → embed → slots → inpaint → manifest).
- Placement list: before/after thumbnail pairs, slot label, critic score, brand, approve/reject status for creator.

## 6. Motion

- Keep motion subtle (hackathon demo doesn't need to win awards; avoid distraction).
- Use `transition-colors`, `transition-opacity`, `transition-all` (150–200ms, default easing).
- Pause-ad entrance: `animate-in fade-in-0 zoom-in-95 duration-200` (from tailwindcss-animate).
- SSE progress: slide the progress bar's width; don't flash the whole page on every log line.
- Respect `prefers-reduced-motion`: Tailwind's animate plugin already gates most; double-check custom animations.

## 7. Copy voice

- **Clear, technical but friendly.** Write like Vercel/Linear docs: short sentences, active voice, no marketing fluff.
- **No exclamation marks** except the hero tagline.
- **Disclosure text is non-negotiable** (regulatory + hackathon judging):
  - In-ad: `AI Ad · Why?`
  - Verify page: `This placement was generated by AI and is cryptographically recorded. The manifest is WORM-locked on Backblaze B2 until <date>.`
  - When a slot is rejected: `Slot was not filled — safety filter (overlaps a person / low critic score / creator rejected).`
- **Timestamps:** always `M:SS` for <1hr, `H:MM:SS` otherwise (matches `formatTimestamp()` in `lib/utils.ts`).
- **Hashes/IDs:** monospace, truncate with ellipsis to 10 chars on UI but show full on /verify page with a copy button.

## 8. Accessibility (quick rules)

- All interactive elements reachable by keyboard; visible focus ring (`ring-2 ring-ring ring-offset-2 ring-offset-background`).
- Color is never the only state indicator — pair badges with icons when status is critical.
- Player keyboard shortcuts: Space=play/pause, ←/→=seek 5s, ↑/↓=volume, F=fullscreen, M=mute, 0–9=seek percent.
- Videos need captions (WebVTT from ASR segments) — `<track kind="captions" />`; default off, toggleable.
- All images have `alt=""` (decorative) or descriptive text.
- SSE progress is announced via `aria-live="polite"` only for final "ready" events, not every line.

## 9. Empty states & error states

- **No videos yet (studio):** dashed upload zone + line "Upload your first video to start processing. All processing runs on Genblaze with outputs stored on Backblaze B2."
- **No search results:** muted card with "No moments matched. Try different keywords or check spelling."
- **Pipeline failed:** red `AlertTriangle` card, one-line error, "Retry" button (re-spawns ingest).
- **B2 credentials missing (local dev):** banner at top of studio/search/watch pages: "Running in demo mode — set B2_KEY_ID/B2_APP_KEY/B2_BUCKET in .env.local to enable real uploads." (Driven by `env.isDemo` in `src/lib/env.ts`.)

## 10. Do NOT

- Add new colors beyond the palette above.
- Add icon fonts, image icons, or emoji in UI (except the orange brand dot in the header, which is a `div`).
- Use drop shadows larger than `shadow-sm`; the app is mostly flat with 1px borders for depth.
- Create marketing/gradient backgrounds other than the hero player-card (subtle brand-gradient from dark to brand-dim).
- Animate the scroll position automatically without user intent (auto-scrolling chat panel is okay when the user is already at the bottom).
