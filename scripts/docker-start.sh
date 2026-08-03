#!/usr/bin/env bash
# Container entrypoint: prepare the SQLite DB (ephemeral FS on free Spaces),
# seed demo content, then serve the app.
set -e
cd /app

if [ ! -f brandframe.db ]; then
  echo "[start] fresh volume — creating + seeding database..."
  npx drizzle-kit push
  python3 scripts/seed-demo-data.py
  python3 scripts/seed-brands.py
  echo "[start] database ready"
else
  echo "[start] existing database found"
fi

echo "[start] serving on port ${PORT:-7860}"
exec npm start -- -p "${PORT:-7860}"
