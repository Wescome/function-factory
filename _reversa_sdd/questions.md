# Questions — function-factory

> Phase 5 · Reviewer · Updated 2026-06-10 (post-diff patch review)
> These are 🔴 GAPS requiring human validation to complete the specification.

---

## Q-01: ~~Lineage Completeness Check — Exact AQL~~ RESOLVED

**Unit:** ff-gates
**File:** `workers/ff-gates/src/index.ts:checkLineageCompleteness()`
**Resolution:** CONFIRMED closed. The diff patch correctly documents the D1 SQLite `WITH RECURSIVE` CTE. Source code at lines 191-231 uses exactly the recursive CTE pattern documented in `ff-gates/design.md`. The AQL question is moot — the check uses D1 SQL.
**Reclassification:** 🟡 → 🟢 CONFIRMADO

---

## Q-02: SynthesisCoordinator Harness Path — PARTIALLY RESOLVED

**Unit:** synthesis-coordinator
**File:** `workers/ff-pipeline/src/pipeline.ts` (harness path)
**Gap:** The updated design.md documents this: `ff-pipeline/design.md` states "The harness path returns `status: 'harness-removed'` immediately." This means the synthesis-coordinator is not called on the harness path at all — the step exists in pipeline.ts and immediately returns that status. The coordinator itself is only reached by legacy Trellis dispatch paths.
**Impact:** Medium — the spec now states this behavior explicitly. What remains unconfirmed is whether the `harness-removed` step name is literally present in pipeline.ts or if this is a description of what the deprecated step does.
**Action required:** Confirm: does pipeline.ts contain a step named 'harness-removed' or similar? Or has the harness step been fully deleted?

**Answer:** _(confirm step name or deletion)_

---

## Q-03: InstructionTuning Step — PARTIALLY RESOLVED

**Unit:** ff-pipeline
**File:** `workers/ff-pipeline/src/pipeline.ts` instruction-tuning step
**Gap:** The updated design.md states the instruction-tuning step "returns `status: 'harness-removed'` immediately" — but this is in the context of the harness path. The instruction-tuning step was a separate, legacy synthesis-era step. Q-03 is distinct: specifically, does an `instruction-tuning` step still appear in pipeline.ts and always return `blocked: reason='REMOVED: synthesis-era'`? If so, should it be removed or is it intentional dead code?
**Impact:** High — if the step persists, it writes a failure VerificationReport to D1 every pipeline run, generating noise in the governance audit trail.
**Action required:** Confirm: is a failing `instruction-tuning` step still present in pipeline.ts? If yes, is it intentionally retained or should it be cleaned up?

**Answer:** _(fill in here)_

---

## Q-04: AtomExecutor DO — RESOLVED

**Unit:** synthesis-coordinator
**File:** `workers/ff-pipeline/src/coordinator/atom-executor-do.ts`
**Resolution:** The diff patch added full per-atom DO documentation in synthesis-coordinator/requirements.md (FR-10 through FR-13) and tasks.md (T-09 through T-13, including preflight key check, idempotent re-execution, GitHub file context caching with 5-min TTL). All behaviors confirmed from code.
**Reclassification:** 🟡 → 🟢 CONFIRMADO

---

## Q-05: Task Routing Model Assignments

**Unit:** ff-pipeline (model-bridge)
**File:** `packages/task-routing/src/`
**Gap:** The actual model-to-task-kind mapping was not confirmed from code reading in either the original or the diff patch. This remains an open gap.
**Impact:** Medium — important for understanding which LLM capabilities are used at each pipeline stage, relevant for cost estimation and capability planning.
**Action required:** Read `packages/task-routing/src/` and confirm: what model is assigned to 'planning', 'structured', 'interpretive', 'synthesis', 'validation', 'probe', 'crystallizer', 'semantic_review' task kinds in the default config?

**Answer:** _(fill in here)_

---

## Q-06: TrellisExecutionPacket — Certificate Format

**Unit:** synthesis-coordinator
**File:** `packages/schemas/src/_attic/trellis-execution-packet.ts`
**Gap:** The `certifyTrellisExecutionPacket()` certification algorithm remains unconfirmed. This is low-impact since the path is deprecated.
**Impact:** Low (deprecated code path)

**Answer:** _(fill in here)_

---

## Q-07: Gas City — Pi Container Formula Dispatch Protocol — PARTIALLY ADDRESSED

