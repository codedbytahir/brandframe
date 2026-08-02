#!/usr/bin/env bash
# BrandFrame pre-flight check — run this before testing. Verifies every
# dependency the app + pipeline need, and prints the fix command for any ❌.
#
#   bash scripts/doctor.sh
#
cd "$(dirname "$0")/.."

PASS=0
FAIL=0
# nltk >= 3.10's import guard blocks venv-internal imports when run from the
# repo root; disable it for our python checks (no-op on nltk < 3.10).
export NLTK_DISABLE_IMPORT_SECURITY=1
export PYTHONSAFEPATH=1
export PYTHONPATH="$(pwd)${PYTHONPATH:+:$PYTHONPATH}"
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
warn() { echo "  ⚠️  $1"; }

echo ""
echo "━━━ 1/6 · Git state ━━━"
LOCAL=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
ok "on commit $LOCAL — $(git log -1 --format=%s 2>/dev/null | cut -c1-70)"
if git fetch -q origin main 2>/dev/null; then
  BEHIND=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo 0)
  if [ "$BEHIND" = "0" ]; then ok "up to date with origin/main"; else warn "behind origin/main by $BEHIND commit(s) → run: git pull origin main"; fi
else
  warn "could not reach origin (offline?) — skipped freshness check"
fi

echo ""
echo "━━━ 2/6 · Node / Next.js ━━━"
command -v node >/dev/null 2>&1 && ok "node $(node --version)" || bad "node not found"
if [ -d node_modules ]; then ok "node_modules installed"; else bad "node_modules missing → run: npm install"; fi

echo ""
echo "━━━ 3/6 · Python pipeline venv ━━━"
if [ -x .venv/bin/python ]; then
  ok ".venv present ($(.venv/bin/python --version 2>&1))"
  MISSING=""
  for mod in genblaze boto3 numpy scenedetect cv2 mediapipe PIL sentence_transformers lancedb nltk requests google.genai; do
    .venv/bin/python -c "import $mod" >/dev/null 2>&1 || MISSING="$MISSING $mod"
  done
  if [ -z "$MISSING" ]; then ok "all pipeline modules import"; else bad "missing python modules:$MISSING → run: npm run pipelines:install"; fi
  if .venv/bin/python -c "import nltk; nltk.data.find('tokenizers/punkt')" >/dev/null 2>&1; then
    ok "nltk punkt data"
  else
    bad "nltk punkt data missing → run: .venv/bin/python -c \"import nltk; nltk.download('punkt')\""
  fi
  if PYTHONSAFEPATH=1 PYTHONPATH="$(pwd)" .venv/bin/python -m pipelines.cli ingest --help >/dev/null 2>&1; then
    ok "pipeline entrypoint boots (python -m pipelines.cli)"
  else
    bad "pipeline entrypoint fails to boot → fix the ❌ imports above first"
  fi
else
  bad ".venv missing → run: npm run pipelines:install"
fi

echo ""
echo "━━━ 4/6 · ffmpeg (system binary, not pip) ━━━"
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  ok "ffmpeg + ffprobe on PATH ($(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3))"
else
  bad "ffmpeg/ffprobe missing → run: sudo apt-get install -y ffmpeg   (or re-run: npm run pipelines:install)"
fi

echo ""
echo "━━━ 5/6 · API keys (.env or Codespaces secrets) ━━━"
if [ ! -f .env ]; then warn ".env missing → cp .env.example .env and fill in keys (or set Codespaces secrets)"; fi
getv() {
  local v="${!1:-}"
  if [ -z "$v" ] && [ -f .env ]; then
    v=$(grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d "\"' ")
  fi
  echo "$v"
}
for key in B2_KEY_ID B2_APP_KEY B2_BUCKET B2_REGION B2_ENDPOINT MISTRAL_API_KEY GEMINI_API_KEY DEEPGRAM_API_KEY; do
  if [ -n "$(getv "$key")" ]; then ok "$key set"; else bad "$key empty → set it in .env or Codespaces secrets"; fi
done

echo ""
echo "━━━ 6/6 · Database + seed data ━━━"
if [ -f brandframe.db ]; then
  ok "brandframe.db present"
else
  bad "brandframe.db missing → run: npx drizzle-kit push && python3 scripts/seed-demo-data.py && python3 scripts/seed-brands.py"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ ALL CLEAR — $PASS checks passed. Start testing with: npm run dev"
else
  echo "❌ $FAIL failing · $PASS passing — fix each ❌ above (fix command is on the same line)."
fi
echo ""
