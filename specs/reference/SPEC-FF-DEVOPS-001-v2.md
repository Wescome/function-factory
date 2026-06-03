# SPEC-FF-DEVOPS-001 v2 — Function Factory DevOps Governance

**Status:** Production-Ready Candidate — Architect + SE reviewed 2026-06-03. G1/G2/G4 decided 2026-06-03.  
**Supersedes:** SPEC-FF-DEVOPS-001 draft (2026-06-01)  
**Produced by:** Architect Agent + SE Agent (parallel review 2026-06-03)  
**Source anchors:** `workers/ff-pipeline/src/coordinator/pi-container.ts`, `workers/ff-pipeline/src/cf-workers.ts`, `workers/ff-pipeline/wrangler.jsonc`, `workers/gascity-supervisor/src/index.ts`

> Sections marked [ADDED] are new. [REVISED] replaces the corresponding draft section.

---

## 0. Context and Purpose

No change from v1. Scope includes Cloudflare Workers / DOs / CF Workflows deployment pipeline, environment topology, secret governance, rollback, observability (OTLP), agentic CI governance, Gas City convoy dispatch safety.

The critical gap that motivated this rewrite: **container image deploys are categorically different from Worker-script deploys and were entirely unaddressed**. A container image deploy destroys the running container via `restartContainer()` (`pi-container.ts:235`), which `container.destroy()`s and deletes `ACTIVE_EXECUTION_KEY` (`pi-container.ts:242`) — terminating any in-flight execution as exit 143. Six molecule runs were lost on 2026-06-03 because no deploy-fence, no retryability contract, and no idempotent resume existed.

---

## 1. Non-Negotiable Invariants [REVISED — 15 invariants, up from 7]

### Retained from v1 (audit verdict in §1.1)

- **INV-DEVOPS-1:** No secret in source/wrangler configs. Enforcement: `gitleaks` in CI on every push. **Fully implemented.**
- **INV-DEVOPS-2:** Agent-authored PRs pass identical CI gates as human PRs. **Policy-only today; needs detector (see §1.1).**
- **INV-DEVOPS-3 [REVISED]:** DO migrations deploy atomically — one migration tag applied XOR rolled back; no partial class set. Not "atomic" in the database-transaction sense (CF does not guarantee this). Enforcement: dedicated DO-migration workflow, Architect sign-off.
- **INV-DEVOPS-4:** pi-coding-agent operates with read-only GitHub token. Enforcement: token scoped; negative test (attempt merge → 403).
- **INV-DEVOPS-5 [REVISED]:** Lineage edges write per-stage. Fail-closed: if ArangoDB is unreachable, dispatch refuses or buffers to R2 dead-letter; never silently drops. Enforcement: continuous ArangoDB query for null `source_refs`.
- **INV-DEVOPS-6:** Rollbacks to a version where secrets differ require explicit `--confirm-secret-change`. Enforcement: rollback script diffs secret hashes; blocks absent flag.
- **INV-DEVOPS-7:** OTLP trace export enabled on all production Workers. Enforcement: continuous monitor, exporter freshness < 5 min.

### New invariants [ADDED]

- **INV-DEVOPS-8 (deploy-fence):** No `pi-container` / `gascity-supervisor` image deploy may proceed while `ACTIVE_EXECUTION_KEY` is set in the target singleton DO. The deploy pipeline MUST poll the fence endpoint and block until drained or until the drain deadline forces a checkpoint write. A deploy that kills an in-flight molecule without a checkpoint is a P1 incident.

- **INV-DEVOPS-9 (exit-143 is retryable):** Container exit 143 (SIGTERM) and any monitor error correlated with a rollout window MUST be classified `failureClass: "rollout_interrupted"` (retryable), never `infrastructure_error` (terminal). Root fix site: `pi-container.ts:340` — replace literal with `classifyContainerExit(event.message)`. Continuous detector: zero `infrastructure_error` events whose message matches `/new version rollout|exit 143|signalled container to exit/i`.

- **INV-DEVOPS-10 (idempotent resume):** Every molecule stage dispatched to a container MUST be resumable from an R2 checkpoint keyed by `runs/{runId}/checkpoints/{stageName}.{attemptNumber}.json`. Re-dispatch after SIGTERM MUST no-op if the stage already completed, and resume from last checkpoint otherwise. Root fix site: `pi-container.ts:242` — checkpoint write before `ACTIVE_EXECUTION_KEY` delete.

- **INV-DEVOPS-11 (singleton rotation on image change):** Any container image change MUST rotate the singleton DO name suffix (`singleton-vN → vN+1`) in the same commit as the image change. Image change without rotation is a deploy defect. CI gate: diff image digest vs last deployed; fail if image changed but suffix did not.

- **INV-DEVOPS-12 (atomic co-deploy):** `ff-pipeline`, `gascity-supervisor`, and the `gc` binary that share a molecule contract MUST deploy as one ordered, fenced transaction. Partial deploy (one rotated, one not) is forbidden; on failure the whole set rolls back.

