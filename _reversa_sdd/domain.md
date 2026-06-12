# Domain Model — function-factory

> Phase 3 · Detective · Generated 2026-06-08 · Updated 2026-06-10 (KSP forward run)

---

## Glossary

| Term | Definition | Confidence |
|------|-----------|-----------|
| **Signal (SIG)** | A raw external observation about a domain substrate (market condition, customer request, competitor action, internal metric, regulatory change, or meta/system event). The entry point for all pipeline activity. | 🟢 CONFIRMED — `packages/schemas/src/core.ts:SignalType` |
| **Pressure (PRS)** | The interpreted force a Signal exerts on the system — NOT the signal itself, but what it MEANS for the system. Named, prioritized, categorized. | 🟢 CONFIRMED — synthesize-pressure.ts system prompt |
| **Capability (BC)** | The system ABILITY needed to address a Pressure. Not a solution — the abstract capability. E.g. "The system must be able to cache API responses". | 🟢 CONFIRMED — map-capability.ts system prompt |
| **Function Proposal (FP)** | A concrete, scoped, implementable unit of work derived from a Capability, with an IntentSpecification, acceptance criteria, invariants, scope, and birth gate score. | 🟢 CONFIRMED — propose-function.ts |
| **Intent Specification** | The product requirements document embedded in a FunctionProposal — title, objective, acceptance criteria, invariants, and in/out-of-scope. Input to the compiler. | 🟢 CONFIRMED — propose-function.ts SYSTEM_PROMPT |
| **IntentAnchor (IA)** | A binary yes/no checkpoint crystallized from the Signal's intent. Persists across all compilation passes to guard against intent drift. Has severity: block/warn/log. | 🟢 CONFIRMED — crystallize-intent.ts |
| **Executable Specification (ES/WG)** | The fully compiled, structured work order: atoms, dependencies, invariants, interfaces, validations, repo scope, command policy, compiled lineage. Input to synthesis. | 🟢 CONFIRMED — compile.ts assembly pass |
| **Atom** | A verifiable, independently implementable requirement unit derived from the Intent Specification by the decompose pass. Has id, type (implementation\|config), title, description, verifies, targetFiles. | 🟢 CONFIRMED — compile.ts PASS_PROMPTS.decompose |
| **Coherence Verification (CV)** | The deterministic, fail-closed gate that checks 5 structural properties of an ExecutableSpecification before synthesis begins. | 🟢 CONFIRMED — ff-gates/src/index.ts |
| **TrellisExecutionPacket** | A signed, certified container carrying the ExecutableSpecification to the SynthesisCoordinator. Validated by Zod + hash certification. | 🟢 CONFIRMED — coordinator.ts fetch() |
| **Synthesis** | The process by which a SynthesisCoordinator agent graph (Architect/Planner/Coder/Critic/Tester/Verifier) implements the ExecutableSpecification. | 🟢 CONFIRMED — coordinator.ts |
| **Birth Gate** | The 0-1 confidence score returned by the Function Proposer LLM. Score < 0.5 halts the pipeline immediately. | 🟢 CONFIRMED — propose-function.ts:112-115 |
| **Feedback Loop** | After synthesis, the result generates a new Signal that re-enters the pipeline for self-improvement. Governed by feedbackDepth (max 3) and cooldown (30 min). | 🟢 CONFIRMED — generate-feedback.ts |
| **CRP (Confidence Review Process)** | Auto-generated review item when LLM confidence drops below 0.7 at any stage. Stored in ArangoDB for human review. | 🟢 CONFIRMED — pipeline.ts crp-semantic-review step |
| **Bead** | Gas City's internal work item, equivalent to a task/issue. The bead record itself (id, title, status, deps) is stored in FactoryStore Durable Object SQLite (`beads` table). Pipeline-side bead metadata — dispatch_log, completion_events, fidelity_verdicts — is stored in D1 (ff-factory) via the db-client. These are two distinct stores. | 🟢 CONFIRMED — factory-store-do.ts (bead record), webhook-receiver.ts + autonomy-monitor.ts (pipeline metadata in D1) |
| **D1 (ff-factory)** | Cloudflare serverless SQLite database used for worker operational state: keepalive refcount, dispatch logs, bead metadata. Distinct from ArangoDB which held the artifact graph (now fully replaced by D1). Tables: `documents(collection, key, json, created_at)`, `edges(id, collection, from_id, to_id, data, created_at)`. All collections (specs_signals, dispatch_log, completion_events, fidelity_verdicts, specs_functions, etc.) are stored as rows in `documents` addressed by `(collection, key)`. | 🟢 CONFIRMADO — d1-schema.sql, packages/db-client/src/index.ts, PR #80 |
| **Molecule** | Gas City's execution unit (group of beads). Not defined in pipeline code — 🟡 INFERRED from Gas City context |
| **dryRun** | A pipeline flag disabling all LLM calls and using deterministic stubs. All writes to ArangoDB still occur. | 🟢 CONFIRMED — dryRun checks in every stage |
| **specContent** | Optional ground-truth specification text attached to a Signal. When present, switches all LLM prompts from generation mode to grounded/extraction mode. | 🟢 CONFIRMED — SignalInput.specContent + propose-function.ts |
| **HotConfig** | ArangoDB-backed runtime configuration for model routing, aliases, and feature flags. Loaded on first synthesis, refreshed per-run. | 🟢 CONFIRMED — coordinator.ts:HotConfigLoader |
| **Drift Ledger** | Per-run record of IntentAnchor probe results persisted to ArangoDB for post-analysis. Non-blocking (errors suppressed). | 🟢 CONFIRMED — drift-ledger.ts |
| **Lineage Edge** | A directed ArangoDB edge in `lineage_edges` collection tracing every artifact back to its sources. Types: derived-from, compiled-from, tuned-from, synthesized-from. | 🟢 CONFIRMED — pipeline.ts edge-* steps |

