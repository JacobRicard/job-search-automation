#!/bin/sh
set -e

INTERVAL=${REFRESH_INTERVAL_MINUTES:-30}

echo "[worker] Starting. Refresh interval: ${INTERVAL}m"

while true; do
  node scripts/refresh.js
  echo "[worker] Sleeping ${INTERVAL}m until next run..."
  sleep $((INTERVAL * 60))
done