- **INV-DEVOPS-13 (fidelity-before-merge):** No agent-authored PR touching `FN-*` implementation merges without a passing Fidelity VR cited by Function ID. Enforcement: `fidelity-vr` branch-protection required check.

- **INV-DEVOPS-14 (R2 checkpoint durability):** Every dispatched step writes a resumable workspace checkpoint to R2 before the container begins model work. Enforcement: C12 pre-flight check; integration test.

- **INV-DEVOPS-15 (rollout monotonicity):** A gradual rollout (for script Workers) never advances to the next percentage band while the active band's SLO alert threshold is breached. Enforcement: rollout script reads dispatch-success SLO before each promotion.

### 1.1 Audit of v1 invariants — detector status

| ID | Verifiable? | Detector implemented? | Action |
|----|-------------|----------------------|--------|
| INV-1 | Yes | Yes (gitleaks) | ✅ keep |
| INV-2 | Partial | No — policy only | Needs branch-protection + negative test |
| INV-3 | Partial | No | Needs migration failure integration test |
| INV-4 | Yes | Partial — no negative test | Add negative test |
| INV-5 | Yes | Partial — emitted, not asserted | Add continuous lineage null-check query |
| INV-6 | Yes | No — rollback script unguarded | Add secret-diff check to rollback script |
| INV-7 | Yes | Partial — exporter on, no freshness alarm | Add freshness alarm |

Six of seven v1 invariants have no working detector. Per AGENTS.md: "every invariant you specify must have a detector." All six are non-compliant with Factory discipline and must be closed before v2 is considered production-ready.

---

## 2. Environment Topology [REVISED]

Three environments: `dev` (`{name}-dev`), `staging` (`{name}-staging`), `production` (`{name}`, no suffix).

**[ADDED] Worker-script vs Container-image distinction:**
- **Script Workers** (`ff-arango`, `ff-gates`): use `wrangler versions upload` + percentage rollout (5% → 25% → 100%) for production. No containers.
- **Container Workers** (`ff-pipeline`, `gascity-supervisor`): DO NOT use percentage rollout. Singletons are keyed by `idFromName` — there is exactly one active container per key, so traffic splitting is inapplicable. Use **fenced blue/green by singleton rotation** (§11.3). Gradual = synthetic validation on the new suffix before decommissioning the old one.
- **DO migration Workers**: always `wrangler deploy` (never `versions upload`), always atomic, always independent (INV-3).

Promotion gates:
- dev → staging: `typecheck` + `vitest` + `tessera-impact` (no HIGH/CRITICAL) + no INV-1 violation.
- staging → production: `container-fence-gate` + `singleton-rotation-check` + `co-deploy-order` + Architect approval for DO migrations.

---

## 3. Secret Governance [REVISED]

All secrets via `wrangler secret put` or Cloudflare Secrets Store. Never in source, wrangler configs, GitHub Actions env vars, or CI logs.

**Three-system rotation (live secret names confirmed in source):**
- `GAS_CITY_HMAC_SECRET` (webhook signer / verifier)
- `GC_SUPERVISOR_TOKEN` (Gas City supervisor auth)
- `OPERATOR_CONTROL_TOKEN` (ff-pipeline operator auth)

See **Runbook-2** for the complete zero-downtime dual-accept-window rotation procedure. Rotation cadence: quarterly, or immediately on suspected compromise.

Audit: `wrangler secret list` on both workers compared against `secrets-manifest.yaml` on every deploy (C11 pre-flight).

---

## 4. Gradual Deployment and Rollback [REVISED]

**Script Workers** (`ff-arango`, `ff-gates`):
- Gradual rollout: 5% → 25% → 100%, 15 min observation window at each band.
- Rollback trigger: error rate > 2% above baseline OR p95 latency > 150% baseline.
- `wrangler rollback --version {version-id}` + INV-6 secret-diff check.

**Container Workers** (`ff-pipeline`, `gascity-supervisor`) — blue/green by rotation (NOT percentage rollout):
- Old container keeps serving on `singleton-vN`.
- New image boots on `singleton-vN+1` only when first addressed.
- Validation = synthetic dispatch to the new suffix + `/health`.
- "Rollback" = revert suffix constant + image reference in one commit + redeploy.
- See §11.4 for the full deploy sequencing procedure.

**DO-migration Workers**: atomic, independent, Architect sign-off. Dedicated `--do-migration` workflow. Full recovery in Runbook-3.

---

## 5. Observability [REVISED]

- Workers Logs on all Workers.
- OTLP tracing: `observability.traces.enabled = true` in all `wrangler.jsonc`. Honeycomb as primary destination.
- `CF_VERSION_METADATA` binding on all Workers (already in `ff-pipeline/wrangler.jsonc:86`).
- Synthetic monitors: `/health` and `/webhooks/gascity` every 5 min in production + `/__pi-container/fence` + `/__pi-container/status`.
- SLOs and non-negotiable alerts defined in **§12 [ADDED]**.

