# 03 — Conventions (TypeScript / React / Tailwind / Python)

The goal: any coding agent opening the repo can match the existing style in their
first file without asking. When in doubt, mimic the most recently touched file.

## 1. TypeScript

- **Strict on.** Fix the type, don't `as any`; if you must, leave a `// eslint-disable-next-line @typescript-eslint/no-explicit-any` and a comment explaining.
- **No `require()`** — use ES modules (`import`/`export`).
- **Type exports:** prefer `export type { Foo }` when only types cross a boundary (helps tree-shaking & isolatedModules).
- **Enums:** use string-union types (`type SlotStatus = "pending" | "approved" | ...`) and Drizzle `text(..., { enum: [...] })`. Do **not** use TypeScript `enum` (they emit runtime code; we don't need it).
- **null vs undefined:**
  - DB-nullable columns → `| null` in TS types.
  - Optional function parameters → `?` / `| undefined`.
- **Async:** always `await`, never floating promises. Use `Promise.all` for parallel B2 calls.
- **Paths:** always use the `@/*` alias (matches tsconfig). Example: `import { cn } from "@/lib/utils"`.
- **Barrels:** no top-level barrel `index.ts` that re-exports everything; it slows type-checking and confuses RSC boundaries. Import deep paths.
- **`"use client"` directive:**
  - Default: **omit it** (Server Component).
  - Add only when the file needs React state, effects, browser APIs, event handlers, or hooks.
  - When a component needs client hooks, make the *leaf* component client, not a whole page. Pass server-fetched data as props.

## 2. React / Next.js

- **Components are functions.** Default export for page files (`export default function Page()`); named exports for reusable components.
- **Naming:** `PascalCase` for components/files that export a component (`player.tsx`, `chat-panel.tsx`), `camelCase.ts` for lib modules.
- **Props:** destructure in the signature; type with an exported `interface` named `<Component>Props`.
- **Data loading in RSCs:** do it directly in the component body (async Server Components). Do **not** use `useEffect` for initial data.
- **Mutations:** use Server Actions (`"use server"`) for form submissions, or Route Handlers if the client needs imperative control. Wrap mutations in `useTransition` when pending states matter.
- **Suspense:** wrap async data boundaries with `<Suspense fallback={<Skeleton/>}>`; provide meaningful skeletons.
- **`next/link`** for internal navigation; plain `<a target="_blank" rel="noreferrer">` only for external URLs (matches current layout.tsx).
- **`next/font`** for any typeface (Inter for sans, JetBrains Mono for code) — loaded once in `layout.tsx`. Do not add more fonts.
- **Metadata:** set `export const metadata: Metadata = …` in page files; don't mutate `<head>` manually.

### Component file template

```tsx
// src/components/<domain>/<kebab-name>.tsx
"use client"; // only if needed

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ThingProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
}

export function Thing({ className, title, children, ...props }: ThingProps) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", className)} {...props}>
      <h3 className="font-semibold">{title}</h3>
      {children}
    </div>
  );
}
```

## 3. Tailwind

- **Always use Tailwind utility classes.** Do not add rules to `globals.css` except:
  1. `@tailwind base/components/utilities`,
  2. CSS variables for theming (`--background`, `--primary`, etc.),
  3. `@layer base` body/typography resets.
- **Order classes** roughly as: layout → box → typography → color → state. (Tailwind-sorter isn't installed; we rely on consistency, not tooling.)
- **Use the design tokens** from `tailwind.config.ts`: `bg-background`, `text-muted-foreground`, `border-border`, `bg-brand`, `text-brand`. Do **not** hard-code hex colors (the only allowed hard-coded color is for one-off brand-gradient hero art).
- **Responsive:** mobile-first; add `md:` / `lg:` breakpoints. Container is `container mx-auto px-4` (already set in config).
- **Dark mode:** class-based (`.dark` set on `<html>` in `layout.tsx`). All colors must work in dark mode first (the product defaults to dark).
- **Animation:** use `tailwindcss-animate` classes (`fade-in`, `slide-in-from-top`, etc.) before reaching for custom CSS.

### Spacing scale (memorize this)
- `gap-2 / p-2` = 8px (tight)
- `gap-4 / p-4` = 16px (default)
- `gap-6 / p-6` = 24px (card padding)
- `space-y-8` = 32px (section spacing)
- `py-12` / `space-y-12` = 48px (hero/marketing)

## 4. shadcn-style primitives

When adding a new primitive:
1.  Prefer writing a minimal wrapper in `src/components/ui/` following the existing pattern (forwardRef, cn, VariantProps via CVA where applicable).
2.  Only `npx shadcn@latest add <primitive>` if you don't want to hand-roll it; afterwards, delete unused variants and run `npm run typecheck`.
3.  Never import from `@radix-ui/*` directly in a page — re-export through `src/components/ui/`.

## 5. Zod

- All environment variables are validated in `src/lib/env.ts`.
- All API request bodies are validated with a Zod schema before use.
- All webhook payloads are validated with a Zod schema (B2 Event Notification shape).
- Coerce timestamps to numbers with `z.coerce.number()` when they come from query strings.

## 6. Server Actions / Route Handlers

- **Server Actions** live either:
  - inlined in a Server Component with `"use server"` at the top of an async function, or
  - in `src/app/_actions/<feature>.ts` (use `"use server"` at the top of the file) when reused.
- **Route Handlers** live in `src/app/api/<segment>/route.ts` and export `export async function GET/POST/…(request: Request) {...}`.
- Return typed responses: `Response.json({ ... })` with appropriate status codes.
- Never throw raw errors to the client; catch and return `{ error: string }` with a 4xx/5xx status.
- SSE endpoints: set headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`; flush with a writer or `ReadableStream`.

## 7. Database (Drizzle)

- Import the `db` instance from `@/lib/db` (don't re-create it).
- All queries live in Server Components / Server Actions / Route Handlers. Never import `db` in a `"use client"` file.
- Use `drizzle-orm` selectors: `eq`, `desc`, `inArray`, etc., from `drizzle-orm`.
- Timestamps: store ISO 8601 strings (text columns) for cross-platform simplicity; convert with `new Date().toISOString()`. Durations in integer **milliseconds**.
- IDs: `vid_<nanoid(10)>` for videos, `seg_<…>` for segments, `slot_<…>` for ad slots, `brd_<…>` for brands, `run_<unix>` for manifest runs. Helper `shortId("vid")` in `lib/utils.ts`.
- Bbox: JSON array `[x1, y1, x2, y2]` in integer coordinates 0–1000 (normalized to frame width/height), stored as text. Parse with `JSON.parse()` and cast to `[number, number, number, number]`.
- JSON columns (e.g. `categories`): store as `JSON.stringify(array)` in text columns; read with `JSON.parse()` and validate through a Zod schema. (libsql/SQLite has limited JSON-type support; text is more portable.)

## 8. B2 helpers

- **Never** build B2 key strings inline. Use the helpers in `src/lib/b2/paths.ts` (`sourceKey()`, `hlsMasterKey()`, `keyframeKey()`, `inpaintedKey()`, `manifestKey()`, `thumbKey()`).
- **Never** construct public URLs manually. Use `b2PublicUrl(key)` from `src/lib/b2/client.ts`.
- **Never** hard-code prefixes (they're defined as `PREFIX` in `paths.ts` and must match Python's `config.py`).

## 9. Python (pipelines/)

- **Python 3.10+** syntax. Use `from __future__ import annotations` at the top of every module.
- **Type hints everywhere** (matching Genblaze's own style).
- **Logging:** the ONLY thing written to stdout is JSONL event lines via `_log(event, **data)` (see `cli.py`). Anything human-debuggy goes to stderr (prefix `[stderr]` is added on the Node side).
- **Idioms:**
  - Use `dataclasses.dataclass` for `StepResult`-shaped records (not Pydantic in v1, to avoid another dep).
  - Wrap provider calls in Genblaze `Step(...)` with `retry` and `fallback` configured — never call raw provider SDKs directly at the top level.
  - All outputs (keyframes, audio, clips, manifests) go to B2 via `ObjectStorageSink`, never to local disk except `tmp/` which is cleaned up.
  - Environment reads go through `pipelines/config.py` helpers — never read `os.environ` directly in a Step.
- **Lint:** 4 spaces, 88 cols (Black-compatible), double quotes, no unused imports.
- **Entry point:** always invokable as `python -m pipelines.<module>` from repo root; if you add a new CLI command, add it to `main()`'s argparse subparsers in `cli.py`.

## 10. Comments & docstrings

- Public functions get a one-line JSDoc/docstring. Complex algorithms get a paragraph explaining **why**, not **what**.
- TODOs look like `// TODO(phase-N): <action>` so search shows phase. Example: `// TODO(phase-4): wire BGE-M3 embedding call`.
- Use `// NOTE:` for non-obvious constraints (e.g., `// NOTE: bbox coords are 0..1000 normalized to match VL model output`).
- Don't leave commented-out code in committed files; delete it.

## 11. Commit messages

Format: `<type>(<scope>): <imperative summary>`
- Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `pipeline`, `ui`.
- Scope examples: `player`, `search`, `b2`, `db`, `pipelines`, `verify`, `studio`.
- Imperative mood, lowercase, no period.
- Examples:
  - `feat(player): pause-ad overlay with disclosure badge`
  - `pipeline(embed): wire BGE-M3 dense+sparse embeddings to LanceDB`
  - `docs(specs): add ad-engine spec`
  - `fix(b2): add forcePathStyle for us-west-004 endpoint`

## 12. DoD (Definition of Done) for any task

1. Code written, matching these conventions.
2. `npm run typecheck` passes (TypeScript side).
3. `npm run lint` passes.
4. No new console errors/warnings in browser.
5. If it touches the pipeline, `python -m pipelines.cli --help` still works and `ingest --key dummy` fails gracefully (no traceback at import time).
6. `MEMORY.md` updated with what changed and what's next.
7. If a new file/dir was added, it's mentioned in the appropriate spec file.
