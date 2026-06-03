# SPEC-G3 — `smoke:e2e` and `fidelity:check` npm Scripts

**Status:** Draft v6 — awaiting Architect + SE review (smoke:e2e section only; fidelity:check approved + implemented)  
**Date:** 2026-06-03  
**Closes:** SPEC-FF-DEVOPS-001-v2 G3  
**Decision logged:** smoke:e2e uses Option B (direct GC sling POST, bypass compiler) — Wes 2026-06-03  
**v1–v3 findings:** all resolved  
**v4 findings:** workflow `status` enum invented; `failed` not a workflow status; single-step noop may not create convoy; 4xx skip too broad; poll non-200 unspecified — all fixed in v5  
**v5 findings:** bead status enum needed widening; `terminal_reason` regex missed `exhaust`; dual-path branch condition ambiguous; auth returns 401/403/503 not hardcoded 401 — all fixed in v6; expansion formula adopted (eliminates dual-path)  

**Source anchors:**
- `workers/ff-pipeline/package.json` — package `@factory/ff-pipeline`
- `workers/ff-pipeline/src/index.ts` — routing pattern, `authorizeOperatorControl`
- `workers/ff-pipeline/src/compilers/formula-compiler.ts` lines 40–74 (FormulaCompilerEnv), 1055–1290 (sling loop — success: `status === "slung"`, fallback `workflow_id ?? root_bead_id`, 4xx → rejected)
- `workers/ff-pipeline/src/merge-readiness-pack.test.ts:522` — VR ID format confirmed: `VR-{FN-ID}-FIDELITY-{ISO8601-dashes}`
- `strings gc-linux-amd64` — `/v0/city/%s/sessions`, `state` field, `terminal_reason`, noop provider in `internal/runtime/noop`
- `.github/workflows/ci.yml` lines 93–101 — `factory-pr-check` is a bare echo today

---

## 1. Context and deliverables

| Script | Called by CI job | Env |
|--------|-----------------|-----|
| `pnpm --filter @factory/ff-pipeline fidelity:check` | `factory-pr-check` (agent PRs) | `GITHUB_TOKEN` *(explicit)*; `GITHUB_REF`, `GITHUB_REPOSITORY`, `GITHUB_SHA` *(Actions defaults — auto-present, do NOT pass in `env:`)* |
| `pnpm --filter @factory/ff-pipeline smoke:e2e` | `smoke-test` (post-deploy main) | `FF_PIPELINE_URL`, `OPERATOR_CONTROL_TOKEN` *(both explicit)* |

**Human-only deliverable:** `.github/workflows/ci.yml` `factory-pr-check` job must be updated to run `fidelity:check`. This file is in the agent-mutation guard — a Factory PR cannot self-edit it. A human/operator must commit the wiring (§2.6).

**`fidelity:check` status: APPROVED by Architect + SE (v2 review). Ready for Engineer.**  
**`smoke:e2e` status: Under review (v3). Engineer holds until Architect + SE sign off.**

---

## 2. `fidelity:check` — APPROVED

### 2.1 Purpose

Enforce INV-DEVOPS-13: no agent-authored PR touching `FN-*` implementation files may merge without a Fidelity VR ID cited in the PR body.

### 2.2 What it does

1. Resolve PR number from `GITHUB_REF` (`refs/pull/{N}/merge`). If not a PR ref → **exit 0**.
2. Fetch PR metadata:  
   `GET https://api.github.com/repos/{GITHUB_REPOSITORY}/pulls/{N}`  
   Headers: `Authorization: Bearer {GITHUB_TOKEN}`, `Accept: application/vnd.github+json`, `User-Agent: ff-fidelity-check`.  
   Treat `.body` as possibly `null` → coerce to `""`.
3. Fetch changed file list with pagination:  
   `GET https://api.github.com/repos/{GITHUB_REPOSITORY}/pulls/{N}/files?per_page=100`  
   Follow `Link: ...; rel="next"` until exhausted. Each page is `Array<{ filename: string, patch?: string, ... }>`.
4. **FN detection (content-based):** scan each file's `.patch` field for:  
   `functionId\s*[=:]\s*["']FN-[A-Z0-9][A-Z0-9-]*["']`  
   Collect unique matched FN IDs. Call this set `fnIds`.
5. If `fnIds` is empty → **exit 0**.
6. Scan `pr.body` for Fidelity VR citations matching:  
   `VR-[A-Z0-9][A-Z0-9-]+-FIDELITY`  
   *(Format confirmed from live code: `VR-FN-MOTDWVR2-W7UN-FIDELITY-2026-05-07T21-33-20-000Z`. The regex matches the `-FIDELITY` infix correctly with or without the trailing timestamp.)*
7. If no citations found → print error listing `fnIds`, **exit 1**.
8. **Exit 0.**

### 2.3 Acceptance criteria