---

## 6. Agentic CI Governance [REVISED]

- pi-coding-agent permissions: read repo, write to branch, open PR. Cannot: merge PRs, deploy, modify CI configuration, access production secrets, or mutate `wrangler.jsonc`, `CLAUDE.md`, `AGENTS.md`, `.github/` (protected by CODEOWNERS + ruleset).
- Agent-authored PRs carry `factory-generated` label and trigger `factory-pr-check` job (see §10) which validates that: (a) the full gate set ran and passed, (b) no protected infra file was mutated, (c) a passing Fidelity VR is cited for FN-* changes (INV-13).
- Branch naming: `agent/{fnId}/{attempt}`.
- Human review required before merge for: DO migrations, `wrangler.jsonc` changes, new secret bindings, changes to CI configuration.

---

## 7. Webhook-Worker CI Feedback Loop

No change from v1. Factory receives deploy outcome via `POST /webhooks/gascity`. Factory records deploy evidence in ArangoDB lineage. Failed deploy → Signal → Pressure → re-dispatch to pi-coding-agent.

---

## 8. Gas City Convoy Pre-Flight [REVISED — C1–C12]

Keep C1–C7. Add:

- **C8 (skeleton ready):** Molecule skeleton (`runs/{runId}/` in R2 with IS/ES/Elucidation present and valid manifest) materialized before Convoy emission.
- **C9 (singleton boot parity):** Supervisor `singleton-vN` suffix matches the deployed image digest. Prevents dispatching into a warm pre-fix container.
- **C10 (deploy fence clear):** `ROLLOUT_IN_PROGRESS_KEY` is unset on both `PI_CONTAINER` and `SUPERVISOR`. Never start a molecule into a draining container.
- **C11 (secret manifest parity):** `GC_SUPERVISOR_TOKEN`, `OPERATOR_CONTROL_TOKEN`, `GAS_CITY_HMAC_SECRET` present and matching `secrets-manifest.yaml` on both workers.
- **C12 (checkpoint bucket writable):** `WORKSPACE_BUCKET` accepts a write probe to `runs/__preflight/probe`. INV-10 resume is impossible if R2 is read-only; fail closed.

All C1–C12: fail-closed. Any failure halts Convoy emission.

---

## 9. Runbooks [ADDED — all six written; no stubs]

### Runbook-1 — Roll back a gradual deploy / container image

**Script Workers:**
1. `wrangler deployments list --name {worker}` → capture current and prior version-ids.
2. Diff secrets between target and current (INV-6). If secrets differ, `wrangler rollback --version {id} --force`; else `wrangler rollback --version {id}`.
3. Watch §12 SLIs for 15 min; confirm error rate returns to baseline.

**Container Workers:**
1. Fence first: poll `/__pi-container/fence`; drain/checkpoint any active run (§11.2A — drain deadline 20 min).
2. Revert `singleton-vN` constant to last-good `vN-1` AND image reference, in one commit. (Suffixes are one-way forward; rolling back means pointing at the prior suffix+image, not reusing storage.)
3. `wrangler deploy` the reverted worker. Verify `/health` + synthetic dispatch.
4. Resume checkpointed molecules; confirm no-op short-circuit.
5. If the trio was co-deployed → Runbook-5 instead (atomic rollback).

---

### Runbook-2 — Rotate the HMAC key and both tokens (zero-downtime)

> Three secrets across two workers. Sequential rotation without a dual-accept window causes crash-loop skew. Use the dual-accept protocol:

1. **Pre-check (C11):** confirm current secrets match `secrets-manifest.yaml` on both workers.
2. **Generate** new values. Update `secrets-manifest.yaml` (new + old recorded).
3. **Phase A — receivers accept OLD and NEW:** deploy supervisor + pipeline configured to validate both `GAS_CITY_HMAC_SECRET` and `GAS_CITY_HMAC_SECRET_NEXT` (and both token variants). Set via `wrangler secret put {SECRET}_NEXT`.
4. **Verify** with a synthetic webhook signed by the new HMAC + a synthetic operator call with the new token. Both must succeed while old still works.
5. **Phase B — senders switch to NEW:** `wrangler secret put` new values as primary on the sending side. Re-verify end-to-end.
6. **Phase C — retire OLD:** delete `_NEXT` acceptance and old values once a full molecule cycle has passed signing with the new secret. Update `secrets-manifest.yaml`.
7. **Audit:** `wrangler secret list` on both workers == manifest. Emit a rotation lineage record.
8. **Rollback:** if Phase B fails, receivers still accept old (Phase A never removed) — revert sender secrets, no outage.

---

### Runbook-3 — Recover from DO migration failure

