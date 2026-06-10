# Tasks — ff-pipeline

> Unit: ff-pipeline (FactoryPipeline Workflow)
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — Gas City era, D1 migration)

---

## Implementation Tasks

### T-01: Implement Signal Ingestion with Idempotency
**Source:** `workers/ff-pipeline/src/stages/ingest-signal.ts:51-66`
**Behavior:**
- Accept `SignalInput`, validate required fields
- Compute idempotency key: FNV-variant hash over `signalType|source|title|description[:200]`
- Query D1 `documents` table (collection=`specs_signals`) for existing key
- Return existing doc if found (no-op)
- Otherwise: generate `SIG-{timestamp36}-{random4}` key, persist via `db.save()`, return
**Criterion for done:** Two calls with identical input produce one Signal artifact in D1.
**Confidence:** 🟢 CONFIRMADO

### T-02: Implement Pressure Synthesis Stage
**Source:** `workers/ff-pipeline/src/stages/synthesize-pressure.ts`
**Behavior:**
- Call LLM with 'planning' task kind
- Parse JSON response, merge with `{type:'pressure', sourceSignalId, sourceRefs, synthesizedBy:'gdk-ai'}`
- Pass through `signal.specContent` when present
- Persist to D1 `specs_pressures` via `db.save()`
**Criterion for done:** Given a valid Signal, returns a Pressure with category, priority, sourceSignalId.
**Confidence:** 🟢 CONFIRMADO

### T-03: Implement Capability Mapping Stage
**Source:** `workers/ff-pipeline/src/stages/map-capability.ts`
**Behavior:**
- Call LLM with 'planning' task kind
- Parse JSON, merge `{type:'capability', sourcePressureId, sourceRefs, mappedBy:'gdk-ai'}`
- Pass through `pressure.specContent`
- Persist to D1 `specs_capabilities` via `db.save()`
**Criterion for done:** Given a Pressure, returns a Capability with gapAnalysis and sourcePressureId.
**Confidence:** 🟢 CONFIRMADO

### T-04: Implement Function Proposer with Birth Gate
**Source:** `workers/ff-pipeline/src/stages/propose-function.ts`
**Behavior:**
- Two system prompts: SYSTEM_PROMPT (generative) and SPEC_GROUNDED_PROMPT (when specContent present)
- Parse JSON response, coerce birthGateScore and title if missing
- Throw error if `birthGateScore < 0.5`
- Persist to D1 `specs_functions` via `db.save()`
**Criterion for done:** birthGateScore < 0.5 throws; >= 0.5 saves FP artifact.
**Confidence:** 🟢 CONFIRMADO

### T-05: Implement Auto-Approve Logic
**Source:** `workers/ff-pipeline/src/pipeline.ts:171-183`
**Behavior:**
- Check `signal.raw?.autoApprove === true`
- When true: construct inline `approvalPayload`, skip `waitForEvent('architect-approval')`
- When false: `waitForEvent('architect-approval', { timeout: '7 days' })`
**Criterion for done:** autoApprove=true signals skip the 7-day pause and proceed to semantic review.
**Confidence:** 🟢 CONFIRMADO

### T-06: Implement IntentAnchor Crystallization
**Source:** `workers/ff-pipeline/src/stages/crystallize-intent.ts`
**Behavior:**
- Call LLM with 'crystallizer' task kind
- Parse JSON array, validate MIN_ANCHORS and MAX_ANCHORS
- Assign `signal_id`, generate IDs `IA-{signalId}-{nn}`
- Return empty array when crystallizer disabled (fail-open)
**Criterion for done:** Returns 3-6 anchors with probe_question, violation_signal, severity. Returns [] when disabled.
**Confidence:** 🟢 CONFIRMADO

### T-07: Implement File Context Extraction for Compile Grounding
**Source:** `workers/ff-pipeline/src/stages/compile.ts:84-148`
**Behavior:**
- `extractFilePathsFromSpec(specContent)`: regex extracts .ts/.tsx paths, dedup, filter node_modules
- `fetchCompileFileContexts(filePaths, env)`: GitHub Contents API per path (base64 decode), fail-open
- Run `extractContext()` from `@factory/file-context` — returns path + exports + functions only (NOT raw content)
- Pass to `decompose` pass as `existingFiles`
**Criterion for done:** Given specContent with .ts paths, existingFiles injected into decompose pass.
**Confidence:** 🟢 CONFIRMADO