---

## Business Rules

### BR-01: Signal Idempotency
Every Signal is keyed by a hash of `(signalType + source + title + description[:200])`. If a matching Signal already exists in D1 (ff-factory) — queried via `SELECT json FROM documents WHERE collection='specs_signals' AND json_extract(json,'$.idempotencyKey')=?` — the existing document is returned and no new artifact chain is started. Storage was previously ArangoDB; migrated to D1 in PR #80.
- 🟢 CONFIRMED — `ingest-signal.ts:computeIdempotencyKey`, `ingest-signal.ts:db.queryOne` SQL query

### BR-02: Birth Gate (Confidence Threshold)
A Function Proposal with `birthGateScore < 0.5` halts the pipeline with an error. The pipeline does not produce an ExecutableSpecification for low-confidence proposals.
- 🟢 CONFIRMED — `propose-function.ts:112`

### BR-03: Architect Approval Gate (Human-in-the-Loop)
After a Function Proposal is generated, the pipeline waits up to 7 days for an architect-approval event. If the architect rejects, a rejection VerificationReport is persisted and the pipeline terminates with `status: 'rejected'`. Feedback-loop re-entries with `autoApprove: true` skip this gate.
- 🟢 CONFIRMED — `pipeline.ts:architect-approval waitForEvent`

### BR-04: Semantic Review is Advisory (Not Blocking)
A semantic review result of 'miscast' logs a warning but does not halt the pipeline (bootstrap mode). This is marked as a TODO for configurable strict mode.
- 🟢 CONFIRMED — `pipeline.ts` comment: "make this configurable via hot-config"

### BR-05: Coherence Verification is Fail-Closed
Any single failed check in the 5-check Coherence Verification terminates the pipeline with `status: 'coherence-verification-failed'` and triggers the feedback loop.
- 🟢 CONFIRMED — `ff-gates/src/index.ts`

### BR-06: Intent Violation Escalation
If 'block'-severity IntentAnchors are violated after MAX_REMEDIATION (2) attempts, the pipeline terminates with `status: 'synthesis:intent-violation'`. No synthesis is attempted.
- 🟢 CONFIRMED — `pipeline.ts:intentViolation check`

### BR-07: Feedback Loop Depth Cap
Feedback-generated signals carry a `feedbackDepth` counter in `signal.raw`. When depth reaches 3, no further feedback signals are generated. Three additional guard layers: idempotency hash, 30-min cooldown per (functionId, subtype).
- 🟢 CONFIRMED — `generate-feedback.ts:MAX_FEEDBACK_DEPTH = 3`

### BR-08: Test Atoms Are Stripped Before Synthesis
The `assembly` compilation pass filters out atoms with `type === 'test'`. Only implementation and config atoms are included in the ExecutableSpecification. Testing is handled downstream.
- 🟢 CONFIRMED — `compile.ts:runLivePass assembly case`

