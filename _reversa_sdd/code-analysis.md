# Code Analysis — function-factory

> Phase 2 · Archaeologist · Generated 2026-06-08 · Patched 2026-06-10
> Focus: Discovery Core — Signal → Pressure → Capability → FunctionProposal → IntentSpecification → ExecutableSpecification

---

## Module 1: ff-pipeline (FactoryPipeline Workflow)

**Files:**
- `workers/ff-pipeline/src/pipeline.ts` — Cloudflare Workflow main execution body
- `workers/ff-pipeline/src/index.ts` — Worker fetch/queue/scheduled handlers + HTTP routes (2750 lines)
- `workers/ff-pipeline/src/types.ts` — PipelineEnv, PipelineParams, PipelineResult, SignalInput interfaces
- `workers/ff-pipeline/src/stages/compile.ts` — 8-pass compilation engine
- `workers/ff-pipeline/src/stages/drift-ledger.ts` — Crystallizer observability ledger
- `workers/ff-pipeline/src/stages/generate-feedback.ts` — Self-improvement loop signal generator
- `workers/ff-pipeline/src/stages/ingest-signal.ts` — Signal deduplication + ingestion
- `workers/ff-pipeline/src/stages/ingest-signal.ts`, `synthesize-pressure.ts`, `map-capability.ts`, `propose-function.ts`, `semantic-review.ts`, `pr-outcome-signal.ts`, `synthesize-pressure.ts`
- `workers/ff-pipeline/src/agents/governor-agent.ts` — Autonomous operational governor (Plan-Execute pattern)
- `workers/ff-pipeline/src/agents/memory-curator-agent.ts` — Memory curation (Orientation role)
- `workers/ff-pipeline/src/agents/architect-agent.ts`, `coder-agent.ts`, `critic-agent.ts`, `planner-agent.ts`, `tester-agent.ts`, `verifier-agent.ts` — Synthesis agent graph roles
- `workers/ff-pipeline/src/gascity/autonomy-monitor.ts` — Gas City lifecycle monitor
- `workers/ff-pipeline/src/gascity/webhook-receiver.ts` — Gas City HMAC-authenticated completion webhook
- `workers/ff-pipeline/src/gascity/skeleton-builder.ts` — Workspace seeding (SPEC-FF-SEEDWORKSPACE-001)
- `workers/ff-pipeline/src/compilers/formula-compiler-adapter.ts` — Dependency wiring for Formula compiler
- `workers/ff-pipeline/src/config/crystallizer-config.ts` — Hot-config for crystallizer.enabled flag
- `workers/ff-pipeline/src/config/hot-config.ts` — TTL-cached hot configuration loader (aliases, routing, model capabilities)
- `workers/ff-pipeline/src/crp.ts` — ConsultationRequestPack (CRP) auto-generation
- `workers/ff-pipeline/src/learning-capture.ts` — Learning transcript capture at pipeline terminal
- `workers/ff-pipeline/src/merge-readiness-pack.ts` — MergeReadinessPack assembly and ingestion
- `workers/ff-pipeline/d1-schema.sql` — Cloudflare D1 schema (documents + edges tables)
- `workers/ff-pipeline/wrangler.jsonc` — Worker bindings

**Role:** Top-level Cloudflare Worker hosting: (1) durable `FactoryPipeline` Workflow (Signal→Pressure→Capability→Proposal→Compilation→Formula Dispatch), (2) the GovernorAgent cron/queue runner, (3) the GasCityAutonomyMonitor cron runner, (4) the Gas City webhook receiver, and (5) all diagnostic HTTP routes. The pipeline has been substantially refactored from the synthesis-era (DO graph path) to the Gas City era (Formula dispatch path).

---

### 1.1 Control Flow

`FactoryPipeline extends WorkflowEntrypoint<PipelineEnv, PipelineParams>` — a durable Cloudflare Workflow with step-based execution and built-in idempotency via named steps.

**Execution sequence (current — Gas City era, from `pipeline.ts:run()`):**

```
1.  ingest-signal                  (DB_STEP_CONFIG) — dedup via idempotencyKey hash
2.  synthesize-pressure            (AI_STEP_CONFIG)
3.  edge-pressure-signal           (DB_STEP_CONFIG) — lineage edge
4.  map-capability                 (AI_STEP_CONFIG)
5.  edge-capability-pressure       (DB_STEP_CONFIG) — lineage edge
6.  propose-function               (AI_STEP_CONFIG)
7.  edge-proposal-capability       (DB_STEP_CONFIG) — lineage edge
8.  [if isAutoApproved]  auto-approve via approvalPayload shortcut
    [else] architect-approval      (waitForEvent, 7-day timeout, type='architect-approval')
    [if rejected] persist-rejection + terminal
9.  semantic-review                (AI_STEP_CONFIG, advisory — miscast does NOT halt)
10. [if review.confidence < 0.7] crp-semantic-review  (DB_STEP_CONFIG)
11. load-crystallizer-config       (DB_STEP_CONFIG)
12. crystallize-intent             (AI_STEP_CONFIG, 0 anchors if disabled/error)
13. [if intentAnchors.length > 0] persist-intent-anchors (DB_STEP_CONFIG)
14. fetch-compile-context          (DB_STEP_CONFIG) — GitHub file contexts from specContent paths
FOR each passName in PASS_NAMES:
  IF passName in PROBED_PASSES and passAnchors.length > 0:
    FOR r in [0..MAX_REMEDIATION=2]:
      15a. compile-verify-{passName}-r{r}  (AI_STEP_CONFIG)
           — compileIntentSpecification(passName)
           — computeDelta(prevState, newState)
           — probeAnchors(deltaStr, passAnchors)
           — reconcile → verdict ∈ {pass, warn, remediate, escalate}
           — appendDriftEntry (best-effort)
      break if verdict != 'remediate'
    if verdict == 'escalate': intentViolation=true; break pass loop
  ELSE:
    15b. compile-{passName}  (AI_STEP_CONFIG — non-probed)
16. [if intentViolation] → terminal: status='synthesis:intent-violation'
17. edge-executableSpecification-proposal (DB_STEP_CONFIG)
18. coherence-verification          (DB_STEP_CONFIG, via GATES service binding)
19. [if !passed] persist-coherence-verification-failure + enqueue-feedback-coherence-verification → terminal
20. persist-coherence-verification-pass  (DB_STEP_CONFIG)
21. [if !executableSpecification] → terminal: status='compile-incomplete'
22. build-skeleton                  (DB_STEP_CONFIG — GitHub tarball → R2 → signed URL)
23. build-execution-packet          (DB_STEP_CONFIG — EP artifact with skeleton vars)
24. dispatch-formula                (DB_STEP_CONFIG — compileAndDispatchFormula → Gas City)
25. [if outcome != 'dispatched'] → terminal: status='dispatch-failed'
26. mark-function-dispatched        (DB_STEP_CONFIG — lifecycle state machine)
27. terminal: status='dispatched'
    captureTerminal → captureLearningTranscript (if LEARNING_ENABLED)
```

**Note:** The synthesis-era waitForEvent `synthesis-complete` / `atoms-complete` loop has been REMOVED from the pipeline. The pipeline now terminates at `dispatched` status immediately after Gas City dispatch. The DO graph path was deprecated in ADR-009. Harness path (`job.harnessKey`) returns `status: 'harness-removed'` immediately.
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/pipeline.ts:100-613`

**Step configs:**
- `AI_STEP_CONFIG`: 4 min timeout, 2 retries, exponential backoff (5s delay)
- `DB_STEP_CONFIG`: 30 sec timeout, 3 retries, exponential backoff (2s delay)
- 🟢 CONFIRMADO — `pipeline.ts:41-50`

---

### 1.2 Key Algorithms

**Idempotency key for signals** (`ingest-signal.ts:computeIdempotencyKey`):
- FNV-variant hash (`(hash << 5) - hash + charCode`) over `signalType|source|title|description[:200]`
- Before save, queries D1 for existing doc with matching `idempotencyKey`
- Returns existing doc if found (dedup guarantee)
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/ingest-signal.ts:51-66`

**Birth gate** (`propose-function.ts`):
- LLM returns `birthGateScore` (0-1). If `< 0.5`, throws error halting pipeline.
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/propose-function.ts` (unchanged behavior)

**8-pass compiler loop** (`compile.ts`):
```
PASS_NAMES = ['decompose', 'dependency', 'invariant', 'interface', 'binding', 'validation', 'assembly', 'verification']
PROBED_PASSES = ['decompose']   // only 'decompose' is probed (C1+SE-1 resolution)
MAX_REMEDIATION = 2
```
- `decompose`: probed. Compiles atoms, then probeAnchors on delta, reconcile gate, up to 2 remediations.
- `dependency` through `validation`: non-probed live LLM passes.
- `assembly`: deterministic (merges bindings onto atoms, strips test atoms, runs dry-pass assembly, saves ES to D1).
- `verification`: deterministic (dry-pass only).
- Minimal context per pass (anti-corruption slicing): each pass receives only the fields it needs.
- JSON speculative repair on parse failure (4 regex substitutions before hard error).
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/compile.ts:1-370`

**Delta computation** (`pipeline.ts:computeDelta`):
- Before probe: computes `newState - prevState` as JSON diff on keys.
- Skips internal sentinel fields (prefixed `_`).
- Probe receives only the delta, not the accumulated full state.
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/pipeline.ts:68-82`

**Reconciliation gate** (unchanged from prior analysis):
```
No violations          → PASS
Log violations only    → PASS (record)
Warn violations        → WARN (advisory)
Block, attempt < max   → REMEDIATE (inject violation feedback)
Block, attempt >= max  → ESCALATE (status: synthesis:intent-violation)
```
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/reconciliation-gate.ts`

**Auto-approve logic:**
- `isAutoApproved = signal.raw?.autoApprove === true`
- When true: skips `waitForEvent('architect-approval')`, constructs inline `approvalPayload`.
- 🟢 CONFIRMADO — `pipeline.ts:171-183`

**Skeleton builder** (`gascity/skeleton-builder.ts`):
- Fetches `https://api.github.com/repos/Wescome/function-factory/tarball/main`
- Uploads `.tar.gz` to R2 under `skeletons/{functionId}/{safeTimestamp}.tar.gz`
- Records `SkeletonManifest` to `skeleton_manifests` collection
- Extracts HEAD commit SHA from `x-github-commit-sha` header (or fallback to commits API), truncated to 12 chars
- Issues HMAC-SHA256 signed `/skeleton-download` URL (2-hour rolling window token)
- Purpose: ensures Gas City containers have a baseline git commit before the agent writes files, so `git diff --cached` produces a non-empty CandidatePatch
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/gascity/skeleton-builder.ts:1-154`

**Execution Packet assembly** (`pipeline.ts:build-execution-packet` step):
- Generates `EP-{esKey}` key
- Computes SHA-256 of the serialized ExecutableSpecification JSON
- Embeds skeleton vars: `skeleton_r2_key`, `skeleton_sha`, `workspace_url`
- Defines 3 roles: `planner`, `coder`, `verifier`
- Adapter: `adapter.coding` with `lang: 'typescript'`
- Saves to `execution_packets` collection + lineage edge to ES
- 🟢 CONFIRMADO — `pipeline.ts:513-567`

**Formula Dispatch** (`dispatch-formula` step):
- Calls `compileAndDispatchFormula({ ep, factoryAttempt: 1, traceId, env, deps })`
- `buildFormulaCompilerDeps(db, formulaEnv)` wires all DB operations as injected dependencies
- Gas City traffic routed via `GAS_CITY` service binding (avoids public Worker-to-Worker CF error 1042)
- If `outcome !== 'dispatched'` → terminal `dispatch-failed`
- 🟢 CONFIRMADO — `pipeline.ts:570-591`, `formula-compiler-adapter.ts:11-155`

**GovernorAgent** (`agents/governor-agent.ts`):
- Architecture: Plan-and-Execute. LLM = planner (assessment). Deterministic code = executor (validates criteria before acting).
- Runs on 15-min cron (`scheduled` handler) and on `feedback-signals` queue messages with `type:'governor-cycle'`
- Pre-fetches 9 parallel AQL queries before LLM call (ORL telemetry, pending signals, active pipelines, recent feedback, curated memory, orientation assessments, completion ledgers, hot_config, lineage gaps INV-DEVOPS-5)
- 8 possible `GovernanceAction` types: `trigger_pipeline`, `approve_pipeline`, `escalate_to_human`, `diagnose_failure`, `adjust_config`, `archive_signal`, `deduplicate_signal`, `no_action`
- Rate limits: MAX 5 `trigger_pipeline` + MAX 3 `approve_pipeline` per cycle
- `meetsAutoTriggerCriteria`: source=`factory:feedback-loop` AND feedbackDepth < 3 AND autoApprove=true (deterministic, NOT LLM)
- `meetsAutoApproveCriteria`: source=`factory:feedback-loop` AND autoApprove=true AND subtype in `{synthesis:atom-failed, synthesis:orl-degradation}` (deterministic, NOT LLM)
- Escalation to GitHub Issues if `escalation_target='github_issue'`
- ORL telemetry: each cycle writes to `orl_telemetry` with `schemaName='_governance_cycle'`
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/agents/governor-agent.ts:1-1025`

**MemoryCuratorAgent** (`agents/memory-curator-agent.ts`):
- Orientation role: curates raw telemetry + lessons into ranked, cross-referenced knowledge
- Pre-fetches 4 parallel AQL queries: ORL telemetry, semantic memory (lessons), episodic memory, feedback signals
- 8 curation rules: consolidate, rank, decay, cross-reference, lineage, severity, pattern-detection, governance
- Decay: >14 days → `decaying`, >30 days → `archived`
- Output: `MemoryCurationResult` → persists to `memory_curated` (UPSERT), `pattern_library` (UPSERT), `orientation_assessments`
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/agents/memory-curator-agent.ts:1-367`

**Gas City Webhook Receiver** (`gascity/webhook-receiver.ts`):
- HMAC-SHA256 verification: header `X-GC-Key-ID: v1` + `X-GC-Signature: sha256={hex64}`, constant-time comparison
- Two event classes:
  1. Completion events (`fn_id`, `is_id`, `es_id`, `ep_id`, `form_id`, `bead_id`, `outcome`: `approved`|`revise`)
  2. Operational events (`event_type`: `health.stall`, `session.crash`, `convergence.evaluate`, `molecule.failed`)
- Idempotency: checks `completion_events` keyed by `bead_id` before processing
- Orphan guard: validates dispatch_log entry exists for `bead_id`
- Lineage mismatch check: validates all 6 fields match dispatch log (`fn_id`, `is_id`, `es_id`, `ep_id`, `form_id`, `factory_attempt`)
- On `outcome=revise`: checks `factory_attempt > GAS_CITY_MAX_AMENDMENT_DEPTH` (default 3) → writes INC if exceeded, else writes revision Signal
- Lifecycle transition: `dispatched → accepted` (approved) or `dispatched → rejected` (revise)
- Writes `fidelity_verdicts` and `completion_events`, updates `specs_functions` state
- Best-effort keepalive stop to Gas City after each callback
- Operational event `convergence.evaluate` written to `gascity_drift_events`; others create incidents in `specs_incidents`
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/gascity/webhook-receiver.ts:1-612`

**GasCityAutonomyMonitor** (`gascity/autonomy-monitor.ts`):
- Runs on 15-min cron and `POST /gascity/autonomy/run`
- Smoke mode: D1 SELECT 1 liveness probe only (no full sweep)
- Full sweep:
  1. `accepted` functions: evaluates persistence (fidelity_verdicts + completion_events freshness) → `accepted → monitored` on pass, creates incident on fail
  2. `monitored` functions: checks persistence freshness → `monitored → regressed` if stale
  3. Stale dispatches: `dispatch_log` entries older than `GAS_CITY_DISPATCH_STALE_MINUTES` (default 60) without completion event → creates sev2 incidents
  4. Recurring incidents: `escalateRecurringIncidents` — groups open incidents by type+functionId, creates `Pressure` if count >= `GAS_CITY_RECURRING_INCIDENT_THRESHOLD` (default 3)
- Freshness: `GAS_CITY_PERSISTENCE_FRESHNESS_HOURS` (default 24h)
- All queries wrapped with `queryWithTimeout` (8s limit)
- `markFunctionDispatched`: upserts `specs_functions` record, skips if already in terminal state (accepted/monitored/regressed/retired)
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/gascity/autonomy-monitor.ts:1-595`

**Drift Ledger** (`stages/drift-ledger.ts`):
- Observatory only — never gates or blocks pipeline
- `appendDriftEntry`: best-effort write to `compilation_drift_ledger` (never throws, swallows DB errors)
- `analyzeDrift(entries)`: pure function computing violation_rate, per-pass stats, per-anchor violation counts
- `detectErosion(entries, windowSize=5)`: compares early vs late window violation rates; `eroding=true` if late rate > early rate × 1.5
- Written after every probed pass (decompose) including on remediation attempts
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/drift-ledger.ts:1-189`

**Learning Capture** (`learning-capture.ts`):
- Terminal hook: called on EVERY exit path via `captureTerminal()`
- Feature-flagged: `LEARNING_ENABLED='true'` required
- Writes `RunTranscript` to `learning_run_transcripts` via UPSERT
- Optionally writes `LearningObservation` entries to `learning_observations` if `LEARNING_OBSERVATIONS_ENABLED='true'`
- Timeout: `LEARNING_WRITE_TIMEOUT_MS` (default 500ms) — never blocks pipeline exit
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/learning-capture.ts:1-112`

**CRP auto-generation** (`crp.ts`):
- When any agent confidence < 0.7: `createCRP(db, opts)` is called
- Non-blocking: DB save failure is caught and warned, never rethrows
- Currently triggered in pipeline on `semanticReview.confidence < 0.7` → `crp-semantic-review` step
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/crp.ts:1-93`

**Feedback Signal generation** (`stages/generate-feedback.ts`):
- 3-layer loop prevention:
  1. `feedbackDepth >= MAX_FEEDBACK_DEPTH (3)` → return []
  2. Idempotency via ingest-signal hash (handled downstream)
  3. 30-min cooldown per `executableSpecificationId + subtype` (AQL query, fail-open)
- Signal taxonomy (confirmed unchanged):

| Subtype | Condition | autoApprove |
|---------|-----------|-------------|
| `synthesis:atom-failed` | critical atom verdict = fail | true |
| `synthesis:coherence-verification-failed` | coherence gate fail | false |
| `synthesis:verdict-fail` | general synthesis failure (no atomResults) | false |
| `synthesis:low-confidence` | pass but confidence < 0.8 | false |
| `synthesis:orl-degradation` | repairCount >= 2 | true |
| `synthesis:pr-candidate` | pass + confidence >= 0.8 | false |

- Lesson extraction (fire-and-forget): detects patterns F1 (prose instead of JSON), timeout, F7 (null response), partial synthesis (50-99% pass rate); UPSERTs to `memory_semantic`
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/generate-feedback.ts:1-392`

**File context extraction for compile grounding** (`compile.ts`):
- `extractFilePathsFromSpec(specContent)`: regex extracts `.ts`/`.tsx` paths from spec text, deduplicates, filters node_modules
- `fetchCompileFileContexts(filePaths, env)`: GitHub Contents API fetch per path (base64 decode), runs `extractContext` from `@factory/file-context`, fail-open on missing token or errors
- Passed to `decompose` pass as `existingFiles` (path + exports + functions only, NOT raw content — context compression for 8K window)
- 🟢 CONFIRMADO — `workers/ff-pipeline/src/stages/compile.ts:84-148`

---

### 1.3 Data Structures

**PipelineEnv** (extended from prior analysis):
```typescript
interface PipelineEnv {
  DB: D1Database                          // Cloudflare D1 binding
  ARANGO_URL, ARANGO_DATABASE, ARANGO_JWT, ARANGO_USERNAME?, ARANGO_PASSWORD?
  FF_ARANGO?: Fetcher                     // ArangoDB proxy Worker service binding
  GAS_CITY?: Fetcher                      // gascity-supervisor service binding (avoids public hop)
  GATES: { evaluateCoherenceVerification(es: unknown): Promise<CoherenceVerificationReport> }
  FACTORY_PIPELINE: { create, get }       // Workflow binding
  COORDINATOR: DurableObjectNamespace<SynthesisCoordinator>
  ATOM_EXECUTOR: DurableObjectNamespace<AtomExecutor>
  SYNTHESIS_QUEUE: Queue
  SYNTHESIS_RESULTS: Queue
  ATOM_RESULTS: Queue
  FEEDBACK_QUEUE?: Queue
  TELEMETRY_QUEUE?: Queue
  FACTORY_METRICS?: AnalyticsEngineDataset
  WORKSPACE_BUCKET?: unknown              // R2 bucket for workspace/skeleton
  GITHUB_TOKEN?: string
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string
  GITHUB_TARGET_REPO?: string
  PI_CONTAINER?: DurableObjectNamespace
  GAS_CITY_BASE_URL?, GAS_CITY_CITY_NAME?, GAS_CITY_BEARER_TOKEN?
  GAS_CITY_HMAC_SECRET_V1?
  GAS_CITY_MAX_AMENDMENT_DEPTH?          // default 3
  GAS_CITY_PERSISTENCE_FRESHNESS_HOURS?  // default 24
  GAS_CITY_DISPATCH_STALE_MINUTES?       // default 60
  GAS_CITY_RECURRING_INCIDENT_THRESHOLD? // default 3
  GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1?
  LEARNING_ENABLED?, LEARNING_OBSERVATIONS_ENABLED?
  LEARNING_WRITE_TIMEOUT_MS?             // default 500
  ENVIRONMENT: string
  BUILD_GIT_SHA?
  ...
}
```
🟢 CONFIRMADO — `workers/ff-pipeline/src/types.ts:5-117`

**PipelineParams** (current):
```typescript
interface PipelineParams {
  signal?: SignalInput   // required for synthesis path
  dryRun?: boolean
  job?: FunctionJob      // harness path — returns harness-removed immediately
}
```
🟢 CONFIRMADO — `types.ts:119-128`

**SignalInput** (current, unchanged structure):
```typescript
interface SignalInput {
  signalType: 'market'|'customer'|'competitor'|'regulatory'|'internal'|'meta'
  source: string
  title: string
  description: string
  evidence?: string[]
  sourceRefs?: string[]
  subtype?: string
  raw?: Record<string, unknown>  // feedbackDepth, autoApprove
  specContent?: string           // ground-truth spec — when present, grounding context for compile
}
```
🟢 CONFIRMADO — `types.ts:130-146`

**PipelineResult** (current):
```typescript
interface PipelineResult {
  status: string  // 'dispatched' | 'dispatch-failed' | 'harness-removed' | 'compile-incomplete'
                  // | 'rejected' | 'coherence-verification-failed' | 'synthesis:intent-violation'
  signalId?: string
  executableSpecificationId?: string
  coherenceVerificationReport?: CoherenceVerificationReport
  report?: unknown
  reason?: string
  synthesisResult?: { verdict, tokenUsage, repairCount }  // legacy — no longer set in Gas City era
  atomResults?: Record<string, unknown>                   // legacy — no longer set
  harnessResultKey?: string
}
```
🟢 CONFIRMADO — `types.ts:148-165`

**compState** — accumulation object passed through all compilation passes:
```typescript
{
  intentSpecification: object
  intentAnchors: IntentAnchor[]
  signalContext: { title, description, specContent? }
  fileContexts: FileContext[]         // GitHub-fetched file structure contexts
  executableSpecification: null | object
  atoms?: object[]
  dependencies?: object[]
  invariants?: object[]
  interfaces?: object[]
  bindings?: object[]
  validations?: object[]
  _gateVerdict?: 'pass'|'warn'|'remediate'|'escalate'
  _violatedAnchors?: string[]
  _violationFeedback?: string
}
```
🟢 CONFIRMADO — `pipeline.ts:296-306`

**SkeletonManifest:**
```typescript
interface SkeletonManifest {
  _key: string               // "{functionId}-{safeTimestamp}"
  functionId: string
  r2Key: string              // "skeletons/{functionId}/{safeTimestamp}.tar.gz"
  skeletonSha: string        // first 12 chars of HEAD commit SHA
  producedAt: string         // ISO timestamp
  expiresAt: string          // producedAt + 24h
}
```
🟢 CONFIRMADO — `gascity/skeleton-builder.ts:26-34`

**GasCityCompletionPayload (webhook):**
```typescript
{
  fn_id: string
  is_id: string
  es_id: string
  ep_id: string
  form_id: string
  factory_attempt: number    // >= 1
  bead_id: string
  outcome: 'approved' | 'revise'
  remediation?: string
}
```
🟢 CONFIRMADO — `gascity/webhook-receiver.ts:10-22`

**GasCityOperationalEventPayload (webhook):**
```typescript
{
  event_type: 'health.stall' | 'session.crash' | 'convergence.evaluate' | 'molecule.failed'
  fn_id: string
  bead_id: string
  severity?: 'sev1'|'sev2'|'sev3'|'sev4'
  message?: string
  iteration?: number
  stage?: string
  is_id?, es_id?, ep_id?, form_id?
}
```
🟢 CONFIRMADO — `gascity/webhook-receiver.ts:24-35`

**GovernanceCycleResult:**
```typescript
interface GovernanceCycleResult {
  cycle_id: string             // "gov-{ISO8601}"
  timestamp: string
  decisions: GovernanceDecision[]
  assessment: GovernanceAssessment
  escalations: EscalationEntry[]
  metrics_snapshot: MetricsSnapshot
}
interface GovernanceDecision {
  action: GovernanceAction
  target: string
  reason: string
  evidence: string[]
  risk_level: 'safe'|'moderate'|'high'
  executed: boolean
  execution_result?: string
}
interface MetricsSnapshot {
  pending_signal_count, active_pipeline_count, completed_last_24h, failed_last_24h
  orl_success_rate_7day, avg_repair_count_7day, stale_signal_count, feedback_loop_depth_max
}
```
🟢 CONFIRMADO — `agents/governor-agent.ts:44-88`

**DriftEntry:**
```typescript
interface DriftEntry {
  pipeline_id: string
  signal_id: string
  pass_name: string
  anchors_probed: string[]
  probe_results: ProbeResult[]
  gate_verdict: 'pass'|'warn'|'remediate'|'escalate'
  remediation_count: number
  probe_model: string         // hardcoded 'llama-70b'
  latency_ms: number
  timestamp: string
}
```
🟢 CONFIRMADO — `stages/drift-ledger.ts:27-37`

**D1 Schema:**
```sql
documents (collection TEXT, key TEXT, json TEXT, created_at INTEGER)
  PRIMARY KEY (collection, key)
  INDEX: idx_documents_collection
