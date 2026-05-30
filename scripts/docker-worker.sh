#!/bin/sh
set -e

INTERVAL=${REFRESH_INTERVAL_MINUTES:-30}

echo "[worker] Starting. Refresh interval: ${INTERVAL}m"

# Load a dotenv-format file safely: strips CRLF, skips comments/blanks,
# exports KEY=VALUE lines quoted so values with spaces are preserved.
# Uses a temp file + input redirect (not a pipe) so exports persist in this shell.
load_env() {
  sed 's/\r//' "$1" > /tmp/.env.load
  while IFS= read -r line; do
    case "$line" in
      ''|'#'*) continue ;;
      *=*) export "$line" ;;
    esac
  done < /tmp/.env.load
}

while true; do
  # Re-source .env each tick so wizard-added keys are picked up without restart.
  if [ -f /app/.env ]; then
    load_env /app/.env
  fi
  node scripts/refresh.js || echo "[worker] refresh exited non-zero; will retry on next tick"
  echo "[worker] Sleeping ${INTERVAL}m until next run..."
  sleep $((INTERVAL * 60))
done