### BR-09: Invariants Must Be Source-Derived
Both the Function Proposer and the invariant pass prompts include explicit rules: "NEVER fabricate invariants not explicitly stated in the Capability/specification." An invariant without a source is flagged as a hallucination to be rejected by the Critic.
- 🟢 CONFIRMED — `propose-function.ts:SYSTEM_PROMPT invariant rules`

### BR-10: specContent Switches All Prompts to Grounded Mode
When a Signal carries `specContent`, every downstream LLM prompt changes: the Function Proposer uses `SPEC_GROUNDED_PROMPT`, the Semantic Reviewer uses `GROUNDED_SYSTEM_PROMPT`, and the compiler's decompose pass receives `signalContext.specContent`. The spec is the SOLE source of truth.
- 🟢 CONFIRMED — `propose-function.ts`, `semantic-review.ts`, `compile.ts`

### BR-11: Graph Path Deprecated (harness path only)
The SynthesisCoordinator's direct synthesis path (executing agents in-DO) was deprecated per ADR-009. All synthesis now uses the harness path via `/trigger-harness`. The DO returns `interrupt` verdict immediately when called via `/synthesize`.
- 🟢 CONFIRMED — `coordinator.ts` DEPRECATED throw

### BR-12: CRP Auto-Generation on Low Confidence
When semantic review confidence < 0.7 or synthesis verdict confidence < 0.7, a CRP (Confidence Review Process) record is automatically created in ArangoDB for human review.
- 🟢 CONFIRMED — `pipeline.ts:crp-semantic-review`, `coordinator.ts:persistSynthesisResult`

### BR-13: Keepalive is Best-Effort and Non-Blocking
Both keepalive/start (on dispatch) and keepalive/stop (on RELEASE or amendment_halted) are fire-and-forget HTTP calls with a 5-second AbortSignal timeout. A keepalive failure never fails the dispatch or the webhook response. The pipeline treats container warm-state as an operational concern, not a correctness concern.
- 🟢 CONFIRMED — `formula-compiler.ts:1137 .catch(() => {})`, `webhook-receiver.ts:223+241 .catch(() => {})`

### BR-14: Amendment Depth Cap (Max Attempts Gate)
When Gas City returns `outcome: "revise"` and `factory_attempt > GAS_CITY_MAX_AMENDMENT_DEPTH` (default 3), the pipeline halts the amendment cycle: it writes an `INC-GC-AMENDMENT-DEPTH-*` incident, fires a best-effort keepalive/stop, and returns `amendment_halted: true` in the webhook response. No revision Signal is generated. The function remains in `rejected` lifecycle state.
- 🟢 CONFIRMED — `webhook-receiver.ts:configuredMaxAmendmentDepth`, `writeAmendmentDepthIncident`

### BR-15: Stale Dispatch Escalation (SLA Gate)
If a dispatch_log entry with `outcome='dispatched'` has no corresponding completion_event for its `gc_bead_id` after `GAS_CITY_DISPATCH_STALE_MINUTES` (default 60 minutes), the autonomy monitor creates a sev2 `INC-GC-DISPATCH-STALE-*` incident. This is the primary mechanism for detecting hung keepalives and lost Gas City callbacks.
- 🟢 CONFIRMED — `autonomy-monitor.ts:staleDispatches SQL query`, `writeDispatchStaleIncident`

### BR-16: Recurring Incident Escalation (Autonomous Pressure Generation)
When `COUNT(*) >= GAS_CITY_RECURRING_INCIDENT_THRESHOLD` (default 3) open incidents of the same `(incidentType, functionId)` exist, the autonomy monitor auto-generates a `PRS-OPS-GC-*` Pressure entry in `specs_pressures`. This is the only autonomous Pressure creation path — all other Pressures are created by the discovery pipeline. Pressure strength and urgency scale linearly with incident count.
- 🟢 CONFIRMED — `autonomy-monitor.ts:escalateRecurringIncidents`

### BR-17: Orphan Bead Rejection
A Gas City completion webhook is rejected with `409 orphan_bead` if no `dispatch_log` entry with `outcome='dispatched'` matches the incoming `bead_id`. A webhook without a prior dispatch record cannot be accepted — this prevents Gas City from injecting completions for dispatches the pipeline did not initiate.
- 🟢 CONFIRMED — `webhook-receiver.ts:dispatch null check → writeWebhookRejection + 409`

