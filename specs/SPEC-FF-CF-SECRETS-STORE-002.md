# SPEC-FF-CF-SECRETS-STORE-002 — CF Secrets Store Migration — Factory Workers (CI-Compatible)

| Field | Value |
|-------|-------|
| Spec ID | SPEC-FF-CF-SECRETS-STORE-002 |
| Status | Ready for Workflow execution |
| Supersedes | SPEC-FF-CF-SECRETS-STORE-001 (draft) |
| Author | Architect |
| Date | 2026-06-16 |
| Scope | All Cloudflare Workers in `function-factory/workers/*` that declare secrets, their `packages/*` source, the `scripts/deploy-*.sh` deploy path, `.dev.vars`, and (optionally) a new deploy CI workflow |
| Type | Infrastructure / configuration migration. No business-logic change. |

---

## 0. JTBD

> **When** I need to redeploy any factory Worker (by hand, by deploy script, or by a future CI deploy job),
> **I want to** run `wrangler deploy` with **zero secret values present in the environment** — only the CF API token, account ID, and the (non-secret) store ID,
> **so I can** deploy and rotate credentials without secret values ever transiting an operator shell or a CI runner, and without manually keeping shared secrets byte-identical across workers.

---

## 1. The CI constraint, stated honestly (read this first)

**Current reality, verified in this repo (do not skip — the original brief mis-states it):**

- `.github/workflows/ci.yml` **does not deploy any Worker.** It runs only `typecheck`, `test`,
  `repository-audit`, `factory-pr-check`, and `singleton-rotation-check`. There is **no
  `wrangler deploy` and no `wrangler secret put` anywhere in CI today.**
- The only secret referenced in CI is `${{ secrets.GITHUB_TOKEN }}` on the `factory-pr-check`
  job's fidelity step. That is the **standard GitHub Actions token**, not a deployment
  credential, and is **out of scope** — leave it.
- **All `wrangler secret put` calls live in `scripts/deploy-*.sh`**, run from an operator's
  machine, where the secret values are exported as shell env vars
  (`deploy-linear-bridge.sh`, `deploy-i-layer.sh`, `deploy-graphql-gateway.sh`). These scripts
  are the real "secret pipeline," not CI.

**Therefore "CI-compatible" in this spec means two concrete things:**

1. **Deploy path requires zero secret env vars.** After migration, `wrangler deploy` for every
   migrated worker needs only `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the
   binding metadata in `wrangler.jsonc` (which includes the **non-secret** `store_id`). No
   `WEOPS_SIGNING_KEY`, `LINEAR_API_KEY`, etc. need to exist anywhere a deploy runs.
2. **The deploy path becomes safely promotable into CI.** Because deploy no longer touches
   secret values, a future GitHub Actions deploy job (§5.4) can run `wrangler deploy` using
   only the two CF env vars stored as repo/org secrets — no per-secret pipeline. This spec
   ships that optional workflow but does not require enabling auto-deploy.

**Hard constraint — the agent-PR guard.** `ci.yml → factory-pr-check` blocks any PR labeled
`factory-generated` that touches `wrangler.jsonc`, `.github/`, `CLAUDE.md`, or `AGENTS.md`
(lines 111–115). This migration edits **every** `wrangler.jsonc` and (optionally) `.github/`.
**It must therefore be executed on a human/privileged branch, NOT as a `factory-generated`
agent PR.** Do not label the migration PR `factory-generated`. The Workflow executing this
spec runs under the operator's identity, not the autonomous factory pipeline.

**Tooling prerequisite — wrangler v4.** `secrets_store_secrets` bindings require wrangler v4.
This repo has mixed versions (`^3.100.0` in at least one package, `^4.0.0`, `^4.99.0`
elsewhere). Before migrating any worker, confirm its effective wrangler is **≥ 4.x**
(`npx wrangler --version` from that worker dir) and bump the package if it resolves to v3.
A worker on wrangler v3 cannot deploy a `secrets_store_secrets` binding.

---

## 2. Account setup (one-time, human-run; CI never does this)

Run once by a Secrets Store **admin**. CI and deploy scripts never execute §2.

### 2.1 Create the store

```bash
# Creates the account-level store. Capture the printed STORE_ID — every binding needs it.
npx wrangler secrets-store store create factory-secrets --remote
# → prints: store_id = <opaque-uuid>     ← RECORD THIS. It is NOT a secret.
```

Record the printed `store_id`. It is a **binding identifier, not a secret** — it goes into
each `wrangler.jsonc` and may appear in CI env in the clear. Capture it for the migration:

```bash
export FF_STORE_ID=5f51936ccef540ce825687d0afe96373
```

### 2.2 Create each secret (one-time each; values supplied here only)

`secret create` takes the STORE-ID positional, `--name`, `--scopes workers`, and the value.
Pipe the value (or omit `--value` to be prompted) so it never lands in shell history.

```bash
# Example for one secret; repeat per name in the §3 inventory.
printf '%s' "$THE_VALUE" | npx wrangler secrets-store secret create "$FF_STORE_ID" \
  --name WEOPS_SIGNING_KEY --scopes workers --remote
