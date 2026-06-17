# SPEC-FF-CF-SECRETS-STORE-001 — Migrate function-factory to Cloudflare Secrets Store

| Field | Value |
|-------|-------|
| Spec ID | SPEC-FF-CF-SECRETS-STORE-001 |
| Status | Draft (for Workflow execution) |
| Author | Architect |
| Date | 2026-06-16 |
| Scope | All Cloudflare Workers in `function-factory/workers/*` that declare secrets |
| Type | Infrastructure / configuration migration. No business-logic change. |

---

## Purpose

Replace per-worker `wrangler secret put` secrets with **account-level Cloudflare Secrets
Store** secrets bound into each Worker. This gives us:

- **One source of truth** for shared secrets (`WEOPS_SIGNING_KEY`, `LINEAR_API_KEY`,
  `FF_AGENT_SIGNING_KEY`, `SUB_BUFFER_PRODUCER_SECRET`, etc.) instead of the same value
  re-set on N workers.
- **Rotation without redeployment** — update the secret value once in the store; every
  binding picks it up. No shell env vars, no CI/CD secret pipeline.
- **RBAC + audit log** — security admins manage values; developers only reference them by
  name. Creation, binding, update, and deletion are logged by Cloudflare.
- **Deploy scripts that never touch secret values** — `wrangler deploy` only; no
  `echo "$VAR" | wrangler secret put` chains.

---

## Context

### Current state
Every secret is a per-worker secret set via `echo "$VAR" | wrangler secret put NAME -c <worker>/wrangler.jsonc`.
Consequences observed in this repo:

- `WEOPS_SIGNING_KEY` is set independently on `ff-gateway`, `factory-gateway`, and
  `linear-bridge` and **must be kept byte-identical by hand** (HMAC verification fails
  silently otherwise).
- `LINEAR_API_KEY`, `FF_AGENT_SIGNING_KEY`, `SUB_BUFFER_PRODUCER_SECRET`, `OFOX_API_KEY`,
  `ANTHROPIC_API_KEY`, `OPERATOR_CONTROL_TOKEN` are each duplicated across multiple workers.
- `scripts/deploy-linear-bridge.sh` requires `LINEAR_API_KEY` and `WEOPS_SIGNING_KEY` in the
  operator's shell, generates `LINEAR_WEBHOOK_SECRET`, and pipes all three into
  `wrangler secret put`. The secret values transit the operator's machine on every redeploy.

### Target state
A single account store `ff-factory-secrets` holds every secret once. Each Worker declares a
`secrets_store_secrets` binding array in its `wrangler.jsonc`. Worker code retrieves values
with `await env.NAME.get()`.

### Authoritative CF beta behavior (verified 2026-06-16)
Two assumptions in the original task brief are **wrong per current CF docs** and this spec
corrects them. Workflow MUST follow the corrected forms below, not the brief:

1. **Binding key is `secrets_store_secrets`, not `secrets_store_bindings`; it uses
   `store_id`, not `store_name`.** Correct shape:
   ```jsonc
   "secrets_store_secrets": [
     { "binding": "LINEAR_API_KEY", "store_id": "<STORE_ID>", "secret_name": "LINEAR_API_KEY" }
   ]
   ```
   The `store_id` is the opaque ID returned by `wrangler secrets-store store create`, not the
   human name `ff-factory-secrets`.

2. **The binding does NOT auto-unwrap to a string.** At runtime the binding is an object and
   the value is fetched with an async call:
   ```ts
   const key = await env.LINEAR_API_KEY.get()  // returns string
   ```
   Therefore every `env.X.get()` migration touches both the env interface (`string` →
   `SecretsStoreSecret`) **and every call site** (synchronous read → `await …get()`). This is
   the largest source of code churn and the reason migration is per-worker, not global.