### BR-18: D1 json_each Banned in Correlated Subqueries
Cloudflare D1 does not support `json_each()` in correlated subqueries. Any query that would use `EXISTS (SELECT 1 FROM json_each(json,'$.array') WHERE ...)` must be rewritten as `json LIKE '%"value"%'`. This is a hard platform constraint enforced by runtime error, not a lint rule.
- 🟢 CONFIRMED — `formula-compiler-adapter.ts` and `ontology-loader/src/ontology-tool.ts` — both converted from json_each EXISTS to LIKE pattern in PR #83

---

## TODOs and FIXMEs Found (Intent Evidence)

| Location | Content | Implication |
|----------|---------|-------------|
| `pipeline.ts` semantic-review block | `// TODO: make this configurable via hot-config (strict mode vs advisory mode)` | Semantic review should eventually block on 'miscast' in strict mode |
| `compile.ts:extractTargetFiles` | `// Discrepancy #1: ensures atoms carry targetFiles from binding.target` | Historical data discrepancy acknowledged in code |
| `coordinator.ts` | `// 'critic' removed — CriticAgent handles dry-run internally` | Critic was previously separate; now integrated |

---

## Implicit Constraints (Inferred)

| Constraint | Basis | Confidence |
|-----------|-------|-----------|
| LLM context window ~8K tokens (llama-70b) | `intent-probe.ts:MAX_OUTPUT_TOKENS = 4000` comment | 🟡 INFERRED |
| Max 50 Gas City telemetry events per batch | `gascity-supervisor/src/index.ts:50 events check` | 🟢 CONFIRMED |
| Synthesis timeout 30 minutes | `pipeline.ts:synthesis-complete waitForEvent timeout` | 🟢 CONFIRMED |
| Architect approval timeout 7 days | `pipeline.ts:architect-approval waitForEvent timeout` | 🟢 CONFIRMED |
| FactoryStore payload max 1MB | `factory-store-do.ts:MAX_PAYLOAD_BYTES = 1024 * 1024` | 🟢 CONFIRMED |
| D1 autonomy monitor sweep capped at 100 functions per state | `autonomy-monitor.ts`: accepted and monitored queries both use `LIMIT 100`; stale-dispatch query also uses `LIMIT 100`. Functions beyond that cap are skipped in a given cron run. | 🟢 CONFIRMED — `autonomy-monitor.ts` SQL queries |
| D1 query timeout: 8s for monitor sweeps, 6s for status reads, 5s for smoke probe | `autonomy-monitor.ts:queryWithTimeout` — accepted/monitored/stale-dispatch sweeps time out at 8000ms; status-endpoint queries time out at 6000ms; smoke-mode `SELECT 1` times out at 5000ms. Timed-out queries return empty fallback without error. | 🟢 CONFIRMED — `autonomy-monitor.ts:queryWithTimeout` |
| D1 document query shape: all collections stored in `documents` table, addressed by `(collection, key)`, JSON payload in `json` column, extracted via `json_extract()` | `webhook-receiver.ts` and `autonomy-monitor.ts` use `SELECT json FROM documents WHERE collection=? AND json_extract(json,'$.field')=?` uniformly. All consumers must use this shape; AQL and bindVars are removed. | 🟢 CONFIRMED — `packages/db-client/src/index.ts`, `webhook-receiver.ts`, `autonomy-monitor.ts` |
| `traverse()` not supported in D1 backend | `ArangoClient.traverse()` throws unconditionally. Graph traversal must use recursive CTEs via `query()`. Any pipeline code relying on graph traversal must be rewritten. | 🟢 CONFIRMED — `packages/db-client/src/index.ts:traverse()` |
| Pi-container execute timeout 8 minutes (480,000ms) | Backstop above Gas City's 6-minute client timeout. Gas City fires its AbortSignal first and classifies the event correctly. Pi-container timeout is a last-resort kill, not the expected termination path. | 🟢 CONFIRMED — `pi-container/server.mjs:EXECUTE_TIMEOUT_MS = 480_000` comment |
| Keepalive/start call timeout 5 seconds | `AbortSignal.timeout(5_000)` on both keepalive/start and keepalive/stop calls. If Gas City is not reachable within 5s, the call is silently dropped. | 🟢 CONFIRMED — `formula-compiler.ts:1141`, `webhook-receiver.ts:226+243` |
| Gas City Max Amendment Depth default 3 | `GAS_CITY_MAX_AMENDMENT_DEPTH` env var, integer > 0, defaults to 3 via `configuredMaxAmendmentDepth()`. Means Gas City can request at most 3 revisions before the pipeline halts the amendment cycle. `factory_attempt` starts at 1 so attempts 1, 2, 3 are allowed; attempt 4 halts. | 🟢 CONFIRMED — `webhook-receiver.ts:configuredMaxAmendmentDepth` |