edges (id AUTOINCREMENT, collection TEXT, from_id TEXT, to_id TEXT, data TEXT, created_at INTEGER)
  INDEX: idx_edges_from, idx_edges_to, idx_edges_collection
```
- Two general-purpose tables replacing ArangoDB's 48-collection model
- Idempotent (IF NOT EXISTS) — safe to apply on every deploy
🟢 CONFIRMADO — `workers/ff-pipeline/d1-schema.sql:1-30`

---

### 1.4 HTTP Routes (Worker fetch handler)

**Diagnostic routes:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/version` | Service metadata |
| GET | `/debug/health` | ArangoDB + AI binding status |
| GET | `/debug/arango` | ArangoDB connectivity only |
| GET | `/debug/ai-test` | Workers AI binding smoke test (llama-3.3-70b-instruct-fp8-fast) |
| GET | `/debug/pi-container/status` | PI container rollout state |
| GET | `/debug/pi-container/health` | PI container health |
| POST | `/debug/pi-container/restart` | PI container restart |
| GET | `/debug/governor` | Latest governance cycle assessments + ORL telemetry |
| GET | `/debug/crystallizer` | Intent anchors + drift ledger (filterable by ?signal=) |
| GET | `/internal/do-health` | ArangoDB round-trip test (requires OPERATOR_CONTROL_TOKEN) |
| GET | `/gascity/autonomy/status` | Gas City lifecycle state counts + incidents |
| GET | `/gascity/telemetry/status` | Telemetry queue/sink binding status |
| POST | `/gascity/autonomy/run` | Manual autonomy monitor trigger (requires auth) |
| POST | `/admin/init-db` | Database + collections init/repair (requires auth) |
| POST | `/debug/generate-pr` | Manual PR generation from a pipeline result |
| GET/POST | `/debug/pr-outcome` | Factory PR outcome observation (enqueue or processNow) |
| POST | `/debug/pr-outcome-scan` | Scan known Factory PRs and enqueue outcome observations |
| POST | `/debug/fidelity-verification` | REMOVED (410) — Gas City era |
| POST | `/debug/persistence-verification` | REMOVED (410) — quarantined |
| POST | `/debug/lifecycle-acceptance` | REMOVED (410) — Gas City era |
| POST | `/debug/function-identity` | FP→FN identity split report |
| POST | `/debug/function-identity-migration` | FP→FN runtime materialization (apply=true executes) |
| POST | `/debug/mrp-auto` | MRP assembly from latest PR outcome |
| GET/POST | `/debug/mrp` | MRP read/assemble |
| POST | `/debug/mrp-evidence` | Persist canonical MRP evidence |

**Operational routes:**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/trigger-synthesis` | Bridge: Workflow → SynthesisCoordinator DO (legacy, still present) |
| POST | `/synthesis-callback` | DO → Workflow `synthesis-complete` event relay (legacy, still present) |
| POST | `/trigger-harness` | Create pipeline in harness mode (harnessKey path — returns harness-removed) |
| POST | `/dispatch-formula` | Direct formula dispatch (bypasses pipeline) |
| POST | `/webhooks/gascity` | Gas City completion/operational event webhook |
| GET | `/skeleton-download` | Signed R2 skeleton tarball download |
| POST | `/seed-dispatch-ep` | Seed execution packet + dispatch |
| POST | `/admin/seed-factory-artifacts` | Seed Factory artifacts |
| POST | `/__pi-container/execute` | Gas City pi-rpc → PI container bridge (IS-GC-RUNTIME-PROVIDER-CONTRACT) |
| GET | `/__pi-container/status` | PI container status (auth-gated) |
| GET | `/__pi-container/fence` | PI container fence (auth-gated) |
| POST | `/__pi-container/restart` | PI container restart (auth-gated) |
| POST | `/smoke/e2e` | End-to-end smoke test handler |
| GET | `/run-status/:runId` | Run event log summary/latest attempt log |
| GET | `/run-monitor/:runId` | Run monitor snapshot |
| POST | `/run-interventions/:runId` | Run intervention |
| GET | `/run-artifacts/:runId` | Run artifact manifest |

🟢 CONFIRMADO — `workers/ff-pipeline/src/index.ts:138-1394`

---

### 1.5 Queue Handlers (Worker queue handler)

| Queue | Message type | Handler |
|-------|-------------|---------|
| `telemetry-queue` / `telemetry-dlq` | any | `handleTelemetryBatch` |
| `harness-queue` / `harness-dlq` | any (removed) | ack + warn |
| `feedback-signals` | `{type:'governor-cycle'}` | `runGovernanceCycle` |
| `feedback-signals` | `{type:'pr-outcome'}` | `fetchPROutcomeFromGitHub` + `ingestPROutcomeSignals` |
| `synthesis-results` | `{type:'phase1-complete'}` | ack (informational) |
| `synthesis-results` | `{workflowId, verdict, ...}` | relay `synthesis-complete` event to Workflow (legacy) |
| `atom-results` | `{executableSpecificationId, atomId, result, workflowId}` | `recordAtomResult` → `getReadyAtoms` → dispatch deps → `isComplete` → send `atoms-complete` event |

- `atom-results` handler implements a dependency-aware dispatching system: after each atom completes, it checks if dependent atoms now have all deps satisfied and dispatches them
- Completion aggregation: pass rate >= 70% AND no critical failures → `pass`; any critical failure → `fail`
- Max retries: synthesis-results = 3 (4 total attempts), feedback-signals pr-outcome = 3, atom-results = implicitly via msg.retry()
🟢 CONFIRMADO — `workers/ff-pipeline/src/index.ts:1404-1750` (approx)

---

### 1.6 Scheduled Handler (Worker cron)

```typescript
scheduled(event, env, ctx) {
  ctx.waitUntil(runGovernanceCycle(env, 'cron'))
  ctx.waitUntil(runGasCityAutonomyMonitor(env, 'cron'))
}
```
- Both run concurrently on every cron tick
🟢 CONFIRMADO — `workers/ff-pipeline/src/index.ts:1397-1402`

---

### 1.7 Hot Configuration System

**HotConfigLoader** (`config/hot-config.ts`):
- TTL-cached (default 60s), in-memory
- Reads 3 surfaces from D1:
  1. `config_aliases` — ORL schema field alias overrides per schema name
  2. `config_routing` — model routing overrides (default doc key: `'default'`)
  3. `config_model_capabilities` — per-model capability profiles
- Never throws; falls back to hardcoded defaults on any DB error
- Stale cache preferred over error defaults when cache exists

**Crystallizer config** (`config/crystallizer-config.ts`):
- Single flag: `hot_config/pipeline.crystallizer.enabled` (default: `true`)
- `seedPipelineConfig`: idempotent UPSERT via `ON CONFLICT DO UPDATE`

**Known model capabilities (hardcoded):**
```
llama-3.3-70b:   jsonMode, no funcCalling, 4096 tokens, medium reliability
deepseek-v4-pro: jsonMode, funcCalling,    8192 tokens, high reliability
gemini-3.1-pro-preview: jsonMode, funcCalling, 8192 tokens, high reliability
claude-opus-4.6: jsonMode, funcCalling,   16384 tokens, high reliability
kimi-k2.6:       jsonMode, no funcCalling, 4096 tokens, medium reliability
```
🟢 CONFIRMADO — `workers/ff-pipeline/src/config/hot-config.ts:51-83`

---

### 1.8 Collections Written by ff-pipeline

| Collection | Written by | Document type |
|-----------|-----------|--------------|
| `specs_signals` | ingest-signal, governor-agent, webhook-receiver | Signal artifacts |
| `specs_pressures` | synthesize-pressure, autonomy-monitor | Pressure artifacts |
| `specs_capabilities` | map-capability | Capability artifacts |
| `specs_functions` | propose-function, markFunctionDispatched, autonomy-monitor | Function proposals + lifecycle records |
| `intent_anchors` | pipeline:persist-intent-anchors | IntentAnchor binary checkpoints |
| `executable_specifications` | compile:assembly pass | Compiled specs |
| `execution_packets` | pipeline:build-execution-packet | EP artifacts |
| `formulas` | formula-compiler | Formula artifacts |
| `dispatch_log` | formula-compiler | Dispatch audit records |
| `lineage_edges` | pipeline (multiple steps) | Directed artifact edges |
| `verification_reports` | pipeline:coherence steps | Coherence/rejection VRs |
| `verification_status` | pipeline:coherence steps | Coherence status per ES |
| `compilation_drift_ledger` | drift-ledger:appendDriftEntry | Per-pass probe results |
| `skeleton_manifests` | skeleton-builder | R2 key + SHA manifests |
| `completion_events` | webhook-receiver | Gas City completion callbacks |
| `fidelity_verdicts` | webhook-receiver | Gas City fidelity VRs |
| `persistence_verdicts` | autonomy-monitor | Persistence VRs |
| `specs_incidents` | autonomy-monitor, webhook-receiver | Operational incidents |
| `gascity_drift_events` | webhook-receiver | convergence.evaluate events |
| `webhook_rejections` | webhook-receiver | Rejected/malformed webhooks |
| `orl_telemetry` | all agent output-reliability | Agent success/failure metrics |
| `orientation_assessments` | governor-agent, memory-curator | Governance cycle summaries |
| `memory_curated` | memory-curator | Ranked lessons (UPSERT) |
| `pattern_library` | memory-curator | Named patterns (UPSERT) |
| `memory_semantic` | generate-feedback:extractLessons | Failure pattern lessons (UPSERT) |
| `consultation_requests` | crp:createCRP | CRP artifacts |
| `learning_run_transcripts` | learning-capture | Terminal pipeline transcripts |
| `learning_observations` | learning-capture | Derived learning observations |
| `merge_readiness_packs` | merge-readiness-pack | MRP artifacts |
| `merge_readiness_evidence` | debug routes | Canonical MRP evidence |
| `hot_config` | seedHotConfig, crystallizer config | Runtime configuration |
| `config_aliases`, `config_routing`, `config_model_capabilities` | seedHotConfig | ORL / routing config |

🟢 CONFIRMADO (inferred from collection writes across all files)

---

### 1.9 Feedback Loop (Updated)

The feedback loop has changed: the pipeline no longer waits for synthesis results. It terminates at `dispatched`. The FEEDBACK_QUEUE consumer in index.ts handles `pr-outcome` messages from `feedback-signals` queue. GovernorAgent on cron re-triggers pipelines from pending signals.

**Active feedback paths:**
1. Gas City `revise` outcome → `writeRevisionSignal` → `specs_signals` (subtype `gascity:revise`) → GovernorAgent picks up on next cycle
2. Coherence Verification failure → `enqueue-feedback-coherence-verification` → pipeline consumer
3. GovernorAgent `trigger_pipeline` → `FACTORY_PIPELINE.create()` for feedback signals meeting auto-trigger criteria

🟡 INFERIDO — from webhook-receiver.ts revise path + governor-agent trigger logic + pipeline enqueue-feedback step

---

### 1.10 Removed / Deprecated Paths

| Path | Status | Replacement |
|------|--------|-------------|
| `synthesis-era waitForEvent(synthesis-complete)` | REMOVED | Pipeline terminates at `dispatched` |
| `synthesis-era waitForEvent(atoms-complete)` | REMOVED | Pipeline terminates at `dispatched` |
| `instruction-tuning` step | REMOVED | ExecutionPacket + Formula dispatch |
| `enqueue-synthesis` step | REMOVED | `dispatch-formula` step |
| `job.harnessKey` path | REMOVED | Returns `harness-removed` immediately |
| DO graph path (coordinator.ts synthesize) | DEPRECATED (ADR-009) | Gas City Formula dispatch |
| `/debug/fidelity-verification` | REMOVED (410) | Gas City fidelity via `/webhooks/gascity` |
| `/debug/persistence-verification` | REMOVED (410) | Gas City autonomy monitor |
| `/debug/lifecycle-acceptance` | REMOVED (410) | Gas City webhook lifecycle transitions |

🟢 CONFIRMADO — pipeline.ts:99-105, index.ts 410 routes

---

### 1.11 Architectural Patterns (Updated)

| Pattern | Where | Confidence |
|---------|-------|-----------|
| Durable CF Workflow (step dedup by name) | `pipeline.ts` | 🟢 CONFIRMADO |
| Gas City era: pipeline terminates at `dispatched` (no synthesis wait) | `pipeline.ts:607-613` | 🟢 CONFIRMADO |
| Fail-open feature flags (crystallizer, learning, feedback) | `config/`, `pipeline.ts` | 🟢 CONFIRMADO |
| Anti-corruption context slicing (per-pass minimal context) | `compile.ts:runLivePass` | 🟢 CONFIRMADO |
| Idempotent artifact creation (hash-based dedup) | `ingest-signal.ts` | 🟢 CONFIRMADO |
| Event-driven DO↔Workflow decoupling (queue + relay) | `index.ts:synthesis-results consumer` | 🟢 CONFIRMADO (legacy path still present) |
| Speculative JSON repair (regex repair before parse failure) | `compile.ts:runLivePass` | 🟢 CONFIRMADO |
| CRP auto-generation on low confidence (<0.7) | `pipeline.ts:crp-semantic-review` | 🟢 CONFIRMADO |
| 3-tier feedback loop prevention (depth, idempotency, cooldown) | `generate-feedback.ts` | 🟢 CONFIRMADO |
| Plan-and-Execute Governor (LLM plans, deterministic code validates before acting) | `governor-agent.ts` | 🟢 CONFIRMADO |
| HMAC-gated external webhooks (constant-time comparison) | `webhook-receiver.ts:verifyGasCityHmac` | 🟢 CONFIRMADO |
| Skeleton workspace seeding (R2 + signed URL + formula init step) | `skeleton-builder.ts` | 🟢 CONFIRMADO |
| D1 two-table model replacing 48 ArangoDB collections | `d1-schema.sql` | 🟢 CONFIRMADO |
| Best-effort telemetry never blocking main path | `drift-ledger.ts`, `learning-capture.ts`, `crp.ts` | 🟢 CONFIRMADO |
| TTL-cached hot configuration (60s, fail-open) | `hot-config.ts:HotConfigLoader` | 🟢 CONFIRMADO |
| Dependency-aware atom dispatch (queue consumer DAG) | `index.ts:atom-results consumer` | 🟢 CONFIRMADO |

---

## Module 2: Synthesis Coordinator DO (v5.1)

**Files:**
- `workers/ff-pipeline/src/coordinator/coordinator.ts`
- `workers/ff-pipeline/src/coordinator/atom-executor-do.ts`
- `workers/ff-pipeline/src/coordinator/completion-ledger.ts`
- `workers/ff-pipeline/src/coordinator/layer-dispatch.ts`
- `workers/ff-pipeline/src/coordinator/state.ts`
- `workers/ff-pipeline/src/coordinator/contracts.ts`

**Role:** Two-phase durable synthesis system. Phase 1 runs in the SynthesisCoordinator DO (agent graph path deprecated; now always returns `interrupt`). Phase 2 dispatches atoms individually to AtomExecutor DOs via SYNTHESIS_QUEUE. A CompletionLedger in ArangoDB tracks cross-atom completion state and enables event-driven progression through dependency layers.

---

### 2.1 Control Flow

#### SynthesisCoordinator (`coordinator.ts`)

`SynthesisCoordinator extends Agent<CoordinatorEnv>` — Cloudflare Durable Object wrapping the agent synthesis graph.

**HTTP routes (fetch handler):**

| Route | Method | Behavior |
|-------|--------|----------|
| `/synthesize` | POST | Validate TrellisExecutionPacket → call `synthesize()` → `notifyCallback()` |

- 🟢 CONFIRMADO — `coordinator.ts:fetch()` lines 108–157

**Route removal vs prior documentation:**
- `/dispatch-atom` and `/atoms-callback` routes are **no longer present** in `coordinator.ts`. These were documented in the prior SDD but have been removed. Atom dispatch now goes through SYNTHESIS_QUEUE directly from `synthesize()`.
- 🟢 CONFIRMADO — `coordinator.ts` full fetch handler (lines 108–157), no `/dispatch-atom` or `/atoms-callback` route exists

**`synthesize()` method — full execution sequence:**

```
1. Resolve executableSpecificationId from _key or id
2. Guard: trellisExecutionPacket required (throws if absent)
3. Read persisted GraphState from DO storage (crash recovery)
4. If restoredState has terminal verdict (pass/fail/interrupt):
     → deleteAlarm, mark __completed, return cached result (idempotent)
5. runFiber('synth-{esId}', ...) — crash-recovery wrapper
   5a. dryRun → use dryRunModelBridge(); else createModelBridge()
   5b. ensureConfigSeeded() → seedHotConfig() if first run
   5c. getConfigLoader().get() → load HotConfig (model routing, aliases)
   5d. prefetchAgentContext() → load ArangoDB context once for all agents
   5e. Resolve 7 models via resolveAgentModel() for each role
   5f. Instantiate 6 agent objects (Architect, Coder, Planner, Tester, Verifier, Critic)
       with hot-config alias overrides per artifact type
   5g. Build deps object (callModel, persistState, fetchMentorRules, executionRole,
       all 6 agent facades, verticalSlicing: true)
   5h. [ADR-009 gate 6] throw DEPRECATED error immediately
       — graph path removed, always catches to interrupt verdict
   5i. Return interrupt result immediately (Phase 1 never produces a real finalState)
```

- 🟢 CONFIRMADO — `coordinator.ts:synthesize()` lines 218–562

**Note on Phase 2 (dead code path):** Lines 428–562 in `synthesize()` implement Phase 2 atom dispatch and CompletionLedger creation. This code is unreachable because Phase 1 always throws at step 5h. The code is present and structurally correct but never executes in the current deployed state.
- 🟢 CONFIRMADO — `coordinator.ts:400–417` (DEPRECATED throw), lines 428–562 (unreachable but present)

**Alarm handler (`alarm()`):**
- Fires if DO is suspended beyond wall-clock deadline (CF alarm, not setTimeout)
- Checks `__completed` flag first — returns immediately if already done
- Reads or reconstructs GraphState from storage
- Writes `interrupt` verdict to `graphState` and `__alarm_fired` = true
- Sets `__completed` = true
- Calls `notifyCallback()` so Workflow is unblocked at `waitForEvent`
- 🟢 CONFIRMADO — `coordinator.ts:alarm()` lines 164–184

**onFiberRecovered hook:**
- Fires when DO restarts after eviction with a live fiber in SQLite
- Reads `snapshot.executableSpecificationId` and `snapshot.state`
- If state exists without a verdict: writes `interrupt` verdict, marks `__completed`, calls `notifyCallback()`
- 🟢 CONFIRMADO — `coordinator.ts:onFiberRecovered()` lines 190–215

---

#### AtomExecutor DO (`atom-executor-do.ts`)

`AtomExecutor extends Agent<AtomExecutorEnv>` — per-atom Durable Object introduced in v5.1.

**Design intent:** Each atom gets its own DO instance with its own 900-second wall-clock lifetime, avoiding coordinator eviction under large atom counts.

**HTTP routes:**

| Route | Method | Behavior |
|-------|--------|----------|
| `/execute-atom` | POST | Execute single atom via `handleExecuteAtom()` |

- 🟢 CONFIRMADO — `atom-executor-do.ts:fetch()` lines 64–71

**`handleExecuteAtom()` execution sequence:**

```
1. Idempotency check: if DO storage has 'atomResult' → return cached response (no re-execution)
2. Pre-flight auth check (non-dryRun only):
   a. Resolve coder model via resolveAgentModel('coder')
   b. keyForModel() → get API key
   c. If key missing: write failResult, set __completed, publishResult(), ingest 'infra:llm-api-401' signal, return 400
3. Store metadata: __atomId, __executableSpecificationId, __workflowId, __completed=false
4. Set 900s alarm: ctx.storage.setAlarm(Date.now() + 900_000)
5. fetchFileContexts(payload) → resolve GitHub file contents (if GITHUB_TOKEN present)
6. Build AtomSlice: { atomId, atomSpec, upstreamArtifacts, sharedContext, fileContexts }
7. buildAtomDeps(dryRun) → create agent stubs (lazy-import real agents for non-dryRun)
8. executeAtomSlice(slice, deps, { maxRetries, dryRun }) → AtomResult
9. Store result in DO storage ('atomResult')
10. Set __completed = true
11. deleteAlarm()
12. publishResult() → ATOM_RESULTS queue
13. Return result as HTTP response
```

- 🟢 CONFIRMADO — `atom-executor-do.ts:handleExecuteAtom()` lines 113–215

**Alarm handler:**
- Reads `__completed` — returns immediately if done
- Reads `__atomId`, `__executableSpecificationId`, `__workflowId` from storage
- Produces `AtomResult` with `decision: 'fail'` and alarm reason
- Ingests `pipeline:synthesis-timeout` internal signal (best-effort, non-blocking)
- Calls `publishResult()` → ATOM_RESULTS queue
- 🟢 CONFIRMADO — `atom-executor-do.ts:alarm()` lines 74–111

**`fetchFileContexts()` — file-aware atom execution:**
- Skips if no `GITHUB_TOKEN` in env
- Calls `resolveTargetFiles(atomSpec)` to determine target files
- For each target file: checks ArangoDB `file_context_cache` first (5-minute TTL, keyed by content SHA)
- On cache miss: fetches from GitHub API (`/repos/Wescome/function-factory/contents/{path}?ref=main`)
- Saves to ArangoDB cache with UPSERT (refresh cached_at on duplicate SHA)
- Caches raw file content in DO storage (`file:{path}` key)
- Cross-file resolution: follows imports one level deep, up to 10 additional files (marked `confidence: 'inferred'`)
- 🟢 CONFIRMADO — `atom-executor-do.ts:fetchFileContexts()` lines 343–436

**`resolveTargetFiles()` — file path resolution (exported standalone):**

Priority order:
1. `atomSpec.targetFiles` (explicit array) — filter TBD entries
2. `atomSpec.suggestedFiles` (inferred from plan)
3. `atomSpec.file` (single file string)
4. `atomSpec.binding.target` (comma-separated paths fallback — Discrepancy #5)

- 🟢 CONFIRMADO — `atom-executor-do.ts:resolveTargetFiles()` lines 451–471

---

#### CompletionLedger (`completion-ledger.ts`)

**Purpose:** Shared state in ArangoDB that enables event-driven coordination across AtomExecutor DOs. Each atom DO writes its result; the queue consumer reads the ledger to check readiness of dependent atoms and detect global completion.

**Storage location:** ArangoDB `completion_ledgers` collection, keyed by `executableSpecificationId`.

**`createLedger(db, input)`:**
- Layer 0 atoms dispatched immediately; all other atoms added to `pendingAtoms`
- Initial `phase: 'dispatched'`, `completedAtoms: 0`, `atomResults: {}`
- 🟢 CONFIRMADO — `completion-ledger.ts:createLedger()` lines 68–88

**`recordAtomResult(db, executableSpecificationId, atomId, result)`:**
- Read-modify-write pattern (no AQL atomic update — D1 limitation)
- Increments `completedAtoms` by 1
- Merges new result into `atomResults` map
- Removes `atomId` from `pendingAtoms`
- Transitions `phase` to `'complete'` when `completedAtoms >= totalAtoms`
- Returns updated ledger
- 🟢 CONFIRMADO — `completion-ledger.ts:recordAtomResult()` lines 100–129

**`getReadyAtoms(ledger)`:**
- Iterates `pendingAtoms`; excludes already-completed atoms
- An atom is ready when ALL its `dependencies[].atomId` values are present in `completedIds`
- Atoms with no dependencies are immediately ready
- Returns string array of ready atomIds
- 🟢 CONFIRMADO — `completion-ledger.ts:getReadyAtoms()` lines 137–151

**`isComplete(ledger)`:**
- Returns `ledger.completedAtoms >= ledger.totalAtoms`
- 🟢 CONFIRMADO — `completion-ledger.ts:isComplete()` lines 156–158

---

### 2.2 TrellisExecutionPacket Validation

- Validated via Zod `TrellisExecutionPacket.safeParse()` — returns 400 with `issues` on failure
- Certified via `certifyTrellisExecutionPacket()` — returns 422 with `diagnostics` on failure
- If both pass, `workflowId` is stored in DO storage (`__workflowId` key)
- 🟢 CONFIRMADO — `coordinator.ts:fetch()` lines 118–141

---

### 2.3 Crash Recovery

**runFiber pattern:**
- Wraps `synthesize()` body in `runFiber('synth-{esId}', ...)` from agents SDK
- Fiber checkpoints via `fiberCtx.stash({ executableSpecificationId, state })` after each agent step
- On eviction + restart: `onFiberRecovered` fires, reads snapshot, writes interrupt verdict, calls `notifyCallback()`
- 🟢 CONFIRMADO — `coordinator.ts:synthesize()` line 257, `onFiberRecovered()` lines 190–215

**Alarm vs fiber recovery:**
- Alarm is set per-atom in AtomExecutor (900s). The coordinator's alarm path (`coordinator.ts:alarm()`) handles the case where the coordinator itself times out.
- `__alarm_fired` flag prevents duplicate alarm processing
- 🟢 CONFIRMADO — `coordinator.ts:alarm()` lines 164–184

---

### 2.4 Queue Communication Architecture

```
ff-pipeline Workflow
  SYNTHESIS_QUEUE.send({ type: 'synthesize', workflowId, executableSpecification, trellisPacket })
    ↓
  queue consumer (Worker) → fetch SynthesisCoordinator DO /synthesize
    ↓
  SynthesisCoordinator.synthesize() → always returns interrupt (ADR-009 gate 6)
    ↓
  [Phase 2 code present but unreachable in current state]
  If reachable, coordinator would:
    → createLedger() in ArangoDB
    → dispatch Layer 0 atoms to SYNTHESIS_QUEUE (type: 'atom-execute')
    → return verdict: { decision: 'dispatched' }
    ↓
  Each 'atom-execute' message → AtomExecutor DO /execute-atom
    ↓
  AtomExecutor → ATOM_RESULTS queue
    ↓
  atom-results queue consumer → recordAtomResult() in ledger
    → getReadyAtoms() → dispatch next-layer atoms to SYNTHESIS_QUEUE
    → isComplete() → send 'atoms-complete' event to Workflow
    ↓
  SYNTHESIS_RESULTS queue → workflow.sendEvent('synthesis-complete', payload)