**Unit:** gascity-dispatch / gascity-supervisor
**File:** `workers/ff-pipeline/src/gascity/pi-container-execute.ts`
**Gap:** The diff patch created a full gascity-supervisor spec documenting the keepalive protocol, bead store proxy, telemetry ingest, and FactoryStore SQLite DO. However `pi-container-execute.ts` itself (the file that dispatches Formulas from ff-pipeline to Gas City) was not read. The gascity-dispatch/design.md documents the route at `/__pi-container/execute` but the exact request format, auth tokens, and response handling is still inferred.
**Impact:** Medium — the dispatch protocol is the critical interface between ff-pipeline and Gas City.
**Action required:** Read `workers/ff-pipeline/src/gascity/pi-container-execute.ts` to confirm the Formula dispatch protocol details.

**Answer:** _(fill in here)_

---

## Q-08: FactoryStore — Full Bead/Spec CRUD Contract — PARTIALLY ADDRESSED

**Unit:** gascity-supervisor
**File:** `workers/gascity-supervisor/src/factory-store-do.ts`
**Gap:** The diff patch added FR-09 through FR-13 for FactoryStore in gascity-supervisor/requirements.md covering SQLite schema init, auth, vacuum schedule, payload enforcement, lineage walk, and transactional batch operations. However the full `handleBeads()` filter/pagination contract and the `handleArtifacts()` endpoint contract remain inferred.
**Impact:** Low — supporting component for Gas City internal protocol

**Answer:** _(fill in here)_

---

## Q-09: NEW — db-client Validator Trigger Condition

**Unit:** packages/db-client
**File:** `packages/db-client/src/index.ts:save()` lines 126-138
**Gap:** The spec (FR-11, requirements.md) states the validator throws when it "returns violations with `severity === 'violation'`". The actual code throws when `!result.valid` AND there are violation-severity items. If `result.valid` is false but all violations have `severity === 'warning'`, the throw fires with an EMPTY message (violationMessages would be []). The spec does not document this edge case — it implies the throw only fires when violation-severity items exist.
**Impact:** Medium — this is a behavioral difference from the spec. If a validator returns `{ valid: false, violations: [{ severity: 'warning', ... }] }`, the spec says "console.warn and proceed" but the code throws with an empty error message.
**Action required:** Confirm: is `result.valid` always set correctly by validators (i.e., valid=false only when there are violation-severity items)? Or is this a latent bug?

**Answer:** _(fill in here)_

---

## Q-10: NEW — GovernorAgent "AQL queries" Description in code-analysis.md

**Unit:** ff-pipeline (GovernorAgent)
**File:** `_reversa_sdd/code-analysis.md:174`
**Gap:** `code-analysis.md` line 174 says "Pre-fetches 9 parallel AQL queries" but the actual governor-agent.ts code at lines 191-321 uses SQL `SELECT` statements via `db.query()` — D1 SQL, not AQL. The code-analysis.md document has not been updated to reflect the D1 migration for this section.
**Impact:** Cosmetic — this is a stale description in code-analysis.md (a source analysis artifact, not a spec). The unit specs (ff-pipeline/requirements.md) correctly show D1. However, it creates confusion if anyone reads code-analysis.md.
**Action required:** Update code-analysis.md line 174 to say "Pre-fetches 9 parallel D1 SQL queries" and line 185 to say "Pre-fetches 4 parallel D1 SQL queries."

**Answer:** _(Wes to confirm whether code-analysis.md is authoritative or archival)_

---

## Q-11 (KSP): Package Naming — @koales/* vs @factory/* — CRITICAL

**Unit:** All KSP packages (ksp-artifact-graph, ksp-bead-graph, ksp-loop-closure, ksp-gears)
**Source:** CLAUDE.md `/tmp/ksp-impl/ksp-impl-specs/CLAUDE.md` (authoritative implementation instructions)
**Gap:** CLAUDE.md uses `@koales/artifact-graph`, `@koales/bead-graph`, `@koales/loop-closure` as the actual package names for the base KSP packages. The SDD uses `@factory/artifact-graph`, `@factory/bead-graph`, `@factory/loop-closure`. The `ksp-gears/requirements.md` (NFR-07) acknowledges this conflict explicitly: "All `@koales/*` references apply the package naming rule: `@koales/loop-closure` → `@factory/loop-closure`". The CLAUDE.md package topology also shows `@factory/knowing-state-sdk ← @koales/bead-graph only` — which means the source truth uses `@koales/` scope for the 3 base packages but `@factory/` scope for ksp-sdk and gears.

**Ambiguity:** Which names are authoritative for implementation? Does `@koales/artifact-graph` get published as `@factory/artifact-graph` via alias, or are they genuinely different scopes?