```

Provisioning loop for all 16 (admin supplies each value when prompted):

```bash
for NAME in \
  WEOPS_SIGNING_KEY LINEAR_API_KEY FF_AGENT_SIGNING_KEY SUB_BUFFER_PRODUCER_SECRET \
  OFOX_API_KEY OPERATOR_CONTROL_TOKEN ANTHROPIC_API_KEY PDP_API_KEY \
  LINEAR_WEBHOOK_SECRET OPENAI_API_KEY DEEPSEEK_API_KEY \
  CF_API_TOKEN GITHUB_TOKEN HONEYCOMB_API_KEY ; do
  npx wrangler secrets-store secret create "$FF_STORE_ID" \
    --name "$NAME" --scopes workers --remote   # prompts for value
done
```

### 2.3 Record the NAME → secret-id map

`update`/rotation needs each secret's opaque `secret-id`, not its name. Recover any time:

```bash
npx wrangler secrets-store secret list "$FF_STORE_ID" --remote
```

Keep the `NAME → secret-id` map in the operator runbook (not in the repo).

**CI boundary:** §2 runs **once, by an admin**. CI never creates the store or any secret. The
only thing CI/deploy ever needs from §2 is the **non-secret `FF_STORE_ID`**.

---

## 3. Secret inventory (16 distinct secrets)

Distinct names to provision = **14** (against the 100/account cap → 86 headroom; all values
are short tokens/base64 → far under the 1 KB/secret cap). The deprecated `ARANGO_*` pair and
Gas City secrets are excluded — see §3.3.

### 3.1 Shared secrets (same value, multiple workers)

| Secret | Workers binding it | Why shared / risk today |
|--------|--------------------|--------------------------|
| `WEOPS_SIGNING_KEY` | ff-gateway, factory-gateway, linear-bridge | base64 HMAC-SHA256. Must be byte-identical across all 3 or WGSP verification fails silently. **Top priority** — silent-drift risk exists today. |
| `LINEAR_API_KEY` | ff-commissioning-agent, ff-linear-sync, linear-bridge | Linear PAT / Bearer for GraphQL. |
| `FF_AGENT_SIGNING_KEY` | ff-gateway, ff-architect-agent, ff-commissioning-agent | WGSP envelope signing key. |
| `SUB_BUFFER_PRODUCER_SECRET` | ff-commissioning-agent, ff-mediation-agent, factory-subscription-buffer, ff-pipeline (CoordinatorDO) | HMAC producer-token secret (§5.2 of the buffer protocol). **Confirmed** read in mediation-agent (`mediation-agent-do.ts:76–77`) and buffer (`buffer-do.ts:142`). |
| `OFOX_API_KEY` | ff-commissioning-agent, ff-pipeline | OFOX gateway (OpenAI-compatible). High call-site count in ff-pipeline. |
| `OPERATOR_CONTROL_TOKEN` | ff-architect-agent, ff-pipeline | Bearer for WeOps gateway. |
| `ANTHROPIC_API_KEY` | ff-pipeline | 0 **direct** `env.` reads found — passed into SDK clients/DOs indirectly. **Trace before binding** (see §4.4). |
| `DEEPSEEK_API_KEY` | ff-pipeline, dream-do | Optional. |

### 3.2 Worker-specific secrets (one consumer)

| Secret | Worker | Notes |
|--------|--------|-------|
| `PDP_API_KEY` | factory-gateway | Bearer for PDP calls. |
| `LINEAR_WEBHOOK_SECRET` | linear-bridge | Generated by bootstrap (§7.4); **must stay paired** with the Linear webhook registration. |
| `OPENAI_API_KEY` | ff-pipeline | ThinkExecutor safety/memory models. 0 direct reads — verify (§4.4). |
| `CF_API_TOKEN` | ff-pipeline | 3 call sites. |
| `GITHUB_TOKEN` | ff-pipeline | **Highest call-site count (6).** Do not confuse with CI's Actions `GITHUB_TOKEN` — this is a separate PAT consumed by ff-pipeline at runtime. |
| `HONEYCOMB_API_KEY` | ff-pipeline | 0 call sites; good rotation-test candidate (§7). |

### 3.3 Explicitly OUT of scope (do not migrate)

- `ARANGO_ROOT_PASSWORD` / `ARANGO_URL` / `ARANGO_DATABASE` / `ARANGO_JWT` — deprecated
  ArangoDB path (D1 migration in progress). The `ff-gateway` comment block already marks these
  `[DEPRECATED]`. Leave them; let them retire. Remove only the comment lines, not via secret
  delete unless confirmed already unset.
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — consumed by Dolt-over-S3, **not** by the
  Worker runtime. Out of scope.

---

## 4. wrangler.jsonc binding changes

### 4.1 The binding shape (authoritative)

CF beta uses `secrets_store_secrets` (NOT `secrets_store_bindings`), keyed by `store_id` (NOT
`store_name`). One block entry per secret:

```jsonc
"secrets_store_secrets": [
  { "binding": "SECRET_NAME", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "SECRET_NAME" }
]
```

- `binding` = what code reads as `env.<binding>`. Keep equal to `secret_name` for clarity,
  except the one deliberate exception noted in §3.4 (now removed — Gas City retired).
- `store_id` = the opaque ID from §2.1. **Hardcode the literal value** in each `wrangler.jsonc`
  (decision below). It is not a secret.
- Replace `5f51936ccef540ce825687d0afe96373` below with the real store id before committing.

**store_id injection decision (resolves Open Item 5 from 001):** **hardcode the literal
`store_id` string in every `wrangler.jsonc`.** It is a non-secret identifier, beta-acceptable,
and avoids a templating step in the deploy path (which is what keeps deploy "zero-secret" and
CI-promotable). Do not template it.

Per-worker secrets and store bindings **coexist**; a store binding only takes effect when code
calls `.get()`. Old per-worker secrets stay live until each worker is cut over and redeployed.

### 4.2 Per-worker binding blocks

Add the `secrets_store_secrets` array to each `wrangler.jsonc` and remove that file's
`// Secrets (set via wrangler secret put): …` comment block.