---

## KSP Layer — Knowing-State Prosthesis (SPEC-KSP-ARCH-001 and children)

> Forward run · Added 2026-06-10 · Source: SPEC-KSP-ARCH-001, SPEC-KSP-ARTIFACT-GRAPH-001, SPEC-KSP-BEAD-GRAPH-001, SPEC-KSP-LOOP-CLOSURE-001, SPEC-KSP-FACTORY-001, SPEC-FF-GEARS-001, SPEC-FF-JUSTBASH-001-004

### KSP Glossary

| Term | Definition |
|------|-----------|
| **Knowing-State Prosthesis** | An externalized substrate that holds, maintains, and mediates the knowing-state an executing agent cannot reliably bear across turn boundaries. Defined in spec-execution-ontology §3.13. |
| **Artifact Graph** | The lineage-authoritative storage layer holding the spec-execution cycle record: Specification, Execution, ExecutionTrace, Divergence, Hypothesis, Amendment, ElucidationArtifact, VerificationProcess, Verdict nodes. DO SQLite per namespace. |
| **Bead Graph** | The knowing-state content layer holding what governs execution: PolicyBead, TrustBead, ExecutionBead, OutcomeBead, AmendmentBead, ConsentBead, EscalationBead, AuditBead. DO SQLite per org + KV hot cache. |
| **Bead** | A content-addressed, append-only record in the Bead graph. `bead_id = SHA-256(type + canonical_json(content) + sorted(parent_ids))`. Immutable after write. |
| **LoopClosureService** | The coordinator service that bridges the two storage layers. Implements the five bridge points. Neither storage layer calls the other directly. |
| **Bridge field** | An `artifact_graph_*_id` field in Bead content that carries a cross-layer reference to a node in the artifact graph. Written by the loop closure service. Optional — storage-layer invariants hold regardless of whether bridge fields are present. |
| **ArchitectureDecisionBead** | Factory-domain PolicyBead. Holds the compiled WorkGraph content (atoms, detector specs, AGENTS.md). Retrieved by Conducting Agent at session open. |
| **CommitBead** | Factory-domain ExecutionBead. Written by Mediation Agent when an AtomDirective is dispatched. |
| **BuildOutcomeBead** | Factory-domain OutcomeBead. Written by CoordinatorDO on `releaseBead()`/`failBead()`. |
| **ArchAmendmentBead** | Factory-domain AmendmentBead. Written by Commissioning Agent when a blocking Divergence triggers the amendment loop. |
| **ElucidationArtifact** | An artifact graph node written unconditionally on every Amendment adoption. Records the selected option, rejected alternatives, assumptions, and accepted risks. Fulfills Axiom A9 (Elucidation Obligation). |
| **DispositionEvent** | An artifact graph node representing the moment of possibility-space collapse. Every Amendment adoption is a DispositionEvent. Every DispositionEvent requires an ElucidationArtifact (INV-KSP-004). |
| **Autonomy floor** | The minimum autonomy level for a session. Set to `SUGGEST` when `retrieveKnowingState()` fails (I4 — Fail-closed). Prevents autonomous execution until human review restores normal state. |
| **CoordinatorDO** | The `@factory/gears` Durable Object that holds the per-WorkGraph-execution bead store. Enforces single-writer, manages the `ready → in_progress → done/failed` bead lifecycle, writes D1 audit log, and wires `LoopClosureService` Bridge Point 3. |

---

### KSP Business Rules

**BR-KSP-01: I1 — Externalization**
Knowing-state content is held in a substrate distinct from the executing agent. The Bead Graph DO SQLite + KV hold the content; the Conducting Agent holds no knowing-state across turn boundaries. Enforced structurally by `BeadGraphDOBase` schema.
- Source: SPEC-KSP-ARCH-001 §2.2 I1

**BR-KSP-02: I2 — Retrieval Enforcement**
The agent retrieves knowing-state from the prosthesis at the moment of execution. `KnowingStateSDK.writeExecutionBead()` asserts `session.ksRetrievedAt` is set before proceeding. Throws `SessionNotInitialized` if `retrieveKnowingState()` was not called first.
- Source: SPEC-KSP-ARCH-001 §6, SPEC-KSP-BEAD-GRAPH-001 INV-BG-003