```

- 🟢 CONFIRMADO (coordinator → queue paths) — `coordinator.ts:notifyCallback()` lines 634–650
- 🟢 CONFIRMADO (atom dispatch structure) — `coordinator.ts` Phase 2 block lines 428–562 (unreachable)
- 🟡 INFERIDO (queue consumer dispatch loop) — ledger and layer-dispatch modules imply this, but queue consumer implementation not in changed files

---

### 2.5 Data Structures

#### CoordinatorEnv

```typescript
interface CoordinatorEnv {
  DB: D1Database
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
  OFOX_API_KEY?: string
  CF_API_TOKEN?: string
  AI?: { run(model: string, input: Record<string, unknown>): Promise<Record<string, unknown>> }
  SANDBOX?: unknown
  SYNTHESIS_RESULTS?: { send(body: unknown): Promise<void> }
  SYNTHESIS_QUEUE?: { send(body: unknown): Promise<void> }  // v5.1: atom dispatch
}
```

- 🟢 CONFIRMADO — `coordinator.ts` lines 35–54

#### SynthesisResult

```typescript
interface SynthesisResult {
  functionId: string
  verdict: Verdict
  tokenUsage: number
  repairCount: number
  roleHistory: { role: string; tokenUsage: number; timestamp: string }[]
  briefingScript?: unknown
  semanticReview?: unknown
  trellisExecutionPacket: TrellisExecutionPacketType | null
  packetId: string | null
  packetHash: string | null
  domainExecutionRequest: DomainExecutionRequest
  domainExecutionEvidence: DomainExecutionEvidence
}
```

- 🟢 CONFIRMADO — `coordinator.ts` lines 56–69

#### AtomExecutorEnv

```typescript
interface AtomExecutorEnv {
  DB: D1Database
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT?: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
  OFOX_API_KEY?: string
  CF_API_TOKEN?: string
  GITHUB_TOKEN?: string
  ATOM_RESULTS?: { send(body: unknown): Promise<void> }
}
```

- 🟢 CONFIRMADO — `atom-executor-do.ts` lines 29–41

#### ExecuteAtomPayload (HTTP body for /execute-atom)

```typescript
interface ExecuteAtomPayload {
  atomId: string
  atomSpec: Record<string, unknown>
  sharedContext: {
    executableSpecificationId: string
    specContent: string | null
    briefingScript: unknown
  }
  upstreamArtifacts: Record<string, unknown>
  workflowId: string
  executableSpecificationId: string
  maxRetries: number
  dryRun: boolean
}
```

- 🟢 CONFIRMADO — `atom-executor-do.ts` lines 43–56

#### CompletionLedger

```typescript
interface CompletionLedger {
  _key: string                                  // executableSpecificationId
  workflowId: string
  totalAtoms: number
  completedAtoms: number
  atomResults: Record<string, AtomResult>
  layers: DependencyLayer[]
  allAtomSpecs: Record<string, Record<string, unknown>>
  sharedContext: {
    executableSpecificationId: string
    specContent: string | null
    briefingScript: unknown
  }
  pendingAtoms: string[]                        // atoms waiting for upstream deps
  phase: 'dispatched' | 'executing' | 'complete' | 'failed'
}
```

- 🟢 CONFIRMADO — `completion-ledger.ts` lines 19–34

#### DependencyLayer (from layer-dispatch.ts)

```typescript
interface DependencyLayer {
  index: number
  atomIds: string[]
}
```

- 🟢 CONFIRMADO — `layer-dispatch.ts` lines 16–19

---

### 2.6 Algorithms

#### Topological Sort — `topologicalSort(atoms, dependencies)` (`layer-dispatch.ts`)

Uses Kahn's algorithm to group atoms into dependency layers:

```
1. Build atomIds set from atoms[].id or atoms[]._key
2. Build in-degree map (count of incoming edges per atom)
3. Build dependents map (atom → list of atoms that depend on it)
4. Process edges from dependencies[].{from, to}:
   - Skip edges where from or to is not in atomIds set
   - inDegree[to]++; dependents[from].push(to)
5. Iteratively extract layer:
   while (remaining atoms):
     layerAtoms = atoms with inDegree == 0
     if none found: cycle detected → dump remaining into one layer (fallback)
     emit DependencyLayer { index, atomIds: layerAtoms }
     for each atom in layer: decrement in-degree of all dependents
6. Return DependencyLayer[]
```

Cycle guard: if no zero-in-degree atoms found, remaining atoms are emitted as a single layer (no infinite loop). Noted as "should not happen with well-formed ExecutableSpecification."

- 🟢 CONFIRMADO — `layer-dispatch.ts:topologicalSort()` lines 34–99

#### getReadyAtoms — dependency readiness check (`completion-ledger.ts`)

```
completedIds = Set of keys in ledger.atomResults
For each pendingAtom:
  if completedIds.has(atomId) → skip (already done)
  spec.dependencies = atomSpec.dependencies as Array<{ atomId: string }>
  if deps.length == 0 → ready (no dependencies)
  if all dep.atomId in completedIds → ready
  else → not ready
Return ready atom IDs
```

- 🟢 CONFIRMADO — `completion-ledger.ts:getReadyAtoms()` lines 137–151

#### Pre-flight API Key Check (AtomExecutor)

Before burning 900s of DO lifetime, the DO verifies that an API key exists for the coder model's provider:

```
if !dryRun:
  model = resolveAgentModel('coder')
  key = keyForModel(model, { CF_API_TOKEN, OFOX_API_KEY })
  if !key:
    write failResult with reason 'Pre-flight auth check failed: no API key for provider {provider}'
    ingest 'infra:llm-api-401' internal signal (best-effort)
    return HTTP response immediately (no 900s alarm set)
```

- 🟢 CONFIRMADO — `atom-executor-do.ts:handleExecuteAtom()` lines 126–167

#### CRP Auto-Generation (coordinator.ts)

In `persistSynthesisResult()`:
- If `verdict.confidence < 0.7` AND `verdict.decision !== 'pass'`: create CRP for `EA-{id}-synthesis` artifact
- If `semanticReview.confidence < 0.7`: create CRP for `EA-{id}-semantic-review` artifact
- `createCRP()` from `../crp` — args: `{ artifactKey, collection, confidence, context, agentRole, executableSpecificationId }`
- 🟢 CONFIRMADO — `coordinator.ts:persistSynthesisResult()` lines 756–780

---

### 2.7 DO Storage Keys (Coordinator)

| Key | Type | Purpose |
|-----|------|---------|
| `__workflowId` | string | Workflow ID for queue callback |
| `__completed` | boolean | Idempotency guard for alarm and synthesize |
| `__alarm_fired` | boolean | Set by alarm handler, read by synthesize to detect timeout |
| `graphState` | GraphState | Current synthesis state (deleted on completion) |

- 🟢 CONFIRMADO — `coordinator.ts` (various storage.put/get calls)

#### DO Storage Keys (AtomExecutor)

| Key | Type | Purpose |
|-----|------|---------|
| `__atomId` | string | Atom ID for alarm handler |
| `__executableSpecificationId` | string | ES ID for alarm handler |
| `__workflowId` | string | Workflow ID for queue publish |
| `__completed` | boolean | Idempotency guard |
| `atomResult` | AtomResult | Cached result for idempotency |
| `file:{path}` | string | Raw file content for cross-file resolution |

- 🟢 CONFIRMADO — `atom-executor-do.ts` (various storage calls)

---

### 2.8 Persistence (ArangoDB Collections)

| Collection | Written by | Key pattern | Contents |
|-----------|-----------|------------|---------|
| `execution_artifacts` | `persistSynthesisResult()` | `EA-{esId}-code`, `EA-{esId}-tests`, `EA-{esId}-synthesis` | Code artifact, test report, synthesis summary |
| `memory_episodic` | `persistSynthesisResult()` | `ep-synth-{esId}` | Stage-6 outcome record with pain_score |
| `completion_ledgers` | `createLedger()` | `{executableSpecificationId}` | Cross-atom completion tracking |
| `file_context_cache` | `fetchFileContexts()` | `{sha}` | GitHub file content cache (5-min TTL) |

- 🟢 CONFIRMADO — `coordinator.ts:persistSynthesisResult()` lines 685–781, `atom-executor-do.ts:fetchFileContexts()` lines 394–401

---

### 2.9 Dry-Run Mode

**Coordinator dry-run bridge** (`dryRunModelBridge()`):

| taskKind | Returns |
|---------|---------|
| `planner` | stub Plan with one atom, gdk-agent recommendation |
| `coder` | stub CodeArtifact with `src/stub.ts` |
| `tester` | stub TestReport (all pass) |
| `verifier` | `{ decision: 'pass', confidence: 1.0 }` |
| `architect` | handled internally by ArchitectAgent |
| `semantic_review` | handled internally by CriticAgent |
| `critic` | handled internally by CriticAgent |
| default | `{ result: 'dry-run stub' }` |

- 🟢 CONFIRMADO — `coordinator.ts:dryRunModelBridge()` lines 565–598

**AtomExecutor dry-run:** Each agent method returns a hardcoded stub result without importing or instantiating the real agent class. Real agents are lazy-imported only for non-dryRun execution.
- 🟢 CONFIRMADO — `atom-executor-do.ts:buildAtomDeps()` lines 248–341

---

### 2.10 Archived Tests (spec-content-threading)

`_archive/spec-content-threading.test.ts` documents the specContent threading requirement: a ground-truth spec string that flows from the pipeline Queue message through GraphState into both `criticAgent.semanticReview()` and `architectAgent.produceBriefingScript()`.

This test file is archived (not in active test suite) but documents behavior that should remain invariant:
- `createInitialState()` defaults `specContent` to `null`
- `specContent` is passed via opts and survives spread-merge cycles
- Queue consumer includes `specContent` in DO fetch body when present
- Both semantic-critic and architect graph nodes receive `specContent` when set; omit when null/absent
- 🟡 INFERIDO — behavior documented in tests, but graph.ts and index.ts not in changed file set; archived status suggests these tests were superseded by integration tests elsewhere

---

### 2.11 Architectural Patterns (Updated)

| Pattern | Where | Confidence |
|---------|-------|-----------|
| ADR-009 gate 6: graph path removed, always interrupt | `coordinator.ts:synthesize()` throw line 403 | 🟢 CONFIRMADO |
| Per-atom DO isolation (v5.1) | `atom-executor-do.ts` | 🟢 CONFIRMADO |
| CompletionLedger event-driven coordination | `completion-ledger.ts` | 🟢 CONFIRMADO |
| Pre-flight auth check before 900s DO lifetime | `atom-executor-do.ts:handleExecuteAtom()` | 🟢 CONFIRMADO |
| Tier-1 internal signals on infra failures | `atom-executor-do.ts:alarm()`, `handleExecuteAtom()` | 🟢 CONFIRMADO |
| File-context caching (ArangoDB, 5-min TTL, SHA-keyed) | `atom-executor-do.ts:fetchFileContexts()` | 🟢 CONFIRMADO |
| Topological layer dispatch (Kahn's algorithm) | `layer-dispatch.ts:topologicalSort()` | 🟢 CONFIRMADO |
| Idempotent atom execution (DO storage cache) | `atom-executor-do.ts:handleExecuteAtom()` | 🟢 CONFIRMADO |
| Queue-based callback (avoids CF self-fetch error 1042) | `coordinator.ts:notifyCallback()` | 🟢 CONFIRMADO |
| Lazy agent import in AtomExecutor (non-dryRun only) | `atom-executor-do.ts:buildAtomDeps()` | 🟢 CONFIRMADO |
| Phase 2 atom dispatch code present but unreachable | `coordinator.ts` lines 428–562 | 🟢 CONFIRMADO |

---

### 2.12 Open Gaps

| Gap | Severity | Note |
|-----|---------|------|
| Phase 2 atom dispatch is dead code in current state (ADR-009 gate 6 always fires first) | HIGH | Queue consumer, ledger, and AtomExecutor exist and are tested, but coordinator never reaches the dispatch block. |
| `/dispatch-atom` and `/atoms-callback` routes referenced in prior SDD no longer exist | MEDIUM | Architecture diagram in `synthesis-coordinator/design.md` is stale on this point. |
| `phase: 'executing'` ledger state is never set by `createLedger()` or `recordAtomResult()` | LOW | `createLedger` sets `'dispatched'`; `recordAtomResult` transitions to `'complete'`. The `'executing'` value is defined in the type but not written by any current function. |
| `spec-content-threading.test.ts` archived — whether `graph.ts` and `index.ts` threading is still correct is unverifiable from changed files alone | LOW | Archived test is not running; graph.ts not in changed file set. |

- 🔴 LACUNA (Phase 2 dead code)
- 🔴 LACUNA (route documentation stale)
- 🟡 INFERIDO (executing phase gap)
- 🟡 INFERIDO (specContent threading current status)

---

## Module 3: gascity-supervisor (Gas City Container Host)

**Files:**
- `workers/gascity-supervisor/src/index.ts` — Cloudflare Worker entry point + `GasCitySupervisor` Container DO
- `workers/gascity-supervisor/src/factory-store-do.ts` — `FactoryStore` SQLite Durable Object
- `workers/gascity-supervisor/gc-linux-amd64` — Gas City daemon binary (ELF 64-bit, ~98 MB, statically linked, not stripped)

**Role:** Hosts a long-running Gas City daemon (linux binary) inside a Cloudflare Container Durable Object. The Worker layer handles authentication, request routing, telemetry ingestion, and an internal bead-store proxy. The `FactoryStore` DO provides the SQLite-backed bead/artifact persistence layer that Gas City reads via the internal proxy.

---

### 3.1 GasCitySupervisor Container DO

`GasCitySupervisor extends Container<Env>` — Cloudflare Container DO wrapping the Gas City daemon process.

#### Static Configuration

| Property | Value | Confidence |
|---|---|---|
| `defaultPort` | `9443` | 🟢 CONFIRMADO — `index.ts:8` |
| `sleepAfter` | `"30m"` | 🟢 CONFIRMADO — `index.ts:9` |
| `enableInternet` | `true` | 🟢 CONFIRMADO — `index.ts:10` |
| Singleton key | `"singleton-v51"` | 🟢 CONFIRMADO — `index.ts:4` |

The suffix `v51` intentionally rotates the container instance; incrementing forces Cloudflare to start the newly deployed image rather than reusing a warm pre-fix container. — 🟢 CONFIRMADO (code comment `index.ts:211-213`)

#### Environment Variable Injection (constructor)

Injected into the container process at startup via `this.envVars`:

| Variable | Source | Purpose | Confidence |
|---|---|---|---|
| `FF_OPERATOR_CONTROL_TOKEN` | `env.OPERATOR_CONTROL_TOKEN` | Auth token for outbound calls to `ff-pipeline /__pi-container/execute` | 🟢 CONFIRMADO — `index.ts:17` |
| `GC_SUPERVISOR_TOKEN` | `env.GC_SUPERVISOR_TOKEN` | Supervisor bearer token (used internally by gc daemon) | 🟢 CONFIRMADO — `index.ts:18` |
| `GC_BEAD_STORE_URL` | hardcoded string | Points gc daemon at the internal bead-store proxy: `https://gascity-supervisor.koales.workers.dev/internal/bead-store/factory` | 🟢 CONFIRMADO — `index.ts:19` |
| `GAS_CITY_HMAC_SECRET` | `env.GAS_CITY_HMAC_SECRET` | HMAC signing secret for Gas City request validation | 🟢 CONFIRMADO — `index.ts:20` |
| `AWS_ACCESS_KEY_ID` | `env.DOLT_R2_ACCESS_KEY_ID` | R2 credentials for Dolt push/pull (S3-compatible) | 🟢 CONFIRMADO — `index.ts:22` |
| `AWS_SECRET_ACCESS_KEY` | `env.DOLT_R2_SECRET_ACCESS_KEY` | R2 secret | 🟢 CONFIRMADO — `index.ts:23` |
| `AWS_REGION` | `"auto"` | R2 region | 🟢 CONFIRMADO — `index.ts:24` |
| `DOLT_R2_ENDPOINT` | `env.DOLT_R2_ENDPOINT` | R2 endpoint URL | 🟢 CONFIRMADO — `index.ts:25` |
| `DOLT_AWS_ENDPOINT` | hardcoded R2 URL | `https://cb56a846c70a38987f31cf6e2b85cb57.r2.cloudflarestorage.com` | 🟢 CONFIRMADO — `index.ts:26` |

#### Keepalive Reference Count Protocol

The container supports a cooperative keepalive mechanism so that multiple concurrent pipeline molecules can hold the container warm. State is stored in Durable Object storage under key `keepalive_refcount`.

**`POST /v0/keepalive/start`**
1. Reads current `keepalive_refcount` (default 0)
2. Increments by 1, persists to storage
3. Calls `renewActivityTimeout()` to reset the 30m idle timer
4. Returns `{ ok: true, refcount: N }`

**`POST /v0/keepalive/stop`**
1. Reads current `keepalive_refcount`
2. Decrements by 1, floors at 0 (`Math.max(0, current - 1)`)
3. If `next > 0`: calls `renewActivityTimeout()` (other molecules still hold the pin)
4. If `next === 0`: does not renew — allows natural 30m sleep to proceed
5. Returns `{ ok: true, refcount: N }`

— 🟢 CONFIRMADO — `index.ts:46-66`

**`GET /__supervisor/fence`**
- Returns `{ active: bool, refcount: number }` — `active` is `refcount > 0`
- Used by callers to test whether the container is currently pinned by any molecule
- Does NOT require authentication (no bearer check in this path)
- 🟢 CONFIRMADO — `index.ts:68-74`

#### Activity Lifecycle Overrides

**`onActivityExpired()`** (override):
- Reads `keepalive_refcount`
- If `refcount > 0`: calls `renewActivityTimeout()` and returns early (prevents sleep while molecules are active)
- If `refcount === 0`: calls `super.onActivityExpired()` (delegates to Container base — normal sleep)
- 🟢 CONFIRMADO — `index.ts:30-37`

**`onStop()`** (override):
- Deletes `keepalive_refcount` from storage (swallows errors)
- Ensures stale refcount does not persist across container restarts
- 🟢 CONFIRMADO — `index.ts:39-41`

#### Request Proxying to Container

All routes not matched by the keepalive or fence paths are proxied to the container daemon:

1. Injects `X-GC-Request: true` header (Gas City CSRF requirement for all mutations) — 🟢 CONFIRMADO — `index.ts:76-78`
2. Rewrites URL: `url.protocol = "http:"`, `url.hostname = "localhost"`, `url.port = "9443"` — 🟢 CONFIRMADO — `index.ts:81-84`
3. Omits body on `GET`/`HEAD` requests to avoid "body with GET" errors — 🟢 CONFIRMADO — `index.ts:86-91`
4. Calls `this.containerFetch(forwarded, 9443)`
5. On error: returns `503 { error: "container_not_ready", detail: <error string> }` — 🟢 CONFIRMADO — `index.ts:93-100`

---

### 3.2 Worker Entry Point (fetch handler)

The `default.fetch` handler is the public-facing Cloudflare Worker routing layer. It runs BEFORE the container DO is involved.

#### Route Dispatch (in priority order)

**1. `POST /internal/telemetry`** (authenticated, no container)
- Auth: `Bearer ${env.GC_SUPERVISOR_TOKEN}` — rejects with 401 on mismatch
- Validates request body: must be a JSON array, max 50 events per batch
- If `env.TELEMETRY_QUEUE` unbound: returns 503 `{ error: "telemetry_queue_unbound" }`
- On success: calls `env.TELEMETRY_QUEUE.send(events)`, returns 200 `{ ok: true }`
- 🟢 CONFIRMADO — `index.ts:108-148`

**2. `GET /internal/telemetry/health`** (authenticated, no container)
- Auth: same bearer check
- Returns `{ ok: bool, telemetry_queue_bound: bool, timestamp: ISO8601 }`
- Status 200 if queue bound, 503 if not
- 🟢 CONFIRMADO — `index.ts:151-168`

**3. `* /internal/bead-store/{city}/{...path}`** (authenticated, proxies to FactoryStore DO)
- Auth: bearer check before routing
- Path parsing: strips `/internal/bead-store/` prefix, splits on first `/` to extract `city` (DO name) and `doPath`
- Strips `Authorization` header from inner request (security: prevents stale token from reaching DO)
- Injects `X-FF-Internal: factory-store` header so DO can identify trusted callee
- Fetches `FACTORY_STORE` DO by `idFromName(city)` with `doPath + url.search` as target URL
- Body forwarded for non-GET/HEAD methods
- 🟢 CONFIRMADO — `index.ts:170-200`

**4. All other routes** (authenticated, proxied to GasCitySupervisor DO)
- Auth: bearer check, 401 on failure
- Routes to `SUPERVISOR` DO named `SUPERVISOR_SINGLETON` (`"singleton-v51"`)
- 🟢 CONFIRMADO — `index.ts:202-217`

#### Path validation for bead-store proxy

```
url.pathname = "/internal/bead-store/{city}/{doPath}"
rest = pathname.slice("/internal/bead-store/".length)  → "{city}/{doPath}"
slash = rest.indexOf("/")
if slash <= 0 → 400 invalid_path
city = rest.slice(0, slash)
doPath = rest.slice(slash)   → includes leading "/"
```

— 🟢 CONFIRMADO — `index.ts:178-187`

**Security design note:** The Worker is the auth gate for the bead-store proxy. It validates the always-current bearer secret, then strips it and injects `X-FF-Internal: factory-store`. This means token rotation does not require updating the DO — the DO only trusts the internal sentinel header, which never rotates. — 🟢 CONFIRMADO (code comment `index.ts:188-190`)

---

### 3.3 Env Interface

```typescript
interface Env {
  SUPERVISOR: DurableObjectNamespace;       // GasCitySupervisor DO
  FACTORY_STORE: DurableObjectNamespace;    // FactoryStore DO
  TELEMETRY_QUEUE?: Queue;                  // optional — telemetry event queue
  GC_SUPERVISOR_TOKEN: string;              // bearer token for all /internal/* and pass-through routes
  OPERATOR_CONTROL_TOKEN: string;           // ff-pipeline authentication token (injected into container)
  GAS_CITY_HMAC_SECRET: string;             // HMAC secret (injected into container)
  DOLT_R2_ACCESS_KEY_ID: string;            // R2/Dolt credentials (injected into container)
  DOLT_R2_SECRET_ACCESS_KEY: string;
  DOLT_R2_ENDPOINT: string;
}
```

— 🟢 CONFIRMADO — `index.ts:220-230`

---

### 3.4 FactoryStore DO (SQLite)

`FactoryStore` — Cloudflare Durable Object with SQLite storage (`ctx.storage.sql`).

#### Initialization