1. DO migration tags are one-way. On failure the migration tag is partially applied.
2. Do NOT re-run the same tag. Roll the Worker back to the pre-migration version (Runbook-1).
3. Author a forward-fix migration as a new tag. Deploy via dedicated DO-migration workflow with Architect sign-off.
4. Verify each DO class resolves via a read/write probe against the migrated class before lifting the change freeze.

---

### Runbook-4 — Re-dispatch a failed/killed Convoy

1. Pull `runId` from §7 webhook record / ArangoDB lineage.
2. Run pre-flight C1–C12. Fix dependencies before re-emitting.
3. Verify R2 checkpoint: `runs/{runId}/checkpoints/` must have the last completed stage's JSON. If absent, checkpoint write failed (C12 regression) → escalate to Architect, INV-10 breach.
4. If `ACTIVE_EXECUTION_KEY` is stale on the container (the dead run), `POST /__pi-container/restart` to clear it.
5. Re-dispatch; confirm completed stages no-op short-circuit, next stage resumes from checkpoint.
6. Record the re-dispatch as a Signal in lineage.

---

### Runbook-5 — Atomic co-deploy rollback (the molecule trio)

Trigger: any failure during §11.4 deploy steps 4–7 leaving workers on mismatched contracts.

1. Halt all Convoy emission (global pre-flight deny, C10 fail-closed).
2. Identify which workers deployed (digest + singleton suffix per worker).
3. Roll ALL trio members to the last commit where suffixes + image digests were mutually consistent.
4. `wrangler deploy` in leaf-first order (supervisor → pipeline); verify `/health` + synthetic dispatch at each step.
5. Resume checkpointed molecules; confirm no-op short-circuit.
6. Lift the Convoy deny. Open an incident Signal; partial deploy → Pressure → new FN task.

---

### Runbook-6 — Molecule failure operator response

1. From PagerDuty payload: capture `runId` and `failureClass`.
2. Open Honeycomb trace filtered by `runId`; identify failing stage.
3. By `failureClass`:
   - `rollout_interrupted`: verify R2 checkpoint exists; re-dispatch (Runbook-4 step 5). If checkpoint absent → P1 INV-10 breach, escalate to Architect.
   - `infrastructure_error`: check C1–C4; re-dispatch once dependency restored.
   - `container_execute_timeout`: one bounded retry, then fail molecule → Signal → re-dispatch to pi-coding-agent via §7 loop.
   - `semantic_miscast`: not a failure — happy path. Record counterfactual, re-propose.
   - `fidelity_failed` × 3 (3-strike rule): STOP auto-loop. Spawn Architect for root cause. No more blind re-dispatches.
4. Always record the failure as a Signal in ArangoDB lineage. Recurrence → Pressure → new Function.

---

## 10. CI Pipeline [REVISED — with container fence gate, co-deploy order]

See `.github/workflows/ci-v2.yml` (§14) for the complete GitHub Actions YAML.

Jobs added to the existing `typecheck` / `vitest` / `tessera-impact` / `secret-scan` / `deploy-dev` / `deploy-staging` / `deploy-production` set:

- **`go-build`:** builds `gc-linux-amd64` for `linux/amd64` with `BUILD_ID=$GITHUB_SHA`; uploads as artifact.
- **`container-fence-gate`:** before any container image deploy, polls `/__pi-container/fence` and `/__supervisor-fence`. Blocks on `active:true`; drains or checkpoints. INV-8.
- **`singleton-rotation-check`:** diffs image digest vs last deployed; fails if image changed but `singleton-vN` suffix did not. INV-11.
- **`co-deploy-order`:** enforces leaf-first ordering when the trio changes together (supervisor → ff-pipeline). INV-12.
- **`checkpoint-probe`:** C12 R2 write probe as deploy precondition.
- **`factory-pr-check` [REVISED]:** extended from stub echo to: run `pnpm fidelity:check`, assert no protected infra files mutated, assert `VR-*` in PR body for FN-* changes.
- **`smoke-test`:** post-deploy health check on all Workers + container readiness probe + synthetic no-op molecule dispatch (< 5 min).
- **`notify-deploy`:** Slack `#ff-ops` on success/failure.

---

## 11. Container Rollout Safety [ADDED — new section]

> This section closes the gap that cost 6 molecule runs on 2026-06-03.

### 11.1 Failure model (confirmed in source)

1. New image deploys → `resolveDesiredPiContainerBuildId()` returns new build id.
2. Next request triggers `ensureContainerReady()` → `shouldRestartPiContainerForBuild()` true → `restartContainer()` → `container.destroy("worker-version-changed")`.
3. Running pi process receives SIGTERM, exits 143.
4. `monitorContainer()` (`pi-container.ts:307`) catch fires → `recordMonitorEvent` → **hardcoded `failureClass: "infrastructure_error"` (`:340`)**. Rollout kill indistinguishable from genuine crash.
5. `isContainerNotRunningTransient()` (`cf-workers.ts:422`) matches only cold-start string → SIGTERM rethrown **terminal** → molecule fails permanently.

