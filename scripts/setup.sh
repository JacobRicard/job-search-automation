#!/bin/sh
# Usage: ./scripts/setup.sh
# Sets up your personal data directory by copying data.example to data.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/data.example"
DEST="$REPO_ROOT/data"

if [ ! -d "$SRC" ]; then
  echo "Error: data.example not found at $SRC"
  exit 1
fi

if [ -d "$DEST" ]; then
  echo "data/ already exists — nothing copied."
  echo "Delete it and re-run if you want a fresh start."
  exit 0
fi

cp -r "$SRC" "$DEST"
rm -f "$DEST/jobs.db" "$DEST/jobs.db-shm" "$DEST/jobs.db-wal"

echo "Created data/ from data.example"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit your profile files in data/:"
echo "       data/resume.md      — your resume (plain text or markdown)"
echo "       data/context.md     — target titles, stack, comp range, deal breakers"
echo "       data/companies.js   — target companies per ATS platform"
echo ""
echo "  2. Add your Gemini API key to .env:"
echo "       GEMINI_API_KEY=your-key-here"
echo ""
echo "  3. Then bring it up:"
echo "       docker compose up -d"
echo ""
echo "  Or: run 'docker compose up -d' and fill everything in via the setup wizard at localhost:3131"
echo ""
