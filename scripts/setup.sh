#!/bin/sh
# Usage: ./scripts/setup.sh <profile-name>
# Creates a new profile by copying profiles/example and prints the .env lines to update.
set -e

PROFILE_NAME="$1"

if [ -z "$PROFILE_NAME" ]; then
  echo "Usage: $0 <profile-name>"
  echo "Example: $0 jake"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/profiles/example"
DEST="$REPO_ROOT/profiles/$PROFILE_NAME"

if [ ! -d "$SRC" ]; then
  echo "Error: profiles/example not found at $SRC"
  exit 1
fi

if [ -d "$DEST" ]; then
  echo "Profile '$PROFILE_NAME' already exists at $DEST — nothing copied."
else
  cp -r "$SRC" "$DEST"
  # Remove the example SQLite DB so the new profile starts clean
  rm -f "$DEST/jobs.db" "$DEST/jobs.db-shm" "$DEST/jobs.db-wal"
  echo "Created profile at $DEST"
fi

echo ""
echo "Next steps:"
echo ""
echo "  1. Edit your profile files:"
echo "       $DEST/resume.md        — your resume (plain text or markdown)"
echo "       $DEST/context.md       — target titles, stack, comp range, deal breakers"
echo "       $DEST/companies.js     — target companies per ATS platform"
echo ""
echo "  2. Update these two lines in .env:"
echo "       JOB_PROFILE_DIR=profiles/$PROFILE_NAME"
echo "       JOB_DB_PATH=profiles/$PROFILE_NAME/jobs.db"
echo ""
echo "  3. Then bring it up:"
echo "       docker compose up -d"
echo ""