**BR-KSP-03: I3 — Continuous Maintenance**
The prosthesis decays without active upkeep. `OutcomeBead` writes trigger amendment evaluation. `maintenance:{orgId}` KV key tracks health score and pending amendment count. Staleness alarm fires in the DO when the health score degrades. `DEGRADED` lifecycle blocks new dispatch.
- Source: SPEC-KSP-ARCH-001 §6, SPEC-KSP-BEAD-GRAPH-001 INV-BG-008

**BR-KSP-04: I4 — Fail-Closed Coupling**
When `retrieveKnowingState()` fails (DO unavailable, missing ArchitectureDecisionBead, empty trust set), `session.autonomyFloor` is set to `SUGGEST`. `writeExecutionBead()` throws `AutonomyDegradedError` if execution-level autonomy is attempted while floor is `SUGGEST`. Execution does not proceed unprotected.
- Source: SPEC-KSP-ARCH-001 §6, SPEC-KSP-BEAD-GRAPH-001 INV-BG-008

**BR-KSP-05: Append-Only — Both Layers**
Neither the artifact graph nor the bead graph deletes or mutates records. Artifact graph corrections produce new nodes with `corrects` edges. Bead graph supersessions produce new beads with `supersedes` edges in `bead_edges`. No `UPDATE` or `DELETE` on `beads` table. Violation throws `BeadImmutabilityError`.
- Source: SPEC-KSP-ARCH-001 INV-KSP-001, SPEC-KSP-BEAD-GRAPH-001 INV-BG-001, SPEC-KSP-ARTIFACT-GRAPH-001 INV-AG-001

**BR-KSP-06: Content-Addressed Bead Identity**
`bead_id = SHA-256(type + canonical_json(content) + sorted(parent_ids))`. Computed before every write via `computeBeadId()`. Mismatch throws `BeadIntegrityError`. Parent-order independence is required: sorted `parent_ids` ensure the same bead ID regardless of parent arrival order.
- Source: SPEC-KSP-ARCH-001 INV-KSP-002, SPEC-KSP-BEAD-GRAPH-001 §3 + INV-BG-002

**BR-KSP-07: AuditBead in Every Bead Write Transaction**
Every non-audit `writeBead()` call requires an `auditBead` parameter. Both the primary bead and the AuditBead are written in the same `BEGIN/COMMIT` block. `writeBead()` throws if `auditBead` is missing for a non-audit type. Transaction fails if either insert fails.
- Source: SPEC-KSP-ARCH-001 INV-KSP-005, SPEC-KSP-BEAD-GRAPH-001 INV-BG-007

**BR-KSP-08: KV Invalidated on Amendment Adoption**
`LoopClosureService.adoptAmendment()` invalidates KV keys `ks:{orgId}:*`, `head:{orgId}:*`, and `maintenance:{orgId}` before returning. A new session opened after adoption receives the amended knowing-state. Invalidation precedes the return of the adoption result.
- Source: SPEC-KSP-ARCH-001 INV-KSP-006, SPEC-KSP-LOOP-CLOSURE-001 INV-LC-006
- Factory KV keys deleted: `ks:{repoId}:conducting-agent:*`, `head:{repoId}:arch_decision`, `maintenance:{repoId}`

**BR-KSP-09: ElucidationArtifact Written on Every Amendment Adoption**
Every Amendment adoption is a DispositionEvent with cardinality > 1. `LoopClosureService.adoptAmendment()` writes an `ElucidationArtifact` node to the artifact graph unconditionally. Skipping this write is a structural error, not a recoverable failure (Axiom A9 — Elucidation Obligation). See INV-KSP-004, INV-LC-005.
- Source: SPEC-KSP-ARCH-001 INV-KSP-004, SPEC-KSP-LOOP-CLOSURE-001 INV-LC-005

**BR-KSP-10: Bridge Fields Are Optional, Invariants Are Unconditional**
Bead graph invariants (INV-BG-001 through INV-BG-008) hold regardless of whether bridge fields (`artifact_graph_*_id`) are present. A Bead written without bridge fields is storage-valid. The loop closure service writes bridge fields; it does not enforce them at the storage layer. Beads predating loop closure implementation are valid.
- Source: SPEC-KSP-ARCH-001 INV-KSP-007, SPEC-KSP-LOOP-CLOSURE-001 INV-LC-002

