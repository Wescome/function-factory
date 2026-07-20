#!/bin/bash
set -euo pipefail

# Secrets managed via CF Secrets Store (factory-secrets). No secret env vars required.

# Function Factory — Linear Bridge Deployment + Webhook Bootstrap
# Deploys: linear-bridge worker, sets CF secrets, registers Linear webhook
#
# Deployed host: https://linear-bridge.koales.workers.dev
# (NOT ff-linear-bridge — the wrangler name is "linear-bridge")
#
# Prerequisites:
#   ff-pipeline, ff-gateway deployed (linear-bridge binds ff-pipeline DOs)
#
# Required env vars (export before running):
#   LINEAR_API_KEY      — Linear personal API key (used for webhook registration)
#
# Generated in-script (do NOT supply externally):
#   LINEAR_WEBHOOK_SECRET — generated once via openssl rand, set on both CF and Linear
#                           in the same pass to guarantee HMAC verification matches
#
# Usage:
#   export LINEAR_API_KEY=...
#   bash scripts/deploy-linear-bridge.sh
#
# NOTE: Re-running this script creates a new webhook in Linear (Linear allows duplicates).
# If re-running after a partial failure, delete any prior webhook for this URL+team in
# Linear settings before re-running. TODO-1: future revision may auto-dedupe via
# webhooks query.

echo "═══ linear-bridge: deploy + Linear webhook bootstrap ═══"
echo ""

# ── Validate env vars ─────────────────────────────────────────────────────────
: "${LINEAR_API_KEY:?LINEAR_API_KEY must be set}"

# ── Generate shared webhook secret (exactly once) ─────────────────────────────
# This value is used in the webhookCreate call below.
# It is never printed to stdout — only set on each side atomically.
WEBHOOK_SECRET="$(openssl rand -hex 32)"
echo "→ Generated LINEAR_WEBHOOK_SECRET (not printed)"

# ── Write the secret into the CF Secrets Store so the worker binding resolves ──
echo ""
echo "→ Writing LINEAR_WEBHOOK_SECRET to CF Secrets Store..."
FF_STORE_ID="5f51936ccef540ce825687d0afe96373"
SECRET_ID="$(npx wrangler secrets-store secret list "${FF_STORE_ID}" --remote --json 2>/dev/null | jq -r '.[] | select(.name == "LINEAR_WEBHOOK_SECRET") | .id')"
if [ -n "${SECRET_ID}" ]; then
  printf '%s' "${WEBHOOK_SECRET}" | npx wrangler secrets-store secret update "${FF_STORE_ID}" --secret-id "${SECRET_ID}" --remote
  echo "→ Updated existing LINEAR_WEBHOOK_SECRET (id: ${SECRET_ID})"
else
  printf '%s' "${WEBHOOK_SECRET}" | npx wrangler secrets-store secret create "${FF_STORE_ID}" --name LINEAR_WEBHOOK_SECRET --scopes workers --remote
  echo "→ Created new LINEAR_WEBHOOK_SECRET in Secrets Store"
fi

# ── Deploy the worker first (so the URL is live before Linear delivers) ───────
echo ""
echo "→ Deploying linear-bridge..."
npx wrangler deploy -c workers/linear-bridge/wrangler.jsonc

# ── Register the Linear webhook via GraphQL webhookCreate ─────────────────────
echo ""
echo "→ Registering Linear webhook..."

WEBHOOK_URL="https://linear-bridge.koales.workers.dev/webhook"
TEAM_ID="8b9ba524-28fa-457f-adfc-e4f2452d3aa0"

# Build the JSON body with the mutation and variables.
# Variables carry the generated secret — not interpolated into the mutation string
# to avoid quoting issues with special chars.
GRAPHQL_BODY="$(cat <<GQLEOF
{
  "query": "mutation WebhookCreate(\$input: WebhookCreateInput!) { webhookCreate(input: \$input) { success webhook { id url enabled resourceTypes teamId } } }",
  "variables": {
    "input": {
      "url": "${WEBHOOK_URL}",
      "secret": "${WEBHOOK_SECRET}",
      "teamId": "${TEAM_ID}",
      "resourceTypes": ["Comment"],
      "allPublicTeams": false,
      "enabled": true,
      "label": "ff-commissioning-pipeline"
    }
  }
}
GQLEOF
)"

RESPONSE="$(curl -sS -X POST "https://api.linear.app/graphql" \
  -H "Authorization: Bearer ${LINEAR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "${GRAPHQL_BODY}")"

# Check for GraphQL-level errors
if echo "${RESPONSE}" | grep -q '"errors"'; then
  echo ""
  echo "ERROR: Linear webhookCreate returned errors:"
  echo "${RESPONSE}"
  exit 1
fi

# Check mutation success flag
SUCCESS="$(echo "${RESPONSE}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('webhookCreate',{}).get('success','false'))" 2>/dev/null || echo "false")"
if [ "${SUCCESS}" != "True" ] && [ "${SUCCESS}" != "true" ]; then
  echo ""
  echo "ERROR: webhookCreate returned success=false:"
  echo "${RESPONSE}"
  exit 1
fi

WEBHOOK_ID="$(echo "${RESPONSE}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['webhookCreate']['webhook']['id'])" 2>/dev/null || echo "(unknown)")"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══ linear-bridge deployed and webhook registered ═══"
echo ""
echo "Webhook ID  : ${WEBHOOK_ID}"
echo "Delivery URL: ${WEBHOOK_URL}"
echo "Team filter : ${TEAM_ID}"
echo "Events      : Comment (create)"
echo ""
echo "Health check:"
echo "  curl https://linear-bridge.koales.workers.dev/health"
echo ""
echo "NOTE: LINEAR_WEBHOOK_SECRET was generated and set in this run."
echo "      Re-running creates a duplicate webhook in Linear — delete the"
echo "      prior one (ID: ${WEBHOOK_ID}) from Linear settings first."
