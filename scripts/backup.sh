#!/bin/bash
set -euo pipefail

# Local snapshot of your job-search data.
# Usage: ./scripts/backup.sh [destination-dir]   (default: ./backups)
#
# Uses SQLite's native .backup so it's safe to run while the worker is up.
# Pair this with Time Machine / iCloud / File History for off-machine safety.

cd "$(dirname "$0")/.."

BACKUP_DIR="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "[backup] Snapshotting SQLite databases..."
for db in profiles/*/jobs.db; do
  [ -f "$db" ] || continue
  profile="$(basename "$(dirname "$db")")"
  [ "$profile" = "example" ] && continue
  out="$BACKUP_DIR/${profile}_jobs_${STAMP}.db"
  sqlite3 "$db" ".backup '$out'"
  echo "  -> $out"
done

echo "[backup] Archiving profiles/ (excluding example)..."
tar -czf "$BACKUP_DIR/profiles_${STAMP}.tar.gz" \
  --exclude='profiles/example' \
  profiles/
echo "  -> $BACKUP_DIR/profiles_${STAMP}.tar.gz"

echo "[backup] Done. Snapshot saved to $BACKUP_DIR"