**ff-gateway** (`workers/ff-gateway/wrangler.jsonc`) — add after `"vars"`, remove the
`[DEPRECATED] ARANGO_*` comment block:
```jsonc
"secrets_store_secrets": [
  { "binding": "WEOPS_SIGNING_KEY",    "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "WEOPS_SIGNING_KEY" },
  { "binding": "FF_AGENT_SIGNING_KEY", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "FF_AGENT_SIGNING_KEY" }
]
```
> Note: the trailing `,` after the `"vars"` object is required since the file currently ends
> the object with `"vars"` and a comment. Add the comma, then the array.

**factory-gateway** (`workers/factory-gateway/wrangler.jsonc`) — add after the `"services"`
array, remove the `// Secrets … WEOPS_SIGNING_KEY … PDP_API_KEY` block:
```jsonc
"secrets_store_secrets": [
  { "binding": "WEOPS_SIGNING_KEY", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "WEOPS_SIGNING_KEY" },
  { "binding": "PDP_API_KEY",       "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "PDP_API_KEY" }
]
```

**linear-bridge** (`workers/linear-bridge/wrangler.jsonc`) — add after `"vars"`, remove the
secrets comment block (keep `WEOPS_GATEWAY_URL` — it is a var, not a secret):
```jsonc
"secrets_store_secrets": [
  { "binding": "LINEAR_WEBHOOK_SECRET", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "LINEAR_WEBHOOK_SECRET" },
  { "binding": "LINEAR_API_KEY",        "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "LINEAR_API_KEY" },
  { "binding": "WEOPS_SIGNING_KEY",     "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "WEOPS_SIGNING_KEY" }
]
```

**ff-commissioning-agent** (`workers/ff-commissioning-agent/wrangler.jsonc`) — add after
`"vars"`, remove the secrets comment block:
```jsonc
"secrets_store_secrets": [
  { "binding": "LINEAR_API_KEY",             "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "LINEAR_API_KEY" },
  { "binding": "FF_AGENT_SIGNING_KEY",       "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "FF_AGENT_SIGNING_KEY" },
  { "binding": "SUB_BUFFER_PRODUCER_SECRET", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "SUB_BUFFER_PRODUCER_SECRET" },
  { "binding": "OFOX_API_KEY",               "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "OFOX_API_KEY" }
]
```

