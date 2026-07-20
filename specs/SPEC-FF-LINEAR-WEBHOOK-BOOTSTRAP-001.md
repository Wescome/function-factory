# SPEC-FF-LINEAR-WEBHOOK-BOOTSTRAP-001 — Linear Webhook Bootstrap

**Status:** Draft · **Layer:** Ingress (Linear → Gateway) · **Date:** 2026-06-16
**Owner:** Architect (spec) → Workflow agents (implementation)

---

## Purpose

The `linear-bridge` Worker is the entry point of the entire commissioning pipeline: a Linear
issue comment carrying a `DISPOSITION:` line is verified, recorded as an ElucidationArtifact,
signed, and forwarded to the gateway. None of that fires unless **Linear is actually
configured to deliver webhooks to the deployed worker**. Today there is no bootstrap: the
worker exists but no webhook is registered, and the hostname commonly assumed
(`ff-linear-bridge`) is wrong — the wrangler `name` is `linear-bridge`, so the deployed host
is `linear-bridge.koales.workers.dev`.

This spec defines the **correct deployed hostname**, the **Linear webhook configuration**
(URL, events, team filter), and a **single bootstrap script** that deploys the worker,
generates the shared webhook secret once, sets it in both Linear and Cloudflare in the same
pass, and registers the webhook via Linear's GraphQL `webhookCreate` mutation.

## JTBD

When I stand up the commissioning pipeline in a fresh environment, I want one script that
deploys the linear-bridge worker and registers the Linear webhook with a matching shared
secret on both sides, so I can guarantee disposition comments actually reach the bridge and
pass HMAC verification on the first try.

---

## Context

### Worker identity (`workers/linear-bridge/wrangler.jsonc`)
- `name: "linear-bridge"` → deployed host `https://linear-bridge.koales.workers.dev`.
- Route handled: `POST /webhook` (`workers/linear-bridge/src/index.ts`), plus `GET /health`.
- `vars`: `WEOPS_GATEWAY_URL = https://ff-gateway.koales.workers.dev`.
- Secrets (per the wrangler comment block), set via `wrangler secret put`:
  - `LINEAR_WEBHOOK_SECRET` — raw string, Linear webhook signing secret.
  - `LINEAR_API_KEY` — Linear personal API key (Bearer for GraphQL).
  - `WEOPS_SIGNING_KEY` — base64-encoded HMAC-SHA256 raw bytes (shared with ff-gateway).
- KV binding `BRIDGE_KV`, DO bindings `ARTIFACT_GRAPH` (script `ff-pipeline`) and
  `APPROVAL_FLOW_DO`.

### Verification dependency
`handleWebhook` step 1 calls `verifyLinearSignature(rawBody, signature,
env.LINEAR_WEBHOOK_SECRET)`. The signature Linear sends is HMAC-SHA256 of the raw body using
the secret entered **when the webhook was created in Linear**. Therefore the value in
`LINEAR_WEBHOOK_SECRET` (Cloudflare) and the secret registered in Linear MUST be **byte-for-byte
identical**. A mismatch makes every webhook fail with 401 at step 1.

### Existing deploy-script conventions (`scripts/`)
Existing scripts (`deploy-i-layer.sh`, `deploy-phase*.sh`) are bash, `set -euo pipefail`,
validate required env vars with `: "${VAR:?...}"`, and pipe secrets non-interactively into
`wrangler secret put … -c <wrangler.jsonc>`. The new script follows the same pattern.

---

## Spec (numbered rules)

### R1 — Correct deployed hostname
- The webhook delivery URL is:
  ```
  https://linear-bridge.koales.workers.dev/webhook
  ```
- It is **NOT** `ff-linear-bridge.*`. Any doc, runbook, or config referencing
  `ff-linear-bridge` is wrong and must be corrected to `linear-bridge`.
- Health check: `https://linear-bridge.koales.workers.dev/health`.

### R2 — Linear webhook configuration
The webhook registered in Linear MUST have:
- **URL:** `https://linear-bridge.koales.workers.dev/webhook` (R1).
- **Resource / event types:** `Comment` create events. The bridge only processes
  `payload.type === 'Comment' && payload.action === 'create'` (everything else returns
  `skipped`), so the webhook subscribes to the **Comment** resource type. (In Linear's
  GraphQL `webhookCreate` input this is `resourceTypes: ["Comment"]`.)
- **Team filter:** WeOps team only — `teamId = 8b9ba524-28fa-457f-adfc-e4f2452d3aa0`.
- **Secret:** the shared HMAC secret (R4), supplied as the `secret` input field so Linear
  signs deliveries with it.
- **Enabled:** `true`.

### R3 — Bootstrap script: `scripts/deploy-linear-bridge.sh`
A single bash script (`set -euo pipefail`, env-var validation in the existing style) that, in
one pass:

