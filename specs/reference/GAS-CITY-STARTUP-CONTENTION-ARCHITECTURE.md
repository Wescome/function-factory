# Gas City Startup Contention Architecture

Date: 2026-05-31  
Status: Approved — architecture gates cleared 2026-05-31  
Scope: Function Factory runtime integration with Gas City supervisor container  
Primary repos/paths:
- `Wescome/gascity` (branch: `factory`)
- `function-factory/workers/gascity-supervisor/`

## 1. Problem Statement

City startup intermittently fails to reach `running=true` within operational budgets because startup phases (especially `adopting_sessions`) are serialized and include operations that can stall under `bd`/Dolt cold-start contention.

Observed behavior:
- `GET /v0/cities` remains `running=false`, `status=adopting_sessions` for extended intervals.
- Dispatch automation fails on fixed readiness windows even when the city eventually recovers.

## 2. Root Cause Model

### 2.1 Failure plane
- Primary: Runtime Plane (startup FSM in Gas City runtime)
- Coupled dependency: State Plane A (`bd`/Dolt bead store readiness and latency)

### 2.2 Architectural failure mode
- Startup readiness is blocked by phase-completion gates that include heavy or variable-latency work.
- Adoption/reconciliation tasks compete with bead-store warmup and can exceed startup SLO.
- Readiness contract is binary (`running=true`) instead of phase-aware and dispatch-aware.

## 3. Architectural Goal

Guarantee deterministic startup progression under contention by:
1. Removing heavy contention-prone work from the startup critical path.
2. Hard-bounding all startup operations.
3. Exposing explicit readiness semantics for dispatch.

## 4. Target Architecture

## 4.1 Two-tier readiness contract

Introduce and publish:
- `control_ready`: API/container responsive.
- `dispatch_ready`: safe to accept `/dispatch-formula`.

Policy:
- Dispatch must gate on `dispatch_ready`, not only on process/container availability.

## 4.2 Startup FSM with deadlines

Canonical startup phases (extend `startupPhaseOrder` in `city_registry.go:434` — no rename):
1. `loading_config`
2. `starting_bead_store`
3. `resolving_formulas`
4. `adopting_sessions`
5. `starting_agents`
6. `running`

`allStartupPhases()` in `internal/api/supervisor.go` must reference `startupPhaseOrder` as single source of truth — eliminate the duplicated literal slice.

New phases are appended to `startupPhaseOrder`; existing 5 names are stable across all call sites.

Each phase carries:
- `phase_start_ts`
- `elapsed_ms`
- `deadline_ms`
- `attempt`
- `last_blocking_op`
- `last_error`

Terminal states:
- `failed_<phase>`
- `running_degraded`

No phase may remain open indefinitely.

## 4.3 Critical-path split

Move to minimal startup critical path:
- Required-for-dispatch in startup:
  - config load
  - bead store readiness probe
  - runtime provider init
  - minimal agent/session viability checks
- Deferred (async healing loop):
  - full historical session adoption
  - orphan detection and cleanup
  - deep bead reconciliation

## 4.4 Single-writer startup coordinator

Add city-scoped startup lease so only one coordinator performs startup mutation work against `bd`/Dolt at a time.

Effect:
- Prevent startup-contention amplification from concurrent coordinators.

## 4.5 Bounded adoption execution

Adoption execution model:
- bounded worker pool (small fixed concurrency)
- per-session hard deadline
- per-op timeouts (probe/list/lock/create)
- timeout result: record + defer, do not block startup indefinitely

## 4.6 Degraded-mode progression

If startup cannot fully complete non-critical adoption work within budget:
- transition to `running_degraded`
- continue healing in patrol ticks

`dispatch_ready` predicate for degraded mode — ALL of the following must hold:
1. Bead store open and writable
2. Adoption barrier completed (every running session has a bead)
3. Convergence-startup completed (active convergence index populated)
4. `onStarted` fired

Agent pool below desired count is the **only** allowed degraded axis — it self-heals on the 30s patrol tick. Bead store or convergence incompleteness is a hard fail, not degraded.

## 5. API/Status Contract

`/v0/cities` and city status endpoint must include:
- `running` (legacy compatibility)
- `control_ready`
- `dispatch_ready`
- `status` (phase or terminal)
- `phase_meta` (deadline/elapsed/attempt/blocker/error)