- Enables `PRAGMA foreign_keys = ON`
- Attempts `PRAGMA auto_vacuum = INCREMENTAL` (swallows error if unsupported)
- Calls `initSchema()` to create all tables
- Sets alarm for vacuum: `Date.now() + VACUUM_INTERVAL_MS` (7 days)
- 🟢 CONFIRMADO — `factory-store-do.ts:15-27`

**`alarm()`:** Runs `PRAGMA incremental_vacuum`, reschedules alarm for another 7 days. — 🟢 CONFIRMADO — `factory-store-do.ts:29-32`

#### Auth Model

All requests to the DO must include `X-FF-Internal: factory-store` header. Any other value returns 401. — 🟢 CONFIRMADO — `factory-store-do.ts:36-39`

#### Route Dispatch

| Pattern | Handler |
|---|---|
| `GET /ping` | Returns `{ ok: true }` |
| `POST /beads` | `createBead()` |
| `GET /beads` | `queryBeads()` |
| `POST /beads/close-all` | `closeAll()` |
| `POST /tx` | `runTx()` |
| `POST /deps` | `depAdd()` |
| `GET /deps/{id}` | `depList()` |
| `DELETE /deps/{id}/{dependsOnId}` | `depRemove()` |
| `GET /beads/{id}` | `getBead()` |
| `PATCH /beads/{id}` | `patchBead()` |
| `DELETE /beads/{id}` | `tombstoneBead()` |
| `POST /beads/{id}/close` | `closeBead()` |
| `POST /beads/{id}/reopen` | `reopenBead()` |
| `POST /beads/{id}/metadata` | `setMetadataBatch()` |
| `GET /artifacts/lineage` | `lineageWalk()` |
| `POST /artifacts/lineage` | `insertCollection("lineage_edges", ...)` |
| `POST /artifacts/tx` | `artifactTx()` |
| `POST /artifacts/{collection}` | `insertCollection(collection, ...)` |
| `GET /artifacts/{collection}` | `queryCollection(collection, ...)` |
| `GET /artifacts/{collection}/{id}` | `getCollection(collection, id)` |
| `PATCH /artifacts/{collection}/{id}` | `patchCollection(collection, id, ...)` |

— 🟢 CONFIRMADO — `factory-store-do.ts:108-147`

#### Schema — Typed Tables

**`beads`** — Gas City work items (primary task/issue store)

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | TEXT PK | yes | — | Format: `do-{N}` (auto-increment via nextID()) |
| `title` | TEXT | yes | — | |
| `status` | TEXT | yes | `'open'` | Values: open, closed, deleted |
| `issue_type` | TEXT | yes | `'task'` | |
| `priority` | INTEGER | no | null | |
| `created_at` | TEXT | yes | `new Date().toISOString()` | ISO8601 |
| `assignee` | TEXT | no | null | |
| `from_` | TEXT | no | null | Wire name: `from` (reserved word workaround) |
| `parent_id` | TEXT | no | null | Wire name: `parent` |
| `ref` | TEXT | no | null | |
| `needs` | TEXT | no | `[]` | JSON array |
| `description` | TEXT | no | null | |
| `labels` | TEXT | no | `[]` | JSON array |
| `metadata` | TEXT | no | `{}` | JSON object, key-value pairs |
| `ephemeral` | INTEGER | yes | `0` | Boolean (0/1) |

Index: `idx_status ON beads(status)` — 🟢 CONFIRMADO — `factory-store-do.ts:53-70`

**`deps`** — bead dependency edges

| Column | Type | Notes |
|---|---|---|
| `issue_id` | TEXT | FK → beads.id (enforced by foreign_keys pragma) |
| `depends_on_id` | TEXT | |
| `dep_type` | TEXT | |

PK: `(issue_id, depends_on_id)` — 🟢 CONFIRMADO — `factory-store-do.ts:71-76`

**`specifications`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `kind` | TEXT | |
| `status` | TEXT | default `'active'` |
| `payload` | TEXT | |
| `agent_id` | TEXT | |
| `emission_bead_id` | TEXT | FK → beads(id) |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

— 🟢 CONFIRMADO — `factory-store-do.ts:79`

**`verification_processes`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `spec_id` | TEXT | FK → specifications(id) |
| `kind` | TEXT | |
| `status` | TEXT | |
| `agent_id` | TEXT | |
| `emission_bead_id` | TEXT | FK → beads(id) |
| `started_at` | TEXT | |
| `completed_at` | TEXT | nullable |
| `payload` | TEXT | |

— 🟢 CONFIRMADO — `factory-store-do.ts:80`

**`verdicts`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `vp_id` | TEXT | FK → verification_processes(id) |
| `spec_id` | TEXT | FK → specifications(id) |
| `outcome` | TEXT | |
| `coverage_pct` | REAL | nullable |
| `agent_id` | TEXT | |
| `emission_bead_id` | TEXT | FK → beads(id) |
| `produced_at` | TEXT | |
| `payload` | TEXT | |

— 🟢 CONFIRMADO — `factory-store-do.ts:81`

**`lineage_edges`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `from_id` | TEXT | |
| `from_kind` | TEXT | |
| `to_id` | TEXT | |
| `to_kind` | TEXT | |
| `edge_kind` | TEXT | |
| `agent_id` | TEXT | |
| `emission_bead_id` | TEXT | FK → beads(id) |
| `created_at` | TEXT | |
| `source_ref` | TEXT | nullable |

— 🟢 CONFIRMADO — `factory-store-do.ts:82`

**`completion_events`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `bead_id` | TEXT UNIQUE | |
| `fn_id` | TEXT | |
| `factory_attempt` | INTEGER | |
| `emission_bead_id` | TEXT | FK → beads(id) |
| `created_at` | TEXT | |

— 🟢 CONFIRMADO — `factory-store-do.ts:83`

**`fidelity_verdicts`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `bead_id` | TEXT | |
| `function_id` | TEXT | |
| `overall` | TEXT | |
| `emission_bead_id` | TEXT | FK → beads(id) |
| `produced_at` | TEXT | |
| `payload` | TEXT | |

— 🟢 CONFIRMADO — `factory-store-do.ts:84`

**`dispatch_log`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `ep_id` | TEXT | execution plan id |
| `fn_id` | TEXT | function id |
| `is_id` | TEXT | intent specification id |
| `es_id` | TEXT | executable specification id |
| `form_id` | TEXT | nullable |
| `factory_attempt` | INTEGER | |
| `outcome` | TEXT | |
| `emission_bead_id` | TEXT | FK → beads(id) |
| `dispatched_at` | TEXT | |
| `payload` | TEXT | |

— 🟢 CONFIRMADO — `factory-store-do.ts:85`

**`specs_functions`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name` | TEXT | |
| `domain` | TEXT | |
| `purpose` | TEXT | nullable |
| `state` | TEXT | default `'draft'` |
| `status` | TEXT | default `'active'` |
| `source_refs` | TEXT | |
| `function_type` | TEXT | nullable |
| `confidence` | REAL | nullable |
| `agent_id` | TEXT | |
| `emission_bead_id` | TEXT | FK → beads(id) |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |
| `payload` | TEXT | |

— 🟢 CONFIRMADO — `factory-store-do.ts:86`

**`lifecycle_transitions`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `from_id` | TEXT | entity being transitioned |
| `to_state` | TEXT | target state |
| `from_state` | TEXT | nullable — source state |
| `agent_id` | TEXT | |
| `emission_bead_id` | TEXT | FK → beads(id) |
| `ts` | TEXT | timestamp |

— 🟢 CONFIRMADO — `factory-store-do.ts:93`

#### Schema — Generic Event-Sourced Tables

The following tables all share the same schema: `(id, kind, payload, agent_id, emission_bead_id → beads(id), created_at, updated_at)` — 🟢 CONFIRMADO — `factory-store-do.ts:97-100`

| Table | Domain Purpose |
|---|---|
| `function_proposals` | Function proposal artifacts |
| `workgraphs` | Work graph artifacts |
| `pressures` | Pressure artifacts |
| `capabilities` | Capability artifacts |
| `prds` | Product requirement documents |
| `invariants` | Invariant specifications |
| `consultation_requests` | External consultation records |
| `candidate_sets` | Candidate set artifacts |
| `elucidation_artifacts` | Elucidation records |
| `crps` | Coherence review packages |
| `vcrs` | Verification check results |
| `mrps` | Merge readiness packages |
| `mentor_rules` | Mentor/guidance rules |
| `agents` | Agent registry |
| `assurance_graph` | Assurance lineage graph |
| `specs_incidents` | Incident specifications |
| `memory_entries` | Memory/learning entries |
| `orl_telemetry` | ORL telemetry records |

— 🟡 INFERIDO domain purposes from table names; payload schema not inspectable from DDL alone

#### Additional Typed Tables

| Table | Key Fields | Confidence |
|---|---|---|
| `run_envelopes` | id, kind, payload, agent_id, emission_bead_id, created_at, updated_at | 🟢 CONFIRMADO — `factory-store-do.ts:87` |
| `divergences` | id, kind (default 'divergence'), payload, agent_id, emission_bead_id, created_at, updated_at | 🟢 CONFIRMADO — `factory-store-do.ts:88` |
| `hypotheses` | id, kind (default 'hypothesis'), payload, agent_id, emission_bead_id, created_at, updated_at | 🟢 CONFIRMADO — `factory-store-do.ts:89` |
| `specs_signals` | id, source, subtype, status (default 'active'), source_refs, emission_bead_id, created_at, payload | 🟢 CONFIRMADO — `factory-store-do.ts:90` |
| `merge_readiness_packs` | id, proposal_id, function_id, es_id, readiness_verdict, emission_bead_id, created_at, payload | 🟢 CONFIRMADO — `factory-store-do.ts:91` |
| `completion_ledgers` | id, results, emission_bead_id, created_at, updated_at | 🟢 CONFIRMADO — `factory-store-do.ts:92` |

---

### 3.5 Key Algorithms

#### Bead ID Generation (`nextID`)

```
SELECT COALESCE(MAX(CAST(SUBSTR(id,4) AS INT)), 0) + 1 AS next
FROM beads WHERE id LIKE 'do-%'
→ returns "do-{N}"
```

Auto-incrementing integer suffix within the `do-` namespace. Not globally unique across DOs — unique within a single `FactoryStore` instance. — 🟢 CONFIRMADO — `factory-store-do.ts:477-480`

#### Bead Query Filter Logic

`queryBeads()` builds a dynamic SQL `WHERE` clause with the following precedence:

1. If `status` = `"open"`: clause is `(status='open' OR status='')` — handles legacy beads persisted before default fix
2. If `status` is other non-empty value: `status=?`
3. If no status AND `includeClosed` is false: `status!='closed'`
4. `label` and `metadata` filters applied in-memory post-query (not SQL)
5. Sorting: `created_asc` / `created_desc` — in-memory sort by `created_at` ISO string comparison
6. Limit: applied after in-memory filtering

Query parameter wire format: accepts both camelCase (`status`, `assignee`, `parent`, `issue_type`) and PascalCase (`Status`, `Assignee`, `ParentID`, `Type`) — mirrors Gas City Go DoStore `ListQuery` marshal format. — 🟢 CONFIRMADO — `factory-store-do.ts:319-372`, comment at line 329

#### Metadata Merge Strategy

`patchBead()` with metadata: reads current JSON metadata from DB, merges patch over it (shallow `Object.assign`), writes back. Non-string values are coerced via `String()`. — 🟢 CONFIRMADO — `factory-store-do.ts:234-239`

#### Label Merge Strategy

Labels use Set semantics: `append` items added, `remove` items deleted. Underlying storage is JSON array of strings. — 🟢 CONFIRMADO — `factory-store-do.ts:241-247`

#### Transaction Ops (`runTx`)

Wraps a batch of bead operations in a single SQLite transaction. Supported op kinds:
- `{ kind: "update", id, opts }` → `patchBead(id, { opts })`
- `{ kind: "set_metadata_batch", id, kvs }` → `setMetadataBatch(id, { kvs })`
- `{ kind: "close", id }` → `closeBead(id)`

On error: `ROLLBACK` and rethrow. — 🟢 CONFIRMADO — `factory-store-do.ts:282-297`

#### Artifact Transaction (`artifactTx`)

Wraps batch `insertCollection` calls in a single transaction. Each op: `{ collection: string, doc: JsonRecord }`. On error: `ROLLBACK` and rethrow. — 🟢 CONFIRMADO — `factory-store-do.ts:449-460`

#### Lineage Walk (recursive CTE)

`GET /artifacts/lineage?from={id}` — recursive upward traversal of `lineage_edges`:

```sql
WITH RECURSIVE lineage_walk AS (
  SELECT id, from_id, to_id, from_kind, to_kind, edge_kind, 1 AS depth
  FROM lineage_edges WHERE to_id = ?1
  UNION ALL
  SELECT le.id, le.from_id, le.to_id, le.from_kind, le.to_kind, le.edge_kind, lw.depth + 1
  FROM lineage_edges le
  JOIN lineage_walk lw ON le.to_id = lw.from_id
  WHERE lw.depth < 10
) SELECT * FROM lineage_walk
```

Max depth: 10 hops. Traverses from a given artifact back to its origins. — 🟢 CONFIRMADO — `factory-store-do.ts:462-475`

#### Payload Size Enforcement

`enforcePayloadLimit()` rejects payloads exceeding `MAX_PAYLOAD_BYTES = 1,048,576` (1 MB). Applied on `insertCollection` and `patchCollection`. Throws a `Response` object with 413 status, which is caught by `sqliteError()` and returned directly. — 🟢 CONFIRMADO — `factory-store-do.ts:1,487-492`

---

### 3.6 Error Handling

**Worker layer (default.fetch):**
- Invalid JSON body: `400 { error: "invalid json" }`
- Body not array: `400 { error: "events must be an array" }`
- Batch > 50: `400 { error: "max 50 events per batch" }`
- Queue unbound: `503 { error: "telemetry_queue_unbound" }`
- Invalid bead-store path (no slash after city): `400 { error: "invalid_path" }`
- Container fetch error: `503 { error: "container_not_ready", detail: <string> }`
- All unauthorized: `401 { error: "unauthorized" }`
- 🟢 CONFIRMADO — `index.ts` throughout

**FactoryStore layer:**
- Foreign key violation: `409 { error: "foreign_key_violation" }`
- Payload too large: `413 { error: "payload_too_large" }`
- Internal SQLite error: `500 { error: "internal_error", detail: <msg> }`
- Not found (DO auth): `401 { error: "unauthorized" }`
- Route not found: `404 { error: "not_found" }`
- `tombstoneBead()` sets `status='deleted'` and `ephemeral=0` (does not actually delete the row)
- 🟢 CONFIRMADO — `factory-store-do.ts:495-500`

---

### 3.7 Binary Artifact

`workers/gascity-supervisor/gc-linux-amd64`:
- ELF 64-bit LSB executable, x86-64, statically linked, with debug info, not stripped
- Size: ~98 MB
- BuildID: `78f46dc6dd576d6c3c362dba3f96c759e9fdb106`
- Deployed into the Cloudflare Container image; runs as the Gas City daemon on port 9443
- 🟢 CONFIRMADO — `file` output
- 🔴 LACUNA — binary source is not in this repository; internal API endpoints, city.toml configuration, routing/session logic, and provider behavior are opaque without source. `city.toml [provider.pi-rpc]` referenced in constructor comment implies a TOML config file inside the image.

---

### 3.8 Metadata

#### Domain Constants

| Constant | Value | Location |
|---|---|---|
| `SUPERVISOR_SINGLETON` | `"singleton-v51"` | `index.ts:4` |
| `MAX_PAYLOAD_BYTES` | `1048576` (1 MB) | `factory-store-do.ts:1` |
| `VACUUM_INTERVAL_MS` | `604800000` (7 days) | `factory-store-do.ts:2` |
| `GC_BEAD_STORE_URL` | `"https://gascity-supervisor.koales.workers.dev/internal/bead-store/factory"` | `index.ts:19` |
| `DOLT_AWS_ENDPOINT` | `"https://cb56a846c70a38987f31cf6e2b85cb57.r2.cloudflarestorage.com"` | `index.ts:26` |

— 🟢 CONFIRMADO

#### Feature Flags / Behavioral Switches

| Flag | Mechanism | Effect |
|---|---|---|
| Singleton rotation | `SUPERVISOR_SINGLETON` string value (`v51`) | Increment suffix to force new container image on deploy |
| Keepalive pin | `keepalive_refcount` in DO storage | Prevents 30m sleep while > 0 |
| Legacy status backfill | `initSchema()` UPDATE migration | Normalizes `status=''` → `'open'` on schema init |
| Optional telemetry queue | `env.TELEMETRY_QUEUE?` (optional binding) | 503 if unbound; no hard failure |

— 🟢 CONFIRMADO

---

## Module 4: ff-gates (Coherence Verification)

**Files:** `workers/ff-gates/src/index.ts`, `workers/ff-gates/package.json`, `workers/ff-gates/wrangler.jsonc`
**Role:** Deterministic, fail-closed gate evaluating 5 coverage checks on ExecutableSpecification artifacts. No LLM calls. No network calls except ArangoDB reads. Target latency: <10ms.

---

### 4.1 Control Flow

#### Entry points

**`default.fetch(): Promise<Response>`** — 🟢 CONFIRMADO (`src/index.ts:16-20`)
HTTP entry point returns `404 "ff-gates: use via Service Binding, not HTTP"`. Worker is intentionally not routable via public HTTP.

**`GatesService extends WorkerEntrypoint<GatesEnv>`** — 🟢 CONFIRMADO (`src/index.ts:44`)
The real entry point. Exposed via Cloudflare Service Binding from `ff-gateway` only. Named export `GatesService` alongside the default object export.

---

#### `evaluateCoherenceVerification(executableSpecificationJson: unknown): Promise<CoherenceVerificationReport>`

🟢 CONFIRMADO (`src/index.ts:66-95`)

Main evaluation method. Accepts raw unknown input (deliberate — caller may pass unvalidated JSON). Executes checks sequentially in a fixed order. Fail-closed: if the parseability check fails, subsequent checks are skipped and the report is returned immediately with only that failure. If parse passes, all remaining 5 checks execute unconditionally and are collected into `checks[]`.

**Execution sequence:**

```
1. checkParseable(executableSpecificationJson)
     └─ if !passed → buildReport() and return early   [short-circuit]