**ff-mediation-agent** (`workers/ff-mediation-agent/wrangler.jsonc`) — **confirmed reader** of
`SUB_BUFFER_PRODUCER_SECRET` (`packages/mediation-agent/src/mediation-agent-do.ts:53,76,77`).
Add after `"vars"`:
```jsonc
"secrets_store_secrets": [
  { "binding": "SUB_BUFFER_PRODUCER_SECRET", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "SUB_BUFFER_PRODUCER_SECRET" }
]
```
(This worker's `wrangler.jsonc` has no secrets comment block to remove.)

**factory-subscription-buffer** (`workers/factory-subscription-buffer/wrangler.jsonc`) — add
after the `kv_namespaces` array, remove the secrets comment block:
```jsonc
"secrets_store_secrets": [
  { "binding": "SUB_BUFFER_PRODUCER_SECRET", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "SUB_BUFFER_PRODUCER_SECRET" }
]
```

**ff-architect-agent** (`workers/ff-architect-agent/wrangler.jsonc`) — add:
```jsonc
"secrets_store_secrets": [
  { "binding": "OPERATOR_CONTROL_TOKEN", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "OPERATOR_CONTROL_TOKEN" },
  { "binding": "FF_AGENT_SIGNING_KEY",   "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "FF_AGENT_SIGNING_KEY" }
]
```

**ff-linear-sync** (`workers/ff-linear-sync/wrangler.jsonc`) — add:
```jsonc
"secrets_store_secrets": [
  { "binding": "LINEAR_API_KEY", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "LINEAR_API_KEY" }
]
```

**ff-pipeline** (`workers/ff-pipeline/wrangler.jsonc`) — largest set; **migrate last**:
```jsonc
"secrets_store_secrets": [
  { "binding": "OFOX_API_KEY",               "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "OFOX_API_KEY" },
  { "binding": "CF_API_TOKEN",               "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "CF_API_TOKEN" },
  { "binding": "GITHUB_TOKEN",               "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "GITHUB_TOKEN" },
  { "binding": "OPERATOR_CONTROL_TOKEN",     "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "OPERATOR_CONTROL_TOKEN" },
  { "binding": "HONEYCOMB_API_KEY",          "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "HONEYCOMB_API_KEY" },
  { "binding": "ANTHROPIC_API_KEY",          "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "ANTHROPIC_API_KEY" },
  { "binding": "OPENAI_API_KEY",             "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "OPENAI_API_KEY" },
  { "binding": "DEEPSEEK_API_KEY",           "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "DEEPSEEK_API_KEY" },
  { "binding": "SUB_BUFFER_PRODUCER_SECRET", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "SUB_BUFFER_PRODUCER_SECRET" }
]
```

**dream-do** (`workers/dream-do/wrangler.jsonc`) — `DEEPSEEK_API_KEY` only **if** centralizing:
```jsonc
"secrets_store_secrets": [
  { "binding": "DEEPSEEK_API_KEY", "store_id": "5f51936ccef540ce825687d0afe96373", "secret_name": "DEEPSEEK_API_KEY" }
]
```

**ff-arango** — **do NOT modify.** Deprecated ArangoDB path.

---

## 5. Call-site migration pattern

The binding is an **object**, not a string. Two changes per secret per worker: the env type,
and every read site.

### 5.1 Env interface change

In each worker's `env.ts` / `Env` interface (and the corresponding type in `packages/*` for
DO-hosting packages), change the type:
```ts
// before
WEOPS_SIGNING_KEY: string
// after
WEOPS_SIGNING_KEY: SecretsStoreSecret
```
`SecretsStoreSecret` comes from `@cloudflare/workers-types`. Confirm the worker's types include
it; if `Env` is generated, run `npx wrangler types` after editing `wrangler.jsonc` so the
binding type lands automatically. Bump `@cloudflare/workers-types` if the symbol is missing
(resolves Open Item 6 from 001).

### 5.2 Read-once-into-config pattern (REQUIRED)

Never call `.get()` in hot loops. Read each needed secret **once** at the top of the entry
scope into a plain config object, then pass the resolved strings down. Two scopes apply:

**Pattern A — `fetch()` handler workers** (ff-gateway, factory-gateway, linear-bridge,
ff-linear-sync, ff-architect-agent):
```ts
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Resolve once per request, at the top, before routing.
    const secrets = {
      weopsSigningKey:    await env.WEOPS_SIGNING_KEY.get(),
      ffAgentSigningKey:  await env.FF_AGENT_SIGNING_KEY.get(),
    };
    // pass `secrets.weopsSigningKey` (a string) into handlers — do NOT pass `env.X`.
    return route(req, env, ctx, secrets);
  },
};
```
For ff-gateway specifically, the current sites `signals-handler.ts:416` (`env.WEOPS_SIGNING_KEY`),
`:482`/`:554` (`env.FF_AGENT_SIGNING_KEY`) take a string today. Change those handlers to accept
the resolved `secrets` object (or resolved strings as params) instead of reading `env.X`.

**Pattern B — Durable Object workers** (ff-commissioning-agent, ff-mediation-agent,
factory-subscription-buffer, ff-pipeline DOs). DO **constructors cannot be
`async`** and cannot `await`. Resolve lazily-once on first use and cache on the instance:
```ts
export class MediationAgentDO {
  private cachedProducerSecret?: string;
  constructor(private state: DurableObjectState, private env: Env) {}

  private async producerSecret(): Promise<string> {
    if (this.cachedProducerSecret === undefined) {
      this.cachedProducerSecret = await this.env.SUB_BUFFER_PRODUCER_SECRET.get();
    }
    return this.cachedProducerSecret;
  }
  // replace `this.env.SUB_BUFFER_PRODUCER_SECRET` reads with `await this.producerSecret()`.
}
```
Concrete sites to convert (synchronous `this.env.X` reads today → `await …get()`):
- `packages/mediation-agent/src/mediation-agent-do.ts:76–77` — guard + `emitSubscriptionEvent`.
- `packages/subscription-buffer/src/buffer-do.ts:142` — verifier reads the producer secret.
- `packages/commissioning-agent/src/env.ts:29` (`FF_AGENT_SIGNING_KEY`) and its call sites.
- `packages/architect-agent/src/env.ts:41` (`FF_AGENT_SIGNING_KEY`) and its call sites.

The enclosing function at every converted site must become `async`. Where a sync function (e.g.
a guard like `mediation-agent-do.ts:76`) reads the secret, refactor it to `async` and `await`
at the call boundary.

### 5.3 Per-worker Tessera gate (repo rule — AGENTS.md / CLAUDE.md)

