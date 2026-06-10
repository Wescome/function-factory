# Spec Impact Matrix — function-factory

> Phase 4 · Architect · Generated 2026-06-08 · Updated 2026-06-10

This matrix shows which components/units are impacted when key pipeline components change.

---

## Impact Matrix

| Component Changed | ff-pipeline | synthesis-coordinator | gascity-dispatch | ff-gates | verification |
|-------------------|-------------|----------------------|-----------------|----------|-------------|
| `SignalInput` schema | 🔴 CRITICAL | 🔴 via TrellisPacket | 🟡 indirect | — | — |
| `ingest-signal.ts` | 🔴 CRITICAL | — | — | — | — |
| `synthesize-pressure.ts` | 🔴 CRITICAL | — | — | — | — |
| `map-capability.ts` | 🔴 CRITICAL | — | — | — | — |
| `propose-function.ts` | 🔴 CRITICAL | — | — | — | — |
| `compile.ts` (PASS_NAMES) | 🔴 CRITICAL | 🟡 atom structure | 🟡 dispatch format | 🔴 CV checks | 🟡 schema |
| `crystallize-intent.ts` | 🔴 CRITICAL | — | — | — | — |
| `reconciliation-gate.ts` | 🔴 CRITICAL | — | — | — | — |
| `ff-gates` (CoherenceVerification) | 🔴 CRITICAL | 🟡 synthesis unblocked/blocked | — | 🔴 CRITICAL | 🟡 VR schema |
| `TrellisExecutionPacket` schema | 🟡 pipeline enqueue | 🔴 CRITICAL | — | — | — |
| `SynthesisCoordinator` | 🔴 dispatch path | 🔴 CRITICAL | — | — | — |
| `AtomExecutor` | 🟡 atoms-complete | 🔴 CRITICAL | — | — | — |
| `GasCitySupervisor` | — | — | 🔴 CRITICAL | — | — |
| `FactoryStore` | — | — | 🔴 CRITICAL | — | — |
| `generate-feedback.ts` | 🔴 CRITICAL | — | — | — | — |
| `lineage_edges` collection | 🟡 lineage steps | — | — | 🔴 CV check 5 | 🟡 |
| `@factory/schemas:core.ts` | 🔴 ALL | 🔴 ALL | 🔴 ALL | 🔴 ALL | 🔴 ALL |
| `@factory/task-routing` | 🔴 ALL model calls | — | — | — | — |
| `@factory/db-client` | 🔴 CRITICAL | 🟡 indirect (config seed) | 🔴 dispatch + fidelity | 🔴 lineage SQL | — |
| `D1 (ff-factory) schema` | 🔴 CRITICAL | — | 🔴 CRITICAL | 🔴 CRITICAL | — |
| `keepalive wiring` | 🔴 CRITICAL (dispatch step) | — | 🔴 CRITICAL (gascity-supervisor) | — | — |
| `@factory/artifact-graph` | 🟡 INDIRECT (loop-closure consumer) | — | — | — | — |
| `@factory/bead-graph` | 🟡 INDIRECT (via ksp-sdk) | — | — | — | — |
| `@factory/loop-closure` | 🔴 CRITICAL (session open/close) | — | 🔴 CRITICAL (outcome bridge) | — | — |
| `@factory/gears` | 🔴 CRITICAL (claim/release hooks) | — | 🟡 INDIRECT | — | — |
| `@factory/ksp-sdk` | 🟡 INDIRECT (via harness-bridge) | — | — | — | — |
| `packages/harness-bridge` | DELETED (step 47) | — | — | — | — |
| `packages/runtime` | DELETED (step 47 — stub) | — | — | — | — |

**Legend:**
- 🔴 CRITICAL — direct dependency, change breaks this unit
- 🟡 INDIRECT — transitive dependency, requires validation
- — no dependency

---

## KSP Layer — Package Impact Matrix

This section extends the main matrix for the KSP package layer. Columns are KSP consumers; rows are KSP packages.