**BR-KSP-11: Single Writer Per DO**
One DO instance per namespace (artifact graph) or per org (bead graph). All writes are serialized. No direct SQLite access from Workers or external processes. The DO is the only write path.
- Source: SPEC-KSP-ARCH-001 INV-KSP-003, SPEC-KSP-ARTIFACT-GRAPH-001 INV-AG-006

**BR-KSP-12: Lineage Completeness on Specification Succession**
Before writing any successor Specification node, the `version_of` edge to its predecessor MUST be written in the same `transactionSync`. A Specification node without a `version_of` edge to its predecessor is an orphan lineage record.
- Source: SPEC-KSP-ARTIFACT-GRAPH-001 INV-AG-005

**BR-KSP-13: Write Sequence on Execution — Artifact Graph First**
At Bridge Point 2, the artifact graph write (Execution node + `governed_by` edge) precedes the bead graph write (ExecutionBead). Partial failure (artifact graph succeeds, bead graph fails) produces an orphan Execution node. Recovery is via idempotent retry on the next session operation — both writes are idempotent (`INSERT OR IGNORE` / `ON CONFLICT DO UPDATE`).
- Source: SPEC-KSP-LOOP-CLOSURE-001 INV-LC-003

**BR-KSP-14: HARD GATE — Loop-Closure Tests Before Factory-Graph Implementation**
SPEC-KSP-ARCH-001 Phase 3 (`packages/loop-closure`) tests must pass before Phase 4 (Factory domain instantiation `packages/factory-graph`) begins. Phase 4 depends on all five bridge point tests passing (Bridge Points 2–5 + partial failure recovery). This ordering is not advisory — it is a hard sequencing gate.
- Source: SPEC-KSP-ARCH-001 §9 Phase 4 prerequisite, SPEC-FF-GEARS-001 §14 prerequisite

**BR-KSP-15: @factory/ksp-sdk Zero Factory Import Rule**
`@factory/knowing-state-sdk` (or `@koales/knowing-state-sdk`) MUST NOT import any `@factory/*` package. It re-exports only from `@koales/bead-graph`. Any `@factory/*` import in the SDK creates domain-specific coupling that breaks deployability to ComeFlow and CareTrace. The `tsc --noEmit` gate after Step 17 verifies this constraint.
- Source: SPEC-KSP-ARCH-001 §3, Step 17

**BR-KSP-16: initRun() Before getNextReady() in CoordinatorDO**
`CoordinatorDO.initRun(runId, orgId)` must be called before the first `claimBead()` or `getNextReady()` call in any workflow invocation. `writeAudit()` and `recordOutcome()` require `runId` and `orgId` to be set. The `atom-execution.ts` workflow calls `POST /init` on the DO before calling `getNextReady()`. The call is idempotent — safe to call on every workflow invocation.
- Source: SPEC-FF-GEARS-001 §7b (Gap 6), SPEC-FF-JUSTBASH-003

**BR-KSP-17: writeAudit() Is Not a Stub**
`CoordinatorDO.writeAudit()` is fully implemented: it writes a row to the D1 `bead_audit` table with `run_id`, `bead_id`, `gear_id`, `agent_id`, `verdict`, `attempt`, and `ts`. It is NOT a TODO stub. Any implementation that leaves `writeAudit()` as a no-op or comment violates this rule. The D1 audit log is the cross-run append-only record required for compliance.
- Source: SPEC-FF-GEARS-001 §7b (Gap 1)

**BR-KSP-18: evaluateSuccessCondition Is Async with Harness Parameter**
`evaluateSuccessCondition(condition, result, harness)` is async and takes the `FlueHarness` instance as a third parameter. The `file-exists` success condition type uses `harness.shell()` to check filesystem state, which requires the harness reference. Any implementation that makes this function synchronous or drops the harness parameter breaks the `file-exists` condition type.
- Source: SPEC-FF-JUSTBASH-004 (Gap 4)

**BR-KSP-19: No deriveRole() — Use directive.role Directly**
The `deriveRole()` heuristic function (prefix matching on `skillRef`) is deleted. `AtomDirective.role` is the authoritative role source, populated at compile time from `Gear.role`. The Flue workflow uses `PROFILE_BY_ROLE[directive.role]` directly to select the `AgentProfile`. Any reimplementation of `deriveRole()` reintroduces silent misrouting bugs.
- Source: SPEC-FF-GEARS-001 §5, §8; SPEC-FF-JUSTBASH-004

