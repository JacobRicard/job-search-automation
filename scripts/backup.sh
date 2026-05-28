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
elif command -v docker >/dev/null 2>&1 && docker compose ps -q dashboard >/dev/null 2>&1; then
  out="$BACKUP_DIR/jobs_${STAMP}.db"
  tmp="/app/data/.db-backups/jobs_${STAMP}.db"
  mkdir -p data/.db-backups
  docker compose exec -T dashboard node -e '
    const path = require("path");
    const Database = require("better-sqlite3");
    const dbPath = process.env.DB_DIR
      ? path.join(process.env.DB_DIR, "jobs.db")
      : require("./config/paths").dbPath;
    const out = process.argv[1];
    const db = new Database(dbPath, { readonly: true });
    (async () => {
      await db.backup(out);
      db.close();
    })().catch((error) => {
      try { db.close(); } catch (_) {}
      console.error(error.message);
      process.exit(1);
    });
  ' "$tmp"
  cp "data/.db-backups/jobs_${STAMP}.db" "$out"
  rm -f "data/.db-backups/jobs_${STAMP}.db"
  echo "  -> $out"
else
  echo "  -> skipped; no local data/jobs.db and dashboard container is not running"
fi

echo "[backup] Archiving data/..."
tar -czf "$BACKUP_DIR/data_${STAMP}.tar.gz" data/
echo "  -> $BACKUP_DIR/data_${STAMP}.tar.gz"

echo "[backup] Done. Snapshot saved to $BACKUP_DIR"