| Package Changed | factory-graph | loop-closure | ff-pipeline | gears | ksp-sdk |
|-----------------|--------------|--------------|-------------|-------|---------|
| `@factory/artifact-graph` (schema) | 🔴 CRITICAL | 🔴 CRITICAL | 🟡 INDIRECT | — | — |
| `@factory/artifact-graph` (queries) | 🔴 CRITICAL | 🟡 INDIRECT | — | — | — |
| `@factory/bead-graph` (schema) | 🔴 CRITICAL | 🔴 CRITICAL | 🟡 INDIRECT | 🔴 CRITICAL | 🔴 CRITICAL |
| `@factory/bead-graph` (SDK interface) | 🟡 INDIRECT | 🟡 INDIRECT | — | — | 🔴 CRITICAL |
| `@factory/loop-closure` (bridge methods) | 🔴 CRITICAL | 🔴 CRITICAL | 🔴 CRITICAL | 🟡 INDIRECT | — |
| `@factory/ksp-sdk` (re-export interface) | — | — | 🟡 INDIRECT | — | — |
| `@factory/gears` (CoordinatorDO hooks) | — | — | 🔴 CRITICAL | 🔴 CRITICAL | — |
| `@factory/factory-graph` (divergence/hypothesis/verifier) | — | 🔴 CRITICAL | 🔴 CRITICAL | — | — |
| `D1 factory-bead-audit` (schema) | — | — | — | 🔴 CRITICAL | — |
| `KV key patterns / TTLs` | — | 🔴 CRITICAL | 🟡 INDIRECT | 🟡 INDIRECT | — |

**Build order constraint:** `artifact-graph` and `bead-graph` have no dependencies between them. `loop-closure` depends on both. `ksp-sdk` depends only on `bead-graph`. `factory-graph` depends on all three. `gears` depends on `factory-graph`. Any change in `artifact-graph` or `bead-graph` schemas requires a full rebuild of the dependency chain before deploying.

---

## Deleted Packages (KSP Step 47)

| Package | Status | Notes |
|---------|--------|-------|
| `packages/harness-bridge` | DELETED | Consumed `@factory/ksp-sdk` via KnowingStateSDK. Replaced by direct Gas City / Flue session management. |
| `packages/runtime` | DELETED | Stub package. No active consumers at deletion. |

---

## db-client Package — Dependents