### 11.2 Required invariant implementations

**(A) Deploy-fence (INV-8):**
- Add `GET /__pi-container/fence` → `{ active: boolean, runId?, stageName?, startedAt?, ageMs }` from `ACTIVE_EXECUTION_KEY`.
- Deploy pipeline polls this endpoint before image push. `active:true` blocks the deploy.
- Drain deadline: 20 min (one molecule stage budget). On deadline expiry → `POST /__pi-container/checkpoint-and-drain` forces checkpoint write then signals graceful drain.
- Fence fail-closed: if unreachable → deploy aborts.
- Guard site: `pi-container.ts:217` — read `ACTIVE_EXECUTION_KEY` before restart branch; if present, log `pi.container.restart_deferred_active_execution` and skip until queue drains.

**(B) Exit-143 retryability (INV-9):**
- Replace `pi-container.ts:340` literal with `classifyContainerExit(event.message)`:
  - exit 143 / destroy-correlated / message matching `/new version rollout|signalled container to exit/i` during `ROLLOUT_IN_PROGRESS_KEY` window → `failureClass: "rollout_interrupted"`, `retryable: true`.
  - All other errors → `infrastructure_error` (terminal, per existing logic).
- Add `isRolloutInterrupted(message)` in `cf-workers.ts` alongside `isContainerNotRunningTransient()`. Consult it in `fetchWithInfrastructureRetry` catch at `cf-workers.ts:364` for mid-execution retryable resume.

**(C) Idempotent resume (INV-10):**
- Before `restartContainer` deletes `ACTIVE_EXECUTION_KEY` (`pi-container.ts:242`), persist checkpoint to R2: `runs/{runId}/checkpoints/{stageName}.{attemptNumber}.json` → `{ activeExecution, lastObservationKey, partialArtifacts[], phase }`. Only after checkpoint write success may the key be deleted.
- On re-dispatch: `/execute` reads checkpoint. Completion marker → no-op short-circuit. Partial checkpoint → pass `resumeFrom` into container.
- Anti-criteria: real OOM/panic must NOT be retried as if rollout (INV-9 discriminates cause).

### 11.3 Singleton rotation requirement (INV-11)

The live pattern is confirmed at `gascity-supervisor/src/index.ts:204` (`idFromName("singleton-v43")`). Rules:
- Every container image change increments the suffix in the same commit.
- Rotation is a one-way ratchet. Never reuse a retired suffix.
- A CI gate diffs image digest vs last deployed; fails if image changed but suffix did not.
- Once INV-8 + INV-9 + INV-10 are implemented, rotation becomes the clean-boot mechanism rather than a SIGTERM workaround. Eventually retire manual rotation in favor of automatic buildId-comparison (the pattern already implemented in `pi-container-version.ts` / `ensureContainerReady`).

**Architecture gate (Wes decision required):** The Architect identified a collision between version-naming (`singleton-vN`) and future city-sharding (`singleton-{cityId}`). Both patterns want the `idFromName` argument. Before implementing automatic buildId-comparison in `GasCitySupervisor`, this gate must be cleared. The current `vN` rotation remains the mechanism until cleared.

### 11.4 Deploy sequencing for the molecule trio (INV-12)

When `ff-pipeline` + `gascity-supervisor` + `gc` binary change together, deploy in this ordered, fenced transaction:

1. **Pre-flight:** run C1–C12. Abort on any failure.
2. **Fence both singletons:** poll `/__pi-container/fence` + supervisor fence. Both must report `active:false`, OR drain to checkpoint (drain deadline 20 min).
3. **Build + digest container images** (`gc` binary baked into supervisor image). Assert suffix rotation per INV-11.
4. **Deploy supervisor first** (carries new `gc` binary). Rotate `singleton-vN`. Verify `/health` + synthetic no-op convoy before proceeding.
5. **Deploy `ff-pipeline`** (rotate `PI_CONTAINER` singleton). Verify `/health` + synthetic single-stage dispatch.
6. **Validate** synthetic full molecule dispatch (not percentage rollout — singletons use blue/green validation only).
7. **Resume checkpointed molecules.** Confirm no-op short-circuit for completed stages.
8. **Clear `ROLLOUT_IN_PROGRESS_KEY`** on both DOs.

On failure at any step 4–7 → Runbook-5 (atomic co-deploy rollback).

### 11.5 wrangler.jsonc additions [ADDED]

Add to `workers/gascity-supervisor/wrangler.jsonc`:
```jsonc
{
  "version_metadata": { "binding": "CF_VERSION_METADATA" },
  "containers": [{
    "class_name": "GasCitySupervisor",
    "rollout_step_percentage": 100,
    "rollout_active_grace_period": 60
  }]
}
```

`rollout_active_grace_period: 60` ensures a container that just started isn't immediately eligible for SIGTERM. Set higher if steps are expected to run longer (max usable is ~840s given the 15-min SIGTERM→SIGKILL window).