2. checkAtomVerification(executableSpecification)
3. checkInvariantVerification(executableSpecification)
4. checkDependencyClosure(executableSpecification)    [async — D1 query]
5. checkLineageCompleteness(wgId)                     [async — D1 query]
6. checkFieldCompleteness(executableSpecification)
7. buildReport(executableSpecificationJson, checks)
```

🟢 CONFIRMADO (`src/index.ts:70-94`)

ID extraction: `wgId = executableSpecification._key ?? executableSpecification.id ?? 'unknown'` — 🟢 CONFIRMADO (`src/index.ts:77`)

---

#### `getDb(): ArangoClient` (private, lazy)

🟢 CONFIRMADO (`src/index.ts:47-52`)

Lazy-initializes `this.db` on first call via `createClientFromEnv(this.env)`. Instance is cached on the WorkerEntrypoint class for the lifetime of the request. `ArangoClient` is imported from `@factory/db-client` (workspace package). Despite the type name `ArangoClient`, the actual SQL dialect used in queries is SQLite/D1-compatible (see §4.2 lineage check).

---

### 4.2 Check Implementations (5 checks + parse gate)

#### `checkParseable(executableSpecification: unknown): CoherenceVerificationCheck`

🟢 CONFIRMADO (`src/index.ts:99-118`)

Guard check (not counted in the 5 numbered checks). Validates:
1. Input is non-null object (`typeof === 'object' && !== null`)
2. All four required top-level fields are present: `['_key', 'atoms', 'invariants', 'dependencies']`

Returns `passed: false` with detail listing missing fields if any are absent. This is the only check that triggers early return.

🔴 LACUNA — `title`, `intentSpecificationId`, `repo` are NOT checked here (only in `checkFieldCompleteness`). The split between "parseable" and "field-completeness" checks is not documented anywhere as a design decision.

---

#### Check 1 — `checkAtomVerification(executableSpecification)` → `"atom-coverage"`

🟢 CONFIRMADO (`src/index.ts:120-139`)

- Extracts `atoms` as `Array<Record<string, unknown>>`
- Fails if `atoms` is absent or not an array
- Identifies "unbound" atoms: those missing BOTH `binding` AND `implementation` fields
- Reports count and IDs (via `a.id ?? a._key ?? 'unknown'`) of unbound atoms

Pass condition: `atoms.length > 0` and every atom has at least one of `binding` or `implementation` set to a truthy value.

🟡 INFERIDO — Previous documentation stated the check also excluded `'stub'` values. The current code uses a simple `!a.binding && !a.implementation` truthiness check with no stub exclusion — any non-falsy value passes.

---

#### Check 2 — `checkInvariantVerification(executableSpecification)` → `"invariant-coverage"`

🟢 CONFIRMADO (`src/index.ts:141-160`)

- Extracts `invariants` as `Array<Record<string, unknown>>`
- Fails if `invariants` is absent or not an array
- Identifies invariants missing BOTH `detector` AND `detectorSpec` fields
- Reports count and IDs of failing invariants

Pass condition: every invariant has at least one of `detector` or `detectorSpec` truthy.

🟡 INFERIDO — Previous documentation referred to checking `detector.check` (nested field). Current code only checks for the existence of `detector` or `detectorSpec` at the top level — no nesting check.

---

#### Check 3 — `checkDependencyClosure(executableSpecification)` → `"dependency-closure"`

🟢 CONFIRMADO (`src/index.ts:162-189`)

- Extracts `dependencies` array and `atoms` array
- Builds a `Set<string>` of all atom IDs: `atomIds = new Set(atoms.map(a => a.id ?? a._key))`
- Identifies "dangling" dependencies: those whose `target ?? to` value is not in `atomIds`
- Special case: if `dependencies` is absent/empty → passes with `"No dependencies declared"`

Pass condition: every dependency's `target` or `to` field resolves to a known atom ID.

🔴 LACUNA — Dependencies that are missing BOTH `target` and `to` fields evaluate `target && !atomIds.has(target)` as `false` (falsy short-circuit), so they silently pass rather than being flagged as malformed.

---

#### Check 4 — `checkLineageCompleteness(wgId: string)` → `"lineage-completeness"`

🟢 CONFIRMADO (`src/index.ts:191-231`)

Performs a recursive D1 SQL query (not AQL — uses SQLite-compatible `WITH RECURSIVE`).

**Algorithm:**
1. Starts from `executable_specifications/{wgId}` as the root node
2. Walks `OUTBOUND` through `lineage_edges` collection (stored in `edges` table with `collection='lineage_edges'`)
3. Uses recursive CTE `lineage(id, depth)` to traverse up to **10 hops**
4. At each visited node, joins `documents` table to inspect the node's JSON
5. Considers the check PASSED if any node satisfies EITHER:
   - `d.json->>'$.type' = 'signal'`
   - `d.key LIKE 'SIG-%'`
6. Uses `LIMIT 1` — stops at the first Signal found

Pass condition: at least one Signal node reachable within 10 hops from the ExecutableSpecification.

`db.queryOne<{ depth: number; doc_json: string }>` — return type carries `depth` (used in success detail message) and `doc_json` (unused beyond hit detection).

🟡 INFERIDO — `startId` is constructed as `executable_specifications/{wgId}`, implying the `edges` table stores IDs in `{collection}/{key}` format.

🔴 LACUNA — The `doc_json` field is fetched in the query return type but never read in the success path. May be a debug artifact or future use.

---

#### Check 5 — `checkFieldCompleteness(executableSpecification)` → `"field-completeness"`

🟢 CONFIRMADO (`src/index.ts:233-263`)

Two-level field completeness scan:

**ExecutableSpecification-level required fields:**
`['title', 'intentSpecificationId', 'atoms', 'invariants', 'repo']`
Checked via `!executableSpecification[f]` (falsy check).

**Atom-level spot-check (first atom only):**
`['id', 'type', 'description']`
Only checks `atoms[0]` — does not validate all atoms.

Missing fields reported with path prefix: `executableSpecification.{f}` or `atoms[0].{f}`.

🟡 INFERIDO — Spot-checking only `atoms[0]` is a performance optimization consistent with the <10ms target. Malformed atoms at index > 0 will not be caught by this check.

🔴 LACUNA — Previous documentation listed `source_refs` and `compiledBy` as required fields. Current implementation does NOT include them in `wgRequired`. Either the requirements changed or the previous doc was inaccurate.

---

### 4.3 Report Assembly

#### `buildReport(executableSpecification: unknown, checks: CoherenceVerificationCheck[]): CoherenceVerificationReport`

🟢 CONFIRMADO (`src/index.ts:267-288`)

- `passed = checks.every(c => c.passed)` — all checks must pass
- `wgId = obj?._key ?? obj?.id ?? 'unknown'`
- `summary`: one of:
  - `"Coherence Verification PASSED: {N} checks, all clear"`
  - `"Coherence Verification FAILED: {failedCheckNames, comma-separated}"`

---

### 4.4 Data Structures

#### `GatesEnv` (interface)

🟢 CONFIRMADO (`src/index.ts:22-25`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `DB` | `D1Database` | yes | Cloudflare D1 binding; used via `ArangoClient` wrapper |
| `ENVIRONMENT` | `string` | yes | Runtime environment identifier; not yet used in gate logic |

#### `CoherenceVerificationReport` (exported interface)

🟢 CONFIRMADO (`src/index.ts:27-34`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `verification` | `"coherence"` | yes | Literal discriminant |
| `passed` | `boolean` | yes | True only if ALL checks pass |
| `timestamp` | `string` | yes | ISO 8601, generated at report build time |
| `executableSpecificationId` | `string` | yes | `_key ?? id ?? 'unknown'` |
| `checks` | `CoherenceVerificationCheck[]` | yes | One entry per check executed |
| `summary` | `string` | yes | Human-readable pass/fail with failed check names |

#### `CoherenceVerificationCheck` (exported interface)

🟢 CONFIRMADO (`src/index.ts:36-40`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | `string` | yes | Check identifier (see enum below) |
| `passed` | `boolean` | yes | |
| `detail` | `string` | yes | Specific pass/fail message with counts and IDs |

**Check name values (domain enum):** `"parseable"`, `"atom-coverage"`, `"invariant-coverage"`, `"dependency-closure"`, `"lineage-completeness"`, `"field-completeness"` — 🟢 CONFIRMADO (inlined in check implementations)

---

### 4.5 Infrastructure / Metadata

#### Package identity

🟢 CONFIRMADO (`package.json`)

| Field | Value |
|-------|-------|
| Package name | `@factory/ff-gates` |
| Version | `0.1.0` |
| Entry point | `src/index.ts` |
| Runtime | Cloudflare Worker (ESM module) |

**Dependencies:**
- `@factory/db-client` — workspace monorepo package; provides `ArangoClient`, `createClientFromEnv`, `D1Database` type
- `@cloudflare/workers-types ^4.20260101.0` — CF type definitions
- `wrangler ^3.100.0` — build/deploy toolchain
- `typescript ^5.4.0`

#### Wrangler configuration

🟢 CONFIRMADO (`wrangler.jsonc`)

| Field | Value |
|-------|-------|
| Worker name | `ff-gates` |
| `compatibility_date` | `2026-01-01` |
| `compatibility_flags` | `["nodejs_compat"]` |
| D1 binding name | `DB` |
| D1 database name | `ff-factory` |
| D1 database ID | `6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3` |

🔴 LACUNA — No `ENVIRONMENT` variable binding is defined in `wrangler.jsonc`, yet `GatesEnv.ENVIRONMENT` is declared as a required field on the interface. Either it is injected at runtime by the platform/secret store, or it is optional in practice despite the interface typing.

🟡 INFERIDO — `nodejs_compat` flag is required for `@factory/db-client`'s use of Node.js APIs (likely `crypto` or buffer operations) inside the Worker runtime.

---

### 4.6 Feedback on Gate Failure (upstream — ff-pipeline)

🟢 CONFIRMADO (`pipeline.ts` coherence-verification-failure block)

When `CoherenceVerificationReport.passed === false`, the pipeline (not ff-gates itself):
1. Persists the report to `verification_reports` and `verification_status`
2. Enqueues `coherenceVerificationFailResult` to `FEEDBACK_QUEUE`
3. Returns `status: 'coherence-verification-failed'`

Feedback loop re-enters pipeline with `autoApprove: false`.

🔴 LACUNA — ff-gates itself has no awareness of the feedback loop. The retry/feedback behavior is entirely owned by `ff-pipeline`. There is no retry budget or depth counter inside ff-gates.

---

### 4.7 Diff from Previous Documentation

| Claim in previous doc | Current code reality | Status |
|-----------------------|----------------------|--------|
| Atom check excludes `'stub'` values | No stub exclusion — any truthy `binding` or `implementation` passes | 🔴 CHANGED |
| Invariant check inspects `detector.check` (nested) | Checks only `detector` or `detectorSpec` existence at top level | 🔴 CHANGED |
| `source_refs` and `compiledBy` in `wgRequired` | Not in `wgRequired`; only `title`, `intentSpecificationId`, `atoms`, `invariants`, `repo` | 🔴 CHANGED |
| Lineage uses ArangoDB AQL traversal | Uses D1 SQLite `WITH RECURSIVE` CTE | 🔴 CHANGED |
| 5 checks listed | Parse gate + 5 checks (6 total check objects possible) | 🟡 CLARIFIED |
| Files: `src/index.ts` only | Also `package.json`, `wrangler.jsonc` now documented | 🟡 EXPANDED |

---

## Module 5: Verification Package

**Files:** `packages/verification/src/`, `packages/schemas/src/coverage.ts`
**Role:** Schema definitions and helpers for Verification Reports.

### 5.1 Verification Report Schemas

```typescript
CoherenceVerificationReport: { verification: "coherence", passed, timestamp, executableSpecificationId, checks[], summary }
FidelityVerificationReport: { verification: "fidelity", passed, verdict: FidelityVerificationVerdict, ... }
PersistenceVerificationReport: { verification: "persistence", passed, ... }
```

All schemas export both Zod validators and inferred TypeScript types.

- 🟢 CONFIRMED — `packages/schemas/src/coverage.ts`

---

## Module 6: ff-gateway (Public API Gateway)

**Files:**
- `workers/ff-gateway/src/index.ts` — HTTP router, public Worker entrypoint
- `workers/ff-gateway/src/query.ts` — read-path `QueryService` WorkerEntrypoint
- `workers/ff-gateway/src/env.ts` — Cloudflare binding type declarations
- `workers/ff-gateway/src/types.ts` — shared output types
- `workers/ff-gateway/wrangler.jsonc` — deployment manifest
- `workers/ff-gateway/package.json` — workspace package metadata

**Role:** The single public endpoint for the Factory API. All external requests enter here. Routes to internal Workers (`ff-gates`, `ff-pipeline`) via Service Bindings. Also hosts a named `QueryService` entrypoint co-deployed in the same Worker for read-path access. Protected by Cloudflare Access in production.

🟢 CONFIRMADO — `src/index.ts:1-29` (module docstring), `wrangler.jsonc:1-35`

---

### N.1 Control Flow — index.ts (HTTP Router)

**Entry point:** `export default { async fetch(request, env) }` — standard Cloudflare Worker fetch handler.

**Dispatch pattern:** Sequential `if` chain on `(method, path)`. No router framework.

🟢 CONFIRMADO — `src/index.ts:36-218`

#### Route table

| Method | Path pattern | Delegate | Behavior |
|--------|-------------|---------|---------|
| `GET` | `/health` | `env.QUERY.getSystemHealth()` | Returns DB health + collection counts |
| `GET` | `/specs/:collection/:key` | `env.QUERY.getSpec()` | Single spec lookup; 404 if missing |
| `GET` | `/specs/:collection` | `env.QUERY.listSpecs()` | Paginated list; `?limit` `?offset` query params |
| `GET` | `/lineage/:collection/:key` | `env.QUERY.traceLineage()` | Upstream lineage traversal; `?depth` param (default 10) |
| `GET` | `/impact/:collection/:key` | `env.QUERY.traceImpact()` | Downstream impact traversal; `?depth` param (default 5) |
| `POST` | `/coherence-verification` | `env.GATES.evaluateCoherenceVerification()` | Canonical coherence gate |
| `POST` | `/gate/1` | `env.GATES.evaluateCoherenceVerification()` | Legacy alias for `/coherence-verification` |
| `GET` | `/gate-status/:gate/:id` | `env.QUERY.getGateStatus()` | Gate status lookup; 404 if missing |
| `GET` | `/trust/:id` | `env.QUERY.getTrustScore()` | Trust score by Function ID; 404 if missing |
| `GET` | `/crps/pending` | `env.QUERY.listPendingCRPs()` | ACE inbox: pending CRPs |
| `GET` | `/mrps/pending` | `env.QUERY.listPendingMRPs()` | ACE inbox: merge-ready MRPs without resolution |
| `GET` | `/mentorscript` | `env.QUERY.listMentorRules()` | Active MentorScript rules |
| `POST` | `/pipeline` | `env.PIPELINE.create()` | Trigger FactoryPipeline Workflow; requires `signal` body field |
| `POST` | `/approve/:id` | `env.PIPELINE.get(id).sendEvent()` | Send `architect-approval` event to paused Workflow |
| `GET` | `/pipeline/:id` | `env.PIPELINE.get(id).status()` | Workflow instance status |
| `*` | `*` | — | 404 with `availableRoutes` listing |

🟢 CONFIRMADO — `src/index.ts:43-211`

#### Conditional logic: POST /pipeline

```
body.signal missing → 400 "Missing signal field"
body.dryRun absent  → defaults to false
→ env.PIPELINE.create({ params: { signal, dryRun } })
→ 201 { instanceId, status: "started", statusUrl, approveUrl }
```

🟢 CONFIRMADO — `src/index.ts:143-160`

#### Conditional logic: POST /coherence-verification

```
report.passed === true  → 200
report.passed === false → 422
```

🟢 CONFIRMADO — `src/index.ts:97-102`

#### Conditional logic: POST /approve/:id

Architect identity resolved in priority order:
1. `cf-access-authenticated-user-email` header (Cloudflare Access, production)
2. `body.by` field (operator override)
3. Fallback literal `"unknown"`

Event sent to Workflow: `{ type: "architect-approval", payload: { decision, reason, by } }`
`decision` defaults to `"approved"` when not supplied.

🟢 CONFIRMADO — `src/index.ts:162-179`

#### Error handling

Single top-level `try/catch` wraps all route dispatch. Any thrown `Error` returns:
```json
{ "error": "<message>" }  // HTTP 500
```
Non-Error throws produce `"Internal error"`.

🟢 CONFIRMADO — `src/index.ts:213-217`

#### Helper: json()

```typescript
function json(data: unknown, status = 200): Response
```
Serializes with 2-space indent. Always sets:
- `Content-Type: application/json`
- `Access-Control-Allow-Origin: *`

🟢 CONFIRMADO — `src/index.ts:223-231`

---

### N.2 Control Flow — query.ts (QueryService)

**Class:** `QueryService extends WorkerEntrypoint<QueryEnv>`
**Exposure:** Named entrypoint `QueryService` re-exported from `index.ts` for Service Binding. No public HTTP route.

🟢 CONFIRMADO — `src/query.ts:49`, `src/index.ts:34`, `wrangler.jsonc:15-16`

#### Lazy DB initialization

```typescript
private db!: ArangoClient
private getDb(): ArangoClient {
  if (!this.db) this.db = createClientFromEnv(this.env)
  return this.db
}
```
ArangoClient is created on first use within a Worker invocation lifecycle.

🟢 CONFIRMADO — `src/query.ts:50-57`

#### Collection name resolution

`resolveCollection(collection: string): string` — two-stage lookup:

1. Check `SPEC_COLLECTIONS` map (public alias → real collection name).
2. If not found, check `NON_SPEC_COLLECTIONS` set — if member, return as-is.
3. Otherwise, prefix `specs_` (e.g., `"foo"` → `"specs_foo"`).

🟢 CONFIRMADO — `src/query.ts:45-47`

#### listSpecs — pagination

Defaults: `limit=25`, `offset=0` (applied in the method, not at the route layer).
Executes two D1 queries per call: one for the page of items, one for total count.
Items are returned with `ORDER BY json->>'$.createdAt' DESC`.

🟢 CONFIRMADO — `src/query.ts:67-87`

#### traceLineage — recursive SQL CTE

Traversal direction: **OUTBOUND** — follows `lineage_edges` forward from `startId`.
Algorithm: SQL `WITH RECURSIVE` CTE anchored at the start node, expanding `edges.to_id` up to `maxDepth`.

```sql
WITH RECURSIVE lineage(id, depth, edge_data) AS (
  SELECT e.to_id, 1, e.data
  FROM edges e WHERE e.collection='lineage_edges' AND e.from_id=?
  UNION ALL
  SELECT e.to_id, l.depth+1, e.data
  FROM edges e JOIN lineage l ON e.from_id=l.id
  WHERE e.collection='lineage_edges' AND l.depth < ?
)
SELECT DISTINCT d.json, l.depth, l.edge_data
FROM lineage l JOIN documents d ON ...
```

Post-processing: joins each reached node ID back to `documents` table by splitting `collection/key` on `/`.

Default `maxDepth`: 10.

🟢 CONFIRMADO — `src/query.ts:92-134`

#### traceImpact — reverse recursive SQL CTE

Traversal direction: **INBOUND** — follows `lineage_edges` backwards from `startId`.
Structurally identical to `traceLineage` but swaps `from_id`/`to_id` roles:

```sql
WHERE e.collection='lineage_edges' AND e.to_id=?   -- anchor
JOIN impact i ON e.to_id=i.id                       -- expand
```

Default `maxDepth`: 5 (shallower than lineage).

🟢 CONFIRMADO — `src/query.ts:136-178`

#### LineageNode shape (output of both traversals)

```typescript
interface LineageNode {
  id: string          // _key of the document
  collection: string  // collection portion of _id
  type: string        // doc.type field
  title?: string      // doc.title field, optional
  depth: number       // hop count from startId
  edgeType?: string   // edge_data.type if present
}
```

🟢 CONFIRMADO — `src/query.ts:283-290`

#### getSystemHealth — health aggregation

Two-phase:
1. `db.ping()` — if false, returns `{ status: "degraded", arango: false, collections: {}, timestamp }` immediately.
2. Iterates all `SPEC_COLLECTIONS` entries (COUNT queries per collection).
3. Iterates 4 memory tiers: `episodic`, `semantic`, `working`, `personal`.
4. Counts `lineage_edges` table.
5. Returns `{ status: "healthy", arango: true, collections: Record<name,count>, timestamp }`.

🟢 CONFIRMADO — `src/query.ts:198-242`

#### Key lookup patterns

| Method | D1 key pattern |
|--------|---------------|
| `getGateStatus(gate, id)` | `verification_status / gate:{gate}:{id}` |
| `getTrustScore(id)` | `trust_scores / trust:{id}` |
| `getInvariantHealth(id)` | `invariant_health / inv:{id}` |

🟢 CONFIRMADO — `src/query.ts:183-195`

#### SDLC inbox queries

All three methods read documents JSON field with SQLite JSON path operators:

| Method | Collection | Filter |
|--------|-----------|--------|
| `listPendingCRPs()` | `consultation_requests` | `$.status = 'pending'` |
| `listPendingMRPs()` | `merge_readiness_packs` | `$.verdict = 'merge-ready'` AND `$.resolution IS NULL` |
| `listMentorRules()` | `mentorscript_rules` | `$.status = 'active'` |

All return `unknown[]` (raw parsed JSON documents).

🟢 CONFIRMADO — `src/query.ts:247-278`

---

### N.3 Algorithms

#### Collection alias resolution

The `SPEC_COLLECTIONS` map supports both hyphenated and underscore variants for aliased collections:
- `"intent-specifications"` and `"intent_specifications"` both map to `"intent_specifications"`
- `"executable-specifications"` and `"executable_specifications"` both map to `"executable_specifications"`
- `"verification-reports"` and `"verification_reports"` both map to `"verification_reports"`

This normalizes external API consumers that may use either convention.

🟢 CONFIRMADO — `src/query.ts:22-34`

#### Pagination parameter parsing

Route layer applies `parseInt()` with no validation on `limit`/`offset`. A non-numeric query param (`NaN`) propagates to `listSpecs`. The method applies defaults only for missing/undefined opts, not for NaN.

🟡 INFERIDO — `src/index.ts:64-66`; default handling is in `listSpecs` opts destructure (`limit = 25, offset = 0`) which only fires if `opts.limit` is undefined — a NaN would pass through.

---

### N.4 Data Structures

#### GatewayEnv (env.ts)

```typescript
interface GatewayEnv {
  GATES: GatesBinding        // Service Binding → ff-gates (GatesService entrypoint)
  QUERY: QueryBinding        // Service Binding → ff-gateway (QueryService entrypoint, same Worker)
  PIPELINE: PipelineBinding  // Workflow Binding → ff-pipeline (FactoryPipeline)
  DB: D1Database             // D1 database (ff-factory)
  ENVIRONMENT: string        // "production" (var)
}
```

🟢 CONFIRMADO — `src/env.ts:45-51`, `wrangler.jsonc`

#### GatesBinding (env.ts)

```typescript
interface GatesBinding {
  evaluateCoherenceVerification(executableSpecification: unknown): Promise<CoherenceVerificationReport>
}
```

Declared structurally (not imported from ff-gates) to avoid cross-Worker rootDir import issues.

🟢 CONFIRMADO — `src/env.ts:13-15`

#### QueryBinding (env.ts)

```typescript
interface QueryBinding {
  getSpec(collection: string, key: string): Promise<unknown>
  listSpecs(collection: string, opts: { limit: number; offset: number }): Promise<{ items: unknown[]; total: number }>
  traceLineage(collection: string, key: string, maxDepth: number): Promise<unknown[]>
  traceImpact(collection: string, key: string, maxDepth: number): Promise<unknown[]>
  getGateStatus(gate: number, id: string): Promise<unknown>
  getTrustScore(id: string): Promise<unknown>
  getSystemHealth(): Promise<unknown>
  listPendingCRPs(): Promise<unknown[]>
  listPendingMRPs(): Promise<unknown[]>
  listMentorRules(): Promise<unknown[]>
}
```

🟢 CONFIRMADO — `src/env.ts:18-28`

#### WorkflowInstance / PipelineBinding (env.ts)

```typescript
interface WorkflowInstance {
  id: string
  pause(): Promise<void>
  resume(): Promise<void>
  terminate(): Promise<void>
  restart(): Promise<void>
  status(): Promise<unknown>
  sendEvent(event: { type: string; payload: unknown }): Promise<void>
}

interface PipelineBinding {
  create(opts?: { id?: string; params?: unknown }): Promise<WorkflowInstance>
  get(id: string): Promise<WorkflowInstance>
}
```

🟢 CONFIRMADO — `src/env.ts:30-43`

#### CoherenceVerificationReport (types.ts)

```typescript
interface CoherenceVerificationReport {
  verification: "coherence"     // literal discriminant
  passed: boolean
  timestamp: string             // ISO 8601
  executableSpecificationId: string
  checks: { name: string; passed: boolean; detail: string }[]
  summary: string
}
```

🟢 CONFIRMADO — `src/types.ts:1-8`

#### SystemHealth (query.ts local type)

```typescript
interface SystemHealth {
  status: 'healthy' | 'degraded'
  arango: boolean
  collections: Record<string, number>   // collection name → document count
  timestamp: string                     // ISO 8601
}
```

🟢 CONFIRMADO — `src/query.ts:292-297`

---

### N.5 Metadata

#### SPEC_COLLECTIONS constant (query.ts)

Domain-named map from public API collection slugs to ArangoDB collection names:

```typescript
const SPEC_COLLECTIONS: Record<string, string> = {
  signals:                     'specs_signals',
  pressures:                   'specs_pressures',
  capabilities:                'specs_capabilities',
  functions:                   'specs_functions',
  'intent-specifications':     'intent_specifications',
  intent_specifications:       'intent_specifications',
  'executable-specifications': 'executable_specifications',
  executable_specifications:   'executable_specifications',
  invariants:                  'specs_invariants',
  'verification-reports':      'verification_reports',
  verification_reports:        'verification_reports',
}
```

🟢 CONFIRMADO — `src/query.ts:22-34`

#### NON_SPEC_COLLECTIONS constant (query.ts)

Set of collection names that are passed through verbatim (no `specs_` prefix applied):

```
execution_artifacts, memory_episodic, memory_semantic, memory_working, memory_personal, verification_status
```

🟢 CONFIRMADO — `src/query.ts:36-43`

#### Environment variable: ENVIRONMENT

- Key: `ENVIRONMENT`
- Value in production: `"production"` (set in `wrangler.jsonc` vars)
- Bound in `GatewayEnv.ENVIRONMENT: string`
- Not currently used in routing logic (declared binding, no conditional on it in index.ts)

🟡 INFERIDO — present in env interface and wrangler vars but no branch on its value found in index.ts

#### Deprecated secrets (wrangler.jsonc)

Three ArangoDB secrets are documented as `[DEPRECATED]` — database layer migrated to D1:
- `ARANGO_URL`
- `ARANGO_DATABASE`
- `ARANGO_JWT`

🟢 CONFIRMADO — `wrangler.jsonc:36-39`

#### Cloudflare binding topology (wrangler.jsonc)

| Binding name | Type | Target |
|-------------|------|--------|
| `DB` | D1 | `ff-factory` (id: `6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3`) |
| `GATES` | Service | `ff-gates` → `GatesService` entrypoint |
| `QUERY` | Service | `ff-gateway` → `QueryService` entrypoint (self-reference — same deployment) |
| `PIPELINE` | Workflow | `ff-pipeline` → `FactoryPipeline` class |

The `QUERY` binding pointing to `ff-gateway` itself (same script) is a notable pattern: `QueryService` is co-deployed as a named entrypoint in the same Worker rather than a separate deployment. The wrangler comment notes this may be split if query load requires independent scaling.

🟢 CONFIRMADO — `wrangler.jsonc:9-27`

#### Compatibility date / flags

- `compatibility_date`: `"2026-01-01"`
- `compatibility_flags`: `["nodejs_compat"]`

🟢 CONFIRMADO — `wrangler.jsonc:5-6`

---

### N.6 Lacunas

| # | Lacuna | Severity |
|---|--------|----------|
| 1 | No authentication middleware visible in index.ts — Cloudflare Access is referenced only in comments. There is no programmatic check of Access JWT or API key in code. | 🔴 LACUNA |
| 2 | `ENVIRONMENT` binding is declared and set but never branched on in the router — unclear if it drives any behavior (e.g., debug routes, relaxed auth in dev). | 🔴 LACUNA |
| 3 | `parseInt()` for `limit`/`offset` query params has no NaN guard at the route layer. | 🔴 LACUNA |
| 4 | `getInvariantHealth(id)` is implemented in QueryService but not exposed in `QueryBinding` (env.ts) and not routed in index.ts. The method exists but is unreachable via gateway. | 🔴 LACUNA |
| 5 | Phase 7 route `POST /webhook/ci-result` is documented in the module docstring but not yet implemented. | 🟡 INFERIDO (planned gap) |
| 6 | No request body size limits or Content-Type validation on POST routes — `request.json()` will throw on malformed bodies, which is caught by the top-level try/catch, but large payloads are not bounded. | 🔴 LACUNA |

---

## Data Dictionary (Summary)

| Entity | Key Prefix | Collection | Required Fields |
|--------|-----------|-----------|----------------|
| Signal | `SIG-` | `specs_signals` | signalType, source, title, description, idempotencyKey, status |
| Pressure | `PRS-` | `specs_pressures` | title, description, priority, category, sourceSignalId |
| Capability | `BC-` | `specs_capabilities` | title, description, category, gapAnalysis, sourcePressureId |
| FunctionProposal | `FP-` | `specs_functions` | title, intentSpecification, birthGateScore, sourceCapabilityId |
| IntentAnchor | `IA-` | `intent_anchors` | id, signal_id, claim, probe_question, violation_signal, severity |
| ExecutableSpecification | `ES-` | `executable_specifications` | title, atoms[], dependencies[], invariants[], source_refs[], compiledBy |
| VerificationReport | `VR-` | `verification_reports` | type, passed, sourceRefs[], timestamp |
| LineageEdge | — | `lineage_edges` | type ('derived-from'|'compiled-from'), createdAt |

---

## Architectural Patterns Observed

| Pattern | Where | Confidence |
|---------|-------|-----------|
| Durable CF Workflow (step dedup by name) | `pipeline.ts` | 🟢 CONFIRMED |
| Fail-open feature flags (crystallizer, learning, feedback) | `config/`, `pipeline.ts` | 🟢 CONFIRMED |
| Anti-corruption context slicing (per-pass minimal context) | `compile.ts:runLivePass` | 🟢 CONFIRMED |
| Idempotent artifact creation (hash-based dedup) | `ingest-signal.ts` | 🟢 CONFIRMED |
| Event-driven DO↔Workflow decoupling (queue + waitForEvent) | `pipeline.ts` + `coordinator.ts` | 🟢 CONFIRMED |
| Speculative JSON repair (regex repair before parse failure) | `compile.ts:runLivePass` | 🟢 CONFIRMED |
| CRP auto-generation on low confidence (<0.7) | `pipeline.ts`, `coordinator.ts` | 🟢 CONFIRMED |
| 3-tier execution fallback (Sandbox → Agent → callModel) | `coordinator.ts:buildSandboxDeps` | 🟢 CONFIRMED |
| Feedback depth counter (max 3) in raw signal field | `generate-feedback.ts` | 🟢 CONFIRMED |
| Gas City era: pipeline terminates at `dispatched` (no synthesis wait) | `pipeline.ts` | 🟢 CONFIRMADO |
| Plan-and-Execute Governor (LLM plans, deterministic code validates) | `governor-agent.ts` | 🟢 CONFIRMADO |
| HMAC-gated external webhooks (constant-time comparison) | `webhook-receiver.ts` | 🟢 CONFIRMADO |
| D1 two-table model replacing 48 ArangoDB collections | `d1-schema.sql` | 🟢 CONFIRMADO |
| TTL-cached hot configuration (60s, fail-open) | `hot-config.ts` | 🟢 CONFIRMADO |
| Per-atom DO isolation with Kahn topological dispatch | `atom-executor-do.ts`, `layer-dispatch.ts` | 🟢 CONFIRMADO |
| Self-referencing Service Binding (QueryService co-deployed in ff-gateway) | `wrangler.jsonc` (ff-gateway) | 🟢 CONFIRMADO |

---

## Module: ksp-artifact-graph (@factory/artifact-graph)
> Source: SPEC-KSP-ARTIFACT-GRAPH-001.md | Steps: 1–9

---

### 1. Control Flow

#### 1.1 Public API — `ArtifactGraphDOBase` (abstract Durable Object)

All methods are `async` and operate against the DO's `SqlStorage` instance. The namespace is injected at construction time via `DomainConfig` and is never passed by callers.

| Method | Signature | Returns |
|--------|-----------|---------|
| `upsertNode` | `(id, type, data)` | `Promise<ArtifactNode>` |
| `getNode` | `(id)` | `Promise<ArtifactNode \| null>` |
| `getNodesByType` | `(type, limit=100, offset=0)` | `Promise<ArtifactNode[]>` |
| `upsertEdge` | `(source, target, rel, props?)` | `Promise<ArtifactEdge>` |
| `getEdgesFrom` | `(source, rel?)` | `Promise<ArtifactEdge[]>` |
| `getEdgesTo` | `(target, rel?)` | `Promise<ArtifactEdge[]>` |
| `walkLineageBackward` | `(startId, rel, maxDepth?)` | `Promise<LineageChain>` |
| `walkLineageForward` | `(startId, rel, maxDepth?)` | `Promise<LineageChain>` |
| `walkBoundedPath` | `(startId, steps)` | `Promise<PathResult[]>` |
| `collectLineageIds` | `(anyNodeId, rel)` | `Promise<string[]>` |

🟢 CONFIRMADO — all method signatures are explicit in spec §6.2–6.3.

#### 1.2 Initialization / Migration Call Sequence

```
DO constructor(ctx, env, config, migrations)
  └─ super(ctx, env)                         // DurableObject base
  └─ this.sql = ctx.storage.sql              // acquire SqlStorage handle
  └─ ctx.blockConcurrencyWhile(async () => {
       migrate(ctx.storage, migrations)       // run pending migrations
     })
