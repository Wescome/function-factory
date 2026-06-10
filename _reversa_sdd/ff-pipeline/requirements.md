# Requirements — ff-pipeline

> Unit: ff-pipeline (FactoryPipeline Workflow)
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — Gas City era, D1 migration)

---

## JTBD

When a Signal is received (market condition, customer request, internal metric, or Gas City revision), I want the system to deterministically compile it into a verified ExecutableSpecification and dispatch it to Gas City as a Formula, so that work orders are delivered without manual intervention and the pipeline terminates immediately after dispatch.

---

## Functional Requirements

### FR-01: Signal Ingestion with Idempotency
The pipeline MUST ingest a `SignalInput` by persisting it to D1 `specs_signals` via `ArangoClient.save()` with a computed idempotency key. If a matching Signal already exists (by idempotency key hash), the existing document MUST be returned without creating a duplicate.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/ingest-signal.ts:51-66`

### FR-02: Pressure Synthesis (LLM)
Given a Signal, the pipeline MUST synthesize a named, prioritized Pressure artifact by calling an LLM model. The Pressure MUST be persisted to D1 `specs_pressures` with a lineage edge back to its Signal.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/synthesize-pressure.ts`

### FR-03: Capability Mapping (LLM)
Given a Pressure, the pipeline MUST identify the Capability needed to address it. The Capability MUST be persisted to D1 `specs_capabilities` with a lineage edge back to its Pressure.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/map-capability.ts`

### FR-04: Function Proposal with Birth Gate (LLM)
Given a Capability, the pipeline MUST propose a Function with an IntentSpecification. The LLM MUST return a `birthGateScore` (0-1). If `birthGateScore < 0.5`, the pipeline MUST throw an error (halt). The proposal MUST be persisted to D1 `specs_functions` with a lineage edge back to its Capability.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/propose-function.ts`

### FR-05: Architect Approval Gate (Human-in-the-Loop)
After a Function Proposal is generated, the pipeline MUST pause execution and wait up to 7 days for an `architect-approval` workflow event. If the architect rejects, the pipeline MUST persist a rejection VerificationReport and terminate with `status: 'rejected'`. If `params.signal.raw.autoApprove === true`, the approval step MUST be skipped and an inline `approvalPayload` constructed.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/pipeline.ts:171-183`

### FR-06: Semantic Review (Advisory LLM)
Before compilation, the pipeline MUST perform a semantic review of the IntentSpecification. If alignment is 'miscast', the pipeline MUST log a warning but MUST NOT halt (advisory mode). A CRP MUST be created if review confidence < 0.7.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/semantic-review.ts`

### FR-07: Intent Crystallization
The pipeline MUST crystallize binary `IntentAnchor` checkpoints from the Signal's intent before compilation. Anchors MUST be persisted to D1 `intent_anchors`. If the crystallizer is disabled via hot-config, 0 anchors MUST be returned (fail-open, zero behavior change).
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/pipeline.ts:load-crystallizer-config`, `crystallize-intent` steps

### FR-08: 8-Pass Compilation with Intent Probing
The pipeline MUST compile through 8 ordered passes: `decompose`, `dependency`, `invariant`, `interface`, `binding`, `validation`, `assembly`, `verification`. The `decompose` pass MUST be probed via IntentAnchors with up to `MAX_REMEDIATION=2` remediation attempts. Assembly and verification MUST be deterministic (no LLM call). File contexts from `specContent` spec paths MUST be fetched from GitHub and injected into the decompose pass.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/compile.ts:1-370`, `pipeline.ts:PROBED_PASSES`

### FR-09: Reconciliation Gate (Fail on Block Escalation)
If 'block'-severity IntentAnchors are violated after MAX_REMEDIATION attempts, the pipeline MUST terminate with `status: 'synthesis:intent-violation'`. The reconciliation gate MUST be purely deterministic.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/reconciliation-gate.ts`

### FR-10: Coherence Verification (Fail-Closed Gate)
Before dispatch, the pipeline MUST evaluate the ExecutableSpecification against Coherence Verification via Service Binding to ff-gates. If any check fails, the pipeline MUST persist a failure report to D1, enqueue a feedback signal, and terminate with `status: 'coherence-verification-failed'`.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/pipeline.ts` coherence-verification step