3. **There is no `rotate` subcommand.** Rotation is `wrangler secrets-store secret update
   <STORE-ID> --secret-id <ID> --value <NEW>`. Update requires the secret's opaque `--secret-id`
   (look it up via `secret list`), not its name (open issue cloudflare/workers-sdk#10610).

Sources:
- https://developers.cloudflare.com/secrets-store/integrations/workers/
- https://developers.cloudflare.com/workers/wrangler/commands/secrets-store/
- https://developers.cloudflare.com/changelog/product/secrets-store/

---

## Secret Inventory

Compiled from the `// Secrets (...)` comment blocks and `env.ts` interfaces across all
`workers/*/wrangler.jsonc`. "src sites" = count of `.ts` files reading `env.NAME` today
(each must convert to `await env.NAME.get()`).

| Secret name | Workers that use it | Shared? | src sites | Notes |
|-------------|---------------------|---------|-----------|-------|
| `WEOPS_SIGNING_KEY` | ff-gateway, factory-gateway, linear-bridge | **Shared (3)** — must be identical | 2 | base64 HMAC-SHA256. Top priority for store: silent drift today. |
| `LINEAR_API_KEY` | ff-commissioning-agent, ff-linear-sync, linear-bridge | **Shared (3)** | 2 | Linear PAT / Bearer for GraphQL. |
| `FF_AGENT_SIGNING_KEY` | ff-gateway, ff-architect-agent, ff-commissioning-agent | **Shared (3)** | 1 | WGSP envelope signing key. |
| `SUB_BUFFER_PRODUCER_SECRET` | ff-commissioning-agent, ff-pipeline (CoordinatorDO), factory-subscription-buffer | **Shared (3)** | 1 | HMAC producer-token secret (§5.2). |
| `OFOX_API_KEY` | ff-commissioning-agent, ff-pipeline | **Shared (2)** | 5 | OFOX gateway (OpenAI-compatible). High call-site count. |
| `OPERATOR_CONTROL_TOKEN` | ff-architect-agent, ff-pipeline | **Shared (2)** | 2 | Bearer for WeOps gateway. |
| `ANTHROPIC_API_KEY` | ff-pipeline, gascity-supervisor | **Shared (2)** | 0 | Used inside DOs; 0 direct `env.` reads (passed through). Verify before migrating. |
| `PDP_API_KEY` | factory-gateway | per-worker | 1 | Bearer for PDP calls. |
| `LINEAR_WEBHOOK_SECRET` | linear-bridge | per-worker | 1 | Generated by deploy script (see §5). Must stay paired with Linear webhook registration. |
| `OPENAI_API_KEY` | ff-pipeline | per-worker | 0 | ThinkExecutor safety/memory models. 0 direct reads; verify. |
| `DEEPSEEK_API_KEY` | ff-pipeline, dream-do | **Shared (2)** | 1 | Optional. |
| `GC_SUPERVISOR_TOKEN` | gascity-supervisor | shared-value with `GAS_CITY_BEARER_TOKEN` | 1 | Same value as ff-pipeline's `GAS_CITY_BEARER_TOKEN`. |
| `GAS_CITY_BEARER_TOKEN` | ff-pipeline | shared-value with `GC_SUPERVISOR_TOKEN` | 3 | See above — store once, bind under both names if names must differ, or unify on one name. |
| `GAS_CITY_HMAC_SECRET_V1` | ff-pipeline (+ Gas City webhook signer) | **Shared** | 2 | Webhook HMAC. |
| `CF_API_TOKEN` | ff-pipeline | per-worker | 3 | |
| `GITHUB_TOKEN` | ff-pipeline | per-worker | 6 | Highest call-site count. |
| `HONEYCOMB_API_KEY` | ff-pipeline | per-worker | 0 | |
| `ARANGO_ROOT_PASSWORD` | ff-arango (shared value with ff-pipeline `ARANGO_PASSWORD`) | shared-value | 1 | **DEPRECATED** path — ArangoDB being removed (D1 migration). Do NOT migrate; let it retire. |

### Unique-secret count (against the 100/account limit)
Distinct secret names to provision (excluding the deprecated `ARANGO_*` pair):

`WEOPS_SIGNING_KEY`, `LINEAR_API_KEY`, `FF_AGENT_SIGNING_KEY`, `SUB_BUFFER_PRODUCER_SECRET`,
`OFOX_API_KEY`, `OPERATOR_CONTROL_TOKEN`, `ANTHROPIC_API_KEY`, `PDP_API_KEY`,
`LINEAR_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GAS_CITY_BEARER_TOKEN`
(unify `GC_SUPERVISOR_TOKEN` onto this), `GAS_CITY_HMAC_SECRET_V1`, `CF_API_TOKEN`,
`GITHUB_TOKEN`, `HONEYCOMB_API_KEY`.

= **16 distinct secrets**. Well under the 100/account cap (84 headroom). All are short tokens
or base64 keys, far under the 1 KB/secret cap.

---

## Spec (numbered rules)

### S1 — Bootstrap the store (once, by a security admin)
```bash
# Create the account-level store. Capture the printed STORE_ID — every binding needs it.
npx wrangler secrets-store store create ff-factory-secrets --remote

# Export it for the provisioning loop below.
export FF_STORE_ID=<store-id-printed-above>
```

### S2 — Provision each secret (once each)
`secret create` requires the STORE-ID positional, `--name`, and `--scopes workers`. Provide
the value with `--value` (or omit `--value` to be prompted; prefer prompt or piping so the
value is not in shell history).
```bash
for NAME in \
  WEOPS_SIGNING_KEY LINEAR_API_KEY FF_AGENT_SIGNING_KEY SUB_BUFFER_PRODUCER_SECRET \
  OFOX_API_KEY OPERATOR_CONTROL_TOKEN ANTHROPIC_API_KEY PDP_API_KEY \
  LINEAR_WEBHOOK_SECRET OPENAI_API_KEY DEEPSEEK_API_KEY GAS_CITY_BEARER_TOKEN \
  GAS_CITY_HMAC_SECRET_V1 CF_API_TOKEN GITHUB_TOKEN HONEYCOMB_API_KEY ; do
  npx wrangler secrets-store secret create "$FF_STORE_ID" \
    --name "$NAME" --scopes workers --remote
done
```
Record each secret's printed opaque `secret-id` (needed for `update`/rotation). Keep a
mapping `NAME → secret-id` in the store (use `secret list` to recover it any time):
```bash
npx wrangler secrets-store secret list "$FF_STORE_ID" --remote
```

### S3 — Binding block per worker (`wrangler.jsonc`)
For each worker, **add** a `secrets_store_secrets` array and **remove** the
`// Secrets (set via wrangler secret put): …` comment block. The `binding` name is what code
reads as `env.<binding>`; keep it equal to the secret name for clarity.

**ff-gateway** — add:
```jsonc
"secrets_store_secrets": [
  { "binding": "WEOPS_SIGNING_KEY",   "store_id": "<FF_STORE_ID>", "secret_name": "WEOPS_SIGNING_KEY" },
  { "binding": "FF_AGENT_SIGNING_KEY", "store_id": "<FF_STORE_ID>", "secret_name": "FF_AGENT_SIGNING_KEY" }
]
```
Remove `// [DEPRECATED] ARANGO_* …` comment lines only if those secrets are confirmed unset.

**factory-gateway** — add:
```jsonc
"secrets_store_secrets": [
  { "binding": "WEOPS_SIGNING_KEY", "store_id": "<FF_STORE_ID>", "secret_name": "WEOPS_SIGNING_KEY" },
  { "binding": "PDP_API_KEY",        "store_id": "<FF_STORE_ID>", "secret_name": "PDP_API_KEY" }
]
```
Remove the `// Secrets … WEOPS_SIGNING_KEY … PDP_API_KEY` comment block.

**linear-bridge** — add:
```jsonc
"secrets_store_secrets": [
  { "binding": "LINEAR_WEBHOOK_SECRET", "store_id": "<FF_STORE_ID>", "secret_name": "LINEAR_WEBHOOK_SECRET" },
  { "binding": "LINEAR_API_KEY",         "store_id": "<FF_STORE_ID>", "secret_name": "LINEAR_API_KEY" },
  { "binding": "WEOPS_SIGNING_KEY",      "store_id": "<FF_STORE_ID>", "secret_name": "WEOPS_SIGNING_KEY" }
]
```
Remove the `// Secrets … LINEAR_WEBHOOK_SECRET / LINEAR_API_KEY / WEOPS_SIGNING_KEY` block.

**ff-commissioning-agent** — add:
```jsonc
"secrets_store_secrets": [
  { "binding": "LINEAR_API_KEY",             "store_id": "<FF_STORE_ID>", "secret_name": "LINEAR_API_KEY" },
  { "binding": "FF_AGENT_SIGNING_KEY",        "store_id": "<FF_STORE_ID>", "secret_name": "FF_AGENT_SIGNING_KEY" },
  { "binding": "SUB_BUFFER_PRODUCER_SECRET",  "store_id": "<FF_STORE_ID>", "secret_name": "SUB_BUFFER_PRODUCER_SECRET" },
  { "binding": "OFOX_API_KEY",                "store_id": "<FF_STORE_ID>", "secret_name": "OFOX_API_KEY" }
]
```

**ff-mediation-agent** — confirm which secrets it actually reads (`wrangler.jsonc` has no
secrets comment; check `src/`). If it consumes any shared secret (likely `FF_AGENT_SIGNING_KEY`
or `OFOX_API_KEY`), add matching binding entries; otherwise no change.

**factory-subscription-buffer** — add:
```jsonc
"secrets_store_secrets": [
  { "binding": "SUB_BUFFER_PRODUCER_SECRET", "store_id": "<FF_STORE_ID>", "secret_name": "SUB_BUFFER_PRODUCER_SECRET" }
]
```

**ff-architect-agent** — add `OPERATOR_CONTROL_TOKEN`, `FF_AGENT_SIGNING_KEY`.

**ff-linear-sync** — add `LINEAR_API_KEY`.

**ff-pipeline** — add the full set it lists: `OFOX_API_KEY`, `CF_API_TOKEN`, `GITHUB_TOKEN`,
`OPERATOR_CONTROL_TOKEN`, `GAS_CITY_BEARER_TOKEN`, `GAS_CITY_HMAC_SECRET_V1`,
`HONEYCOMB_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`,
`SUB_BUFFER_PRODUCER_SECRET`. (Largest binding set — migrate last.)

**gascity-supervisor** — add `ANTHROPIC_API_KEY`, and `GAS_CITY_BEARER_TOKEN` bound under the
`GC_SUPERVISOR_TOKEN` binding name if the code still reads `env.GC_SUPERVISOR_TOKEN`:
```jsonc
{ "binding": "GC_SUPERVISOR_TOKEN", "store_id": "<FF_STORE_ID>", "secret_name": "GAS_CITY_BEARER_TOKEN" }
```
> `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are consumed by Dolt via S3 API, not by the
> Worker runtime. Out of scope — leave as-is unless a follow-up confirms Worker-side reads.

**dream-do** — `DEEPSEEK_API_KEY` (optional). Add binding only if you want it managed
centrally; otherwise leave as a per-worker optional secret.

**ff-arango** — **do NOT migrate.** `ARANGO_ROOT_PASSWORD` is on the deprecated ArangoDB path.

### S4 — Env interface + call-site changes (per worker, MANDATORY)
Because the binding is an object, **both** the type and every read change.

In each `env.ts` / `Env` interface, change the type:
```ts
// before
WEOPS_SIGNING_KEY: string
// after
WEOPS_SIGNING_KEY: SecretsStoreSecret
```
`SecretsStoreSecret` is provided by `@cloudflare/workers-types`; ensure the worker's
`tsconfig`/types include it (regenerate with `wrangler types` if the project uses generated
`Env`). At every call site change the read:
```ts
// before
const key = env.WEOPS_SIGNING_KEY
// after
const key = await env.WEOPS_SIGNING_KEY.get()
```
The enclosing function must be `async`. Cache the resolved value within a request scope rather
than calling `.get()` in hot loops. Known high-churn workers by call-site count:
`ff-pipeline` (`GITHUB_TOKEN` ×6, `OFOX_API_KEY`, `CF_API_TOKEN` ×3, `GAS_CITY_BEARER_TOKEN`
×3), then commissioning/gateway workers.

**Per-worker Tessera gate:** before editing any symbol that reads a secret, run
`tessera_impact({target, direction:"upstream"})` and report blast radius; run
`tessera_detect_changes()` before each worker's commit. (Repo rule, AGENTS.md / CLAUDE.md.)

### S5 — Deploy-script simplification
With Secrets Store, deploy scripts **never see secret values**. Rewrite to deploy only.

`scripts/deploy-linear-bridge.sh` splits into two concerns:
- **Secret + webhook bootstrap (one-time / on rotation):** generating `LINEAR_WEBHOOK_SECRET`
  and registering the Linear webhook still needs the raw value at generation time, because the
  *same* value must be written to both the store and Linear's `webhookCreate`. Keep a separate
  `scripts/bootstrap-linear-webhook.sh` that: `openssl rand -hex 32` → `wrangler secrets-store
  secret create/update … --name LINEAR_WEBHOOK_SECRET --value "$SECRET"` → `webhookCreate` with
  the same `$SECRET`. It no longer pipes `LINEAR_API_KEY`/`WEOPS_SIGNING_KEY` anywhere.
- **Deploy (every redeploy):** drops the entire secrets section. New shape:
```bash
#!/bin/bash
set -euo pipefail
echo "Deploying linear-bridge (secrets via Secrets Store; none set here)"
npx wrangler deploy -c workers/linear-bridge/wrangler.jsonc
echo "Done. Bindings resolve from store ff-factory-secrets at runtime."
```
Apply the same pattern to `deploy-i-layer.sh`, `deploy-graphql-gateway.sh`, and the
`deploy-phase*.sh` scripts: remove every `echo "$VAR" | wrangler secret put …` line; keep only
`wrangler deploy`. Operators no longer need any secret env var exported to redeploy.

### S6 — Rotation procedure (no redeploy, no shell secrets)
Rotation is `secret update` against the store; bindings re-resolve on next request — **no
worker redeploy required.**
```bash
# 1. find the secret-id once
npx wrangler secrets-store secret list "$FF_STORE_ID" --remote   # note id for the target name

# 2. rotate (value prompted or piped; not stored in history)
npx wrangler secrets-store secret update "$FF_STORE_ID" \
  --secret-id <SECRET_ID> --value <NEW_VALUE> --remote
```
- Rotating `WEOPS_SIGNING_KEY` now updates **all three** consumers (ff-gateway,
  factory-gateway, linear-bridge) atomically from one command — eliminating the silent-drift
  failure mode that exists today.
- `LINEAR_WEBHOOK_SECRET` is the exception: rotating it must update **both** the store value
  **and** the Linear webhook registration in the same pass (run `bootstrap-linear-webhook.sh`),
  because Linear holds the matching HMAC secret out-of-band.
- Caveat (CF beta): if a Worker's deployed version differs from its latest version, secret
  modification is blocked until the latest version is deployed (cloudflare/workers-sdk#10585).
  Ensure `wrangler deploy` is current before rotating.

---

## Migration steps (no downtime)

Per-worker secrets and Secrets Store bindings **coexist**; migrate one worker at a time. A
binding only takes effect when code calls `.get()`, so old per-worker secrets stay live until
the worker is cut over and redeployed.

1. **Bootstrap (S1–S2):** create store, provision all 16 secrets with current values, record
   `NAME → secret-id`. No worker touched yet.
2. **Pilot — `factory-subscription-buffer`** (1 secret, 1 call site): add binding (S3), convert
   env type + call site to `await .get()` (S4), `wrangler deploy`, verify HMAC producer-token
   path works end-to-end. Smallest blast radius validates the pattern.
3. **`linear-bridge`** next (3 secrets incl. the shared `WEOPS_SIGNING_KEY` and the
   webhook-paired secret). Split deploy script (S5). Verify webhook signature + Linear GraphQL.
4. **Shared-key consumers in lockstep:** migrate `ff-gateway` and `factory-gateway` so all
   three `WEOPS_SIGNING_KEY` readers resolve from the store. Until all three are cut over, do
   NOT delete the per-worker `WEOPS_SIGNING_KEY` from any of them.
5. **Agent workers:** `ff-commissioning-agent`, `ff-architect-agent`, `ff-linear-sync`,
   `ff-mediation-agent` (confirm its secrets first).
6. **`ff-pipeline` last** (largest binding set + highest call-site churn). Then
   `gascity-supervisor` (resolve the `GC_SUPERVISOR_TOKEN`/`GAS_CITY_BEARER_TOKEN` name
   unification, S3).
7. **Decommission:** once a worker is verified on store bindings, delete its now-unused
   per-worker secrets with `wrangler secret delete NAME -c <worker>/wrangler.jsonc`. Do this
   only after the deployed version reads exclusively from `.get()`.
8. **Verify rotation** end-to-end on one non-critical secret (e.g. `HONEYCOMB_API_KEY`) before
   declaring done: `secret update` → confirm new value observed at runtime with no redeploy.

Each worker is independently committable. Gate every worker's PR on `tsc`, `npm test`, and
`tessera_detect_changes()` (CLAUDE.md / AGENTS.md). Done = the worker runs in the real
environment, reads its secrets via `.get()`, and shows live behavior (DONE MEANS DEPLOYED).

---

## Limitations to note

- **Public beta.** Secrets Store is open-beta; API/CLI shapes can shift. Pin behavior to the
  docs cited above and re-verify before each phase.
- **100 secrets / account.** We provision **16** → 84 headroom. Safe.
- **1 KB / secret.** All our values are short tokens / base64 keys → safe.
- **No `rotate` command; update by `--secret-id`, not name.** Maintain a `NAME → secret-id`
  map (recoverable via `secret list`). Tracking issue: cloudflare/workers-sdk#10610.
- **Runtime cost of `.get()`.** Async fetch per binding; cache within request scope, never call
  in tight loops.
- **Version-skew block on modify.** Worker latest version must be deployed before a secret can
  be modified (cloudflare/workers-sdk#10585).
- **Out of scope:** `ARANGO_ROOT_PASSWORD` (deprecated ArangoDB path), and Dolt's
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (consumed by Dolt-over-S3, not Worker runtime).

---

## Open items

1. **Confirm `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` access path.** 0 direct `env.` reads found;
   they are likely passed into DOs or SDK clients indirectly. Trace before binding so the
   `.get()` conversion lands at the correct call site.
2. **`ff-mediation-agent` secret inventory.** Its `wrangler.jsonc` has no secrets comment;
   enumerate actual `env.*` secret reads in `src/` before deciding its binding set.
3. **`GC_SUPERVISOR_TOKEN` vs `GAS_CITY_BEARER_TOKEN` naming.** Decide: bind one store secret
   under two binding names, or unify code on one name. Recommend unify on
   `GAS_CITY_BEARER_TOKEN` and bind it under the legacy `GC_SUPERVISOR_TOKEN` binding name to
   avoid a code change on gascity-supervisor.
4. **RBAC roles.** Define who holds Secrets Store admin (provision/rotate/delete) vs developer
   (reference-only). Document in the runbook; not enforceable from wrangler config.
5. **`store_id` injection.** `store_id` is an opaque value repeated across ~11 `wrangler.jsonc`
   files. Decide whether to hardcode it (simplest, beta-acceptable) or template it; if
   templated, the deploy scripts must substitute it before `wrangler deploy`.
6. **`SecretsStoreSecret` type availability.** Verify each worker's `@cloudflare/workers-types`
   version exports it; bump and regenerate `wrangler types` where missing.