```

🟢 CONFIRMADO — explicit in spec §6.3. `blockConcurrencyWhile` serializes migration before any RPC is served.

#### 1.3 Traversal Call Sequences

**Backward lineage (version_of chain):**
```
caller → walkLineageBackward(startId, 'version_of')
  └─ Q.walkLineageBackward(sql, startId, rel, maxDepth=1000)
       └─ sql.exec(WITH RECURSIVE lineage CTE)
            → rows[] → map(toNode) → LineageChain{nodes, depth}
```

**Bounded path (n-hop join chain):**
```
caller → walkBoundedPath(startId, steps[])
  └─ Q.walkBoundedPath(sql, startId, steps)
       └─ dynamically build JOIN chain from steps array
       └─ sql.exec(generated SQL, ...params)
            → rows[] → map(r → {path: ArtifactNode[], edges: ArtifactEdge[]})
            → PathResult[]
```

**Bi-directional lineage collect:**
```
caller → collectLineageIds(anyNodeId, rel)
  └─ Q.collectLineageIds(sql, anyNodeId, rel)
       └─ sql.exec(WITH RECURSIVE predecessors UNION successors CTE)
            → string[] of all node IDs in the entire lineage chain
```

🟢 CONFIRMADO — all three sequences explicit in spec §6.2.

#### 1.4 Error Paths and Fail-Closed Behaviors

🟡 INFERIDO — `upsertNode` and `upsertEdge` use `ON CONFLICT ... DO UPDATE`, making double-writes idempotent. No explicit error handling code is given; SQLite constraint violations surface as thrown exceptions from `sql.exec`.

🔴 LACUNA — No retry logic, error wrapping, or typed error classes are specified. The spec does not define what happens if `getNode` returns `null` at the DO method layer (callers must handle).

🔴 LACUNA — No RPC routing / `fetch` handler is specified in the DO base class. The spec mentions `worker.ts` in §9 step 7 but does not define its contract.

#### 1.5 Async Patterns

🟢 CONFIRMADO — All DO methods are `async`. The underlying `Q.*` query functions are synchronous (they call `sql.exec` which is synchronous in Cloudflare DO SQLite). The `async` wrapping exists purely to satisfy the DO RPC contract.

---

### 2. Algorithms

#### 2.1 Recursive Lineage Walk (`walkLineageBackward` / `walkLineageForward`)

Both use SQLite `WITH RECURSIVE` CTEs.

**Backward (child → ancestors):**
```sql
WITH RECURSIVE lineage(id, depth) AS (
  SELECT ?, 0                                          -- seed: start node at depth 0
  UNION ALL
  SELECT e.target, l.depth + 1
  FROM edges e
  JOIN lineage l ON e.source = l.id
  WHERE e.rel = ? AND l.depth < ?                      -- depth-bounded via maxDepth
)
SELECT n.*, l.depth FROM nodes n JOIN lineage l ON n.id = l.id
ORDER BY l.depth ASC
```

**Forward (root → descendants, reversed traversal direction):**
```sql
WITH RECURSIVE successors(id, depth) AS (
  SELECT ?, 0
  UNION ALL
  SELECT e.source, s.depth + 1
  FROM edges e
  JOIN successors s ON e.target = s.id                 -- reversed: target → source
  WHERE e.rel = ? AND s.depth < ?
)
SELECT n.*, s.depth FROM nodes n JOIN successors s ON n.id = s.id
ORDER BY s.depth ASC
```

- Default `maxDepth = 1000` acts as a cycle guard (SQLite RECURSIVE CTEs do not detect cycles natively).
- Return value `depth` = `nodes.length - 1` (number of hops from seed).

🟢 CONFIRMADO.

#### 2.2 `walkBoundedPath` Dynamic SQL Builder

Constructs a variable-length JOIN chain at runtime from a `steps: PathStep[]` array.

Algorithm:
1. Initialize `params = [startId]`, `prevAlias = 'n0'`.
2. For each step `i` (0-indexed):
   - Push `JOIN edges e{i+1} ON e{i+1}.source = {prevAlias}.id AND e{i+1}.rel = ?`; push `step.rel` to params.
   - If `step.targetType` present: push `JOIN nodes n{i+1} ON n{i+1}.id = e{i+1}.target AND n{i+1}.type = ?`; push `step.targetType` to params.
   - Else: push `JOIN nodes n{i+1} ON n{i+1}.id = e{i+1}.target`.
   - Update `prevAlias = n{i+1}`.
3. Build SELECT: columns for all `n0..nN` and `e1..eN` aliased as `n{i}_{col}` / `e{i}_{col}`.
4. Append `WHERE n0.id = ?`; push `startId` again (startId appears at position 0 and as the last WHERE param).
5. Execute; reconstruct `PathResult[]` by extracting columns per index.

🟢 CONFIRMADO — full algorithm explicit in spec §6.2.

#### 2.3 Bi-directional Lineage Collect (`collectLineageIds`)

```sql
WITH RECURSIVE
  predecessors(id) AS (
    SELECT ?
    UNION ALL
    SELECT e.target FROM edges e JOIN predecessors p ON e.source = p.id WHERE e.rel = ?
  ),
  successors(id) AS (
    SELECT ?
    UNION ALL
    SELECT e.source FROM edges e JOIN successors s ON e.target = s.id WHERE e.rel = ?
  )
SELECT id FROM predecessors
UNION
SELECT id FROM successors
```

Parameters: `anyNodeInLineage` appears twice (once per CTE seed), `rel` appears twice. The `UNION` (not `UNION ALL`) deduplicates the full set.

🟢 CONFIRMADO.

#### 2.4 Content-Addressed Node IDs

🟡 INFERIDO — Spec §2 states immutable nodes MAY use `SHA-256(type + canonical_json(data))`. Implementation of `canonical_json` is not specified. The domain instantiation example in §7 declares `contentHashedTypes: ['ExecutionTrace', 'ElucidationArtifact']` but the enforcement logic is not implemented in the base layer — domain subclasses are expected to compute the hash before calling `upsertNode`.

🔴 LACUNA — No `canonical_json` helper is defined anywhere in the spec.

#### 2.5 Migration Pattern (`migrate.ts`)

🟡 INFERIDO from §9 step 4: `migrate` uses `transactionSync` on `ctx.storage`. `schema_history` table tracks applied versions by integer version + name. Migration is run inside `blockConcurrencyWhile` so it is guaranteed to complete before any RPC is served. Full `migrate.ts` implementation is not in the spec.

🔴 LACUNA — The `Migration` type and the full migration runner implementation are deferred to §9 step 4 without definition in this spec.

#### 2.6 Edge ID Derivation

🟢 CONFIRMADO — Edge IDs are deterministic composites: `id = \`${source}::${rel}::${target}\``. This is consistent with the `UNIQUE(source, target, rel)` constraint — the same logical edge always has the same ID.

---

### 3. Data Structures

#### 3.1 TypeScript Interfaces (`types.ts`)

```typescript
interface ArtifactNode {
  id: string;           // user-supplied or content-addressed
  type: NodeType;       // open string (core or domain-extended)
  data: Record<string, unknown>;   // domain payload, JSON-serialized in DB
  ns: string;           // namespace: "domain:org:scope"
  created: number;      // Unix ms
  updated: number;      // Unix ms
}

interface ArtifactEdge {
  id: string;           // "${source}::${rel}::${target}"
  source: string;       // node id
  target: string;       // node id
  rel: RelType;         // open string
  props: Record<string, unknown>;  // edge metadata, JSON-serialized
  created: number;      // Unix ms
}

interface LineageChain {
  nodes: ArtifactNode[];   // ordered: start → deepest ancestor (backward) or deepest descendant (forward)
  depth: number;           // nodes.length - 1
}

interface PathResult {
  path: ArtifactNode[];    // [n0, n1, ..., nN] — one per step + seed
  edges: ArtifactEdge[];   // [e1, ..., eN] — one per step
}

interface DomainConfig {
  namespace: string;                      // e.g. 'factory:org-abc:pipeline-1'
  nodeTypes: readonly string[];           // domain additions to CORE_NODE_TYPES
  relTypes: readonly string[];            // domain additions to CORE_REL_TYPES
  contentHashedTypes?: readonly string[]; // types whose IDs are SHA-256(type+data)
}

interface PathStep {
  rel: RelType;
  targetType?: string;   // optional — filters target node by type in the JOIN
}
```

🟢 CONFIRMADO — all interfaces explicit in spec §6.1–6.2.

#### 3.2 SQLite Schema (migration `v00_artifact_graph_base`)

**Table: `nodes`**

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `type` | TEXT | NOT NULL |
| `data` | TEXT | NOT NULL DEFAULT '{}' (JSON) |
| `ns` | TEXT | NOT NULL |
| `created` | INTEGER | NOT NULL (Unix ms) |
| `updated` | INTEGER | NOT NULL (Unix ms) |

**Table: `edges`**

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `source` | TEXT | NOT NULL, REFERENCES nodes(id) ON DELETE CASCADE |
| `target` | TEXT | NOT NULL, REFERENCES nodes(id) ON DELETE CASCADE |
| `rel` | TEXT | NOT NULL |
| `props` | TEXT | NOT NULL DEFAULT '{}' (JSON) |
| `created` | INTEGER | NOT NULL (Unix ms) |
| — | — | UNIQUE(source, target, rel) |

**Table: `schema_history`**

| Column | Type | Constraints |
|--------|------|-------------|
| `version` | INTEGER | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `applied` | INTEGER | NOT NULL (Unix ms) |

**Indexes:**

| Name | Columns | Purpose |
|------|---------|---------|
| `idx_nodes_ns_type` | `(ns, type)` | `getNodesByType` hot path |
| `idx_nodes_ns_created` | `(ns, created DESC)` | recency listing |
| `idx_edges_source` | `(source)` | outgoing edge lookup |
| `idx_edges_target` | `(target)` | incoming edge lookup |
| `idx_edges_rel` | `(rel)` | rel-type scans |
| `idx_edges_src_rel` | `(source, rel)` | `getEdgesFrom` with rel filter |
| `idx_edges_tgt_rel` | `(target, rel)` | `getEdgesTo` with rel filter |

🟢 CONFIRMADO — full DDL in spec §5.1.

#### 3.3 Core Node Type Registry

```typescript
const CORE_NODE_TYPES = [
  'Specification',        // §3.2
  'Claim',                // §3.3
  'Execution',            // §3.4
  'ExecutionTrace',       // §3.5
  'VerificationProcess',  // §3.7
  'Verdict',              // §3.8
  'Divergence',           // §3.9
  'Hypothesis',           // §3.10
  'Amendment',            // §3.11
  'Agent',                // §3.12
  'KnowingState',         // §3.1
  'DispositionEvent',     // §4B.4
  'CandidateSet',         // §3.14
  'ElucidationArtifact',  // §3.15
] as const;
```

🟢 CONFIRMADO — §3 of spec.

#### 3.4 Core Relation Type Registry

```typescript
const CORE_REL_TYPES = [
  // Specification lifecycle
  'version_of',               // Specification → Specification
  'composed_of',              // Specification → Claim
  'formalizes',               // Specification → KnowingState
  'governs',                  // Specification → Execution

  // Execution chain
  'produces',                 // Execution → ExecutionTrace
  'governed_by',              // Execution → Specification

  // Divergence chain
  'evidences',                // ExecutionTrace → Divergence
  'diverges_from',            // ExecutionTrace → Specification
  'concerns',                 // Divergence → Claim

  // Amendment loop
  'evidence_for',             // Divergence → Hypothesis
  'explains',                 // Hypothesis → Divergence
  'motivates',                // Hypothesis → Amendment
  'if_adopted_produces',      // Amendment → Specification
  'proposes_modification_of', // Amendment → Specification
  'subject_to',               // Amendment → VerificationProcess

  // Verification
  'produces_verdict',         // VerificationProcess → Verdict
  'borne_by',                 // Verdict → entity

  // Elucidation
  'produced_at',              // ElucidationArtifact → DispositionEvent
  'records_candidate_set',    // ElucidationArtifact → CandidateSet
  'records_selected_option',  // ElucidationArtifact → node
  'informs',                  // ElucidationArtifact → Hypothesis

  // Provenance
  'created_by',               // any → Agent
  'corrects',                 // new node → prior node
] as const;
```

🟢 CONFIRMADO — §4 of spec.

#### 3.5 Constants

| Constant | Value | Context |
|----------|-------|---------|
| `maxDepth` default (lineage walks) | `1000` | Cycle guard for recursive CTEs |
| `getNodesByType` default `limit` | `100` | Pagination default |
| `getNodesByType` default `offset` | `0` | Pagination default |

🟢 CONFIRMADO — explicit in spec §6.2.

#### 3.6 Cloudflare Bindings Required

| Binding | Type | Purpose |
|---------|------|---------|
| DO class (`ArtifactGraphDOBase` subclass) | Durable Object | Single-writer SQLite storage per namespace |
| `ctx.storage.sql` | `SqlStorage` | DO SQLite API |

🟢 CONFIRMADO — explicit in spec §6.3.

#### 3.7 Invariants

| ID | Rule |
|----|------|
| INV-AG-001 | Nodes are never updated in place except `data.retired = true`; corrections use `corrects` edge |
| INV-AG-002 | Edge uniqueness enforced at schema level: `UNIQUE(source, target, rel)` — idempotent writes |
| INV-AG-003 | All queries include `ns` in WHERE — namespace isolation guaranteed |
| INV-AG-004 | `ON DELETE CASCADE` on edges — retiring (not deleting) nodes preserves integrity |
| INV-AG-005 | Successor Specification's `version_of` edge MUST be written in the same `transactionSync` |
| INV-AG-006 | DO is the sole write path — no direct SQLite access from Workers or external processes |

🟢 CONFIRMADO — §8 of spec.

#### 3.8 Package Identity

| Field | Value |
|-------|-------|
| Package name (internal) | `packages/artifact-graph` |
| Published scope | `@factory/artifact-graph` (formerly `@koales/artifact-graph`) |
| Downstream consumers | `@factory/ksp-sdk` (for `ArtifactNode`/`ArtifactEdge` types at loop closure boundary) |
| Upstream specs | `SPEC-KSP-BEAD-GRAPH-001`, `SPEC-KSP-LOOP-CLOSURE-001` |
| Domain instantiation | `SPEC-FACTORY-ARTIFACT-GRAPH-DO-001` |

🟢 CONFIRMADO — §10 of spec.

---

## Module: ksp-bead-graph (@factory/bead-graph)
> Source: SPEC-KSP-BEAD-GRAPH-001.md | Steps: 10–20

---

### 1. Control Flow

#### Public API — `BeadGraphDOBase` (Durable Object base class, `src/do.ts`)

| Method | Params | Return | Notes |
|--------|--------|--------|-------|
| `writeBead` | `bead: AnyBead, auditBead?: AnyBead` | `Promise<void>` | 🟢 CONFIRMADO; delegates to `BQ.writeBead`; throws if auditBead absent for non-audit type |
| `getBead` | `beadId: string` | `Promise<BaseBead & { content } \| null>` | 🟢 CONFIRMADO; reconstitutes `parent_ids` from edges |
| `getCurrentTrustBead` | `orgId: string, subjectId: string` | `Promise<BaseBead & { content } \| null>` | 🟢 CONFIRMADO; returns head TrustBead (no supersedes-child) |
| `getActiveConsent` | `orgId: string, roleId: string` | `Promise<BaseBead & { content } \| null>` | 🟢 CONFIRMADO |
| `getTrustLineage` | `orgId: string, subjectId: string` | `Promise<(BaseBead & { content })[]>` | 🟢 CONFIRMADO; returns trust + outcome + amendment beads in ASC order |
| `getOpenAmendments` | `orgId: string` | `Promise<(BaseBead & { content })[]>` | 🟢 CONFIRMADO; status = 'PENDING' |
| `retrieveKnowingState` | `orgId: string, roleId: string, category?: string` | `Promise<{ policy, trustedSubjects, consent }>` | 🟢 CONFIRMADO; I2 retrieval enforcement entry point |
| `computeBeadId` | `type: string, content: Record<string,unknown>, parentIds: string[]` | `string` | 🟢 CONFIRMADO; exposed on DO so SDK avoids separate import |

#### Public API — `KnowingStateSDK<P,T,E,O>` interface (`src/sdk.ts`)

| Method | Params | Return | Notes |
|--------|--------|--------|-------|
| `openSession` | `orgId, roleId, agentId` | `Promise<Session>` | 🟢 CONFIRMADO; creates session KV entry |
| `closeSession` | `sessionId` | `Promise<void>` | 🟢 CONFIRMADO |
| `retrieveKnowingState` | `sessionId, category?` | `Promise<KnowingState<T,P>>` | 🟢 CONFIRMADO; MUST be called before `writeExecutionBead`; throws if unavailable (I4/INV-BG-008) |
| `evaluateTrust` | `sessionId, subjectId` | `Promise<TrustEvaluation<T>>` | 🟢 CONFIRMADO; returns `{ trusted, trustBead, autonomy }` |
| `writeExecutionBead` | `sessionId, payload: ExecutionContent` | `Promise<string>` (bead_id) | 🟢 CONFIRMADO; asserts `session.ksRetrievedAt` set (INV-BG-003); throws `SessionNotInitialized` if not |
| `writeOutcomeBead` | `sessionId, executionBeadId, outcome: OutcomeContent` | `Promise<string>` (bead_id) | 🟢 CONFIRMADO; may trigger AmendmentBead creation if `triggers_amendment=true` |
| `getOpenAmendments` | `orgId` | `Promise<AmendmentBeadContent[]>` | 🟢 CONFIRMADO |
| `checkConsent` | `sessionId, action` | `Promise<boolean>` | 🟢 CONFIRMADO |

#### Call Sequences

**Session open — I2 retrieval sequence:**
1. SDK caller: `openSession(orgId, roleId, agentId)` → writes `session:{sessionId}` KV entry, sets `autonomyFloor`
2. SDK caller: `retrieveKnowingState(sessionId, category?)` → calls DO RPC → `BQ.retrieveKnowingState(sql, orgId, roleId, category?)` → returns `{ policy, trustedSubjects, consent }`
3. SDK sets `session.ksRetrievedAt = Date.now()` in KV
4. Any subsequent `writeExecutionBead` checks `session.ksRetrievedAt` is present before proceeding

**Execution write sequence:**
1. `writeExecutionBead(sessionId, payload)` → check `session.ksRetrievedAt` (throws `SessionNotInitialized` if absent)
2. Compute `bead_id = computeBeadId('execution', payload, parentIds)`
3. Build `AuditBead` for same transaction
4. DO: `writeBead(executionBead, auditBead)` → `BEGIN` → INSERT bead → INSERT edges → INSERT auditBead → INSERT audit edge → `COMMIT`
5. `invalidateKV()` for affected keys

**Outcome + amendment trigger sequence:**
1. `writeOutcomeBead(sessionId, executionBeadId, outcome)` → writes OutcomeBead
2. If `outcome.triggers_amendment === true`: SDK creates and writes an AmendmentBead (status=PENDING) referencing the OutcomeBead
3. KV `maintenance:{orgId}` invalidated

**Amendment approval sequence (implied by invariants):**
1. Human (or governance agent) approves amendment → `writeAmendmentBead` with `status: APPROVED`
2. New TrustBead written with `supersedes` edge pointing to prior TrustBead
3. Prior TrustBead NOT modified (INV-BG-004)
4. `head:{orgId}:trust:{subjectId}` KV invalidated

#### Error Paths and Fail-Closed Behaviors

| Error | Trigger | Behavior |
|-------|---------|----------|
| `BeadImmutabilityError` | 🟢 Any UPDATE/DELETE attempted on `beads` table | Throws immediately (INV-BG-001) |
| `BeadIntegrityError` | 🟢 Computed `bead_id` does not match stored id | Throws before write (INV-BG-002) |
| `SessionNotInitialized` | 🟢 `writeExecutionBead()` called before `retrieveKnowingState()` | Throws (INV-BG-003) |
| `AutonomyDegradedError` | 🟢 Execution-level autonomy attempted while `autonomyFloor = SUGGEST` | Throws (INV-BG-008) |
| DO unavailable / consent missing / empty trust set | 🟢 `retrieveKnowingState()` throws | `session.autonomyFloor` degrades to `SUGGEST` (I4 / INV-BG-008) |
| Missing `auditBead` on non-audit write | 🟢 `writeBead()` called without auditBead for non-audit type | Throws `Error('writeBead: auditBead required for type=...')` (INV-BG-007) |
| AuditBead INSERT fails | 🟡 Mid-transaction failure | Full `ROLLBACK`; outer error propagates |

---

### 2. Algorithms

#### Bead-ID Derivation (Content-Addressed Identity)

🟢 CONFIRMADO — `src/bead-id.ts`, function `computeBeadId`:

```
bead_id = SHA-256(type + canonical_json(content) + sorted_join(parent_ids))
```

- `type`: raw string literal (e.g. `'trust'`, `'execution'`)
- `canonical_json`: `JSON.stringify(content, Object.keys(content).sort())` — sorted keys, no whitespace
- `sorted_join`: `[...parentIds].sort().join('')` — alphabetical sort of parent bead_id hex strings, then concatenated (no separator)
- Hash algorithm: Node.js `crypto.createHash('sha256').update(canonical).digest('hex')`
- Determinism guarantee: same content + same parents always yields same ID regardless of insertion order
- Idempotency guarantee: `INSERT OR IGNORE` — writing the same bead twice is a no-op at the storage layer

#### `getCurrentTrustBead` Anti-Join Query

🟢 CONFIRMADO — Finds the "head" TrustBead by excluding any bead that has a `supersedes`-typed edge pointing at it as parent:

```sql
AND NOT EXISTS (
  SELECT 1 FROM bead_edges e
  WHERE e.parent_id = b.id AND e.rel = 'supersedes'
)
```

Tie-broken by `ts DESC LIMIT 1`.

#### `retrieveKnowingState` Composite Query

🟢 CONFIRMADO — Three independent SQL reads composed into one return value:
1. Policy: most recent bead where `scope = roleId OR scope = 'org'`, ordered `ts DESC LIMIT 1`
2. Approved trust: anti-join (no supersedes-child) + `status = 'APPROVED'`; optional filter on `subject_type`; sorted by `trust_score DESC`
3. Consent: `status = 'ACTIVE'` + most recent, ordered `ts DESC LIMIT 1`

#### KV Invalidation Strategy

🟢 CONFIRMADO — Invalidation is mandatory after every write (INV-BG-006). Each KV key has a defined trigger:

| Trigger event | Keys invalidated |
|---------------|-----------------|
| TrustBead write for org/subject | `head:{orgId}:trust:{subjectId}`, `ks:{orgId}:{roleId}:{category}` |
| PolicyBead write for org/role | `policy:{orgId}:{roleId}`, `ks:{orgId}:{roleId}:{category}` |
| ConsentBead write for org/role | `consent:{orgId}:{roleId}` |
| OutcomeBead or AmendmentBead write | `maintenance:{orgId}` |

KV is never authoritative; DO SQLite is the source of truth.

---

### 3. Data Structures

#### TypeScript Interfaces