`@factory/db-client` (renamed from `@factory/arango-client`, PR #79) is the sole DB abstraction layer for D1 operational-state access. Any API or behavioral change cascades to all of the following:

| Consumer | Risk | What breaks |
|----------|------|-------------|
| `workers/ff-pipeline/src/stages/ingest-signal.ts` | 🔴 CRITICAL | Signal deduplication — idempotency key lookup + insert |
| `workers/ff-pipeline/src/stages/compile.ts` (assembly pass) | 🔴 CRITICAL | ExecutableSpecification D1 persistence |
| `workers/ff-pipeline/src/compilers/formula-compiler-adapter.ts` | 🔴 CRITICAL | `buildFormulaCompilerDeps` — all DB ops injected into Formula compiler |
| `workers/ff-pipeline/src/gascity/webhook-receiver.ts` | 🔴 CRITICAL | Dispatch log lookup, completion event writes, fidelity verdict writes, specs_functions lifecycle |
| `workers/ff-pipeline/src/gascity/autonomy-monitor.ts` | 🔴 CRITICAL | All sweep queries (specs_functions, dispatch_log, incidents) |
| `workers/ff-pipeline/src/config/hot-config.ts` | 🔴 CRITICAL | TTL-cached hot configuration read from D1 |
| `workers/ff-pipeline/src/stages/drift-ledger.ts` | 🟡 INDIRECT | Best-effort drift entry writes |
| `workers/ff-gates/src/index.ts` | 🔴 CRITICAL | Lineage completeness SQL query (migrated from AQL) |
| `workers/ff-gateway/src/` | 🟡 INDIRECT | Config + routing queries |

---

## D1 Migration Impact

The D1 migration (PRs #79–#80, AD-08) converted the following components from ArangoDB AQL to D1 SQL. Any regression in D1 connectivity or schema affects all of these simultaneously:

| Component | Migration scope | Risk of D1 regression |
|-----------|----------------|----------------------|
| `autonomy-monitor.ts` | Full sweep: all read queries (specs_functions, dispatch_log, completion_events, incidents) and all writes | 🔴 CRITICAL — monitor goes dark; stale dispatches undetected |
| `formula-compiler-adapter.ts` | Dispatch log writes, formula artifact writes | 🔴 CRITICAL — formula dispatch fails silently |
| `webhook-receiver.ts` | Completion event idempotency, dispatch log lookup, lineage mismatch check | 🔴 CRITICAL — webhook processing halts; Gas City callbacks lost |
| `ingest-signal.ts` | Idempotency key dedup query + insert | 🔴 CRITICAL — signal dedup breaks; duplicate pipelines possible |
| `ff-gates` lineage check | SQL SELECT for lineage completeness | 🔴 CRITICAL — Coherence Verification fails closed |
| Hot configuration loader | SQL SELECT on config tables | 🟡 INDIRECT — fails open to hardcoded defaults; degraded but functional |

---

## Keepalive Wiring — ff-pipeline → gascity-supervisor Dependency

The keepalive refcount protocol (PR #84, AD-11) creates a lifecycle dependency between ff-pipeline formula dispatch and the GasCitySupervisor container:

| Change | ff-pipeline impact | gascity-supervisor impact |
|--------|-------------------|--------------------------|
| `POST /v0/keepalive/start` timeout / failure | Dispatch step proceeds (fail-open, 5s timeout) | Container may sleep mid-execution if no other pinner |
| `POST /v0/keepalive/stop` timeout / failure | Best-effort, never blocks webhook-receiver | Refcount may leak; container stays warm longer than needed |
| `GAS_CITY` service binding removed | Keepalive calls fail silently (no route to supervisor) | Container unaware; behaves as if no pinner |
| `onActivityExpired` logic changed in supervisor | — | May cause premature container sleep under active molecules |
| Supervisor `onStop` async change (PR #85) | — | Stale refcount no longer persists across restarts |

**Dependency chain:** `ff-pipeline dispatch-formula step` → `GAS_CITY service binding` → `GasCitySupervisor Container DO` → `POST /v0/keepalive/start` → `keepalive_refcount` in DO storage → `onActivityExpired` guard.

Any break in this chain that causes premature container sleep during active molecule execution will result in `503 container_not_ready` from the Gas City daemon and a `dispatch-failed` or stale-dispatch incident.

---

## Highest-Risk Files (Impact to Multiple Units)

| File | Risk Level | Reason |
|------|-----------|--------|
| `packages/schemas/src/core.ts` | CRITICAL | All packages depend on it; any type change cascades to all stages |
| `workers/ff-pipeline/src/pipeline.ts` | CRITICAL | Top-level orchestrator; controls step naming, timeout configs, state machine |
| `workers/ff-pipeline/src/stages/compile.ts` | HIGH | 8-pass compiler; PASS_NAMES array controls all compilation behavior |
| `packages/db-client/src/` | HIGH | All D1 operational I/O routed through this client; replaces arango-client as primary DB package |
| `workers/ff-gates/src/index.ts` | HIGH | Coherence Verification failure affects every pipeline execution |
| `workers/ff-pipeline/src/stages/ingest-signal.ts` | HIGH | Idempotency logic — changes affect dedup behavior globally |
| `workers/ff-pipeline/src/gascity/webhook-receiver.ts` | HIGH | Gas City callback processing; D1 writes for completion/fidelity/lifecycle |
| `workers/ff-pipeline/src/gascity/autonomy-monitor.ts` | HIGH | All D1 sweep queries for Gas City lifecycle monitoring |
| `workers/ff-pipeline/src/compilers/formula-compiler-adapter.ts` | HIGH | Wires db-client into Formula compiler; dispatch fails if deps incorrect |
| `.reversa/config.toml` | LOW | Reversa config only |