- `AC-F1`: exits 0 when no FN-* `functionId` references in any changed file's patch.
- `AC-F2`: exits 0 when FN-* references found AND PR body contains ≥1 `VR-*-FIDELITY` token.
- `AC-F3`: exits 1 when FN-* references found AND PR body contains no `VR-*-FIDELITY` token. Error names the FN IDs.
- `AC-F4`: exits 0 when `GITHUB_REF` is not a PR ref.
- `AC-F5`: exits 1 (clear error) when GitHub API returns non-2xx. Never silently pass on API error.
- `AC-F6`: no external npm deps — only `node:https`, `node:process`, `node:url`.
- `AC-F7`: enumerates ALL changed files via Link-header pagination.

### 2.4 Files

- `workers/ff-pipeline/scripts/fidelity-check.mjs` — Node.js ESM, no build step

### 2.5 Package.json entry

```json
"fidelity:check": "node scripts/fidelity-check.mjs"
```

### 2.6 CI wiring (human commit — blocked to Factory PRs)

Add to `.github/workflows/ci.yml` `factory-pr-check` job:

```yaml
- name: Fidelity VR check (INV-13)
  run: pnpm --filter @factory/ff-pipeline fidelity:check
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`GITHUB_REF` and `GITHUB_REPOSITORY` are Actions defaults — do not pass in `env:`.

---

## 3. `smoke:e2e` — v3 (under review)

### 3.1 Purpose

Verify the dispatch-to-Gas-City path is alive after a deploy. < 5 minutes. Option B: direct sling POST to Gas City, bypassing `compileAndDispatchFormula`. Zero ArangoDB reads or writes.

### 3.2 Handler: `POST /smoke/e2e` on ff-pipeline

1. Verify auth: `authorizeOperatorControl(request, env)`. Return the helper's result `status` (401 missing token / 403 invalid token / 503 unconfigured) — do NOT hardcode 401.
2. POST to Gas City sling endpoint using existing `PipelineEnv` env vars (same as used by `formula-compiler.ts`):

```
POST {env.GAS_CITY_BASE_URL}/v0/city/{env.GAS_CITY_CITY_NAME}/sling
Authorization: Bearer {env.GAS_CITY_BEARER_TOKEN}
X-GC-Request: 1
X-Trace-ID: {crypto.randomUUID()}
Content-Type: application/json

{
  "formula": "factory-noop-smoke-v1",
  "attached_bead_id": "",
  "bead": "",
  "target": "{env.GAS_CITY_AGENT_NAME}",
  "rig": "",
  "scope_kind": "city",
  "scope_ref": "{env.GAS_CITY_CITY_NAME}",
  "force": true,
  "vars": {}
}
```

3. **Sling response handling (precedence order):**
   - **HTTP 404 AND response body contains `template_not_found`, `not_found`, or `formula`** → return `{ outcome: "skipped", reason: "noop_formula_not_registered" }` status 200. (`factory-noop-smoke-v1` not yet deployed in gc binary.)
   - **Any 4xx not matching the above** → return `{ outcome: "failed", reason: "sling_error_{status}", detail: {body} }` status 500. (Auth/validation failures must not be swallowed as "skipped".)
   - **Any 5xx** → return `{ outcome: "failed", reason: "sling_error_{status}", detail: {body} }` status 500.
   - **HTTP 200 but `parsed.status !== "slung"`** → return `{ outcome: "failed", reason: "sling_rejected", detail: parsed }` status 500.
   - **HTTP 200 and `parsed.status === "slung"`** → read `workflowId = parsed.workflow_id ?? parsed.root_bead_id`. Continue to step 4. (Two-step expansion formula guarantees `workflow_id` is present; the `?? root_bead_id` fallback matches the existing codebase convention at `formula-compiler.ts:1111`.)

4. **Poll for workflow terminal state** (confirmed from gc binary: `workflowSnapshotResponse` fields `workflow_id`, `title`, `total`, `closed`, `complete` [bool], `terminal_reason`; failure is in `terminal_reason` not a status enum):

   Poll `GET /v0/city/{city}/workflow/{workflowId}` every 5s up to **240s**:
   - `poll returns non-200` → transient; keep polling (row may not be projected immediately after sling)
   - `parsed.complete === true AND (terminal_reason ?? "") not matching /fail|reject|exhaust/i` → **approved**
   - `parsed.complete === true AND (terminal_reason ?? "") matches /fail|reject|exhaust/i` → **failed, reason: terminal_reason value**
   - `parsed.complete !== true` → keep polling
   - 240s elapsed → **failed, reason: timeout**

   *(Engineer notes: coerce `terminal_reason` to `""` before regex test to avoid TypeError on `undefined`. GAS_CITY env vars live on `FormulaCompilerEnv`, so cast: `const gcEnv = env as PipelineEnv & import('./compilers/formula-compiler.js').FormulaCompilerEnv` — same pattern as `index.ts:2040`.)*

5. Return `{ outcome: "approved"|"failed"|"skipped", sessionId?, durationMs, reason? }`.
   - approved → status 200
   - failed → status 500
   - skipped → status 200

### 3.3 Dependency: `factory-noop-smoke-v1` formula template

**Noop runtime is present in the current gc binary** (`internal/runtime/noop` confirmed). The missing piece is a formula template file.

Formula template (two steps — forces convoy creation, ensuring `workflow_id` is always present — per Architect v5 recommendation):
```toml
formula = "factory-noop-smoke-v1"
version = 1
contract = "graph.v2"
description = "Synthetic smoke probe. Two noop steps to force convoy expansion. No AI, no workspace, no pi-rpc."