**`Session`** (SDK layer, `src/sdk.ts`):
```typescript
interface Session {
  sessionId:      string;
  orgId:          string;
  roleId:         string;
  agentId:        string;
  autonomyFloor:  'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL';
  ksRetrievedAt?: number;  // epoch ms; set after retrieveKnowingState()
}
```

**`KnowingState<TrustContent, PolicyContent>`**:
```typescript
interface KnowingState<TrustContent, PolicyContent> {
  policy:          PolicyContent | null;
  trustedSubjects: TrustContent[];
  consent:         { grants: string[] } | null;
  retrievedAt:     number;
}
```

**`TrustEvaluation<TrustContent>`**:
```typescript
interface TrustEvaluation<TrustContent> {
  trusted:    boolean;
  trustBead:  TrustContent | null;
  autonomy:   Autonomy;
}
```

#### SQLite Table Schemas (`migrations/v00_base.ts`)

**`beads`**:
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY (content hash = bead_id) |
| `org_id` | TEXT | NOT NULL |
| `type` | TEXT | NOT NULL |
| `content` | TEXT | NOT NULL; JSON; immutable after write |
| `written_by` | TEXT | NOT NULL |
| `ts` | INTEGER | NOT NULL (epoch ms) |

Indexes: `idx_beads_org_type (org_id, type)`, `idx_beads_org_ts (org_id, ts DESC)`

**`bead_edges`**:
| Column | Type | Constraints |
|--------|------|-------------|
| `child_id` | TEXT | NOT NULL; REFERENCES beads(id) |
| `parent_id` | TEXT | NOT NULL; REFERENCES beads(id) |
| `rel` | TEXT | NOT NULL; values: `'parent'\|'supersedes'\|'audits'\|'escalates'` + domain-specific |
| (composite PK) | | PRIMARY KEY (child_id, parent_id, rel) |

Indexes: `idx_edges_child (child_id)`, `idx_edges_parent (parent_id)`

#### KV Key Patterns and TTLs

| Key pattern | Value shape | TTL | Invalidated by |
|-------------|-------------|-----|----------------|
| `ks:{orgId}:{roleId}:{category}` | `{ trustedSubjects, policy }` | 1 hour | TrustBead or PolicyBead write for org/role/category |
| `head:{orgId}:trust:{subjectId}` | `string` (bead_id) | None (no TTL) | TrustBead write for org/subject |
| `consent:{orgId}:{roleId}` | `{ grants: string[] }` | 15 min | ConsentBead write for org/role |
| `policy:{orgId}:{roleId}` | PolicyBead content (JSON) | 1 hour | PolicyBead write for org/role |
| `session:{sessionId}` | `{ orgId, roleId, agentId, ksRetrievedAt, autonomyFloor }` | 24 hours | Session expiry |
| `maintenance:{orgId}` | `{ lastOutcomeAt, pendingAmendments, score }` | 6 hours | OutcomeBead or AmendmentBead write |

#### Enums

**`Autonomy`** (4 levels):
```typescript
type Autonomy = 'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL';
```

**`TrustStatus`** (4 values): `PENDING | APPROVED | SUSPENDED | REVOKED` — 🟢 CONFIRMADO

**`OutcomeStatus`** (4 values): `SUCCESS | PARTIAL | FAILURE | DISPUTED` — 🟢 CONFIRMADO

**`AmendmentStatus`** (4 values): `PENDING | APPROVED | REJECTED | SUPERSEDED` — 🟢 CONFIRMADO

**`ConsentStatus`** (2 values): `ACTIVE | REVOKED` — 🟢 CONFIRMADO

**`AuditAction`** (5 values): `CREATE | SUPERSEDE | ESCALATE | CONSENT_GRANT | CONSENT_REVOKE` — 🟢 CONFIRMADO

#### Loop Closure Bridge Fields

🟢 CONFIRMADO — Three fields in bead content connect to the Artifact Graph (SPEC-KSP-LOOP-CLOSURE-001):

| Field | Bead type | Links to |
|-------|-----------|----------|
| `artifact_graph_execution_id` | `ExecutionBead` | Artifact Graph Execution node |
| `artifact_graph_divergence_id` | `OutcomeBead` | Artifact Graph Divergence node |
| `artifact_graph_amendment_id` | `AmendmentBead` | Artifact Graph Amendment node |

#### Invariant Summary

| ID | Rule | Error thrown |
|----|------|-------------|
| INV-BG-001 | Write-once — no UPDATE/DELETE on `beads` | `BeadImmutabilityError` |
| INV-BG-002 | Content-addressed identity verified before every write | `BeadIntegrityError` |
| INV-BG-003 | `retrieveKnowingState()` must be called before `writeExecutionBead()` | `SessionNotInitialized` |
| INV-BG-004 | Amendment approval writes new TrustBead + supersedes edge; original unmodified | — |
| INV-BG-005 | ConsentBead revocation writes new Bead with `revokes` pointer; original unmodified | — |
| INV-BG-006 | KV invalidated after every write affecting trust/policy/consent | — |
| INV-BG-007 | AuditBead required in same transaction for every non-audit write | throws `Error` |
| INV-BG-008 | Fail-closed: retrieval failure degrades `autonomyFloor` to SUGGEST | `AutonomyDegradedError` on execution attempt |

#### Package Identity

| Name | Scope | Notes |
|------|-------|-------|
| `@factory/bead-graph` | `packages/bead-graph/` | In Function Factory monorepo |
| `@factory/ksp-sdk` | depends on `@factory/bead-graph` for types | Provisional name; consumed by Factory Mediation Agent DO, ComeFlow, CareTrace |

---

## Module: ksp-factory-graph (packages/factory-graph)
> Source: SPEC-KSP-FACTORY-001.md | Steps: 22–23 (Phase 4) + §3–13 full loop trace
> Also informed by: SPEC-KSP-ARCH-001.md §2–4, §6–7, §9

---

### 1. Control Flow

#### 1.1 Public API — Package Exports

🟢 CONFIRMADO — `packages/factory-graph/` exports (SPEC-KSP-FACTORY-001 §13):

| Export | Source file | Description |
|--------|-------------|-------------|
| `FactoryArtifactGraphDO` | `src/artifact-do.ts` | CF DO subclass of `ArtifactGraphDOBase<Env>` |
| `FactoryBeadGraphDO` | `src/bead-do.ts` | CF DO subclass of `BeadGraphDOBase<Env>` |
| `factoryDivergenceDetector` | `src/detectors.ts` | Injectable `DivergenceDetector` function |
| `factoryHypothesisBuilder` | `src/hypothesis.ts` | Injectable `HypothesisBuilder` function (uses Claude Opus) |
| `factoryAmendmentVerifier` | `src/verifier.ts` | Injectable `AmendmentVerifier` function |
| `*` (all types) | `src/types.ts` | `FACTORY_NODE_TYPES`, `FACTORY_REL_TYPES`, all Zod schemas |

#### 1.2 The Full Loop — Seven-Step Call Sequence

🟢 CONFIRMADO — traced verbatim in SPEC-KSP-FACTORY-001 §7:

**Step 1 — WorkGraph → ArchitectureDecisionBead (Commissioning Agent)**
- Commissioning Agent reads `Specification` node from `ArtifactGraphDO`
- Calls `beadGraphDO.writeBead(archDecisionBead, buildAuditBead(...))`
- Writes KV: `head:{repoId}:arch_decision → archDecisionBead.bead_id`

**Step 2 — Session open: Conducting Agent retrieves knowing-state**
- `sdk.openSession(repoId, 'conducting-agent', agentId)`
- `sdk.retrieveKnowingState(sessionId)` — enforces I2
- Hot path: KV read `ks:{repoId}:conducting-agent:*`
- Cold path: `BeadGraphDO.retrieveKnowingState(repoId, 'conducting-agent')`
- On failure: `session.autonomyFloor = 'SUGGEST'`; no execution permitted

**Step 3 — AtomDirective dispatch → CommitBead + Execution node**
- `LoopClosureService` writes to both layers in same logical operation
- Artifact graph: `Execution` node + `governs` edge from `Specification`
- Bead graph: `CommitBead` with bridge field `artifact_graph_execution_id`

**Step 4a — Outcome (success): TraceFragment → BuildOutcomeBead + ExecutionTrace**
- Artifact graph: `ExecutionTrace` node + `produces` edge from `Execution`
- Bead graph: `BuildOutcomeBead` with `triggers_amendment: false`

**Step 4b — Outcome (divergence): TraceFragment → BuildOutcomeBead + Divergence**
- Artifact graph: `ExecutionTrace` + `produces` + `diverges_from` + `evidences` edges + `Divergence` node
- Bead graph: `BuildOutcomeBead` with `triggers_amendment: true`, `artifact_graph_divergence_id`

**Step 5 — Divergence → Hypothesis + ArchAmendmentBead (Commissioning Agent polls)**
- Commissioning Agent detects `blocking` divergence via poll of Mediation Agent
- Calls `factoryHypothesisBuilder` → Claude Opus (`taskKind: 'synthesis'`)
- Artifact graph: `Hypothesis` + `evidence_for` edge; `Amendment` + `motivates` + `proposes_modification_of` edges
- Bead graph: `ArchAmendmentBead` with `status: 'PENDING'`, `artifact_graph_amendment_id`

**Step 6 — Amendment → VerificationProcess → Verdict**
- `factoryAmendmentVerifier` runs Coherence Verification-Process
- Artifact graph: `VerificationProcess` + `Verdict` nodes; `produces_verdict` + `subject_to` edges
- If `coherenceScore < 0.75` → CRP opened to Architect Agent DO

**Step 7 — Adoption: new Specification + new ArchitectureDecisionBead**
- Artifact graph: new `Specification` node (`v3`); `version_of` + `if_adopted_produces` edges; `ElucidationArtifact` node (INV-KSP-004)
- Bead graph: new `ArchitectureDecisionBead` (`parent_ids: [old.bead_id]`); `supersedes` edge in `bead_edges`
- `ArchAmendmentBead` status updated to `'APPROVED'`
- KV invalidation: DELETE `ks:{repoId}:conducting-agent:*`, `head:{repoId}:arch_decision`, `maintenance:{repoId}`

#### 1.3 Error Paths and Fail-Closed Behaviors

🟢 CONFIRMADO:

| Condition | Behavior |
|-----------|----------|
| `retrieveKnowingState()` throws | `session.autonomyFloor = 'SUGGEST'`; execution-level attempt throws `AutonomyDegradedError` |
| Divergence `severity: 'blocking'` | Auto-suspend counter incremented; at threshold → `/suspend` + We-layer `EscalationBead` |
| Divergence `severity: 'advisory'` | Queue Hypothesis at next poll; no suspend |
| Divergence `severity: 'informational'` | Log only; no governance action |
| INV-* detector spec `severity: 'critical'` fires | Promotes unconditionally to `blocking`; bypasses retry evaluation |
| Coherence Verification fails (`coherenceScore < 0.75`) | CRP opened to Architect Agent DO; no adoption |

---

### 2. Algorithms

#### 2.1 `factoryDivergenceDetector` — Trace-to-Divergence Mapping

🟢 CONFIRMADO — SPEC-KSP-FACTORY-001 §8:

```
Input:  traceNodeId (string), specificationId (string), artifactGraph (ArtifactGraphDOBase)
Output: DetectedDivergence[]

Algorithm:
1. getNode(traceNodeId) → traceNode
2. If null → return []
3. For each firing in trace.detector_firings:
   - Map firing.severity via mapInvSeverity():
     'critical' → 'critical' | 'warning' → 'medium' | * → 'low'
   - Push { claimId: firing.inv_id, description: firing.message, severity }
4. If trace.outcome === 'failure' AND trace.attempts_exhausted:
   - Push { claimId: `claim-atom-outcome-${trace.atom_id}`, severity: 'high' }
5. If trace.outcome === 'timeout' AND trace.attempts_exhausted:
   - Push { claimId: `claim-atom-timeout-${trace.atom_id}`, severity: 'high' }
6. Return divergences[]
```

#### 2.2 `factoryAmendmentVerifier` — Coherence + Cross-Repo Pattern Score

🟢 CONFIRMADO — SPEC-KSP-FACTORY-001 §10:

Thresholds: `coherenceScore >= 0.75` (gate), `patternScore >= 0.5` (gate), `coherenceScore > 0.7` (cross-repo scan trigger).

#### 2.3 `factoryHypothesisBuilder` — LLM-Driven Hypothesis Formation

🟢 CONFIRMADO — SPEC-KSP-FACTORY-001 §9: routes to Claude Opus via `@factory/harness-bridge` default routing. Uses `dispatcher.dispatch({ taskKind: 'synthesis', ... })`.

---

### 3. Data Structures

#### 3.1 TypeScript Types and Constants

🟢 CONFIRMADO — SPEC-KSP-FACTORY-001 §3–4:

```typescript
export const FACTORY_NODE_TYPES = [
  ...CORE_NODE_TYPES,
  'Signal', 'Pressure', 'Capability', 'FunctionProposal', 'PRD', 'WorkGraph',
  'Invariant', 'CoverageReport', 'AtomDirective', 'TraceFragment',
] as const;

export const FACTORY_REL_TYPES = [
  ...CORE_REL_TYPES,
  'source_ref', 'compiles_to', 'instantiates', 'addresses', 'derived_from',
  'dispatched_as', 'produced_trace', 'gate_result',
] as const;
```

#### 3.2 Factory Bead Types

| Bead type name | Universal structural type | `type` literal |
|---------------|--------------------------|----------------|
| `ArchitectureDecisionBead` | PolicyBead | `'arch_decision'` |
| `PatternTrustBead` | TrustBead | `'pattern_trust'` |
| `CommitBead` | ExecutionBead | `'commit'` |
| `BuildOutcomeBead` | OutcomeBead | `'build_outcome'` |
| `ArchAmendmentBead` | AmendmentBead | `'arch_amendment'` |

🟢 CONFIRMADO — §5 of spec.

#### 3.3 Artifact Graph Node Types Written in Factory Loop

| Node type | ID pattern | Created at step |
|-----------|------------|-----------------|
| `Specification` (WorkGraph) | `spec-wg-{id}-v{n}` | Pre-existing / new on adoption (Step 7) |
| `Execution` | `exec-atom-{id}-attempt-{n}` | Step 3 |
| `ExecutionTrace` | `trace-atom-{id}` | Step 4 |
| `Divergence` | `div-{n}` | Step 4b |
| `Hypothesis` | `hyp-{n}` | Step 5 |
| `Amendment` | `amd-{n}` | Step 5 |
| `VerificationProcess` | `vp-{n}` | Step 6 |
| `Verdict` | `verdict-{n}` | Step 6 |
| `ElucidationArtifact` | `ea-{n}` | Step 7 (unconditional — INV-KSP-004) |

#### 3.4 KV Key Patterns

| Key Pattern | Value | Written by | Invalidated by |
|-------------|-------|-----------|----------------|
| `head:{repoId}:arch_decision` | `bead_id` (string) | Commissioning Agent | `adoptAmendment()` |
| `ks:{repoId}:conducting-agent:*` | KnowingState payload | Mediation Agent (SDK) | `adoptAmendment()` |
| `maintenance:{repoId}` | Health score | Mediation Agent | `adoptAmendment()` |

#### 3.5 Package Dependencies (factory-graph)

🟢 CONFIRMADO — SPEC-KSP-ARCH-001 §3:

```
factory-graph → @factory/artifact-graph   (ArtifactGraphDOBase, PathStep, walkBoundedPath)
factory-graph → @factory/bead-graph       (BeadGraphDOBase, computeBeadId, BaseBead, writeBead)
factory-graph → @factory/loop-closure     (LoopClosureConfig, DivergenceDetector,
                                           HypothesisBuilder, AmendmentVerifier,
                                           VerificationResult)
```

#### 3.6 Cloudflare Bindings Required

| Binding type | Usage |
|-------------|-------|
| **CF Durable Object** — `ArtifactGraphDO` (per namespace) | Specification lineage, execution provenance |
| **CF Durable Object** — `BeadGraphDO` (per org) | Bead knowing-state |
| **CF Durable Object** — `Mediation Agent DO` (per repo) | KSP enforcement; CommitBead/BuildOutcomeBead writes |
| **CF Durable Object** — `Architect Agent DO` (Factory singleton) | Cross-repo pattern scan; CRP resolution |
| **CF KV** | Hot cache: `ks:*`, `head:*`, `maintenance:*` |
| **CF R2** | DO SQLite WAL snapshots (automated PITR; 30-day) |

---

## Module: ksp-flue-workflow (.flue/workflows)
> Source: SPEC-FF-JUSTBASH-001-004.md | Steps: 001–004 (full spec)

---

### 1. Control Flow

#### Public API / Entry Points

| Symbol | Signature | Notes |
|--------|-----------|-------|
| `run` | `async (ctx: FlueContext<AtomExecutionPayload, Env>) => { status, outcome? }` | Flue workflow entry point — replaces old `POST /execute` CF Worker |
| `route` | `WorkflowRouteHandler` | Passthrough middleware — `async (_c, next) => next()` |
| `extractWorkspaceDelta` | `async (harness, seedPaths: Set<string>) => Array<{virtualPath, kind, content?}>` | Exported helper: VFS diff after session |

🟢 CONFIRMADO — all three are explicitly exported in the spec code listing.

#### Main Call Sequence in `run()`

```
run(ctx)
  1. Derive deterministic runId = sha256(workGraphId + workGraphVersion)
  2. Resolve CoordinatorDO stub from runId
  3. POST /init on CoordinatorDO  ← idempotent, initializes run context
  4. getNextReady(doStub, moleculeId)
     └─ if no bead → return { status: 'complete' }
  5. AtomDirective.safeParse(bead.payload)
     └─ if invalid → failHook(doStub, bead.id, agentId, ...) → return { status: 'error' }
  6. executeWithRetry(directive, bead.id, agentId, id, env, init)
  7. if trace.outcome === 'success' → releaseHook(doStub, bead.id, ...)
     else                           → failHook(doStub, bead.id, ...)
  8. return { status: 'executed', outcome: trace.outcome }
```

🟢 CONFIRMADO — explicit in spec `run()` body.

#### `executeWithRetry()` Call Sequence

```
executeWithRetry(directive, beadId, agentId, workflowId, env, init)
  for attempt 1..maxAttempts:
    if attempt > 1 → sleep(backoffMs)
    runFlueSession(directive, agentId, workflowId, env, init) → SessionResult
    truncate stdout to 4096 chars, storeFullOutput() → R2 ref if overflow
    evaluateSuccessCondition(directive.successCondition, result, harness) → bool
    derive outcome: 'timeout' | 'success' | 'failure'
    build ConductingAgentTraceFragment
    if success → return immediately
    if !isolatedRetry OR attempt >= maxAttempts → break
  return lastTrace
```

🟢 CONFIRMADO.

#### `runFlueSession()` — Five Flue Bridge Points

```
runFlueSession(directive, agentId, workflowId, env, init)
  1. PROFILE_BY_ROLE[directive.role]           → AgentProfile
  2. createAgent(({ id, env }) => AgentRuntimeConfig)
       with sandbox if needsContainer else without sandbox
  3. init(agent)                               → FlueHarness    [ctx.init bridge]
  4. if AGENTS_MD: harness.fs.writeFile('AGENTS.md', agentsMd)
  5. harness.session('atom-{directiveId}')     → FlueSession
  6. Promise.race([
       session.skill(directive.skillRef, { args: { instruction } }),
       sleep(timeoutMs)
     ])
  → return { stdout, timedOut, durationMs, harness }
```

🟢 CONFIRMADO. `needsContainer` = `permittedTools.includes('git') || sandboxConfig.persistFilesystem`.

---

### 2. Algorithms

#### Deterministic Coordinator DO Key (GD-002)

```
runId = sha256(workGraphId + workGraphVersion).hex()
doId  = COORDINATOR_DO.idFromName(`coordinator:${runId}`)
```

🟢 CONFIRMADO.

#### SuccessCondition Evaluation

| Type | Algorithm |
|------|-----------|
| `exit-code` | `!result.timedOut` |
| `output-contains` | `result.stdout.includes(condition.substring)` |
| `output-matches` | `new RegExp(condition.pattern).test(result.stdout)` |
| `file-exists` | `harness.shell('test -f {path} && echo exists')` → check `stdout.trim() === 'exists'` |
| `composite` | `Promise.all(condition.all.map(c => evaluateSuccessCondition(c,...)))` → `.every(Boolean)` |

🟢 CONFIRMADO.

#### stdout Truncation + R2 Overflow

```
rawOutput        = result.stdout.slice(0, 4096)
sandboxOutputRef = if result.stdout.length > 4096
                   then storeFullOutput(stdout, directiveId, env) → `r2://${key}`
                   else undefined
```

R2 key pattern: `sandbox-output/{directiveId}/{Date.now()}.txt`

🟢 CONFIRMADO.

---

### 3. Data Structures

#### `AtomExecutionPayload` (workflow input)

```typescript
interface AtomExecutionPayload {
  repoId:           string
  agentId:          string
  workGraphId:      string
  workGraphVersion: string
  moleculeId:       string
}
```

#### `ConductingAgentTraceFragment` (output / bead payload)

```typescript
interface ConductingAgentTraceFragment {
  executionId:      string   // `${beadId}-attempt-${attempt}`
  directiveId:      string
  atomRef:          string
  workGraphVersion: string
  repoId:           string
  outcome:          'success' | 'failure' | 'timeout'
  rawOutput:        string   // truncated to 4096 chars
  sandboxOutputRef: string | undefined
  durationMs:       number
  attemptNumber:    number
  producedAt:       string   // ISO 8601
}
```

#### `AtomDirective` Schema — New Fields

```typescript
skillRef: z.string().min(1)   // declared skill name passed to session.skill()
role: z.enum(['planner', 'coder', 'critic', 'tester', 'verifier'])
```

Both populated by Mediation Agent compile step from `Gear.skillRef` / `Gear.role`.

#### `AgentProfile` Definitions (PROFILE_BY_ROLE)

| Role | Model |
|------|-------|
| `planner` | `anthropic/claude-opus-4-6` |
| `coder` | `anthropic/claude-opus-4-6` |
| `critic` | `openai/gpt-5.5` |
| `tester` | `openai/gpt-5.5` |
| `verifier` | `openai/gpt-5.5` |

#### Env Bindings Required

| Binding | Type | Purpose |
|---------|------|---------|
| `COORDINATOR_DO` | DurableObjectNamespace | CoordinatorDO for bead claim/release/fail + init |
| `SANDBOX_OUTPUT_BUCKET` | R2Bucket | Overflow stdout storage |
| `Sandbox` | DurableObjectNamespace | CF Container sandbox identity |
| `ANTHROPIC_API_KEY` | string (secret) | Anthropic API auth injected by Sandbox |
| `OPENAI_API_KEY` | string (secret) | OpenAI API auth |
| `DEEPSEEK_API_KEY` | string (secret) | DeepSeek API auth |
| `GITHUB_TOKEN` | string (secret) | GitHub API auth |

#### Packages Retired by This Spec

| Retired | Replaced by |
|---------|-------------|
| Gas City (GAS_CITY_SUPERVISOR_URL) | Coordinator DO + Flue workflow |
| `@factory/harness-bridge` | `@flue/runtime` direct |
| `@factory/runtime` stub | `@flue/runtime` direct |
| `deriveRole()` heuristic | `directive.role` field (explicit, from Gear.role) |
| pi-coding-agent | Subsumed into role-based AgentProfile dispatch |

---

## Module: ksp-gears (@factory/gears)
> Source: SPEC-FF-GEARS-001.md | SPEC-KSP-LOOP-CLOSURE-001.md (Bridge Point 3)
> Replaces: @factory/harness-bridge (retired), @factory/runtime stub (retired), Gas City JSONL + flock task store (retired)

---

### 1. Control Flow

#### 1.1 Public API — `src/beads/hook.ts`

🟢 CONFIRMADO — Signatures explicit in spec §7:

```typescript
claimHook(stub: DurableObjectStub, beadId: string, agentId: string): Promise<ExecutionBead | null>
releaseHook(stub: DurableObjectStub, beadId: string, agentId: string, result: string): Promise<void>
failHook(stub: DurableObjectStub, beadId: string, agentId: string, result: string): Promise<void>
getNextReady(stub: DurableObjectStub, moleculeId: string): Promise<ExecutionBead | null>
```

#### 1.2 CoordinatorDO HTTP Route Table

🟢 CONFIRMADO — Routes defined in spec §7b:

| Method | Path | Handler |
|--------|------|---------|
| POST | `/init` | `initRun(runId, orgId)` |
| POST | `/claim` | `claimBead(beadId, agentId)` |
| POST | `/release` | `releaseBead(beadId, agentId, result)` |
| POST | `/fail` | `failBead(beadId, agentId, result)` |
| POST | `/next` | `getNextReady(moleculeId)` |

#### 1.3 Call Sequence — Atom execution (happy path)

🟢 CONFIRMADO (assembled from §7b + §9 + SPEC-KSP-LOOP-CLOSURE-001 §2 Bridge Point 3):

1. `atom-execution.ts` (Flue workflow) calls `CoordinatorDO /init` once per run → `initRun(runId, orgId)` persists to DO storage
2. `atom-execution.ts` calls `getNextReady(moleculeId)` → returns first `ready` bead with no unfinished parents
3. `atom-execution.ts` calls `claimHook(stub, beadId, agentId)` → atomic CAS `status='ready'→'in_progress'`; increments `attempt_count`
4. Flue workflow executes agent with `PROFILE_BY_ROLE[directive.role]` and `session.skill(directive.skillRef)`
5. On success: `releaseHook(stub, beadId, agentId, resultJson)` → `releaseBead()`:
   a. SQL UPDATE `status='done'`
   b. `writeAudit()` → D1 `bead_audit` insert
   c. `recordOutcome()` → `LoopClosureService.recordOutcome()` (Bridge Point 3)
6. On failure: `failHook(stub, beadId, agentId, resultJson)` → `failBead()`, same audit + loop-closure path with verdict `'failed'`

#### 1.4 Stalled Bead Recovery (DO alarm)

🟢 CONFIRMADO — spec §7 `CoordinatorDO.alarm()`:

- Alarm fires every 5 minutes
- Re-queues beads `status='in_progress'` with `updated_at < (now - 5min)` → `status='ready', assigned_to=NULL`
- Re-arms itself: `ctx.storage.setAlarm(now + 5min)`

#### 1.5 `recordOutcome` → Bridge Point 3 (LoopClosureService)

🟢 CONFIRMADO — spec §7b + SPEC-KSP-LOOP-CLOSURE-001 §2:

Called from `releaseBead()` and `failBead()`. Constructs namespace `factory:{orgId}:{runId}`, instantiates `LoopClosureService` with `factoryDivergenceDetector`, `factoryHypothesisBuilder`, `factoryAmendmentVerifier`, then calls:

```typescript
loopClosure.recordOutcome(beadId, beadId, {
  status:        verdict === 'done' ? 'SUCCESS' : 'FAILURE',
  summary:       trace.rawOutput?.slice(0, 500) ?? '',
  toolCallCount: 0,
})
```

Guard: if `runId` or `orgId` is empty (before `initRun()` called) → skip silently.

---

### 2. Algorithms

#### 2.1 `runId` Derivation (GD-002)

🟢 CONFIRMADO:

```
runId = SHA-256(workGraphId + workGraphVersion)
```

Deterministic and re-attachable after crash. DO key: `coordinator:{runId}`.

#### 2.2 Dependency-Aware Ready-Bead Selection

🟢 CONFIRMADO — spec §7b:

```sql
SELECT b.* FROM execution_beads b
WHERE b.molecule_id=? AND b.status='ready'
  AND NOT EXISTS (
    SELECT 1 FROM bead_edges e
    JOIN execution_beads p ON p.id=e.parent_id
    WHERE e.child_id=b.id AND p.status != 'done'
  )