---

## 12. Production SLOs and Alerts [ADDED]

### 12.1 SLOs

| SLO | Target | Window | Alert threshold | Page? |
|-----|--------|--------|-----------------|-------|
| Dispatch latency p95 | ≤ 90 s | 7-day rolling | > 180 s for 30 min | P2 |
| Dispatch latency p50 | ≤ 15 s | 7-day rolling | — | — |
| Stage success rate | ≥ 95% (excl. miscast) | 7-day rolling | < 90% for 1 h | P2 |
| Molecule e2e completion | ≥ 85% | 7-day rolling | < 75% | P1 |
| Fidelity pass rate | ≥ 90% | 7-day rolling | < 70% (model/spec regression signal) | P2 |
| p95 step execution time | ≤ 8 min | rolling 1h | > 10 min | P1 (approaching 12-min timeout) |
| **Rollout-interrupted resume rate** | **100%** | per-deploy | **< 100%** | **P1** |
| OTLP exporter freshness | < 5 min | continuous | > 5 min | P3 |

Note: semantic-miscast rejections (Critic catching bad proposals) are EXCLUDED from the stage-success-rate denominator. They are the system working correctly.

### 12.2 Non-negotiable P1 alerts

1. **Lost molecule on deploy:** `rollout_interrupted` event with no matching successful resume within 5 min. This is the 2026-06-03 failure class — must never page-silently.
2. **Deploy fence bypassed:** image deploy completed while fence reported `active:true`.
3. **Singleton/image skew:** image digest changed but `singleton-vN` suffix unchanged in production.
4. **Secret skew crash-loop:** > 3 `unauthorized`/`runtime-missing` errors within 2 min (mid-rotation skew).
5. **Pre-flight fail-closed storm:** > 5 Convoy emissions halted on C1–C12 in 15 min.

---

## 13. Molecule Failure Recovery [ADDED]

### 13.1 Failure taxonomy

| Class | Example | Auto-action | Page? |
|-------|---------|-------------|-------|
| `rollout_interrupted` | exit 143 during deploy | Auto-resume from R2 checkpoint (INV-10) | Only if resume fails (P1) |
| `infrastructure_error` | R2/ArangoDB down mid-stage | Retry with backoff; after exhaustion → Signal | P1 if dependency down |
| `container_execute_timeout` | Stage exceeds `CONTAINER_EXECUTE_TIMEOUT_MS` | One bounded retry, then fail → Signal | P2 |
| `semantic_miscast` | Critic rejects proposal | Happy path — record counterfactual, re-propose | No |
| `fidelity_failed` × 3 | 3-strike rule | STOP auto-loop; spawn Architect | P3 |
| `verification_incoherent` | ES fails Coherence | Go upstream — IS incomplete; UncertaintyEntry | P3 |

### 13.2 Paging matrix

- **On-call SE:** P1/P2 molecule failures, fence bypass, secret skew.
- **Architect (escalation):** INV breaches, 3-strike fidelity, incoherent ES, resume failed.
- **Wes (architecture gate only):** never paged for ops. Consulted only when remediation requires an architecture decision.

---

## 14. CI Pipeline YAML — `.github/workflows/ci-v2.yml` [ADDED]

> This YAML replaces `.github/workflows/ci.yml`. Implementation requires Engineer + Architect review before deploy (per `feedback_architect_se_all_changes`). It is a spec artifact — do not treat as deployed.