**Impact:** HIGH — if an implementor follows CLAUDE.md literally, they create `packages/artifact-graph` with `name: "@koales/artifact-graph"` but the SDD says `name: "@factory/artifact-graph"`. The `ksp-sdk` re-export (`export * from '@factory/bead-graph'`) would fail if the package is `@koales/bead-graph`.

**Action required:** Confirm which scope is definitive for package.json `name` fields. The SDD consistently uses `@factory/*` throughout all 7 KSP modules and all cross-references are internally consistent. Recommend: treat `@factory/*` as the final answer; `@koales/*` is the provisional/upstream scope referenced in CLAUDE.md as historical context.

**Answer:** _(Wes to confirm: use @factory/* for all package names as the SDD consistently states)_

---

## Q-12 (KSP): ksp-loop-closure — `getActiveSpecification` not defined in @factory/artifact-graph

**Unit:** ksp-loop-closure
**File:** `ksp-loop-closure/design.md` §Bridge Point 1 — `artifactGraphDO.getActiveSpecification(ns, domain)`
**Gap:** `ksp-loop-closure/design.md` calls `artifactGraphDO.getActiveSpecification(ns, domain)` in Bridge Point 1 (`openSession`). However, `ksp-artifact-graph` defines exactly 10 query functions (`upsertNode`, `getNode`, `getNodesByType`, `upsertEdge`, `getEdgesFrom`, `getEdgesTo`, `walkLineageBackward`, `walkLineageForward`, `walkBoundedPath`, `collectLineageIds`) and `getActiveSpecification` is NOT among them. This method is not mentioned in SPEC-KSP-ARTIFACT-GRAPH-001 anywhere.

**Impact:** HIGH — loop-closure service will fail to compile if it calls a method that doesn't exist on `ArtifactGraphDOBase`. Either: (a) `getActiveSpecification` is a domain-level method added by `FactoryArtifactGraphDO` and loop-closure should not call it directly (it should be injected), or (b) it needs to be implemented as a `walkLineageBackward`-style query in the base class.

**Action required:** Confirm whether `getActiveSpecification` should be implemented as a method on `FactoryArtifactGraphDO` (not `ArtifactGraphDOBase`) and passed via `LoopClosureConfig`, or added to the base class.

**Answer:** _(Wes to specify: domain method on FactoryArtifactGraphDO injected via config, or base class method)_

---

## Q-13 (KSP): ksp-loop-closure — `dispositionEventId` undefined in Bridge Point 5

**Unit:** ksp-loop-closure
**File:** `ksp-loop-closure/design.md` §Bridge Point 5 — Step 3 ElucidationArtifact
**Gap:** The design states: `artifactGraphDO.upsertEdge(eaId, dispositionEventId, 'produced_at')` — but `dispositionEventId` is never defined or generated in the six-step BP5 sequence. The design's own Open Gaps section notes: "dispositionEventId in Bridge Point 5 Step 3 is not explicitly generated or defined in the spec." However, the gap note says to generate a `DispositionEvent` node alongside the ElucidationArtifact. This is documented but not specified in tasks.md (Task 25e — `adoptAmendment`) which doesn't mention generating a DispositionEvent node.

**Impact:** MEDIUM — tasks.md Step 25e does not instruct the implementor to create the DispositionEvent node. If omitted, the `produced_at` edge target is undefined.

**Action required:** Confirm: should tasks.md Step 25e explicitly add "generate a DispositionEvent node with the same node ID pattern and write it with `upsertNode`" before writing the `produced_at` edge?

**Answer:** _(Wes to confirm: yes, add DispositionEvent node to tasks.md Step 25e)_

---

## Q-14 (KSP): ksp-gears — ksp-sdk listed as Phase 3 in tasks.md but Phase 2 everywhere else

**Unit:** ksp-sdk, ksp-gears
**File:** `ksp-sdk/tasks.md` header says "Phase 3", `ksp-sdk/requirements.md` NFR-03 says "Phase 2"
**Gap:** The tasks.md for ksp-sdk (T-01 header) says "This module is Phase 3." but the requirements.md (NFR-03) and architecture.md KSP build order table correctly identify ksp-sdk as Phase 2. The CLAUDE.md also labels it "Phase 3 — @factory/knowing-state-sdk" (its sequence position is Step 21). The loop-closure package is Phase 3, not ksp-sdk.

**Impact:** LOW — cosmetic inconsistency. May confuse an implementor reading only tasks.md.

**Action required:** Confirm: update ksp-sdk/tasks.md prerequisite gate header from "Phase 3" to "Phase 2" to match requirements.md NFR-03, architecture.md, and the actual dependency order.

**Answer:** _(Confirm: yes, it's a typo — ksp-sdk is Phase 2)_