ORDER BY b.created_at ASC LIMIT 1
```

FIFO within a molecule; respects DAG ordering. Single-writer DO guarantees no concurrent claim race.

#### 2.3 Atomic Claim (Compare-and-Swap via SQLite)

🟢 CONFIRMADO — spec §7:

| Operation | SQL pattern |
|-----------|-------------|
| Claim | `UPDATE … SET status='in_progress', assigned_to=?, attempt_count=attempt_count+1 WHERE id=? AND status='ready' RETURNING *` |
| Release success | `UPDATE … SET status='done', result=? WHERE id=? AND assigned_to=?` |
| Release failure | `UPDATE … SET status='failed', result=? WHERE id=? AND assigned_to=?` |
| Re-hook (crash) | `UPDATE … SET status='ready', assigned_to=NULL WHERE assigned_to=?` |

---

### 3. Data Structures

#### 3.1 Core Interfaces

🟢 CONFIRMADO — spec §4:

```typescript
interface Gear {
  id:           string          // GEAR-* content-addressed hash
  name:         string
  role:         RoleName        // 'planner'|'coder'|'critic'|'tester'|'verifier'
  modelBinding: RoleModelBinding
  skillRef:     string
  toolPolicy:   ToolPolicy
  beadType:     string
  source_refs:  SourceRef[]
}

interface GearFormula {
  id:          string           // FORMULA-*
  name:        string
  gearIds:     string[]
  edges:       Array<{ from: string; to: string; type: string }>
  source_refs: SourceRef[]
}

interface GearMolecule {
  id:          string           // MOLECULE-*
  formulaId:   string
  runId:       string
  beadIds:     string[]
  status:      'active' | 'done' | 'failed'
  source_refs: SourceRef[]
}
```

#### 3.2 ExecutionBead Zod Schema

🟢 CONFIRMADO — spec §7a:

```typescript
ExecutionBead = z.object({
  id:            z.string(),
  molecule_id:   z.string(),
  gear_id:       z.string(),
  node_id:       z.string(),
  status:        z.enum(['ready', 'in_progress', 'done', 'failed']),
  assigned_to:   z.string().nullable(),
  attempt_count: z.number().int(),
  payload:       z.string().nullable(),   // JSON: AtomDirective
  result:        z.string().nullable(),   // JSON: ConductingAgentTraceFragment
  created_at:    z.number().nullable(),
  updated_at:    z.number().nullable(),
})
```

#### 3.3 Coordinator DO SQLite Schema

🟢 CONFIRMADO — spec §7:

**`execution_beads`**

| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| molecule_id | TEXT | NOT NULL |
| gear_id | TEXT | NOT NULL |
| node_id | TEXT | NOT NULL |
| status | TEXT | NOT NULL DEFAULT 'ready' |
| assigned_to | TEXT | nullable |
| attempt_count | INTEGER | DEFAULT 0 |
| payload | TEXT | nullable — JSON AtomDirective |
| result | TEXT | nullable — JSON ConductingAgentTraceFragment |
| created_at | INTEGER | nullable |
| updated_at | INTEGER | nullable |

**`bead_edges`**

| Column | Type | Constraints |
|--------|------|-------------|
| parent_id | TEXT | NOT NULL, PK part |
| child_id | TEXT | NOT NULL, PK part |
| — | — | PRIMARY KEY (parent_id, child_id) |

#### 3.4 D1 Cross-Run Audit Log Schema

🟢 CONFIRMADO — spec §7 (`bead_audit` table in D1 database `factory-bead-audit`):

| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT |
| run_id | TEXT | NOT NULL |
| bead_id | TEXT | NOT NULL |
| gear_id | TEXT | NOT NULL |
| agent_id | TEXT | NOT NULL |
| verdict | TEXT | NOT NULL — 'done'\|'failed'\|'timed_out' |
| attempt | INTEGER | NOT NULL |
| ts | INTEGER | NOT NULL |

#### 3.5 CoordinatorDO Env Bindings

🟢 CONFIRMADO — spec §7b + §11:

```typescript
interface Env {
  D1_AUDIT:       D1Database
  ARTIFACT_GRAPH: DurableObjectNamespace<FactoryArtifactGraphDO>
  BEAD_GRAPH:     DurableObjectNamespace<FactoryBeadGraphDO>
  KV:             KVNamespace
}
```

#### 3.6 ID Prefixes / Constants

| Entity | ID prefix |
|--------|-----------|
| Gear | `GEAR-*` |
| GearFormula | `FORMULA-*` |
| GearMolecule | `MOLECULE-*` |
| runId | SHA-256(workGraphId + workGraphVersion) |
| DO storage key | `coordinator:{runId}` |
| LoopClosure namespace | `factory:{orgId}:{runId}` |
| `staleMs` (DO alarm) | `5 * 60 * 1000` (5 minutes) |

#### 3.7 Package Relationships

| Package | Rel | Note |
|---------|-----|------|
| `@factory/schemas` | DEPENDENCY | `RoleName`, `RoleModelBinding`, `ToolPolicy`, `AtomDirective`. Never inverted. |
| `@factory/ksp-sdk` | DEPENDENCY | Coordinator DO is one KS SDK instantiation. |
| `@koales/artifact-graph` | DEPENDENCY | `FactoryArtifactGraphDO` extends `ArtifactGraphDOBase`. |
| `@koales/bead-graph` | DEPENDENCY | `FactoryBeadGraphDO` extends `BeadGraphDOBase`. |
| `@koales/loop-closure` | DEPENDENCY | `LoopClosureService` wired in `releaseBead()`/`failBead()`. |
| `@factory/harness-bridge` | RETIRED | Delete package. |
| `@factory/runtime` | RETIRED | Delete stub. |

---

## Module: ksp-loop-closure (@factory/loop-closure)
> Source: SPEC-KSP-LOOP-CLOSURE-001.md | Steps: 22–26 (Bridge Points 1–5)

---

### 1. Control Flow

#### Public API — `LoopClosureService`

🟢 CONFIRMADO — explicit class definition in §4.

| Method | Parameters | Return Type |
|--------|-----------|-------------|
| `constructor` | `config: LoopClosureConfig` | `LoopClosureService` |
| `openSession` | `orgId: string, roleId: string, agentId: string, ns: string` | `Promise<Session>` |
| `recordExecution` | `sessionId: string, payload: ExecutionContent` | `Promise<{ executionBeadId: string; executionNodeId: string }>` |
| `recordOutcome` | `sessionId: string, executionBeadId: string, outcome: OutcomeContent` | `Promise<{ divergenceId?: string; outcomeBeadId: string }>` |
| `proposeAmendment` | `divergenceId: string, outcomeBeadId: string, orgId: string` | `Promise<{ amendmentId: string; amendmentBeadId: string }>` |
| `adoptAmendment` | `amendmentId: string, amendmentBeadId: string, reviewer: string, verificationResult: VerificationResult` | `Promise<{ newSpecId: string; newBeadId: string } \| { rejected: true }>` |

#### The Five Bridge Points

**Bridge Point 1 — `openSession` (Specification governs ExecutionBead)**

🟢 CONFIRMADO

```
SDK.openSession()
  ├── beadGraphDO.retrieveKnowingState(orgId, roleId, category)
  ├── artifactGraphDO.getActiveSpecification(ns, domain)
  └── kvStore.put(`session:${sessionId}`, JSON.stringify({...}))
```

**Bridge Point 2 — `recordExecution` (ExecutionBead → Execution node)**

🟢 CONFIRMADO — sequential steps with partial-failure recovery:
```
Step 1: artifactGraphDO.upsertNode(executionId, 'Execution', {...})
Step 1b: artifactGraphDO.upsertEdge(activeSpecificationId, executionId, 'governs')
Step 2: beadGraphDO.writeBead(execBead, auditBead)   ← includes artifact_graph_execution_id
```
Error: Step 1 succeeds + Step 2 fails → orphan Execution node; idempotent retry on next session.

**Bridge Point 3 — `recordOutcome` (ExecutionTrace → OutcomeBead)**

🟢 CONFIRMADO
```
Step 1: artifactGraphDO.upsertNode(traceId, 'ExecutionTrace', {...})
        artifactGraphDO.upsertEdge(executionNodeId, traceId, 'produces')
Step 2: detectDivergences(traceId, activeSpecificationId, artifactGraphDO)
        if divergences: upsertNode Divergence + edges
Step 3: beadGraphDO.writeBead(outcomeBead, auditBead)
```

**Bridge Point 4 — `proposeAmendment` (Divergence triggers AmendmentBead)**

🟢 CONFIRMADO
```
Step 1: artifactGraphDO — Hypothesis node, evidence_for edge, Amendment node, motivates edge, proposes_modification_of edge
Step 2: beadGraphDO.writeBead(amendmentBead, auditBead)
```

**Bridge Point 5 — `adoptAmendment` (new Specification + new TrustBead/PolicyBead)**

🟢 CONFIRMADO — six sequential steps, all must complete before new Specification is active:
```
Step 1: Verification — upsertNode(VerificationProcess + Verdict), produce_verdict + subject_to edges
        if !passed → rejectAmendment(); return { rejected: true }
Step 2: upsertNode new Specification (version incremented) + version_of + if_adopted_produces edges
Step 3: upsertNode ElucidationArtifact (Axiom A9 — mandatory) + produced_at edge
Step 4: beadGraphDO.writeBead(newBead, auditBead) — TrustBead/PolicyBead + supersedes edge
Step 5: invalidateKV(orgId, targetType, targetBeadId)
Step 6: beadGraphDO.writeBead(approvedAmendmentBead, auditBead)
```

---

### 2. Data Structures

#### TypeScript Interfaces

**`LoopClosureConfig`** 🟢 CONFIRMADO

```typescript
export interface LoopClosureConfig {
  artifactGraphDO: ArtifactGraphDOBase<unknown>;
  beadGraphDO:     BeadGraphDOBase<unknown>;
  kvStore:         KVNamespace;
  detectDivergences: DivergenceDetector;
  buildHypothesis:   HypothesisBuilder;
  verifyAmendment:   AmendmentVerifier;
}
```

**`DetectedDivergence`** 🟢 CONFIRMADO

```typescript
export interface DetectedDivergence {
  claimId:     string;
  description: string;
  severity:    'low' | 'medium' | 'high' | 'critical';
}

export type DivergenceDetector = (
  traceNodeId:     string,
  specificationId: string,
  artifactGraph:   ArtifactGraphDOBase<unknown>
) => Promise<DetectedDivergence[]>;
```

#### Artifact Graph Node Schemas (written by this module)

| Node type | Data fields |
|-----------|------------|
| `Execution` | `{ session_id, agent_id, started, domain }` |
| `ExecutionTrace` | `{ session_id, tool_calls, outcome, summary }` |
| `Divergence` | `{ claim_id, description, severity, detected_at }` |
| `Hypothesis` | `{ fault_attribution, explanation, confidence }` |
| `Amendment` | `{ proposed_change, status: 'candidate'\|'APPROVED'\|'REJECTED' }` |
| `VerificationProcess` | `{ gate, evaluated_at }` |
| `Verdict` | `{ outcome: 'favorable'\|'unfavorable', gate, score }` |
| `Specification` (post-adoption) | `{ artifact_id, version, content_hash, explicitness: 'derived', source_refs }` |
| `ElucidationArtifact` | `{ selected_option, rejected_options, assumptions, risks_accepted }` |

#### Bridge Field Definitions

🟢 CONFIRMADO:

| Bead Type | Bridge Field | Target Node Type |
|-----------|-------------|-----------------|
| `ExecutionBead` | `artifact_graph_execution_id` | `Execution` |
| `OutcomeBead` | `artifact_graph_divergence_id` | `Divergence` (nullable) |
| `AmendmentBead` | `artifact_graph_amendment_id` | `Amendment` |
| `TrustBead` / `PolicyBead` (post-adoption) | `artifact_graph_specification_id` | `Specification` |

All bridge fields are optional — older Beads without them remain valid (INV-LC-002).

#### Module File Layout

🟢 CONFIRMADO:

```
packages/loop-closure/
  src/
    types.ts          — LoopClosureConfig, Session, DetectedDivergence, DivergenceDetector,
                        HypothesisBuilder, AmendmentVerifier, VerificationResult
    bridge-fields.ts  — helpers to build bridge-field-annotated content objects
    service.ts        — LoopClosureService (five bridge point methods)
  index.ts
```

#### Invariants (INV-LC-*)

| ID | Summary |
|----|---------|
| INV-LC-001 | No direct storage coupling — all cross-layer writes go through `LoopClosureService` |
| INV-LC-002 | Bridge fields are optional — Bead invariants hold without them |
| INV-LC-003 | Artifact graph write precedes Bead graph write at Bridge Point 2; orphan node recovery via idempotent retry |
| INV-LC-004 | Amendment adoption is atomic at the semantic level — all 5 steps of Bridge Point 5 must complete before new Spec is active |
| INV-LC-005 | ElucidationArtifact written on every adoption (Axiom A9 — Elucidation Obligation); skipping is a structural error |
| INV-LC-006 | KV invalidated (Step 5) before adoption result is returned; stale-cache fallback is DO SQLite head-bead lookup |

#### Domain Instantiation Callers

| Domain | Caller | Bridge Points triggered |
|--------|--------|------------------------|
| Factory | Commissioning Agent | All 5 |
| ComeFlow | outcomeHandler (event handler) | All 5 |
| CareTrace | PAA (Proactive Assistance Agent) | All 5 |

---

## Module: ksp-sdk (@factory/ksp-sdk)
> Source: SPEC-KSP-BEAD-GRAPH-001.md §8 | Steps: 12 (impl ordering) | Bead types: 8

---

### 1. Control Flow

#### Public API — `KnowingStateSDK<PolicyContent, TrustContent, ExecutionContent, OutcomeContent>`

| Method | Parameters | Return | Notes |
|--------|-----------|--------|-------|
| `openSession` | `orgId, roleId, agentId` | `Promise<Session>` | Creates session; sets `autonomyFloor`; writes `session:{sessionId}` KV (24h TTL) |
| `closeSession` | `sessionId` | `Promise<void>` | Clears KV session entry |
| `retrieveKnowingState` | `sessionId, category?` | `Promise<KnowingState<TrustContent, PolicyContent>>` | I2 enforcement — MUST be called before any `writeExecutionBead()` |
| `evaluateTrust` | `sessionId, subjectId` | `Promise<TrustEvaluation<TrustContent>>` | Returns `{ trusted, trustBead, autonomy }` |
| `writeExecutionBead` | `sessionId, payload: ExecutionContent` | `Promise<string>` (bead_id) | Asserts `session.ksRetrievedAt` is set (INV-BG-003); throws `SessionNotInitialized` if not |
| `writeOutcomeBead` | `sessionId, executionBeadId, outcome: OutcomeContent` | `Promise<string>` (bead_id) | MAY trigger AmendmentBead when `triggers_amendment: true` |
| `getOpenAmendments` | `orgId` | `Promise<AmendmentBeadContent[]>` | All PENDING amendments for org |
| `checkConsent` | `sessionId, action` | `Promise<boolean>` | Checks active ConsentBead for session's roleId |

#### Session Lifecycle (happy path)

```
openSession(orgId, roleId, agentId)
  → autonomyFloor = from PolicyBead OR default SUGGEST; KV session:{sessionId} written (24h)

retrieveKnowingState(sessionId, category?)
  → KV read: ks:{orgId}:{roleId}:{category} (1h cache); MISS → DO SQLite query
  → Sets session.ksRetrievedAt
  → Returns KnowingState<TrustContent, PolicyContent>

evaluateTrust(sessionId, subjectId)
  → KV read: head:{orgId}:trust:{subjectId}; MISS → getCurrentTrustBead() DO SQLite

checkConsent(sessionId, action)
  → KV read: consent:{orgId}:{roleId} (15min cache); MISS → getActiveConsent() DO SQLite

writeExecutionBead(sessionId, payload)
  → Assert session.ksRetrievedAt is set (throws SessionNotInitialized)
  → Assert autonomyFloor allows execution (throws AutonomyDegradedError)
  → computeBeadId(type, content, parentIds)
  → writeBead(bead, auditBead) in BEGIN/COMMIT transaction
  → invalidateKV() for affected KV keys
  → Returns bead_id

writeOutcomeBead(sessionId, executionBeadId, outcome)
  → computeBeadId(type, content, [executionBeadId])
  → writeBead(outcomeBead, auditBead) in BEGIN/COMMIT
  → if outcome.triggers_amendment → write AmendmentBead (new Bead, no update to target)
  → invalidateKV() maintenance:{orgId}
  → Returns bead_id
```

#### Error Paths (INV-BG-008)

| Scenario | Behavior |
|----------|----------|
| `retrieveKnowingState()` throws (DO unavailable / consent missing / empty trust) | 🟢 `session.autonomyFloor` set to `SUGGEST` |
| `writeExecutionBead()` called without prior `retrieveKnowingState()` | 🟢 throws `SessionNotInitialized` |
| Execution-level autonomy attempted while floor is `SUGGEST` | 🟢 throws `AutonomyDegradedError` |
| `writeBead()` without `auditBead` (non-audit type) | 🟢 throws `Error: auditBead required for type=...` |
| `writeBead()` INSERT fails | 🟢 ROLLBACK in catch; error re-thrown |
| Duplicate bead write (same content-hash) | 🟢 `INSERT OR IGNORE` — idempotent |

---

### 2. Data Structures

#### TypeScript Interfaces

```typescript
type Autonomy = 'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL';

interface Session {
  sessionId:     string;
  orgId:         string;
  roleId:        string;
  agentId:       string;
  autonomyFloor: Autonomy;
  ksRetrievedAt?: number;  // epoch ms; set by retrieveKnowingState()
}

interface KnowingState<TrustContent, PolicyContent> {
  policy:          PolicyContent | null;
  trustedSubjects: TrustContent[];
  consent:         { grants: string[] } | null;
  retrievedAt:     number;
}

interface TrustEvaluation<TrustContent> {
  trusted:   boolean;
  trustBead: TrustContent | null;
  autonomy:  Autonomy;
}
```

#### Zod Schemas — All 8 Bead Types

**BaseBead** (base for all): `bead_id`, `org_id`, `type`, `parent_ids: string[]`, `written_by`, `ts: number` (epoch ms).

**PolicyBead** (`type: 'policy'`): `content.scope`, `content.rules`, `content.autonomy: Autonomy`, `content.effective_at` (ISO8601), `content.expires_at?`

**TrustBead** (`type: 'trust'`): `content.subject_id`, `content.subject_type`, `content.status: TrustStatus`, `content.trust_score: 0–1`, `content.rationale`, `content.evidence_refs: string[]`, `content.expiry?`

**ExecutionBead** (`type: 'execution'`): `content.subject_id`, `content.action`, `content.autonomy_level: Autonomy`, `content.trust_bead_id`, `content.policy_bead_id`, `content.rationale`, `content.artifact_graph_execution_id?`

**OutcomeBead** (`type: 'outcome'`): `content.execution_bead_id`, `content.status: OutcomeStatus`, `content.summary`, `content.metrics?`, `content.triggers_amendment: boolean`, `content.artifact_graph_divergence_id?`

**AmendmentBead** (`type: 'amendment'`): `content.target_bead_id`, `content.target_type: 'trust'|'policy'`, `content.proposed_change`, `content.rationale`, `content.triggered_by`, `content.status: AmendmentStatus`, `content.reviewed_by?`, `content.reviewed_at?`, `content.if_approved_produces?`, `content.artifact_graph_amendment_id?`

**ConsentBead** (`type: 'consent'`): `content.role_id`, `content.grants: string[]`, `content.status: 'ACTIVE'|'REVOKED'`, `content.granted_by`, `content.granted_at`, `content.expires_at?`, `content.revokes?`

**EscalationBead** (`type: 'escalation'`): `content.trigger_bead_id`, `content.reason`, `content.escalated_to`, `content.resolved_at?`, `content.resolution?`, `content.resolution_bead_id?`

**AuditBead** (`type: 'audit'`): `content.audited_bead_id`, `content.audited_type`, `content.action: AuditAction`, `content.actor_id`, `content.session_id`, `content.ts: number`

**AnyBead**: Zod `discriminatedUnion('type', [...])` across all 8 types.

#### KV Key Patterns and TTLs

| Key pattern | TTL | Invalidated by |
|-------------|-----|----------------|
| `ks:{orgId}:{roleId}:{category}` | 1 hour | TrustBead or PolicyBead write |
| `head:{orgId}:trust:{subjectId}` | None | TrustBead write |
| `consent:{orgId}:{roleId}` | 15 min | ConsentBead write |
| `policy:{orgId}:{roleId}` | 1 hour | PolicyBead write |
| `session:{sessionId}` | 24 hours | Session expiry |
| `maintenance:{orgId}` | 6 hours | OutcomeBead or AmendmentBead write |

#### Domain Instantiation Aliases

| Structural type | Commerce (ComeFlow) | Clinical (CareTrace) | Software Eng (Factory) |
|-----------------|---------------------|---------------------|------------------------|
| PolicyBead | OrgPreferenceBead | ProtocolBead | ArchitecturePolicyBead |
| TrustBead | VendorTrustBead | ClinicalGuidelineBead | DependencyTrustBead |
| ExecutionBead | PurchaseBead | ClinicalDecisionBead | CommitBead |
| OutcomeBead | OutcomeBead | ClinicalOutcomeBead | DeploymentOutcomeBead |
| AmendmentBead | AmendmentBead | ProtocolAmendmentBead | ArchitectureAmendmentBead |

#### Error Types

| Error | Thrown by | Condition |
|-------|-----------|-----------|
| `BeadImmutabilityError` | `writeBead()` | UPDATE or DELETE attempted on beads table |
| `BeadIntegrityError` | Pre-write check | Computed `bead_id` does not match provided `bead_id` |
| `SessionNotInitialized` | `writeExecutionBead()` | `session.ksRetrievedAt` not set |
| `AutonomyDegradedError` | `writeExecutionBead()` | Execution-level autonomy requested while `autonomyFloor = 'SUGGEST'` |

#### Prosthesis Invariant → Implementation Mapping

| Invariant | Implementation |
|-----------|---------------|
| I1 — Externalization | Content in DO SQLite + KV; never in executing agent |
| I2 — Retrieval enforcement | `retrieveKnowingState()` called at session open; SDK throws if skipped |
| I3 — Continuous maintenance | OutcomeBead writes trigger amendment evaluation; health tracked in `maintenance:{orgId}` KV |
| I4 — Fail-closed coupling | If `retrieveKnowingState()` fails → `autonomyFloor = 'SUGGEST'`; throws `AutonomyDegradedError` on execution attempt |