```yaml
name: CI v2

on:
  push:
    branches: [main, "factory/*"]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  WRANGLER_VERSION: "4"
  GO_VERSION: "1.22"
  NODE_VERSION: "22"

# ── QUALITY GATES (parallel) ──────────────────────────────────────────────────
jobs:
  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}", cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Typecheck (excl. ff-pipeline vendor errors)
        run: |
          output=$(pnpm -r --if-present typecheck 2>&1 || true)
          own_errors=$(echo "$output" | grep "error TS" | \
            grep -v "gdk-agent\|gdk-ai\|artifact-validator\|ontology-loader" | wc -l)
          [ "$own_errors" -eq 0 ] || { echo "$output"; exit 1; }

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}", cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r --if-present test

  repository-audit:
    name: Repository Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}", cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit:docs
      - run: pnpm audit:ontology

  secret-scan:
    name: Secret Scan (INV-1)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }

  go-build:
    name: Build gc binary
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "${{ env.GO_VERSION }}", cache: true }
      - name: Build linux/amd64 binary
        working-directory: workers/gascity-supervisor
        run: |
          CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
            go build -ldflags="-s -w -X main.BuildID=${{ github.sha }}" \
            -o gc-linux-amd64 ./...
      - uses: actions/upload-artifact@v4
        with:
          name: gc-binary-${{ github.sha }}
          path: workers/gascity-supervisor/gc-linux-amd64
          retention-days: 1

# ── FACTORY PR GATE ──────────────────────────────────────────────────────────
  factory-pr-check:
    name: Factory PR Gate (INV-2, INV-13)
    runs-on: ubuntu-latest
    if: >
      github.event_name == 'pull_request' &&
      contains(github.event.pull_request.labels.*.name, 'factory-generated')
    needs: [typecheck, test, repository-audit, secret-scan]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}", cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Fidelity VR check (INV-13)
        run: pnpm --filter @factory/ff-pipeline fidelity:check
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
      - name: Guard infra configs from agent mutation
        run: |
          changed=$(git diff --name-only origin/main...HEAD | \
            grep -E '(wrangler\.jsonc|CLAUDE\.md|AGENTS\.md|\.github/)' || true)
          [ -z "$changed" ] || { echo "BLOCKED: agent PR modified protected files:"; echo "$changed"; exit 1; }

# ── CONTAINER FENCE GATE (INV-8) ─────────────────────────────────────────────
  container-fence-gate:
    name: Container Fence Gate (INV-8)
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [typecheck, test, secret-scan, go-build]
    steps:
      - name: Check pi-container fence
        run: |
          for i in {1..40}; do
            resp=$(curl -s -H "Authorization: Bearer ${{ secrets.OPERATOR_CONTROL_TOKEN }}" \
              https://ff-pipeline.koales.workers.dev/__pi-container/fence)
            active=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('active', True))" 2>/dev/null || echo "true")
            if [ "$active" = "False" ] || [ "$active" = "false" ]; then
              echo "pi-container fence: clear (attempt $i)"
              break
            fi
            echo "Attempt $i: container active, waiting 30s (drain deadline 20 min)..."
            sleep 30
          done
          [ "$active" = "False" ] || [ "$active" = "false" ] || \
            { echo "DEPLOY BLOCKED: container active after 20 min drain deadline"; exit 1; }
      - name: Check supervisor fence
        run: |
          for i in {1..40}; do
            resp=$(curl -s -H "Authorization: Bearer ${{ secrets.GC_SUPERVISOR_TOKEN }}" \
              https://gascity-supervisor.koales.workers.dev/__supervisor/fence)
            active=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('active', True))" 2>/dev/null || echo "true")
            [ "$active" = "False" ] || [ "$active" = "false" ] && break
            sleep 30
          done
          [ "$active" = "False" ] || [ "$active" = "false" ] || \
            { echo "DEPLOY BLOCKED: supervisor active after 20 min drain deadline"; exit 1; }

  singleton-rotation-check:
    name: Singleton Rotation Check (INV-11)
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [container-fence-gate]
    steps:
      - uses: actions/checkout@v4
      - name: Assert singleton suffix rotated if image changed
        run: |
          # Compare the current wrangler.jsonc singleton suffix with the last deployed
          # This script is a spec stub — implement against CF Deployments API
          echo "TODO: compare image digest in wrangler.jsonc vs last deployed digest"
          echo "Fail if image digest changed but singleton-vN suffix did not"
          # exit 1 on violation

# ── DEPLOY PIPELINE ────────────────────────────────────────────────────────────
  deploy-arango-gates:
    name: Deploy ff-arango + ff-gates
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [typecheck, test, secret-scan]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}", cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Deploy ff-arango
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/ff-arango
          wranglerVersion: ${{ env.WRANGLER_VERSION }}
      - name: Deploy ff-gates
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/ff-gates
          wranglerVersion: ${{ env.WRANGLER_VERSION }}

  deploy-gascity:
    name: Deploy gascity-supervisor (leaf-first, INV-12)
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [singleton-rotation-check, deploy-arango-gates, go-build]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}", cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@v4
        with:
          name: gc-binary-${{ github.sha }}
          path: workers/gascity-supervisor/
      - run: chmod +x workers/gascity-supervisor/gc-linux-amd64
      - uses: docker/setup-buildx-action@v3
      - name: Pre-build supervisor image (GHA cache warm)
        uses: docker/build-push-action@v6
        with:
          context: workers/gascity-supervisor
          push: false
          load: true
          tags: gascity-supervisor:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: BUILD_ID=${{ github.sha }}
      - name: Deploy gascity-supervisor
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/gascity-supervisor
          wranglerVersion: ${{ env.WRANGLER_VERSION }}
          command: deploy --var BUILD_GIT_SHA:${{ github.sha }}

  deploy-ff-pipeline:
    name: Deploy ff-pipeline (after supervisor, INV-12)
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [deploy-gascity, deploy-arango-gates]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}", cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: docker/setup-buildx-action@v3
      - name: Pre-build sandbox + pi-container images
        run: |
          docker buildx build --cache-from type=gha --cache-to type=gha,mode=max \
            -t ff-pipeline-sandbox:${{ github.sha }} workers/ff-pipeline &
          docker buildx build --cache-from type=gha --cache-to type=gha,mode=max \
            -t ff-pipeline-pi:${{ github.sha }} workers/ff-pipeline/pi-container &
          wait
      - name: Deploy ff-pipeline
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/ff-pipeline
          wranglerVersion: ${{ env.WRANGLER_VERSION }}
          command: deploy --var BUILD_GIT_SHA:${{ github.sha }}

# ── POST-DEPLOY GATES ─────────────────────────────────────────────────────────
  smoke-test:
    name: Post-deploy Smoke Test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [deploy-ff-pipeline]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}", cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Health check ff-pipeline
        run: |
          for i in {1..12}; do
            status=$(curl -s -o /dev/null -w "%{http_code}" \
              -H "Authorization: Bearer ${{ secrets.OPERATOR_CONTROL_TOKEN }}" \
              https://ff-pipeline.koales.workers.dev/healthz)
            [ "$status" = "200" ] && { echo "ff-pipeline healthy ($i)"; break; }
            echo "Attempt $i: $status, retry in 10s"; sleep 10
          done
          [ "$status" = "200" ] || { echo "ff-pipeline health FAILED"; exit 1; }
      - name: Health check gascity-supervisor
        run: |
          for i in {1..12}; do
            status=$(curl -s -o /dev/null -w "%{http_code}" \
              -H "Authorization: Bearer ${{ secrets.GC_SUPERVISOR_TOKEN }}" \
              https://gascity-supervisor.koales.workers.dev/healthz)
            [ "$status" = "200" ] && { echo "supervisor healthy ($i)"; break; }
            sleep 10
          done
          [ "$status" = "200" ] || { echo "supervisor health FAILED"; exit 1; }
      - name: Container readiness probe (3 min)
        run: |
          for i in {1..18}; do
            status=$(curl -s -o /dev/null -w "%{http_code}" \
              -H "Authorization: Bearer ${{ secrets.GC_SUPERVISOR_TOKEN }}" \
              https://gascity-supervisor.koales.workers.dev/container/ping)
            [ "$status" = "200" ] && { echo "container ready ($i)"; break; }
            echo "Attempt $i: not ready ($status), waiting 10s"; sleep 10
          done
          [ "$status" = "200" ] || { echo "container readiness FAILED"; exit 1; }
      - name: E2E smoke molecule (< 5 min)
        run: pnpm --filter @factory/ff-pipeline smoke:e2e
        timeout-minutes: 5
        env:
          FF_PIPELINE_URL: https://ff-pipeline.koales.workers.dev
          OPERATOR_CONTROL_TOKEN: ${{ secrets.OPERATOR_CONTROL_TOKEN }}

  notify-deploy:
    name: Notify Deploy Result
    runs-on: ubuntu-latest
    if: always() && github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [smoke-test]
    steps:
      - name: Slack notification
        run: |
          STATUS="${{ needs.smoke-test.result }}"
          MSG="Deploy $STATUS — ${{ github.sha }} — ${{ github.workflow }}"
          echo "$MSG"
          # curl -X POST ${{ secrets.SLACK_WEBHOOK }} -d "{\"text\":\"$MSG\"}"
```

