# Post-Deploy E2E Smoke Test (`/smoke/e2e`)

Task-oriented procedure for running the Gas City dispatch smoke probe after a
deploy of `ff-pipeline` (or a new `gc` binary). This is a **post-deploy**
liveness check — it is not part of CI unit tests.

- **What it proves:** the `ff-pipeline → Gas City` dispatch path is alive end to
  end (auth, sling, workflow projection) within ~5 minutes.
- **What it touches:** a direct sling of the `factory-noop-smoke-v1` formula to
  Gas City, then polls the resulting workflow. **Zero ArangoDB reads or writes.**
- **Source spec:** [`../../specs/reference/SPEC-G3-SMOKE-FIDELITY-SCRIPTS.md`](../../specs/reference/SPEC-G3-SMOKE-FIDELITY-SCRIPTS.md) §3.
- **Handler:** `workers/ff-pipeline/src/smoke/smoke-e2e-handler.ts`
  (route `POST /smoke/e2e`, wired in `workers/ff-pipeline/src/index.ts`).
- **Driver script:** `workers/ff-pipeline/scripts/smoke-e2e.mjs`
  (npm script `smoke:e2e`).
- **Logic coverage:** `workers/ff-pipeline/src/smoke/smoke-e2e-handler.test.ts`
  unit-tests every branch below with a mocked Gas City binding. The live probe
  in this runbook is what confirms the *deployed* path, which the unit test
  cannot.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| `OPERATOR_CONTROL_TOKEN` | Operator secret (the same token used for the live run controls). Required whenever the deployed worker has a token configured. |
| `FF_PIPELINE_URL` | Base URL of the deployed worker, e.g. `https://ff-pipeline.koales.workers.dev`. |
| Network egress to that host | Sandboxed/allowlisted environments (CI containers, the agent sandbox) may block the worker host and return `403 Host not in allowlist` — that is the egress proxy, not the worker. Run from an environment with outbound access. |
| Worker env configured | The deployed worker must have `GAS_CITY_BASE_URL`, `GAS_CITY_CITY_NAME`, `GAS_CITY_BEARER_TOKEN`, and `GAS_CITY_AGENT_NAME` set, plus the `GAS_CITY` service binding. |
| `factory-noop-smoke-v1` registered | For an `approved` result the noop formula must exist in the running `gc` binary. If it is not yet registered the probe returns `skipped` (not a failure). |

## Run

From the repository root:

```bash
OPERATOR_CONTROL_TOKEN=… \
FF_PIPELINE_URL=https://ff-pipeline.koales.workers.dev \
pnpm --filter @factory/ff-pipeline smoke:e2e
```

Equivalent direct invocation:

```bash
cd workers/ff-pipeline
OPERATOR_CONTROL_TOKEN=… FF_PIPELINE_URL=https://ff-pipeline.koales.workers.dev \
  node scripts/smoke-e2e.mjs
```

Raw request (no script):

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $OPERATOR_CONTROL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' \
  "$FF_PIPELINE_URL/smoke/e2e"
```

The script enforces a **270s** HTTP timeout (nested inside CI's 300s budget).
It exits **0** on `approved` or `skipped`, and **1** on `failed`, any non-2xx
response, or a request timeout.

## Interpreting the result

The handler returns JSON `{ outcome, workflowId?, durationMs, reason?, detail? }`.

| `outcome` | HTTP | Meaning | Operator action |
| --- | --- | --- | --- |
| `approved` | 200 | Workflow reached a non-failure terminal state. Dispatch path healthy. | None — pass. |
| `skipped` | 200 | `reason: noop_formula_not_registered` — `factory-noop-smoke-v1` is not in the deployed `gc` binary. | Pass for CI, but register/rebuild the noop formula if you expected a full run. |
| `failed` | 500 | See `reason` below. | Investigate; do not consider the deploy verified. |

`failed` reasons:

| `reason` | Cause |
| --- | --- |
| `gas_city_env_not_configured` | One or more `GAS_CITY_*` vars/bindings missing on the worker. `detail.missing` lists them. |
| `sling_request_failed` | The sling POST threw (transport/binding error). |
| `sling_error_<status>` | Sling returned a non-2xx (other than the 404 noop-not-registered case). |
| `sling_rejected` | Sling returned 200 but body `status` was not `"slung"`. |
| `sling_missing_workflow_id` | Slung, but no `workflow_id`/`root_bead_id` in the response. |
| *(terminal reason)* | Workflow completed with a `terminal_reason` matching `fail`/`reject`/`exhaust`. |
| `timeout` | 240s elapsed (polling every 5s) without the workflow reaching a terminal state. |

### Auth failures

These come from `authorizeOperatorControl` before any Gas City call:

| HTTP | `error` | Cause |
| --- | --- | --- |
| 401 | `operator authorization required` | No `Authorization: Bearer`/`X-FF-Operator-Token` supplied. |
| 403 | `operator authorization rejected` | Token supplied but does not match the worker's `OPERATOR_CONTROL_TOKEN`. |
| 503 | `operator control auth is not configured` | Production worker has no `OPERATOR_CONTROL_TOKEN` set. (In non-production, an unset token bypasses auth.) |

## When to run

- After every `ff-pipeline` deploy.
- After deploying a new `gc` binary (especially one that changes formula
  registration or the sling/workflow API).
- As a first triage step when investigating dispatch incidents — see
  [`INCIDENT_RUNBOOK_GAS_CITY.md`](INCIDENT_RUNBOOK_GAS_CITY.md).