Before editing any symbol that reads a secret, run
`tessera_impact({ target: "<symbol>", direction: "upstream" })` and report the blast radius.
Before each worker's commit, run `tessera_detect_changes()` to confirm only the expected
symbols/flows changed. Warn on HIGH/CRITICAL and stop.

### 5.4 Indirect-access secrets — trace before converting (resolves Open Item 1)

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` show **0 direct `env.` reads**. They are passed into SDK
clients or DOs indirectly. **Do not blindly add `.get()`** — first `grep` the construction site
(e.g. `new Anthropic({ apiKey: … })`) and convert at that exact point. If the value is read at
worker boot and threaded through, resolve it once (Pattern A/B) and inject the resolved string.

---

## 6. CI workflow changes

### 6.1 What changes in CI today: essentially nothing in `ci.yml`

Because `ci.yml` does **not** deploy and does **not** call `wrangler secret put`, there is
**nothing to remove from it.** Specifically:

- **Do NOT remove** `${{ secrets.GITHUB_TOKEN }}` from `factory-pr-check` — it is the Actions
  token for the fidelity check, not a deployment secret.
- **Do NOT touch** `typecheck`, `test`, `repository-audit`, or `singleton-rotation-check`.
- The `factory-pr-check` `wrangler.jsonc`/`.github`/`CLAUDE.md` guard (lines 111–115) **stays**.
  It is what forces this migration onto a human branch (see §1).

The "remove `wrangler secret put` from CI / remove secret env vars from CI" requirement in the
brief is satisfied **vacuously** for `ci.yml` (they were never there) and **substantively** in
the deploy scripts (§7), which are the real secret pipeline.

### 6.2 Where secret env vars actually get removed: the deploy scripts (§7)

The `echo "$VAR" | wrangler secret put …` lines and the `: "${VAR:?…}"` env-var requirements
live in `scripts/deploy-*.sh`. §7 removes them. After §7, the deploy path needs only:
- `CLOUDFLARE_API_TOKEN` (for `wrangler deploy` auth)
- `CLOUDFLARE_ACCOUNT_ID` (account selection)
- the **non-secret** `store_id` (already hardcoded in `wrangler.jsonc`; nothing to export)

### 6.3 Keep in any deploy environment (CI or local)

| Keep | Why |
|------|-----|
| `CLOUDFLARE_API_TOKEN` | wrangler deploy auth. Store as repo/org secret if deploy moves to CI. **Must include the "Secrets Store: Read" permission** so the binding resolves at deploy validation. |
| `CLOUDFLARE_ACCOUNT_ID` | account selection. Non-secret-ish; treat as config. |
| `store_id` | binding identifier, hardcoded in `wrangler.jsonc`. Non-secret. |

### 6.4 Optional new deploy workflow (now safe — does not require secret values)

Because deploy no longer needs secret values, a deploy job becomes promotable to CI. Ship this
file but **do not enable auto-deploy on push unless the operator opts in** (start with
`workflow_dispatch`). Add as `.github/workflows/deploy.yml`:

```yaml
name: Deploy Workers

on:
  workflow_dispatch:
    inputs:
      worker:
        description: "Worker dir under workers/ (e.g. linear-bridge), or 'all'"
        required: true
        default: linear-bridge

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Deploy (no secret values — store bindings resolve at runtime)
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          npx wrangler deploy -c "workers/${{ github.event.inputs.worker }}/wrangler.jsonc"
```

> This workflow edits `.github/` — it must be committed on the same **human** branch (it would
> be blocked under the `factory-generated` guard). Only `CLOUDFLARE_API_TOKEN` and
> `CLOUDFLARE_ACCOUNT_ID` are stored as repo secrets; **no per-credential secret** is needed.

### 6.5 Optional rotation CI job (update without redeploy)

A scheduled/dispatch rotation job can update a value without redeploying. It needs the new
value (a secret input) plus the two CF env vars — but **not** a full deploy:

```yaml
name: Rotate Secret
on:
  workflow_dispatch:
    inputs:
      secret_id: { description: "opaque secret-id from `secret list`", required: true }
jobs:
  rotate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Update store value (no worker redeploy)
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          NEW_VALUE: ${{ secrets.ROTATION_NEW_VALUE }}
          FF_STORE_ID: ${{ vars.FF_STORE_ID }}
        run: |
          printf '%s' "$NEW_VALUE" | npx wrangler secrets-store secret update "$FF_STORE_ID" \
            --secret-id "${{ github.event.inputs.secret_id }}" --remote
