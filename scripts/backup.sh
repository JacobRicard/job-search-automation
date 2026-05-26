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

echo "[backup] Snapshotting SQLite database..."
if [ -f "data/jobs.db" ]; then
  out="$BACKUP_DIR/jobs_${STAMP}.db"
  sqlite3 data/jobs.db ".backup '$out'"
  echo "  -> $out"
fi

echo "[backup] Archiving data/..."
tar -czf "$BACKUP_DIR/data_${STAMP}.tar.gz" data/
echo "  -> $BACKUP_DIR/data_${STAMP}.tar.gz"

echo "[backup] Done. Snapshot saved to $BACKUP_DIR"