**BR-KSP-20: Amendment Adoption is Atomic at Semantic Level**
All five steps of Bridge Point 5 (artifact graph Specification, ElucidationArtifact, Bead graph new TrustBead/PolicyBead, supersedes edge, KV invalidation) must complete before the new Specification is considered active. If any step fails, `session.activeSpecificationId` remains the prior version. There is no partial adoption state.
- Source: SPEC-KSP-LOOP-CLOSURE-001 INV-LC-004

---

### KSP Implicit Constraints

| Constraint | Basis |
|-----------|-------|
| One Artifact Graph DO per namespace (`domain:org:scope`) — max 10GB SQLite per DO | SPEC-KSP-ARTIFACT-GRAPH-001 §2 |
| One Bead Graph DO per org — max 10GB SQLite per DO | SPEC-KSP-BEAD-GRAPH-001 §9 |
| KV cache TTL: 1 hour for `ks:*`/`policy:*`, 15 min for `consent:*`, 6 hours for `maintenance:*`, 24 hours for `session:*` | SPEC-KSP-BEAD-GRAPH-001 §7 |
| CoordinatorDO runId = `SHA-256(workGraphId + workGraphVersion)` — deterministic, re-attachable after crash | SPEC-FF-GEARS-001 §7 (GD-002) |
| Stalled bead detection: 5-minute in_progress timeout in CoordinatorDO alarm | SPEC-FF-GEARS-001 §7 |
| Edge uniqueness in artifact graph: `UNIQUE(source, target, rel)` — writing same edge twice is idempotent | SPEC-KSP-ARTIFACT-GRAPH-001 INV-AG-002 |
| D1 `bead_audit` table is append-only (autoincrement PK, no deletes) | SPEC-FF-GEARS-001 §7 |
| `@koales/` package scope is provisional — packages live in FF monorepo until cross-product decision | SPEC-KSP-ARCH-001 §3, §10 |

---

## Flue Atom-Execution Rules (Patch 2026-06-11)

**BR-FLUE-01: FlueAtomExecutionWorkflow Lives in @factory/gears**
The `FlueAtomExecutionWorkflow` DO class and `FlueRegistry` are part of `@factory/gears`, not a standalone worker. `ff-pipeline/index.ts` re-exports them for wrangler DO bindings only. No separate `ff-flue` worker exists.
- Source: commit b8f8ac2, SPEC-FF-GEARS-001 §3; 🟢 CONFIRMADO

**BR-FLUE-02: seedBeads() Required Before getNextReady()**
`CoordinatorDO.getNextReady()` throws if `initRun()` has not been called and beads have not been seeded via `seedBeads()`. The caller (atom-execution workflow) must seed the molecule before requesting the next bead.
- Source: commit 46b4868 (CoordinatorDO seedBeads/initRun gate); 🟢 CONFIRMADO

**BR-FLUE-03: Only atom-execution Workflow Is Specced**
Three fabricated Flue workflows were deleted (commit 45db2ea). Only `FlueAtomExecutionWorkflow` is specified and deployed. No other Flue workflow classes may be added without a spec.
- Source: commit 45db2ea; 🟢 CONFIRMADO

**BR-FLUE-04: AI Gateway Must Be Bypassed for kimi-k2.6**
`coderProfile` sets `gateway: false` to bypass the Cloudflare AI Gateway. The AI Gateway's SSE connection closes the response body prematurely on kimi-k2.6 text turns, causing stream reads to hang. Direct CF Workers AI binding is required.
- Source: commit 46b4868 (gateway:false bypass); 🟢 CONFIRMADO

**BR-FLUE-05: storeFullOutput Is Non-Fatal**
Writing the full LLM output to `WORKSPACE_BUCKET` (R2) may fail without aborting the atom execution. The failure is logged but does not propagate. R2 unavailability must not cause execution failures.
- Source: commit 46b4868; 🟡 INFERIDO (non-fatal guard confirmed, logging behavior inferred)

**BR-FLUE-06: Handler Modules Must Have Clean Import Graphs**
Queue consumer and route handlers extracted from the barrel (`queue-handler.ts`, `trigger-synthesis-handler.ts`) must use only type-only static imports. All runtime CF-runtime dependencies (`@factory/gears`, `@flue/runtime`, `@cloudflare/*`) must be deferred via `await import()`. This prevents `ERR_UNSUPPORTED_ESM_URL_SCHEME` in Node.js test environments.
- Source: commit 919364e; 🟢 CONFIRMADO