```

> `FF_STORE_ID` is a non-secret **Actions variable** (`vars`), not a secret. The new value is a
> secret input. This is the only CI surface that ever holds a secret value, and only during an
> explicit rotation run — never during a normal deploy.

---

## 7. Local dev (`.dev.vars`)

`secrets_store_secrets` bindings **do not resolve under `wrangler dev`** (no account store
access in local mode). Wrangler falls back to `.dev.vars`: a `secrets_store_secrets` binding
resolves to a `[vars]`-style entry in `.dev.vars` **by binding name**. The runtime still
exposes a `.get()`-able object locally, so the **same `await env.X.get()` code path works in
dev**; only the value source differs.

This repo already has `.dev.vars` for `factory-subscription-buffer`, `ff-pipeline`,
`ff-commissioning-agent`, `ff-gateway`. Ensure each migrated worker's `.dev.vars` contains a
line **per binding name** it now declares. `.dev.vars` is gitignored — never commit real values.

### 7.1 Exact `.dev.vars` format per worker (key = binding name)

`workers/ff-gateway/.dev.vars`:
```
WEOPS_SIGNING_KEY="<dev-base64-hmac>"
FF_AGENT_SIGNING_KEY="<dev-signing-key>"
```

`workers/factory-gateway/.dev.vars`:
```
WEOPS_SIGNING_KEY="<dev-base64-hmac>"
PDP_API_KEY="dev-anything-nonempty"
```

`workers/linear-bridge/.dev.vars`:
```
LINEAR_WEBHOOK_SECRET="<dev-hex32>"
LINEAR_API_KEY="<dev-linear-pat>"
WEOPS_SIGNING_KEY="<dev-base64-hmac>"
```

`workers/ff-commissioning-agent/.dev.vars`:
```
LINEAR_API_KEY="<dev-linear-pat>"
FF_AGENT_SIGNING_KEY="<dev-signing-key>"
SUB_BUFFER_PRODUCER_SECRET="<dev-hmac>"
OFOX_API_KEY="<dev-ofox-key>"
```

`workers/ff-mediation-agent/.dev.vars`:
```
SUB_BUFFER_PRODUCER_SECRET="<dev-hmac>"
```

`workers/factory-subscription-buffer/.dev.vars`:
```
SUB_BUFFER_PRODUCER_SECRET="<dev-hmac>"
```

`workers/ff-architect-agent/.dev.vars`:
```
OPERATOR_CONTROL_TOKEN="<dev-bearer>"
FF_AGENT_SIGNING_KEY="<dev-signing-key>"
```

`workers/ff-linear-sync/.dev.vars`:
```
LINEAR_API_KEY="<dev-linear-pat>"
```

`workers/ff-pipeline/.dev.vars`:
```
OFOX_API_KEY="<dev>"
CF_API_TOKEN="<dev>"
GITHUB_TOKEN="<dev-github-pat>"
OPERATOR_CONTROL_TOKEN="<dev>"
HONEYCOMB_API_KEY="<dev>"
ANTHROPIC_API_KEY="<dev>"
OPENAI_API_KEY="<dev>"
DEEPSEEK_API_KEY="<dev>"
SUB_BUFFER_PRODUCER_SECRET="<dev-hmac>"
```

> For shared HMAC keys (`WEOPS_SIGNING_KEY`, `SUB_BUFFER_PRODUCER_SECRET`) keep the **same dev
> value across every worker's `.dev.vars`** so local cross-worker HMAC verification matches —
> exactly the byte-identical requirement the store enforces in prod.

---

## 8. Rotation procedure

Rotation is `secret update` against the store; bindings re-resolve on the next request — **no
worker redeploy.** Worked example: rotate `WEOPS_SIGNING_KEY` (shared by ff-gateway,
factory-gateway, linear-bridge).

1. **Generate the new value**
   ```bash
   NEW_KEY="$(openssl rand -base64 32)"
   ```
2. **Find the secret-id** (once; it is stable)
   ```bash
   npx wrangler secrets-store secret list "$FF_STORE_ID" --remote   # note id for WEOPS_SIGNING_KEY
   ```
3. **Update the store value** (single command updates all 3 consumers atomically)
   ```bash
   printf '%s' "$NEW_KEY" | npx wrangler secrets-store secret update "$FF_STORE_ID" \
     --secret-id <WEOPS_SECRET_ID> --remote
   ```
4. **Propagation window (~60s).** Bindings re-resolve on next request; allow up to ~60s for
   global propagation. If the secret is a verification key where producer and verifier must
   agree (HMAC), a hard cutover can drop in-flight requests during the window. For those, use a
   **dual-credential overlap**: support `…_V1` and `…_V2` simultaneously, rotate the store to
   V2, let traffic drain, then retire V1. (`GAS_CITY_HMAC_SECRET_V1`'s `_V1` suffix exists for
   exactly this — add `_V2` as a second store secret + binding for overlap, then remove `_V1`.)
5. **Verify all 3 workers picked it up** (no redeploy)
   ```bash
   curl https://ff-gateway.koales.workers.dev/health
   curl https://factory-gateway.koales.workers.dev/health
   curl https://linear-bridge.koales.workers.dev/health
   # then exercise a real signed request end-to-end and confirm HMAC verification passes
   ```
6. **`LINEAR_WEBHOOK_SECRET` is the exception** — rotating it must update **both** the store
   value **and** the Linear webhook registration in one pass (Linear holds the matching HMAC
   out-of-band). Run `scripts/bootstrap-linear-webhook.sh` (§7.4 of the deploy-script changes),
   which writes the same generated value to the store and to Linear `webhookCreate`/update.

**Version-skew caveat (CF beta).** If a Worker's deployed version differs from its latest
version, secret modification is blocked until the latest is deployed
(cloudflare/workers-sdk#10585). Run `wrangler deploy` for the affected workers before rotating.

### Deploy-script changes that enable §8 (the actual env-var removal)

These rewrites remove every `echo "$VAR" | wrangler secret put` and `: "${VAR:?…}"` from the
deploy path so deploys need zero secret env vars.

**`scripts/deploy-linear-bridge.sh`** — split into two:
- **`scripts/bootstrap-linear-webhook.sh`** (one-time / on rotation only): `openssl rand -hex 32`
  → `wrangler secrets-store secret create/update … --name LINEAR_WEBHOOK_SECRET` → Linear
  `webhookCreate` with the **same** value. No longer pipes `LINEAR_API_KEY` or
  `WEOPS_SIGNING_KEY` anywhere; reads `LINEAR_API_KEY` only as a local arg for the GraphQL call,
  not to set a worker secret.
- **`scripts/deploy-linear-bridge.sh`** (every redeploy) becomes:
  ```bash
  #!/bin/bash
  set -euo pipefail
  echo "Deploying linear-bridge (secrets via Secrets Store; none set here)"
  npx wrangler deploy -c workers/linear-bridge/wrangler.jsonc
  echo "Done. Bindings resolve from store factory-secrets at runtime."
  ```

**`scripts/deploy-i-layer.sh`** — remove lines 13–19 (env-var docs), 26–28 (`: "${VAR:?}"`),
and 42–52 (all three `wrangler secret put` for commissioning-agent + the mediation-agent one).
Keep the typecheck and the two `wrangler deploy` blocks.

**`scripts/deploy-graphql-gateway.sh`** — remove lines 13–19, 25–26, and 40–44 (the
`WEOPS_SIGNING_KEY` / `PDP_API_KEY` `secret put` block). Keep typecheck + both deploys.

**`scripts/deploy-phase*.sh`** — audit for any `wrangler secret put`; remove and keep only
`wrangler deploy`.

After these edits, **no `deploy-*.sh` requires any secret env var.** Operators run them with
just `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` configured in their wrangler login.

---

## 9. Migration sequence

Migrate one worker at a time, lowest blast radius first. Per-worker secrets and store bindings
coexist, so old secrets stay live until each worker is cut over and redeployed.

| # | Worker | Secrets | Why this order | Checkpoint |
|---|--------|---------|----------------|------------|
| 0 | — | bootstrap §2 | Create store + all 16 secrets with current values; record NAME→secret-id. No worker touched. | `secret list` shows 16 names. |
| 1 | **factory-subscription-buffer** | 1 (`SUB_BUFFER_PRODUCER_SECRET`) | 1 secret, 1 call site (`buffer-do.ts:142`). Smallest blast radius — validates the whole pattern. | Deploy; producer-token HMAC path verifies end-to-end. |
| 2 | **ff-mediation-agent** | 1 (same secret) | Confirms the DO lazy-cache pattern (§5.2 B) on a single shared secret already proven in #1. | Deploy; `emitSubscriptionEvent` succeeds against the buffer. |
| 3 | **linear-bridge** | 3 (incl. shared `WEOPS_SIGNING_KEY`, webhook-paired secret) | Exercises shared-key + webhook pairing + deploy-script split (§8). | Deploy via new script; webhook signature + Linear GraphQL verify. |
| 4 | **ff-gateway** + **factory-gateway** (lockstep) | shared `WEOPS_SIGNING_KEY` | All three `WEOPS_SIGNING_KEY` readers must resolve from the store before deleting any per-worker copy. Do these together. | Both deploy; a signed WGSP request verifies across gateway → linear-bridge. **Do NOT delete per-worker `WEOPS_SIGNING_KEY` until all 3 (incl. linear-bridge) are cut over.** |
| 5 | **ff-commissioning-agent**, **ff-architect-agent**, **ff-linear-sync** | shared agent keys | Agent workers; `FF_AGENT_SIGNING_KEY` / `LINEAR_API_KEY` already proven shared by earlier steps. | Each deploys; signal intake + Linear sync verify. |
| 7 | **ff-pipeline** | 11 (largest set, highest churn incl. `GITHUB_TOKEN`×6) | Migrate **last** — most call sites, most risk. | Deploy; pipeline runs a real job reading every migrated secret via `.get()`. |
| 8 | **dream-do** | 1 optional | Only if centralizing `DEEPSEEK_API_KEY`. | Optional. |

**Validation checkpoint per worker (all must pass before moving on):**
1. `npx wrangler --version` ≥ 4.x for that worker.
2. `tessera_impact` reported for each edited secret-reading symbol; no unaddressed HIGH/CRITICAL.
3. `tsc` / `pnpm --filter <pkg> typecheck` clean.
4. `pnpm --filter <pkg> test` green.
5. `tessera_detect_changes()` shows only expected symbols/flows.
6. `wrangler deploy` succeeds **with no secret env vars exported**.
7. A real request exercises each migrated secret via `.get()` at runtime (DONE MEANS DEPLOYED).

**Rollback procedure (per worker, fast):** the old per-worker secret is still set (not yet
deleted), so to revert one worker: `git revert` its `wrangler.jsonc` + source commit and
`wrangler deploy`. The worker returns to reading the still-present per-worker secret — no data
loss, no store change needed. **Only delete per-worker secrets (step 9) after the worker has
run successfully on store bindings for a full validation cycle.**

9. **Decommission:** once a worker is verified on store bindings, delete its now-unused
   per-worker secret: `npx wrangler secret delete NAME -c workers/<worker>/wrangler.jsonc`.
   For shared `WEOPS_SIGNING_KEY`, only after **all three** consumers are cut over.

---

## 10. Acceptance criteria (testable)

- **AC1 — Zero-secret deploy.** For every migrated worker, `wrangler deploy` completes
  successfully in an environment where **no secret env var** (`WEOPS_SIGNING_KEY`,
  `LINEAR_API_KEY`, `FF_AGENT_SIGNING_KEY`, `SUB_BUFFER_PRODUCER_SECRET`, `OFOX_API_KEY`,
  `OPERATOR_CONTROL_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`,
  `GAS_CITY_*`, `GITHUB_TOKEN` (runtime PAT), `CF_API_TOKEN`, `HONEYCOMB_API_KEY`, `PDP_API_KEY`,
  `LINEAR_WEBHOOK_SECRET`) is present — only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **AC2 — Runtime correctness.** After deploy, each worker resolves its secrets via
  `await env.X.get()` and functions correctly: WGSP HMAC verification passes across gateway ↔
  linear-bridge; subscription-buffer producer tokens verify; Linear webhook signature verifies;
  ff-pipeline runs a real job using `GITHUB_TOKEN`/`OFOX_API_KEY`/etc.
- **AC3 — Deploy scripts hold no secrets.** No `scripts/deploy-*.sh` contains `wrangler secret
  put` or a `: "${SECRET:?}"` requirement for any migrated secret. `grep -rl "secret put"
  scripts/` returns nothing for migrated workers.
- **AC4 — Shared-secret single source.** `WEOPS_SIGNING_KEY` (and every shared secret) exists as
  exactly one store entry; updating it once propagates to all consumers. Verified by a rotation
  drill on a low-risk secret (`HONEYCOMB_API_KEY`): `secret update` → new value observed at
  runtime with **no redeploy**.
- **AC5 — Local dev unbroken.** `wrangler dev` for each migrated worker resolves bindings from
  `.dev.vars` and the `await env.X.get()` code path works locally.
- **AC6 — CI green & guard intact.** `ci.yml` (`typecheck`, `test`, `repository-audit`) passes
  unchanged; the `factory-pr-check` infra-file guard is untouched; the migration PR is **not**
  labeled `factory-generated`.
- **AC7 — Optional deploy workflow validates.** If `.github/workflows/deploy.yml` is added, a
  `workflow_dispatch` run deploys a chosen worker using only `CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID` repo secrets.

---

## 11. Limitations & open items

- **Public beta.** Secrets Store CLI/API shapes can shift. Pin to the docs below; re-verify per
  phase.
  - https://developers.cloudflare.com/secrets-store/integrations/workers/
  - https://developers.cloudflare.com/workers/wrangler/commands/secrets-store/
  - https://developers.cloudflare.com/changelog/product/secrets-store/
- **No `rotate` command.** Rotation is `secret update --secret-id` (opaque id, not name) —
  tracking issue cloudflare/workers-sdk#10610. Maintain the NAME→secret-id map.
- **Version-skew modify block** — cloudflare/workers-sdk#10585 (deploy latest before rotating).
- **wrangler v4 required** for `secrets_store_secrets`; bump any worker on v3 first.
- **`.get()` runtime cost.** Async per binding — always read-once-into-config (§5.2), never in
  loops.
- **Limits.** 16 secrets / 100 cap (84 headroom); all values ≪ 1 KB.
- **Resolved from 001:** Open Item 3 (name unification → §3.4), Open Item 5 (store_id → hardcode,
  §4.1). **Still requires confirmation during execution:** Open Item 1 (`ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` indirect access path → §5.4 trace) and Open Item 6 (`SecretsStoreSecret` type
  availability per worker → §5.1 bump+`wrangler types`).
- **RBAC (Open Item 4).** Define Secrets Store admin (provision/rotate/delete) vs developer
  (reference-only) in the operator runbook; not enforceable from wrangler config.

---

## 12. Handoff note for the executing Workflow

1. Run **GUVPreFlight** first (repo rule).
2. Execute on a **human/privileged branch** — never a `factory-generated`-labeled PR (the
   `ci.yml` guard will block it, §1).
3. Migrate strictly in the §9 order; one worker per commit; clear every checkpoint (§9) before
   advancing.
4. Run the per-worker **Tessera** impact/detect-changes gate (§5.3) — repo rule.
5. **Architect review gate** at the end: verify every acceptance criterion in §10 against the
   real deployed workers. "It compiled" is not done; **DONE MEANS DEPLOYED**.