1. **Validates inputs.** Requires:
   - `LINEAR_API_KEY` (`: "${LINEAR_API_KEY:?...}"`) — Bearer token for the GraphQL call and
     the worker secret.
   - `WEOPS_SIGNING_KEY` (`: "${WEOPS_SIGNING_KEY:?...}"`) — shared with ff-gateway.
   - `LINEAR_WEBHOOK_SECRET` is **not** required as input — the script generates it (R4).
2. **Generates the shared webhook secret once** (R4):
   `WEBHOOK_SECRET="$(openssl rand -hex 32)"`.
3. **Deploys the worker:** `(cd workers/linear-bridge && npx wrangler deploy)`.
4. **Sets Cloudflare secrets non-interactively**, piping into `wrangler secret put … -c
   workers/linear-bridge/wrangler.jsonc`:
   - `LINEAR_WEBHOOK_SECRET` ← `$WEBHOOK_SECRET` (the generated value).
   - `LINEAR_API_KEY` ← `$LINEAR_API_KEY`.
   - `WEOPS_SIGNING_KEY` ← `$WEOPS_SIGNING_KEY`.
5. **Registers the webhook in Linear** via the GraphQL `webhookCreate` mutation (R5), passing
   the **same** `$WEBHOOK_SECRET` as the `secret` input — guaranteeing both sides match (R4).
6. **Reports** the created webhook id and the delivery URL, and prints the health-check
   command.

The script MUST be idempotent-aware: if a webhook for this URL+team already exists, document
that re-running creates a duplicate (Linear allows it) and recommend deleting the prior one;
a future revision may query existing webhooks first. (v1: no auto-dedupe.)

### R4 — Single-pass shared secret (the matching guarantee)
- The webhook secret is generated **exactly once** in the script with `openssl rand -hex 32`.
- That one value is used in **both** places within the same script run:
  1. `wrangler secret put LINEAR_WEBHOOK_SECRET` (Cloudflare side), and
  2. the `secret:` field of the Linear `webhookCreate` mutation (Linear side).
- The script MUST NOT read the secret from two different sources, MUST NOT prompt for it
  twice, and MUST NOT print it to stdout (it may print only that a secret was generated and
  set). This is what guarantees step-1 HMAC verification passes.

### R5 — `webhookCreate` GraphQL mutation
The script POSTs to `https://api.linear.app/graphql` with header
`Authorization: $LINEAR_API_KEY` (Linear personal API keys are sent as the raw key in the
`Authorization` header) and `Content-Type: application/json`. The mutation string is exactly:

```graphql
mutation WebhookCreate($input: WebhookCreateInput!) {
  webhookCreate(input: $input) {
    success
    webhook {
      id
      url
      enabled
      resourceTypes
      teamId
    }
  }
}
```

with variables:

```json
{
  "input": {
    "url": "https://linear-bridge.koales.workers.dev/webhook",
    "resourceTypes": ["Comment"],
    "teamId": "8b9ba524-28fa-457f-adfc-e4f2452d3aa0",
    "secret": "<the openssl-generated WEBHOOK_SECRET>",
    "enabled": true,
    "label": "ff-commissioning-pipeline"
  }
}
```

- The script builds the JSON request body (mutation + variables) and submits it with `curl`.
- It MUST check `data.webhookCreate.success === true` and fail the script (non-zero exit) if
  the mutation returns `errors` or `success: false`, surfacing the GraphQL error text.

### R6 — Ordering and failure semantics
- Deploy the worker **before** registering the webhook, so the first delivery has a live
  endpoint.
- Set the Cloudflare `LINEAR_WEBHOOK_SECRET` **before** (or atomically with) the
  `webhookCreate` call, so there is no window where Linear signs deliveries the worker cannot
  verify. (Worker is already deployed; secret update is near-instant.)
- If `webhookCreate` fails after secrets are set, the script exits non-zero; the operator
  re-runs. Re-running regenerates a new secret and re-sets it on both sides — acceptable
  because the prior partial webhook (if any) was never created on failure.

---

## Open items / TODOs

- **TODO-1 (R3):** Add a pre-flight `webhooks` query to detect and optionally delete a
  pre-existing webhook for the same URL+team, making the script fully idempotent (no
  duplicate webhooks on re-run).
- **TODO-2 (R2):** Confirm whether `update` Comment events are ever needed; current bridge
  ignores them, so `create` only is correct, but capturing edited dispositions may be a later
  requirement.
- **TODO-3 (R5):** Verify the exact Linear `Authorization` header convention for the API key
  variant in use (raw key vs `Bearer `-prefixed) against the current Linear API docs before
  first run; the worker's own `linear-client`/`createComment` calls already encode the
  correct convention and should be the reference.
- **OPEN-1:** `WEOPS_SIGNING_KEY` must be the **same** base64 key set on `ff-gateway`; the
  script assumes the operator exports the shared value. A future revision could read it from a
  single source of truth rather than env.
