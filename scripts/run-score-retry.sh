#!/bin/bash
set -e
# If node is not on PATH when running under cron/launchd, prepend its directory here:
#   export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."

source .env
node scripts/retry-unscored.js --limit=25 || true
