#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VENV_DIR="${PIPELINE_VENV:-.venv}"

echo "Creating Python virtual environment at $VENV_DIR..."
python3 -m venv "$VENV_DIR"

echo "Installing pipeline dependencies..."
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -r pipelines/requirements.txt

echo "Downloading NLTK data..."
"$VENV_DIR/bin/python" -c "import nltk; nltk.download('punkt', quiet=True)"

echo "Done! Pipeline venv ready at $VENV_DIR"