If not dispatch-ready:
- dispatch route returns structured `503`:
  - `reason: not_ready`
  - `status`
  - `retry_after_sec`
  - `phase_meta`

## 6. Supervisor Bundle Alignment

Supervisor bundle now lives at:
- `function-factory/workers/gascity-supervisor/`

Runtime/deploy scripts must treat this as the authoritative bundle root for:
- `gc-linux-amd64`
- `entrypoint.sh`
- `factory/city.toml`
- `factory/formulas/*`
- `factory/fidelity*`

## 7. Implementation Work Packages

## WP-1: FSM + readiness semantics (gascity)
- Add explicit phase metadata and terminal states.
- Add `control_ready`/`dispatch_ready` projection.
- Acceptance: no indefinite `adopting_sessions`; explicit terminal/degraded outcomes.

## WP-2: Critical-path minimization (gascity)
- Move deep adoption/reconcile work out of startup gate.
- Acceptance: startup reaches dispatch-ready without full historical reconciliation.

## WP-3: Single-writer startup lease — DROPPED
Not applicable. `entrypoint.sh` runs one `gc supervisor run` under tini; two concurrent startup coordinators are structurally impossible in the single-CF-Container topology. Revisit only if supervisor goes multi-instance.

## WP-4: Bounded adoption pool (gascity)
- Bounded worker pool + deadlines + defer queue.
- Acceptance: adoption backlog cannot block startup beyond phase deadline.

## WP-5: Dispatch readiness enforcement (function-factory + gascity)
- Enforce `dispatch_ready` in dispatch path.
- Acceptance: no blind dispatch attempts during startup limbo.

## WP-6: Script gating hardening (function-factory)
- Update `scripts/ops/first-dispatch.sh` to phase-aware wait with larger SLO budget and terminal-state detection.
- Acceptance: no false-negative startup failures from fixed short windows.

## 8. Observability Requirements

Emit structured events:
- `city.start.phase.enter`
- `city.start.phase.exit`
- `city.start.phase.timeout`
- `city.adoption.op.timeout`
- `city.start.transition.degraded`

Required dimensions:
- `city`
- `phase`
- `op`
- `duration_ms`
- `attempt`
- `build_version`
- `beads_provider`

## 9. SLOs

Startup SLOs:
- p99 `dispatch_ready` < 300s *(aspirational/uninstrumented — current structural ceiling from `first-dispatch.sh` two-loop sum)*
- p99.9 `dispatch_ready` < 420s

Correctness SLO:
- zero indefinite startup phase stalls

**Note:** SLOs tighten only after `dispatch_ready_ms` metric emission is instrumented (WP-1). 300s reflects the current observed worst-case ceiling, not a measured p99.

## 10. Rollout Plan

1. **WP-4** — Bounded adoption pool (aggregate deadline + small worker pool + defer-on-timeout). The actual hang fix.
2. **WP-1** — FSM telemetry + phase_meta (reconciled to existing 5-phase enum, `allStartupPhases()` deduplicated). Add `dispatch_ready_ms` metric emission.
3. **WP-6** — Bundle repoint (`first-dispatch.sh` `SUPERVISOR_DIR` → `workers/gascity-supervisor/`) + phase-aware wait with terminal-state detection.
4. **WP-2** — Critical-path split + degraded mode (predicate defined in §4.6).
5. **WP-5** — Dispatch-ready gating in ff-pipeline.
~~6. WP-3 — Dropped (see §WP-3).~~

Rollback: disable degraded-mode gating flag, revert to legacy `running` gate while retaining telemetry.

Rollback:
- disable degraded-mode gating flag and revert to legacy `running` gate while retaining telemetry.

## 11. Non-Goals

- Replacing `bd`/Dolt as bead store.
- Reworking Factory ontology artifacts.
- Changing fidelity verification semantics.

## 12. Acceptance Criteria

Architecture is accepted when:
1. `adopting_sessions` no longer stalls indefinitely.
2. Dispatch automation succeeds/retries deterministically against explicit readiness contract.
3. Cold starts under contention produce diagnosable phase/op timeout events, not ambiguous hangs.
4. `function-factory/workers/gascity-supervisor/` is the only deployment bundle path used by operational scripts.
