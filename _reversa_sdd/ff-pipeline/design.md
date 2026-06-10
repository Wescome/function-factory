# Design — ff-pipeline

> Unit: ff-pipeline (FactoryPipeline Workflow)
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — Gas City era, D1 migration)

---

## Overview

`FactoryPipeline` is a `WorkflowEntrypoint<PipelineEnv, PipelineParams>` running on Cloudflare Workers. It orchestrates the full Discovery Core pipeline through ~27 named `step.do()` / `step.waitForEvent()` calls. Steps are durable and idempotent by name.

The class itself is stateless — all state is accumulated in the local `compState` object passed between steps via serializable objects. The Cloudflare Workflow runtime provides durability.

**Gas City era:** The pipeline terminates at `dispatched` immediately after Formula dispatch. The synthesis-era `waitForEvent('synthesis-complete')` / `waitForEvent('atoms-complete')` loops have been REMOVED (ADR-009). The harness path returns `status: 'harness-removed'` immediately.

---

## Component Hierarchy

```
FactoryPipeline (WorkflowEntrypoint)
├── Stage functions (pure, each persists to D1 via @factory/db-client)
│   ├── ingestSignal(input, db) → Signal
│   ├── synthesizePressure(signal, db, env, dryRun) → Pressure
│   ├── mapCapability(pressure, db, env, dryRun) → Capability
│   ├── proposeFunction(capability, db, env, dryRun) → FunctionProposal
│   ├── semanticReview(proposal, db, env, dryRun) → SemanticReviewResult
│   ├── crystallizeIntent(input, env, dryRun, enabled) → CrystallizationResult
│   └── compileIntentSpecification(passName, state, db, env, dryRun) → compState+
│       ├── probeAnchors(deltaStr, anchors, env, dryRun) → ProbeResult[]
│       ├── reconcile(probeResults, anchors, attempt, max) → GateDecision
│       └── appendDriftEntry(...) → void (best-effort, swallows errors)
├── evaluateCoherenceVerification(es) → CoherenceVerificationReport
│   (via GATES Service Binding → ff-gates GatesService)
├── buildSkeleton(functionId, env) → SkeletonManifest  [GitHub → R2 → signed URL]
├── buildExecutionPacket(es, skeleton, env) → ExecutionPacket
├── keepalive/start → GAS_CITY service binding (best-effort)
├── compileAndDispatchFormula(ep, env) → { outcome }
├── keepalive/stop → GAS_CITY service binding (best-effort)
├── markFunctionDispatched(functionId, db) → void
├── captureLearningTranscript(input) → PipelineResult (pass-through)
├── GovernorAgent cron + queue runner (15-min cron, feedback-signals queue)
└── GasCityAutonomyMonitor cron + queue runner (15-min cron)
```

---

## Key Data Flows

### Discovery Core — Gas City Path (current)

```
PipelineParams.signal
  ↓ ingest-signal → Signal (SIG-*) [D1: specs_signals]
  ↓ synthesize-pressure → Pressure (PRS-*) [D1: specs_pressures]
      edge-pressure-signal (D1: lineage_edges)
  ↓ map-capability → Capability (BC-*) [D1: specs_capabilities]
      edge-capability-pressure (D1: lineage_edges)
  ↓ propose-function → FunctionProposal (FP-*) [D1: specs_functions]
      edge-proposal-capability (D1: lineage_edges)
  ↓ [if autoApprove] skip wait / [else waitForEvent: architect-approval, 7d]
  ↓ semantic-review [LLM, advisory — miscast does NOT halt]
      [if confidence < 0.7] → crp-semantic-review [D1: consultation_requests]
  ↓ load-crystallizer-config [D1: hot_config]
  ↓ crystallize-intent [LLM] → IntentAnchor[] [D1: intent_anchors]
  ↓ fetch-compile-context [GitHub Contents API → existingFiles]
  ↓ [8-pass compile loop]
      FOR each pass in PASS_NAMES:
        IF pass in PROBED_PASSES and passAnchors.length > 0:
          FOR r in [0..MAX_REMEDIATION=2]:
            compile-verify-{passName}-r{r} [LLM + probe + reconcile + drift]
            break if verdict != 'remediate'
          if verdict == 'escalate': intentViolation=true; break
        ELSE:
          compile-{passName} [LLM or deterministic]
  ↓ [if intentViolation] → status:'synthesis:intent-violation'
  ↓ edge-executableSpecification-proposal [D1: lineage_edges]
  ↓ coherence-verification [GATES service binding → ff-gates]
      [if !passed] → persist VR, enqueue feedback → status:'coherence-verification-failed'
  ↓ persist-coherence-verification-pass [D1: verification_reports, verification_status]
  ↓ build-skeleton [GitHub tarball → R2 → signed URL, D1: skeleton_manifests]
  ↓ build-execution-packet [D1: execution_packets]
  ↓ dispatch-formula [GAS_CITY service binding, keepalive start+stop]
      [if outcome != 'dispatched'] → status:'dispatch-failed'
  ↓ mark-function-dispatched [D1: specs_functions]
  ↓ status:'dispatched'
      captureTerminal → captureLearningTranscript [D1: learning_run_transcripts]
```