### FR-11: Skeleton Workspace Seeding
Before Formula dispatch, the pipeline MUST fetch the repository tarball from GitHub, upload it to R2 (`skeletons/{functionId}/{timestamp}.tar.gz`), record a `SkeletonManifest` to D1, and issue a signed `/skeleton-download` URL (2-hour window). The skeleton ensures Gas City containers have a non-empty `git diff --cached` baseline.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/gascity/skeleton-builder.ts:1-154`

### FR-12: Execution Packet Assembly
The pipeline MUST assemble an ExecutionPacket (`EP-{esKey}`) embedding the ExecutableSpecification SHA-256, skeleton variables (`skeleton_r2_key`, `skeleton_sha`, `workspace_url`), and 3 roles (`planner`, `coder`, `verifier`). The EP MUST be persisted to D1 `execution_packets`.
- Priority: **Must**
- 🟢 CONFIRMADO — `pipeline.ts:513-567`

### FR-13: Formula Dispatch to Gas City (Replaces Synthesis Queue)
After Coherence Verification passes, the pipeline MUST call `compileAndDispatchFormula()` using the `GAS_CITY` service binding (not public HTTP). If `outcome !== 'dispatched'`, the pipeline MUST terminate with `status: 'dispatch-failed'`. The pipeline MUST terminate immediately at `status: 'dispatched'` — it does NOT wait for synthesis results.
- Priority: **Must**
- 🟢 CONFIRMADO — `pipeline.ts:570-591`, `formula-compiler-adapter.ts`

### FR-14: Keepalive Lifecycle Integration
Before Formula dispatch, the pipeline MUST call `POST /v0/keepalive/start` on the Gas City supervisor to increment the keepalive refcount. After dispatch, it MUST call `POST /v0/keepalive/stop`. Both calls MUST have a 5-second timeout and MUST NOT block the pipeline on failure.
- Priority: **Must**
- 🟢 CONFIRMADO — wired around `dispatch-formula` step (ADR-011)

### FR-15: Function Lifecycle State Transition
After successful dispatch, the pipeline MUST call `markFunctionDispatched()` to upsert the `specs_functions` record to lifecycle state `dispatched`. If the function is already in a terminal state (`accepted`/`monitored`/`regressed`/`retired`), the transition MUST be skipped.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/gascity/autonomy-monitor.ts:markFunctionDispatched`

### FR-16: Feedback Loop Generation (3-Layer Prevention)
On relevant terminal states, the pipeline MUST generate feedback signals subject to: (1) `feedbackDepth >= 3` → return empty; (2) idempotency hash dedup via ingest-signal; (3) 30-minute cooldown per `(executableSpecificationId, subtype)`.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/generate-feedback.ts:1-392`

### FR-17: specContent Grounding Mode
When `SignalInput.specContent` is present, all LLM stages MUST operate in grounded/extractive mode. This applies to pressure synthesis, capability mapping, function proposal, semantic review, and compilation. File contexts from `specContent` spec paths MUST be fetched from GitHub and injected into the decompose pass as `existingFiles`.
- Priority: **Must**
- 🟢 CONFIRMADO — `compile.ts:84-148`, `propose-function.ts:SPEC_GROUNDED_PROMPT`

### FR-18: Learning Transcript Capture
On every terminal pipeline exit, the pipeline MUST attempt `captureLearningTranscript()` (feature-flagged via `LEARNING_ENABLED`). Capture MUST be fail-open (never block the return value). Write timeout: `LEARNING_WRITE_TIMEOUT_MS` (default 500ms).
- Priority: **Should**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/learning-capture.ts:1-112`

### FR-19: GovernorAgent Cron + Queue Runner
The Worker MUST run `runGovernanceCycle()` on every 15-minute cron tick and on `feedback-signals` queue messages with `type:'governor-cycle'`. The Governor MUST pre-fetch 9 parallel D1 queries, invoke an LLM planner, and execute deterministic actions (max 5 `trigger_pipeline`, max 3 `approve_pipeline` per cycle).
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/agents/governor-agent.ts:1-1025`

### FR-20: Gas City Autonomy Monitor Cron Runner
The Worker MUST run `runGasCityAutonomyMonitor()` on every 15-minute cron tick and via `POST /gascity/autonomy/run`. The monitor MUST evaluate `accepted`, `monitored`, and stale-dispatch states in D1, create incidents on failures, and escalate recurring incidents into Pressure signals.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/gascity/autonomy-monitor.ts:1-595`

