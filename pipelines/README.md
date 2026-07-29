# BrandFrame — Python pipelines directory

Genblaze-based Python pipeline invoked from Next.js via `src/lib/pipelines/run.ts`
(`child_process.spawn('.venv/bin/python', ['-m', 'pipelines.cli', 'ingest', '--key', <b2-key>])`).

## Files

- `cli.py` — entry point. `python -m pipelines.cli ingest --key <b2-key>` emits
  JSON log lines to stdout for SSE progress in the Studio UI. stderr is for
  human/debug output only (prefixed with `[stderr]` on the Node side).
- `config.py` — environment helpers and B2 prefix constants. **Must stay in sync**
  with `src/lib/b2/paths.ts`.
- `requirements.txt` — install with `npm run pipelines:install` (creates `.venv/`).
- `__init__.py` — package marker.

## Steps (Phase 2 wires them for real — see `docs/specs/07-pipeline.md`)

```
probe → transcode-hls → asr → scenes+keyframes → vl-caption → chunk → embed ─┐
                                                                             ├─→ slots → brand-match → inpaint → critic ─┐
                                                                             │                                                ├─→ manifest → lock → done
                                                          index/segments.lance
```

Each Step is a Genblaze `Step` with a primary provider, at least one fallback,
retry budget, and timeout. See `docs/specs/07-pipeline.md` for the per-step
provider/model choices, latency/cost budgets, and log event contract.

## Log event protocol (stdout JSONL)

Every line on stdout is `{"event": "...", "ts": <unix-float>, ...fields}`.
Node fans these out to the browser over SSE (`GET /api/pipelines/[videoId]`).
Events: `pipeline.start`, `step.start`, `step.fallback`, `step.ok`, `step.failed`,
`manifest.built`, `pipeline.done`, `pipeline.failed`. See `docs/specs/07-pipeline.md` §6.

## Conventions

- Python 3.10+, `from __future__ import annotations` in every module.
- Type hints on all public functions.
- Use `dataclasses.dataclass` for `StepResult`-shaped records.
- Only `_log()` writes to stdout. Debug/human output → stderr (print or logging).
- All durable outputs go to B2 via `genblaze.ObjectStorageSink` (or `boto3` for
  Object Lock calls); use local `tmp/` for intermediates and clean up in
  `finally:`.
- Don't read `os.environ` directly; go through `pipelines/config.py`.
