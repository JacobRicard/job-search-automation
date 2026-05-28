#!/bin/sh
set -e

INTERVAL=${REFRESH_INTERVAL_MINUTES:-30}

echo "[worker] Starting. Refresh interval: ${INTERVAL}m"

while true; do
  # Re-source .env each tick so wizard-added keys (e.g. GEMINI_API_KEY) are
  # picked up without requiring a container restart.
  if [ -f /app/.env ]; then
    set -a
    . /app/.env
    set +a
  fi
  node scripts/refresh.js || echo "[worker] refresh exited non-zero; will retry on next tick"
  echo "[worker] Sleeping ${INTERVAL}m until next run..."
  sleep $((INTERVAL * 60))
done