### T-08: Implement 8-Pass Compile Loop with Probe Gate
**Source:** `workers/ff-pipeline/src/stages/compile.ts:1-370`, `pipeline.ts` compile loop
**Behavior:**
- PASS_NAMES: `['decompose','dependency','invariant','interface','binding','validation','assembly','verification']`
- PROBED_PASSES: `['decompose']` only
- MAX_REMEDIATION: 2
- For probed pass with anchors: FOR r in [0..MAX_REMEDIATION]: compile → computeDelta → probeAnchors → reconcile → appendDriftEntry
- Break if verdict != 'remediate'; if verdict == 'escalate': intentViolation=true, break pass loop
- Assembly: deterministic (merges bindings, strips test atoms, saves ES to D1)
- Verification: deterministic (dry-pass only)
- Step names: `compile-verify-{passName}-r{n}` or `compile-{passName}`
**Criterion for done:** decompose pass with block violation remediates up to 2 times then escalates.
**Confidence:** 🟢 CONFIRMADO

### T-09: Implement Coherence Verification Gate Integration
**Source:** `workers/ff-pipeline/src/pipeline.ts` coherence-verification step
**Behavior:**
- Call `this.env.GATES.evaluateCoherenceVerification(compState.executableSpecification)`
- If !passed: persist failure VR to D1 `verification_reports`/`verification_status`, enqueue feedback to FEEDBACK_QUEUE, return captureTerminal
- If passed: persist pass VR, continue to skeleton build
**Criterion for done:** Failed CV halts pipeline with correct status and enqueues feedback.
**Confidence:** 🟢 CONFIRMADO

### T-10: Implement Skeleton Builder
**Source:** `workers/ff-pipeline/src/gascity/skeleton-builder.ts:1-154`
**Behavior:**
- Fetch `https://api.github.com/repos/Wescome/function-factory/tarball/main`
- Upload .tar.gz to R2: `skeletons/{functionId}/{safeTimestamp}.tar.gz`
- Extract HEAD SHA from `x-github-commit-sha` header (truncate to 12 chars)
- Record `SkeletonManifest` to D1 `skeleton_manifests`
- Issue HMAC-SHA256 signed `/skeleton-download` URL (2-hour rolling window)
**Criterion for done:** R2 object exists; D1 skeleton_manifests record exists; signed URL returns the tarball.
**Confidence:** 🟢 CONFIRMADO

### T-11: Implement Execution Packet Assembly
**Source:** `pipeline.ts:513-567`
**Behavior:**
- Generate key `EP-{esKey}`
- Compute SHA-256 of serialized ExecutableSpecification JSON
- Embed skeleton vars: `skeleton_r2_key`, `skeleton_sha`, `workspace_url`
- Define 3 roles: planner, coder, verifier; adapter: `{coding, lang: 'typescript'}`
- Save to D1 `execution_packets` + lineage edge to ES
**Criterion for done:** EP artifact in D1 with correct skeleton vars and SHA checksum.
**Confidence:** 🟢 CONFIRMADO

### T-12: Implement Formula Dispatch with Keepalive
**Source:** `pipeline.ts:570-591`, `formula-compiler-adapter.ts:11-155`
**Behavior:**
- Call `keepalive/start` on GAS_CITY binding (5s timeout, fail-open)
- Call `compileAndDispatchFormula({ ep, factoryAttempt: 1, traceId, env, deps })`
- `buildFormulaCompilerDeps(db, formulaEnv)` — injects all DB operations as dependencies
- Route via `GAS_CITY` service binding
- If outcome != 'dispatched' → terminal `dispatch-failed`
- Call `keepalive/stop` on GAS_CITY binding (fail-open)
**Criterion for done:** Formula dispatch returns outcome='dispatched'; keepalive refcount goes up then down.
**Confidence:** 🟢 CONFIRMADO