### Removed Paths (Gas City era)

| Removed path | Replacement |
|---|---|
| `SYNTHESIS_QUEUE.send()` → `waitForEvent('synthesis-complete')` | `dispatch-formula` + pipeline terminates |
| `waitForEvent('atoms-complete')` | Removed |
| `synthesis-era DO graph execution` | ADR-009 gate — returns interrupt immediately |
| `job.harnessKey` path | Returns `status: 'harness-removed'` immediately |

### Queue Consumer Flows

```
telemetry-queue → handleTelemetryBatch
feedback-signals type:'governor-cycle' → runGovernanceCycle
feedback-signals type:'pr-outcome' → fetchPROutcomeFromGitHub + ingestPROutcomeSignals
synthesis-results type:'phase1-complete' → ack (informational)
synthesis-results {workflowId,verdict} → relay synthesis-complete event (legacy path, still present)
atom-results → recordAtomResult → getReadyAtoms → dispatch deps → isComplete → atoms-complete event
```

---

## Critical Design Decisions

### Compile State Accumulation Pattern
`compState` starts as `{ intentSpecification, intentAnchors, signalContext, fileContexts, executableSpecification: null }`. Each pass adds its output fields via `{ ...state, ...parsed }`. The assembly pass assembles all fields into the `executableSpecification` object.

### `toStep()` Normalization
`toStep(obj)` performs `JSON.parse(JSON.stringify(obj))` before returning from any `step.do()`. This strips functions, undefined values, and non-serializable types for CF Workflow step deduplication.

### Delta Computation for Probing
`computeDelta(prevState, newState)` computes only keys that changed/were added. The probe receives this delta (not the full accumulated state). Internal `_` prefixed keys are excluded.

### Minimal Context Per Pass
Each compilation pass receives only the fields it needs (anti-corruption slicing):
- `decompose`: intentSpecification (summary), signalContext, violationFeedback, existingFiles (exports+functions only — NOT raw content)
- `dependency`: atoms (id+type+title+description only)
- `invariant`: intentSpecification + atoms
- `interface`: atoms + dependencies
- `binding`: atoms only
- `validation`: atoms + interfaces

### D1 Two-Table Model
D1 uses two general-purpose tables replacing ArangoDB's 48-collection model:
- `documents (collection, key, json)` — all document artifacts
- `edges (id, collection, from_id, to_id, data)` — all lineage/relationship edges

All collection writes use `@factory/db-client` (`ArangoClient` shim). `query()` / `queryOne()` callers use SQL with `?` placeholders (not AQL).

### Gas City Service Binding
`GAS_CITY` is a Worker service binding, not a public HTTP call. This avoids Cloudflare error 1042 (Worker-to-Worker public hop restriction). Formula dispatch and keepalive calls both use this binding.

### Skeleton Workspace Seeding
Gas City containers need a non-empty `git diff --cached` before agents write files. The skeleton builder fetches the GitHub repo tarball, uploads to R2, and produces a signed URL. The container downloads the skeleton at session start, so `git diff --cached` produces a meaningful CandidatePatch.

### Hot Configuration (TTL-Cached)
`HotConfigLoader` reads `config_aliases`, `config_routing`, `config_model_capabilities` from D1 with a 60s TTL. Never throws — falls back to hardcoded defaults. The crystallizer flag (`hot_config/pipeline.crystallizer.enabled`) is seeded idempotently via `seedPipelineConfig()`.

---

## Error Handling

