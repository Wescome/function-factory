#!/bin/bash
# Provisions secrets into the CF Secrets Store from shell env vars.
# Only provisions secrets that are sourced from external services (API keys you own).
# Internal/generated secrets (WEOPS_SIGNING_KEY, FF_AGENT_SIGNING_KEY, etc.) are
# already in the store — this script skips them.
set -eo pipefail

FF_STORE_ID="${FF_STORE_ID:-5f51936ccef540ce825687d0afe96373}"

# OFOX is the standard model gateway key — same value as OPENAI_API_KEY
OFOX_VALUE="${OFOX_API_KEY:-${OPENAI_API_KEY:-}}"

PROVISIONED=()
SKIPPED=()
FAILED=()

echo "🔐 Provisioning factory secrets → store $FF_STORE_ID"
echo ""

for NAME in LINEAR_API_KEY OPENAI_API_KEY OFOX_API_KEY GITHUB_TOKEN; do
  if [[ "$NAME" == "OFOX_API_KEY" ]]; then
    VALUE="$OFOX_VALUE"
  else
    VALUE="$(printenv "$NAME" || true)"
  fi

  if [[ -z "$VALUE" ]]; then
    echo "⚠️  SKIP     $NAME  (not in env)"
    SKIPPED+=("$NAME")
    continue
  fi

  echo -n "   SET      $NAME ... "
  OUTPUT=$(printf '%s' "$VALUE" | npx wrangler secrets-store secret create "$FF_STORE_ID" \
    --name "$NAME" --scopes workers --remote 2>&1) && STATUS=$? || STATUS=$?

  if echo "$OUTPUT" | grep -qi "already.exists\|secret_name_already_exists\|1003"; then
    echo "already exists ✓"
    PROVISIONED+=("$NAME")
  elif [[ $STATUS -eq 0 ]]; then
    echo "✅"
    PROVISIONED+=("$NAME")
  else
    echo "❌"
    echo "   $OUTPUT"
    FAILED+=("$NAME")
  fi
done

echo ""
echo "─────────────────────────────────────────"
echo "✅ Done:    ${#PROVISIONED[@]}"
echo "⚠️  Skipped: ${#SKIPPED[@]}"
for s in "${SKIPPED[@]}"; do echo "     - $s"; done
echo "❌ Failed:  ${#FAILED[@]}"
for s in "${FAILED[@]}"; do echo "     - $s"; done
[[ ${#FAILED[@]} -eq 0 ]] || exit 1
