# Function Factory Product Documentation

This is the product-level guide for Function Factory: what it does, how it
works, and how to use it in production.

## What It Is

Function Factory is a closed-loop system that turns operational pressure into
trustworthy executable Functions, runs them through an execution substrate, and
feeds runtime evidence back into the next iteration.

Current production execution substrate: Gas City + Cloudflare Worker ingress.

## What You Get

- A typed artifact pipeline from intent to execution evidence.
- Deterministic lineage across every major artifact.
- Verification at multiple layers (coherence, fidelity, persistence).
- Runtime lifecycle control (`dispatched`, `accepted`, `monitored`, regression).
- Operational controls for dispatch, monitoring, and incident recovery.

## Core Concepts

- `IS-*`: Intent Specification (what should be done).
- `ES-*`: Executable Specification (compiled operational plan).
- `EP-*`: Execution Packet used for dispatch/runtime binding.
- `FORM-*`: Dispatch/formula artifact sent to Gas City.
- `VR-*`: Verification report (coherence/fidelity/persistence evidence).
- `FN-*`: Function identity and lifecycle anchor.
- `INC-*`: Incident when invariants, freshness, or runtime behavior regress.

## How It Works (End-To-End)

1. **Seed execution context**  
   Factory creates an `EP-*` from operator-provided bootstrap or pipeline output.

2. **Dispatch to execution substrate**  
   `POST /dispatch-formula` sends the compiled dispatch payload to Gas City and
   records dispatch lineage (`FORM-*`, bead/workflow identifiers).

3. **Execution + callback evidence**  
   Gas City executes and posts signed callback events to
   `POST /webhooks/gascity` (HMAC-verified).

4. **Verification + lifecycle transitions**  
   Factory stores fidelity/persistence evidence (`VR-*`) and updates `FN-*`
   lifecycle states (`accepted -> monitored`, regression on stale/failing evidence).

5. **Continuous autonomy monitoring**  
   Cloudflare cron/operator monitor checks detector freshness, stale dispatch,
   recurring incidents, and escalates to operational pressure artifacts as needed.

## Product Interfaces

### Public operational endpoints

- `GET /version`
- `GET /debug/health`
- `GET /gascity/autonomy/status`
- `POST /gascity/autonomy/run` (operator token)
- `POST /seed-dispatch-ep` (operator token)
- `POST /dispatch-formula` (operator token)
- `POST /webhooks/gascity` (HMAC-signed event ingress)

### Operator tooling

- Full production smoke: `bash scripts/ops/first-dispatch.sh`
- SLO snapshot: `pnpm slo:dashboard`
- Incident procedures: `docs/how-to/INCIDENT_RUNBOOK_GAS_CITY.md`
- Day-2 operations: `docs/how-to/OPERATOR_RUNBOOK_GAS_CITY_PRODUCTION.md`

## Operational Modes

- **Bootstrap mode:** fast iteration, controlled dispatch, direct smoke evidence.
- **Monitored mode:** sustained operations with persistence freshness enforcement.
- **Regression mode:** stale/failing evidence demotes assurance and emits incidents.

## SLO View

Current SLO dashboard checks:

1. Health endpoint returns healthy runtime dependencies.
2. Autonomy status endpoint returns `ok=true`.
3. At least one monitored function is present.
4. No open incidents.
5. Persistence evidence is fresh.
6. Worker deployment freshness is within threshold.

Run:

```bash
pnpm slo:dashboard --strict
```

## Current V1 Scope

Included in V1:

- Production deploy path on Cloudflare.
- Dispatch + webhook callback bridge to Gas City.
- Lifecycle + persistence monitoring.
- Operator runbooks and incident handling.
- SLO dashboard command with strict gating mode.

Still maturing:

- Intermittent latency on direct `POST /gascity/autonomy/run`; status endpoint is
  the authoritative fallback in smoke and operations.

## Related Docs

- Architecture overview: `ARCHITECTURE.md`
- V1 delivery plan: `specs/reference/V1-ROADMAP.md`
- Operator runbook: `docs/how-to/OPERATOR_RUNBOOK_GAS_CITY_PRODUCTION.md`
- Incident runbook: `docs/how-to/INCIDENT_RUNBOOK_GAS_CITY.md`
- SLO dashboard guide: `docs/how-to/SLO_DASHBOARD.md`