### FR-21: Gas City Webhook Receiver
The Worker MUST receive HMAC-SHA256 signed webhook events from Gas City at `POST /webhooks/gascity`. For completion events (`outcome: approved|revise`), it MUST transition function lifecycle state in D1 and write `fidelity_verdicts` and `completion_events`. For `outcome: revise` exceeding `GAS_CITY_MAX_AMENDMENT_DEPTH` (default 3), it MUST write an incident. After each callback it MUST issue a best-effort keepalive stop.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/gascity/webhook-receiver.ts:1-612`

---

## Non-Functional Requirements

### NFR-01: D1 as Primary Data Store
All artifact persistence MUST use D1 (`DB` binding) via `@factory/db-client`. ArangoDB is no longer the primary store. D1 uses the two-table model (`documents`, `edges`). ArangoDB bindings (`ARANGO_URL`, `FF_ARANGO`) remain for legacy read paths and agent context pre-fetching only.
- 🟢 CONFIRMADO — `d1-schema.sql`, ADR-010

### NFR-02: Workflow Step Idempotency
All workflow steps MUST use unique, deterministic step names so CF Workflow deduplication guarantees exactly-once execution on replay. Remediation steps MUST include the attempt index: `compile-verify-{passName}-r{n}`.
- 🟢 CONFIRMADO — `pipeline.ts` step name constants

### NFR-03: AI Step Timeout
All LLM-calling steps MUST use `AI_STEP_CONFIG`: 4-minute timeout, 2 retries, exponential backoff (5s delay).
- 🟢 CONFIRMADO — `pipeline.ts:41-50`

### NFR-04: DB Step Timeout
All D1-calling steps MUST use `DB_STEP_CONFIG`: 30-second timeout, 3 retries, exponential backoff (2s delay).
- 🟢 CONFIRMADO — `pipeline.ts:41-50`

### NFR-05: Architect Approval SLA
The architect approval wait window MUST be 7 days.
- 🟢 CONFIRMADO — `pipeline.ts waitForEvent timeout: '7 days'`

### NFR-06: Gas City Terminates at Dispatched
The pipeline MUST NOT wait for synthesis completion. It terminates at `dispatched` status immediately after Formula dispatch. The synthesis-era `waitForEvent('synthesis-complete')` and `waitForEvent('atoms-complete')` loops have been REMOVED.
- 🟢 CONFIRMADO — `pipeline.ts:607-613`, ADR-009

### NFR-07: Hot Configuration
Runtime configuration MUST be loaded from D1 (`config_aliases`, `config_routing`, `config_model_capabilities`) via TTL-cached `HotConfigLoader` (60s cache). Never throws — falls back to hardcoded defaults.
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/config/hot-config.ts`

### NFR-08: Best-Effort Telemetry
Drift ledger writes, CRP creation, and learning capture MUST be best-effort. Errors MUST be swallowed and MUST NOT block or fail the pipeline's main return value.
- 🟢 CONFIRMADO — `drift-ledger.ts`, `crp.ts`, `learning-capture.ts`

---

## Acceptance Criteria

**Scenario: Happy path Signal → Gas City dispatch**
```
Dado: A valid SignalInput is submitted with all required fields
Quando: FactoryPipeline.run() is invoked
Então:
  - Signal (SIG-*) persisted to D1 specs_signals
  - Pressure (PRS-*) persisted to D1 specs_pressures
  - Capability (BC-*) persisted to D1 specs_capabilities
  - FunctionProposal (FP-*) persisted to D1 specs_functions (birthGateScore >= 0.5)
  - architect-approval waitForEvent reached (pipeline pauses)
  - After approval: ExecutableSpecification (ES-*) compiled, passes CoherenceVerification
  - Skeleton uploaded to R2; SkeletonManifest persisted to D1
  - ExecutionPacket (EP-*) persisted to D1 execution_packets
  - keepalive/start called on Gas City supervisor
  - Formula dispatched via GAS_CITY service binding
  - keepalive/stop called
  - Pipeline returns status: 'dispatched'
```

**Scenario: Duplicate Signal is deduplicated**
```
Dado: A Signal with the same title, description, and signalType was already processed
Quando: The same SignalInput is submitted again
Então: ingestSignal returns the existing Signal without creating a new one
```

**Scenario: Birth gate rejects low-confidence proposal**
```
Dado: The LLM returns birthGateScore = 0.3
Quando: proposeFunction executes
Então: Error thrown; pipeline halts; no ExecutableSpecification compiled
```

**Scenario: Block-severity IntentAnchor violated after MAX_REMEDIATION attempts**
```
Dado: A block-severity anchor is violated in all 3 decompose compile attempts
Quando: reconcile() is called with remediationAttempt = MAX_REMEDIATION
Então: GateDecision.verdict = 'escalate'; pipeline returns status: 'synthesis:intent-violation'
```

**Scenario: Coherence Verification fails**
```
Dado: Assembled ExecutableSpecification has atoms without implementation bindings
Quando: evaluateCoherenceVerification is called
Então: CoherenceVerificationReport.passed = false; pipeline returns status: 'coherence-verification-failed'; feedback signal enqueued
```

**Scenario: Gas City revision exceeds amendment depth**
```
Dado: Gas City calls /webhooks/gascity with outcome='revise' and factory_attempt=3 (= GAS_CITY_MAX_AMENDMENT_DEPTH)
Quando: webhook-receiver processes the callback
Então: Incident written to specs_incidents; no new revision Signal created
```

**Scenario: GovernorAgent auto-triggers feedback loop**
```
Dado: A pending Signal with source='factory:feedback-loop', feedbackDepth=1, autoApprove=true
Quando: runGovernanceCycle() runs
Então: meetsAutoTriggerCriteria() returns true; FACTORY_PIPELINE.create() called; count incremented toward max 5
```