| Failure Mode | Response |
|---|---|
| `birthGateScore < 0.5` | Error thrown, pipeline halts with unhandled step failure |
| Architect rejects | `status: 'rejected'`, VR persisted, captureTerminal called |
| IntentAnchor escalation | `status: 'synthesis:intent-violation'`, captureTerminal |
| CoherenceVerification failure | `status: 'coherence-verification-failed'`, feedback enqueued to FEEDBACK_QUEUE |
| `dispatch-formula` outcome != 'dispatched' | `status: 'dispatch-failed'`, captureTerminal |
| Skeleton build failure | Step retries (DB_STEP_CONFIG: 3 retries) |
| Gas City keepalive failure | Best-effort — swallowed, pipeline continues |
| LLM JSON parse failure | `compile.ts:runLivePass` attempts 4 regex repairs before hard error |
| Learning capture failure | Suppressed (fail-open), PipelineResult returned as-is |
| Drift ledger failure | Suppressed via `.catch(() => {})` |
| D1 query error (hot-config) | Falls back to hardcoded defaults |

---

## Data Structures

### PipelineEnv (key bindings)
```typescript
interface PipelineEnv {
  DB: D1Database                    // Cloudflare D1 — primary data store
  GAS_CITY?: Fetcher                // gascity-supervisor service binding
  GATES: { evaluateCoherenceVerification(es): Promise<CoherenceVerificationReport> }
  FACTORY_PIPELINE: { create, get } // Workflow self-binding
  WORKSPACE_BUCKET?: unknown        // R2 for skeleton tarballs
  GITHUB_TOKEN?: string
  GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY
  GAS_CITY_MAX_AMENDMENT_DEPTH?     // default 3
  GAS_CITY_PERSISTENCE_FRESHNESS_HOURS? // default 24
  GAS_CITY_DISPATCH_STALE_MINUTES?  // default 60
  GAS_CITY_RECURRING_INCIDENT_THRESHOLD? // default 3
  LEARNING_ENABLED?, LEARNING_OBSERVATIONS_ENABLED?
  LEARNING_WRITE_TIMEOUT_MS?        // default 500ms
  // ArangoDB kept for legacy agent context reads:
  ARANGO_URL, ARANGO_DATABASE, ARANGO_JWT, FF_ARANGO?
}
```

### compState (compilation accumulator)
```typescript
{
  intentSpecification: object
  intentAnchors: IntentAnchor[]
  signalContext: { title, description, specContent? }
  fileContexts: FileContext[]       // GitHub-fetched, exports+functions only
  executableSpecification: null | object
  atoms?, dependencies?, invariants?, interfaces?, bindings?, validations?
  _gateVerdict?: 'pass'|'warn'|'remediate'|'escalate'
  _violatedAnchors?: string[]
  _violationFeedback?: string
}
```

### SkeletonManifest
```typescript
{
  _key: "{functionId}-{safeTimestamp}"
  functionId: string
  r2Key: "skeletons/{functionId}/{safeTimestamp}.tar.gz"
  skeletonSha: string   // first 12 chars of HEAD commit SHA
  producedAt: string    // ISO
  expiresAt: string     // producedAt + 24h
}
```

---

## Collections Written by ff-pipeline

| D1 Collection | Written by |
|---|---|
| `specs_signals` | ingest-signal, governor-agent, webhook-receiver |
| `specs_pressures` | synthesize-pressure, autonomy-monitor |
| `specs_capabilities` | map-capability |
| `specs_functions` | propose-function, markFunctionDispatched, autonomy-monitor |
| `intent_anchors` | pipeline: persist-intent-anchors |
| `executable_specifications` | compile: assembly pass |
| `execution_packets` | pipeline: build-execution-packet |
| `formulas` | formula-compiler |
| `dispatch_log` | formula-compiler |
| `lineage_edges` (edges table) | pipeline: edge-* steps |
| `verification_reports`, `verification_status` | pipeline: coherence steps |
| `compilation_drift_ledger` | drift-ledger: appendDriftEntry |
| `skeleton_manifests` | skeleton-builder |
| `completion_events`, `fidelity_verdicts` | webhook-receiver |
| `specs_incidents`, `gascity_drift_events` | webhook-receiver, autonomy-monitor |
| `orl_telemetry`, `orientation_assessments` | governor-agent, memory-curator |
| `memory_curated`, `pattern_library` | memory-curator |
| `consultation_requests` | crp: createCRP |
| `learning_run_transcripts`, `learning_observations` | learning-capture |
| `hot_config`, `config_aliases`, `config_routing`, `config_model_capabilities` | seedHotConfig |
