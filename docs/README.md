# BrandFrame — Documentation & Agent Specs

This folder is the **single source of truth** for anyone (human or coding agent)
working on BrandFrame. If a spec and the code disagree, **update the spec first**
(in the same PR if practical) so future agents don't rediscover your reasoning.

## Reading order for a new coding agent

1.  `specs/00-project-brief.md` — what BrandFrame is, the hackathon, deadlines, judging.
2.  `specs/01-architecture.md` — system diagram, components, data flow.
3.  `specs/02-tech-stack.md` — exact library versions, why each was chosen, what is off-limits.
4.  `specs/03-conventions.md` — code style, naming, file layout, TS/Tailwind/Python rules.
4.  `specs/04-design-system.md` — colors, typography, spacing, components, copy voice.
5.  `specs/05-data-model.md` — Drizzle schema, indexes, enums, B2 object layout, LanceDB schema.
6.  `specs/06-api-routes.md` — every Next.js Route Handler / Server Action contract.
7.  `specs/07-pipeline.md` — Genblaze Python pipeline Steps, DAG, contracts, fallbacks.
8.  `specs/08-rag-search.md` — embeddings, hybrid weights, rerank, chunking.
9.  `specs/09-ad-engine.md` — three ad layers, detection, inpaint, critic, caps.
10. `specs/10-provenance.md` — Genblaze Manifests, Object Lock, `/verify`, C2PA/MP4 embedding.
11. `specs/11-env-secrets.md` — every env var, how to get each key, safe fallbacks.
12. `specs/12-phases-and-tasks.md` — build order, checklists, Definition of Done per phase.
13. `../MEMORY.md` — living state: what's built, what's broken, active branch context.
14. `../DECISIONS.md` — Architecture Decision Records (ADRs).
15. `../TASKS.md` — canonical checklist (Phase 1–7).

## Quick commands cheat-sheet

```bash
npm run dev             # Next dev server (turbopack)  http://localhost:3000
npm run typecheck       # tsc --noEmit (must be clean before commit)
npm run lint            # next lint
npm run db:push         # push drizzle schema to sqlite (dev only)
npm run db:studio       # drizzle-kit studio on :4983
npm run pipelines:install   # create .venv and pip install -r pipelines/requirements.txt
npm run pipelines:ingest -- --key uploads/<id>/source.mp4
```

## Rules for coding agents

- **Read `MEMORY.md` first** every session — it tells you what state the code is in.
- **Update `MEMORY.md`** at the end of every session with what you changed, what you broke, what's next.
- **Never** introduce FastAPI, Express, or any other backend server. Next.js Route Handlers and Server Actions are the only server surface. Python runs only as a child process.
- **Server Components by default.** Only add `"use client"` when you *must* (state, event handlers, browser APIs like HLS). Props down, events up.
- **No unvalidated env.** All env reads go through `src/lib/env.ts` (zod). Python uses `pipelines/config.py`.
- **B2 is the single source of truth** for binary assets. SQLite (libsql) holds metadata only.
- **Tailwind + shadcn/ui primitives only.** No new CSS frameworks, no styled-components, no MUI.
- **TS strict on.** `any` is a red flag that must be justified in a comment.
- **Every AI-generated ad placement** must have: (a) creator approval row, (b) "AI Ad · Why?" disclosure, (c) a Genblaze Manifest entry, (d) B2 Object Lock retention. No exceptions.