### T-13: Implement markFunctionDispatched
**Source:** `workers/ff-pipeline/src/gascity/autonomy-monitor.ts:markFunctionDispatched`
**Behavior:**
- Upsert `specs_functions` record with state=`dispatched`
- Skip if function is already in terminal state: `accepted|monitored|regressed|retired`
**Criterion for done:** After dispatch, specs_functions record has state='dispatched'; subsequent calls with terminal state are no-ops.
**Confidence:** 🟢 CONFIRMADO

### T-14: Implement Feedback Loop with Loop Prevention
**Source:** `workers/ff-pipeline/src/stages/generate-feedback.ts:1-392`
**Behavior:**
- Read feedbackDepth from `parentSignal.raw.feedbackDepth`, default 0
- If feedbackDepth >= 3: return []
- Map synthesis status to feedback subtypes (6 mappings)
- Check 30-minute cooldown via D1 query
- Set autoApprove=true only for `atom-failed` and `orl-degradation`
- Inject feedbackDepth+1 into new signal's raw field
**Criterion for done:** After 3 feedback cycles, no new signals generated.
**Confidence:** 🟢 CONFIRMADO

### T-15: Implement Gas City Webhook Receiver
**Source:** `workers/ff-pipeline/src/gascity/webhook-receiver.ts:1-612`
**Behavior:**
- Verify HMAC-SHA256: header `X-GC-Signature: sha256={hex64}`, constant-time compare
- Idempotency: check D1 `completion_events` by `bead_id`
- Orphan guard: validate dispatch_log entry exists
- Lineage mismatch check: all 6 IDs match dispatch log
- outcome=approved: lifecycle `dispatched → accepted`, write fidelity_verdict + completion_event
- outcome=revise: check factory_attempt > GAS_CITY_MAX_AMENDMENT_DEPTH → incident or revision Signal
- Best-effort keepalive/stop after each callback
**Criterion for done:** Approved webhook updates specs_functions state to 'accepted'; revise at depth creates incident.
**Confidence:** 🟢 CONFIRMADO

### T-16: Implement GovernorAgent Plan-and-Execute Cycle
**Source:** `workers/ff-pipeline/src/agents/governor-agent.ts:1-1025`
**Behavior:**
- Pre-fetch 9 parallel D1 queries (ORL telemetry, pending signals, active pipelines, feedback, memory, orientation, completion ledgers, hot_config, lineage gaps)
- Call LLM planner with all telemetry
- For each GovernanceDecision: run deterministic validator before executing
- Rate limits: max 5 trigger_pipeline, max 3 approve_pipeline per cycle
- `meetsAutoTriggerCriteria`: source=factory:feedback-loop AND feedbackDepth<3 AND autoApprove=true
- Write ORL telemetry to D1 `orl_telemetry` after cycle
**Criterion for done:** Governor cycle runs on cron; auto-trigger fires only on eligible feedback signals; rate limits respected.
**Confidence:** 🟢 CONFIRMADO

### T-17: Implement Gas City Autonomy Monitor
**Source:** `workers/ff-pipeline/src/gascity/autonomy-monitor.ts:1-595`
**Behavior:**
- Full sweep: evaluate `accepted` (persistence check → monitored|incident), `monitored` (freshness check → regressed if stale), stale dispatches (create sev2 incidents), recurring incidents (→ Pressure if count >= threshold)
- All queries via `queryWithTimeout` (8s limit)
- Freshness: `GAS_CITY_PERSISTENCE_FRESHNESS_HOURS` (default 24h)
- Stale: `GAS_CITY_DISPATCH_STALE_MINUTES` (default 60)
**Criterion for done:** Stale dispatch without completion event within 60 min creates sev2 incident in D1 specs_incidents.
**Confidence:** 🟢 CONFIRMADO

### T-18: Wire Lineage Edges
**Source:** `workers/ff-pipeline/src/pipeline.ts` edge-* steps
**Behavior:**
- After each artifact pair: persist edge to D1 `edges` table via `db.saveEdge()`
- PRS → SIG, BC → PRS, FP → BC, ES → FP (type: derived-from / compiled-from)
- EP → ES lineage edge
**Criterion for done:** D1 edges table traversable from any artifact back to its Signal using recursive CTE.
**Confidence:** 🟢 CONFIRMADO
