#!/usr/bin/env bash
set -euo pipefail

FILE="workers/gascity-supervisor/src/index.ts"
CURRENT=$(grep -oE 'singleton-v[0-9]+' "$FILE" | head -1)
NUM=$(echo "$CURRENT" | grep -oE '[0-9]+')
NEW=$((NUM + 1))

# macOS + Linux compatible sed
if sed --version 2>/dev/null | grep -q GNU; then
  sed -i "s/singleton-v${NUM}/singleton-v${NEW}/" "$FILE"
else
  sed -i '' "s/singleton-v${NUM}/singleton-v${NEW}/" "$FILE"
fi

echo "Rotated: singleton-v${NUM} → singleton-v${NEW}"
