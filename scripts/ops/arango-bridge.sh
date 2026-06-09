#!/usr/bin/env bash
set -euo pipefail

export PATH="/Users/wes/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="${FF_ROOT:-/Users/wes/Developer/function-factory}"
ARANGO_ORIGIN="${FF_ARANGO_ORIGIN:-http://localhost:8529}"
URL_FILE="${FF_ARANGO_BRIDGE_URL_FILE:-/tmp/ff-arango-bridge.url}"
LOG_FILE="${FF_ARANGO_BRIDGE_LOG:-/tmp/ff-arango-bridge.log}"

WORKERS=(
  "workers/ff-pipeline"
  "workers/ff-gateway"
  "workers/ff-gates"
)

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG_FILE"
}

wait_for_arango() {
  log "starting local ArangoDB container"
  (cd "$ROOT" && docker compose up -d arangodb)

  for _ in $(seq 1 60); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$ARANGO_ORIGIN/_api/version" || true)"
    if [[ "$code" == "200" || "$code" == "401" ]]; then
      log "local ArangoDB is reachable at $ARANGO_ORIGIN"
      return 0
    fi
    sleep 2
  done

  log "local ArangoDB did not become reachable"
  return 1
}

update_worker_secrets() {
  local tunnel_url="$1"

  log "updating Worker ARANGO_URL secrets to $tunnel_url"
  for worker in "${WORKERS[@]}"; do
    printf '%s' "$tunnel_url" | (cd "$ROOT/$worker" && npx wrangler secret put ARANGO_URL)
  done
  printf '%s\n' "$tunnel_url" > "$URL_FILE"
  log "Worker ARANGO_URL secrets updated"
}

main() {
  mkdir -p "$(dirname "$URL_FILE")" "$(dirname "$LOG_FILE")"
  touch "$LOG_FILE"

  wait_for_arango

  log "starting cloudflared quick tunnel for $ARANGO_ORIGIN"
  last_url="$(cat "$URL_FILE" 2>/dev/null || true)"

  cloudflared tunnel --url "$ARANGO_ORIGIN" --no-autoupdate 2>&1 | while IFS= read -r line; do
    log "[cloudflared] $line"
    if [[ "$line" =~ https://[a-z0-9-]+\.trycloudflare\.com ]]; then
      tunnel_url="${BASH_REMATCH[0]}"
      if [[ "$tunnel_url" != "$last_url" ]]; then
        update_worker_secrets "$tunnel_url"
        last_url="$tunnel_url"
      fi
    fi
  done
}

main "$@"
