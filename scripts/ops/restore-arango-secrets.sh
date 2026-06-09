#!/usr/bin/env bash
set -euo pipefail

ROOT="${FF_ROOT:-/Users/wes/Developer/function-factory}"
LABEL="com.koales.function-factory.arango-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

WORKERS=(
  "workers/ff-pipeline"
  "workers/ff-gateway"
  "workers/ff-gates"
)

INIT_DB=false

usage() {
  cat <<'EOF'
Usage:
  scripts/ops/restore-arango-secrets.sh [--init-db]

Restores production Arango secrets for all Factory Workers without rolling back
Worker versions or touching refactored code.

What it does:
  1. Prompts once for ARANGO_URL, ARANGO_DATABASE, ARANGO_USERNAME, ARANGO_PASSWORD.
  2. Stops the temporary local Arango bridge launchd job.
  3. Writes those four secrets to ff-pipeline, ff-gateway, and ff-gates.
  4. Optionally initializes Arango collections with --init-db.
  5. Verifies production health endpoints.

EOF
}

for arg in "$@"; do
  case "$arg" in
    --init-db)
      INIT_DB=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

prompt_required() {
  local label="$1"
  local secret="${2:-false}"
  local value=""

  while [[ -z "$value" ]]; do
    if [[ "$secret" == "true" ]]; then
      printf '%s: ' "$label" >&2
      IFS= read -r -s value
      printf '\n' >&2
    else
      printf '%s: ' "$label" >&2
      IFS= read -r value
    fi
  done

  printf '%s' "$value"
}

put_secret() {
  local worker="$1"
  local key="$2"
  local value="$3"

  printf '%s' "$value" | (cd "$ROOT/$worker" && npx wrangler secret put "$key")
}

check_health() {
  local name="$1"
  local url="$2"
  local body

  body="$(curl -sS "$url")"
  printf '%s\n' "$body" | jq .

  if [[ "$(printf '%s' "$body" | jq -r '.arango // false')" != "true" ]]; then
    echo "$name health check failed: arango is not true" >&2
    exit 1
  fi
}

require_command curl
require_command jq
require_command npx

cd "$ROOT"

echo "Enter the real managed Arango values. Do not use localhost or trycloudflare."
ARANGO_URL="$(prompt_required ARANGO_URL)"
ARANGO_DATABASE="$(prompt_required ARANGO_DATABASE)"
ARANGO_USERNAME="$(prompt_required ARANGO_USERNAME)"
ARANGO_PASSWORD="$(prompt_required ARANGO_PASSWORD true)"

if [[ "$ARANGO_URL" == http://localhost* || "$ARANGO_URL" == *trycloudflare.com* ]]; then
  echo "Refusing ARANGO_URL that points to localhost or trycloudflare: $ARANGO_URL" >&2
  exit 1
fi

echo "Stopping temporary Arango bridge, if installed."
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

echo "Writing Arango secrets to Workers."
for worker in "${WORKERS[@]}"; do
  echo "=== $worker ==="
  put_secret "$worker" ARANGO_URL "$ARANGO_URL"
  put_secret "$worker" ARANGO_DATABASE "$ARANGO_DATABASE"
  put_secret "$worker" ARANGO_USERNAME "$ARANGO_USERNAME"
  put_secret "$worker" ARANGO_PASSWORD "$ARANGO_PASSWORD"
done

if [[ "$INIT_DB" == "true" ]]; then
  echo "Initializing Arango collections."
  ARANGO_URL="$ARANGO_URL" \
    ARANGO_USER="$ARANGO_USERNAME" \
    ARANGO_PASS="$ARANGO_PASSWORD" \
    npx tsx infra/arangodb/init-db.ts
fi

echo "Verifying production health."
check_health "ff-pipeline" "https://ff-pipeline.koales.workers.dev/debug/health"
check_health "ff-gateway" "https://ff-gateway.koales.workers.dev/health"

echo "Arango restore complete."