[vars]

[[steps]]
id = "probe"
title = "Smoke probe"
description = "No-op smoke step. Produces no artifacts."
# No runtime_requirements → resolves to the noop-provider agent (not pi-rpc).

[[steps]]
id = "probe-confirm"
title = "Smoke probe confirm"
description = "Second no-op step to force convoy expansion and guarantee workflow_id in sling response."
depends_on = ["probe"]
```

**Provider selection note (confirmed Architect v3 review):** `runtime = "noop"` is NOT a valid step field — noop is selected via the agent's `provider = "noop"` in `city.toml`. The step routes to the sling `target` agent; that agent's `city.toml` config determines the runtime. The smoke formula must target an agent configured with `provider = "noop"`.

**Step agent binding (confirmed Architect v3 review):** No explicit `agent =` field is required on `[[steps]]`. The sling `target` field binds the agent. Step schema only requires `id`.

**Implementation steps (requires separate gc binary rebuild):**
1. Author `factory-noop-smoke-v1.toml` in `Wescome/gascity` under `formulas/`
2. Rebuild `gc-linux-amd64`
3. Commit new binary to `workers/gascity-supervisor/gc-linux-amd64`
4. Deploy gascity-supervisor (rotate singleton suffix)

The "skipped" response allows CI to pass during this interim.

### 3.4 npm script

```js
// workers/ff-pipeline/scripts/smoke-e2e.mjs
// POST {FF_PIPELINE_URL}/smoke/e2e
// Authorization: Bearer {OPERATOR_CONTROL_TOKEN}
// HTTP timeout: 270s
// Exit 0: outcome === "approved" || outcome === "skipped"
// Exit 1: outcome === "failed" || non-2xx || request timeout
```

### 3.5 Timeout budget (strictly nested)

| Layer | Budget | Margin to next |
|-------|--------|----------------|
| GC session poll (inside handler) | 240s | 30s |
| Script HTTP request timeout | 270s | 30s |
| CI `timeout-minutes` | 300s | — |

### 3.6 Acceptance criteria

- `AC-S1`: script exits 0 when `/smoke/e2e` returns `outcome: approved`.
- `AC-S2`: script exits 0 when `/smoke/e2e` returns `outcome: skipped`.
- `AC-S3`: script exits 1 when `/smoke/e2e` returns `outcome: failed` or non-2xx.
- `AC-S4`: script exits 1 on request timeout after 270s.
- `AC-S5`: `/smoke/e2e` returns a non-2xx auth rejection (401 missing token / 403 invalid token) via `authorizeOperatorControl` result status — not a hardcoded 401.
- `AC-S6`: `/smoke/e2e` handler makes zero ArangoDB reads or writes.
- `AC-S7`: script uses only `node:https`, `node:process` — no external npm deps.
- `AC-S8a` *(static, enforced in gascity repo)*: `factory-noop-smoke-v1.toml` contains no `runtime_requirements` key — greppable and verifiable at the formula source level.
- `AC-S8b` *(manual post-deploy verification)*: After first live smoke run, confirm no `container_backpressure_*` events appear for the smoke `workflow_id`/`root_bead_id`. This is a one-time human check, not script-enforced (the handler is intentionally event-blind per AC-S6).

### 3.7 Files

- `workers/ff-pipeline/scripts/smoke-e2e.mjs`
- `workers/ff-pipeline/src/smoke/` *(new directory)*
- `workers/ff-pipeline/src/smoke/smoke-e2e-handler.ts`
- `workers/ff-pipeline/src/index.ts` — add: `if (url.pathname === '/smoke/e2e' && request.method === 'POST') { const { handleSmokeE2E } = await import('./smoke/smoke-e2e-handler.js'); return handleSmokeE2E(request, env) }`
- `Wescome/gascity formulas/factory-noop-smoke-v1.toml` (separate repo)
- `workers/gascity-supervisor/gc-linux-amd64` (rebuilt)

### 3.8 Package.json entry

```json
"smoke:e2e": "node scripts/smoke-e2e.mjs"
```

---

## 4. Open questions — all resolved

- Q1 (VR ID format): `VR-{FN}-FIDELITY-{ISO}` confirmed from live test.
- Q2 (poll): workflow endpoint `GET /v0/city/{city}/workflow/{id}`, `complete` bool + `terminal_reason`. Expansion formula (two steps) ensures `workflow_id` always present — single poll path.
- Q3 (formula schema): `runtime = "noop"` is not a step field; provider is agent config; sling `target` binds agent; `id` is only required step field.
- Q5 (auth): `authorizeOperatorControl` returns 401/403/503 — honor result status.
- Q6 (expansion): two-step formula guarantees convoy creation, eliminating dual-path.