---

## 15. Open Architecture Gates [ADDED]

**G1, G2, G4 decided 2026-06-03 by Wes (Architect recommendation approved).**

| # | Gate | Decision |
|---|------|----------|
| G1 | `idFromName` naming | **Composite `{cityId}-vN`** — hardcode `factory` today; zero-cost composability for multi-city. `singleton-{cityId}-vN` pattern. |
| G2 | `rollout_active_grace_period` | **Configurable env var, default 600s** — upper bound unknown; tune without redeploy. INV-9 (exit 143 retryable) covers overruns. |
| G3 | `smoke:e2e` + `fidelity:check` scripts | **Implementation task** — not a Wes gate. GUV to spec and assign. |
| G4 | `gc` binary CI | **Status quo — committed binary** (`workers/gascity-supervisor/gc-linux-amd64`). Rebuild is manual and infrequent. Cross-repo build when drift becomes a real problem. |

---

## Acceptance Criteria for v2 to be Production-Ready

- [ ] All 15 invariants have working detectors (§1.1 audit closed — see DEVOPS-INVARIANT-STATUS.md)
- [x] `/__pi-container/fence` and `/__supervisor/fence` endpoints implemented (d2b94af)
- [x] `pi-container.ts:340` classification literal replaced (26158e5)
- [x] `pi-container.ts:242` checkpoint-before-delete implemented (26158e5)
- [x] `cf-workers.ts:422` + `:364` rollout-retry path added (26158e5)
- [ ] `singleton-rotation-check` CI gate implemented against CF Deployments API
- [x] `smoke:e2e` npm script implemented (7bbb704)
- [x] `fidelity:check` npm script implemented (7bbb704)
- [ ] `secrets-manifest.yaml` created and Runbook-2 procedure validated end-to-end
- [ ] All six runbooks exercised in staging at least once
- [x] G1-G4 architecture gates resolved or explicitly deferred with documented rationale (9160c96)
