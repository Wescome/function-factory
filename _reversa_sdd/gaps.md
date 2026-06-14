# Gaps — function-factory

> Phase 5 · Reviewer · Updated 2026-06-10 (post-diff patch review)
> Lacunas that remain unresolved — no answer available from code reading alone.

---

## CRÍTICO (blocker for spec accuracy)

### GAP-01: dependencies.md lists `@factory/arango-client` — STALE

**Location:** `_reversa_sdd/dependencies.md:40-43`
**Description:** The dependency graph for workers still says:
```
workers/ff-pipeline → @factory/schemas, @factory/arango-client, ...
workers/ff-gates    → @factory/schemas, @factory/arango-client, ...
```
**Actual state:** All three workers (`ff-pipeline`, `ff-gates`, `ff-gateway`) have `"@factory/db-client": "workspace:*"` in their package.json. The `@factory/arango-client` name no longer exists (renamed to `@factory/db-client` in PR #79).
**Why it matters:** Any developer reading `dependencies.md` to understand the build graph will try to reference a non-existent package. This is a factual error in the SDD.
**Fix required:** Update `dependencies.md:40-43` to replace `@factory/arango-client` with `@factory/db-client` for all worker entries.

---

### GAP-02: db-client validator trigger — `!result.valid` gate not specified

**Location:** `_reversa_sdd/packages/db-client/requirements.md:FR-11`
**Description:** FR-11 states: "If the function returns violations with `severity === 'violation'`: throw". The actual code in `save()` first checks `!result.valid` and THEN filters for violation-severity items to build the error message. If `result.valid === false` but ALL violations are `severity === 'warning'`, the code throws `Error: Artifact validation failed for {collection}: ` (empty message). The spec does not document this behavior.
**Why it matters:** The spec omits the `!result.valid` guard entirely. A test written from the spec would not catch this scenario.
**Fix required:** Update FR-11 to state: "If `result.valid === false`: collect violation-severity messages and throw. If `result.valid === true` but warnings exist: console.warn only. The throw fires on `!result.valid` regardless of whether violation-severity messages exist."

---

### GAP-03: confidence-report.md is pre-patch — counts and reclassifications outdated

**Location:** `_reversa_sdd/confidence-report.md`
**Description:** The confidence report was generated 2026-06-08, before the diff patch added 2 new units (db-client, ontology-loader), updated 5 units (ff-pipeline, synthesis-coordinator, ff-gates, ff-gateway, gascity-supervisor), and created a gascity-supervisor spec where only gascity-dispatch existed before. The report still shows "5 units reviewed" and documents Q-01 as an open AQL gap (now resolved as D1 CTE).
**Why it matters:** The confidence report is the executive summary of spec quality. If it's stale, it misrepresents the current state.
**Fix required:** confidence-report.md is being regenerated as part of this Reviewer run (see `confidence-report.md` output below).

---

## MODERADO (impacts spec usefulness but not blocking)

### GAP-04: code-analysis.md AQL language not updated for D1 migration

**Location:** `_reversa_sdd/code-analysis.md:174, 185, 245, 830, 832, 897`
**Description:** Multiple sections of `code-analysis.md` describe D1 SQL queries as "AQL queries" or describe ArangoDB as the store for completion_ledgers, GovernorAgent context prefetch, and MemoryCuratorAgent prefetch. These sections predate the D1 migration and have not been updated.
- Line 174: "Pre-fetches 9 parallel AQL queries" (GovernorAgent) → should be "D1 SQL queries"
- Line 185: "Pre-fetches 4 parallel AQL queries" (MemoryCurator) → verify if this is also D1
- Lines 830-832: "completion_ledgers in ArangoDB" → synthesis-coordinator spec now confirms D1 for completion_ledgers
- Line 897: "createLedger() in ArangoDB" → D1
**Why it matters:** code-analysis.md is used as a source for future spec work. Stale AQL references cause confusion.
**Fix required:** Update the affected lines in code-analysis.md to reflect D1 SQL. (Or explicitly mark code-analysis.md as an archival document superseded by the unit specs.)

---

### GAP-05: c4-containers.md still shows ArangoDB as primary artifact store

**Location:** `_reversa_sdd/c4-containers.md:29, 36, 57, 68`
**Description:** The C4 container diagram shows `ff-arango` as an active container and ArangoDB as the primary artifact store ("Artifact graph: signals, pressures, capabilities, ES, lineage"). After the D1 migration, D1 is the primary operational store for all artifact types. ArangoDB is now a legacy/legacy-read store.
**Why it matters:** C4 diagrams are high-visibility architectural artifacts. If they show a stale architecture, they mislead onboarding developers and architects.
**Fix required:** Update c4-containers.md to show D1 (ff-factory) as the primary store. Mark ff-arango as "deprecated / legacy read path". Add a note: "Per ADR-010, D1 is the primary operational store as of PR #79-#80."

---

### GAP-06: gascity-dispatch unit vs gascity-supervisor unit — naming confusion

**Location:** `_reversa_sdd/gascity-dispatch/` and `_reversa_sdd/gascity-supervisor/`
**Description:** Two separate spec folders exist for what is substantially one worker (`workers/gascity-supervisor/`). The `gascity-dispatch` folder focuses on the GasCitySupervisor Container and FactoryStore DO from a dispatch perspective. The `gascity-supervisor` folder (created in the diff patch) documents the same Worker more completely with all 13 FRs. There is redundancy and potential for inconsistency.
**Why it matters:** Future spec updates risk being applied to one folder but not the other.
**Fix required:** Consider merging gascity-dispatch into gascity-supervisor, or explicitly marking gascity-dispatch as "superseded by gascity-supervisor". The spec-impact-matrix.md also refers to `gascity-dispatch` as a column header.

---

### GAP-07: NFR-03 traverse() call sites not audited

**Location:** `_reversa_sdd/packages/db-client/requirements.md:NFR-03`
**Description:** NFR-03 explicitly acknowledges "No audit of remaining `traverse()` call sites exists in this SDD." Since traverse() now throws at runtime, any un-migrated call site will cause a runtime error in production.
**Why it matters:** If there are live code paths (even rarely-triggered ones) still calling `traverse()`, they will throw unexpectedly. The synthesis-coordinator design mentions the deprecated graph path still contains unreachable code — but other consumers have not been audited.
**Fix required:** Run `grep -rn "\.traverse(" workers/ packages/ --include="*.ts"` to find all remaining call sites. Document them. Each one is a live runtime bomb.

---

### GAP-08: inventory.md still shows ArangoDB as primary storage

**Location:** `_reversa_sdd/inventory.md:186, 190, 212, 230`
**Description:** inventory.md (dated 2026-06-08, partially patched 2026-06-10) states:
- "ArangoDB remains the durable artifact store for the Discovery Core chain" (line 186)
- "ArangoDB Collections (Live Artifact Store)" (line 190)
- "ArangoDB | HTTP/REST (arangosh-compatible) | Artifact persistence, lineage graph" (line 212)
- "All artifacts are persisted to ArangoDB with lineage edges" (line 230)
After the D1 migration, these statements are superseded. D1 is now the primary store.
**Why it matters:** inventory.md is the entry point for new developers exploring the system. Stale statements create a wrong mental model.
**Fix required:** Update inventory.md storage section to reflect the D1-primary, ArangoDB-legacy split. Reference ADR-010.

---

### GAP-09: synthesis-coordinator — ArangoDB context prefetch is unreachable but undocumented as stale in design.md

**Location:** `_reversa_sdd/synthesis-coordinator/design.md` execution flow, step "prefetchAgentContext() → ArangoDB context (unreachable in practice)"
**Description:** The design.md documents this step and correctly notes it is unreachable. However it still describes the ArangoDB context prefetch pattern as if it's the target state. When the ADR-009 gate is eventually removed (if it is), the agent context prefetch would need to be migrated to D1 SQL before it can run.
**Why it matters:** Medium — the comment "unreachable in practice" is present, but a future developer activating this path will encounter ArangoDB calls in a D1-primary environment.
**Fix required:** Add a note in synthesis-coordinator/design.md: "prefetchAgentContext() uses ArangoDB HTTP queries. If ADR-009 gate is ever removed, this function must be migrated to D1 SQL before activation."

---

## COSMÉTICO (documentation hygiene only)

### GAP-10: questions.md Q-01 and Q-04 resolved but not removed from original file

**Location:** `_reversa_sdd/questions.md`
**Description:** Q-01 (AQL lineage) and Q-04 (AtomExecutor protocol) are now resolved by the diff patch. The original questions.md file (pre-patch) still shows them as open with `_(fill in here)_` answers. This Reviewer run has updated questions.md with resolution notes.
**Status:** Addressed in this review run.

---

### GAP-11: confidence-report.md ff-gates unit shows T-05 reclassified 🟢→🟡 for AQL

**Location:** `_reversa_sdd/confidence-report.md:68`
**Description:** The original confidence-report reclassified T-05 as 🟡 because "Exact AQL pattern inferred". Now confirmed as 🟢 — D1 CTE confirmed from source.
**Status:** Addressed in this review run via new confidence-report.md.

---

### GAP-12: gascity-supervisor/requirements.md NFR-03 (binary opacity) is expected but undocumented in impact matrix

**Location:** `_reversa_sdd/gascity-supervisor/requirements.md:NFR-03` and `_reversa_sdd/traceability/spec-impact-matrix.md`
**Description:** The spec-impact-matrix.md has a `GasCitySupervisor` row but only lists impact on `gascity-dispatch` as CRITICAL. It does not reflect that the `gc-linux-amd64` binary is an opaque external dependency — any binary update requires an incremented `SUPERVISOR_SINGLETON` suffix, which is a manual operational step not captured in the matrix.
**Status:** Cosmetic — the matrix covers code dependencies, not operational procedures.

---

# KSP Section — Gaps from Reviewer KSP Run (2026-06-10)

> Added by: Reviewer KSP run · Source: 7 KSP SDD modules reviewed against CLAUDE.md spec

---

## CRÍTICO (KSP — blocker for spec accuracy or implementation)

### GAP-KSP-01: Package naming ambiguity — @koales/* vs @factory/* for base packages

**Severity:** CRÍTICO
**Location:** All KSP SDD modules; `ksp-gears/requirements.md:NFR-07`; CLAUDE.md `/tmp/ksp-impl/ksp-impl-specs/CLAUDE.md` package topology
**Description:** CLAUDE.md (the authoritative implementation spec) uses `@koales/artifact-graph`, `@koales/bead-graph`, and `@koales/loop-closure` for the three base KSP packages. All 7 KSP SDD modules consistently use `@factory/artifact-graph`, `@factory/bead-graph`, `@factory/loop-closure`. The `ksp-gears/requirements.md` NFR-07 acknowledges this conflict and states the mapping rule but marks it as 🟡 confidence. The CLAUDE.md also uses `@koales/bead-graph` in its own package topology listing (Phase 1-4 build order). This creates a direct conflict between the spec's package.json `name` fields and the CLAUDE.md implementation names.

**Impact:** An implementor following CLAUDE.md creates packages named `@koales/*`; an implementor following the SDD creates packages named `@factory/*`. If both try to reference the same workspace dependency, resolution fails.

**Fix required:** (a) Wes confirms `@factory/*` is canonical — update CLAUDE.md (external, not in this repo) to note the rename. (b) The SDD files are correct as-is. No SDD changes needed once Wes confirms direction. See Q-11.

---

### GAP-KSP-02: `getActiveSpecification` called in loop-closure but not defined in artifact-graph

**Severity:** CRÍTICO
**Location:** `ksp-loop-closure/design.md` §Bridge Point 1; `ksp-artifact-graph/requirements.md` FR-12 (10-method list)
**Description:** `LoopClosureService.openSession()` calls `artifactGraphDO.getActiveSpecification(ns, domain)`. This method is NOT in `ArtifactGraphDOBase`'s 10-method contract (FR-12). It is not in any SPEC-KSP-ARTIFACT-GRAPH-001 section. This means either: (a) it is a `FactoryArtifactGraphDO` domain method that loop-closure should not call directly (architectural violation — NFR-07 says no factory-specific imports), or (b) it was intended as a base class method that was accidentally omitted from the spec.

**Impact:** `ksp-loop-closure` will fail to compile at Task 25a because `ArtifactGraphDOBase` does not expose `getActiveSpecification`. This is a compile blocker on Step 25.

**Fix required:** Wes confirms resolution: either add `getActiveSpecification` to `ArtifactGraphDOBase` (and define its SQL — likely `walkLineageBackward(ns, 'version_of')` to find the head Specification), or make it domain-injectable via `LoopClosureConfig`. See Q-12.

---

### GAP-KSP-03: `dispositionEventId` undefined in Bridge Point 5 — tasks.md does not generate it

**Severity:** CRÍTICO
**Location:** `ksp-loop-closure/design.md` §Bridge Point 5 Step 3; `ksp-loop-closure/tasks.md` Task 25e
**Description:** Bridge Point 5 Step 3 writes `artifactGraphDO.upsertEdge(eaId, dispositionEventId, 'produced_at')` but `dispositionEventId` is never defined or assigned anywhere in the six-step sequence. The design.md Open Gaps section acknowledges this. However, tasks.md (Task 25e `adoptAmendment`) does not instruct the implementor to generate the DispositionEvent node or its ID. An implementor following tasks.md will write code referencing an undefined variable.

**Impact:** Runtime error in `adoptAmendment`. The `produced_at` edge cannot be written without a DispositionEvent node ID. Tasks.md is incomplete.

**Fix required:** Add an explicit sub-step to Task 25e: "Before Step 3, generate `dispositionEventId = generateId('disposition-event')` and call `artifactGraphDO.upsertNode(dispositionEventId, 'DispositionEvent', { amendment_id: amendmentId, adopted_at: Date.now() })`. Then write the `produced_at` edge."

---

### GAP-KSP-04: ksp-sdk tasks.md labels module as "Phase 3" — conflicts with requirements.md

**Severity:** COSMÉTICO (but confusing for implementors)
**Location:** `ksp-sdk/tasks.md` prerequisite gate header; `ksp-sdk/requirements.md` NFR-03
**Description:** tasks.md prerequisite header states "This module is Phase 3. Do not begin any task below until Phase 2 (`@factory/bead-graph`) compiles clean". But requirements.md NFR-03 and the architecture.md KSP package build order correctly identify ksp-sdk as Phase 2. CLAUDE.md labels it "Phase 3 — @factory/knowing-state-sdk" because it is the third item in the reading order (after artifact-graph and bead-graph), not because it is build Phase 3. The confusion: CLAUDE.md uses "Phase" to mean "reading sequence group", while SDD uses "Phase" to mean "dependency tier". Tasks.md has adopted the CLAUDE.md sequence numbering which conflicts with the SDD tier numbering.

**Fix required:** Update ksp-sdk/tasks.md prerequisite gate to clarify: "This module is Phase 2 in the KSP dependency order (depends only on bead-graph). It is listed as Phase 3 in the CLAUDE.md implementation sequence table (Step 21) where phases refer to implementation reading order groups, not dependency tiers." See Q-14.

---

## MODERADO (KSP — impacts spec usability but not blocking)

### GAP-KSP-05: ksp-loop-closure and ksp-factory-graph missing contracts.md

**Severity:** MODERADO
**Location:** `_reversa_sdd/ksp-loop-closure/` (3 files: design, requirements, tasks); `_reversa_sdd/ksp-factory-graph/` (3 files)
**Description:** `ksp-artifact-graph`, `ksp-bead-graph`, `ksp-gears`, and `ksp-flue-workflow` all have a `contracts.md` file alongside their 3 canonical files. `ksp-loop-closure` and `ksp-factory-graph` do not. For `ksp-loop-closure`, a contracts.md would document the 5 bridge point method signatures, the `LoopClosureConfig` interface, and the injectable function type signatures — all of which are the critical API surface for callers. For `ksp-factory-graph`, it would document the injectable function signatures.

**Fix required:** Generate `ksp-loop-closure/contracts.md` and `ksp-factory-graph/contracts.md` documenting the public API signatures. These are referenced implicitly by ksp-gears (which instantiates `LoopClosureService` in `recordOutcome()`).

---

### GAP-KSP-06: ff-pipeline/design.md does not acknowledge @factory/gears dispatch path

**Severity:** MODERADO
**Location:** `ff-pipeline/design.md` — dispatch section; `ksp-gears/requirements.md` FR-08
**Description:** The reviewer check explicitly asked: "Does ff-pipeline SDD need updating? (ff-pipeline now dispatches via @factory/gears for atoms, not direct Gas City)." The current `ff-pipeline/design.md` documents `compileAndDispatchFormula()` via `GAS_CITY` service binding (line 87: "dispatch-formula [GAS_CITY service binding, keepalive start+stop]"). The KSP spec intends that atom dispatch goes through `CoordinatorDO` (in `@factory/gears`) — not through the Gas City Worker service binding. However, the ff-pipeline/design.md dispatch path is the Gas City era path (ADR-009). The KSP path is a forward-spec not yet integrated into ff-pipeline. The ff-pipeline SDD is internally consistent with its documented Gas City era behavior.

**Conclusion:** No update needed to ff-pipeline/design.md — it correctly documents the current deployed behavior. The KSP path (`@factory/gears CoordinatorDO`) replaces the Gas City path in future. The spec-impact-matrix.md already shows `@factory/gears` impacts ff-pipeline CRITICAL.

---

### GAP-KSP-07: synthesis-coordinator/design.md does not note CoordinatorDO is now in @factory/gears

**Severity:** MODERADO
**Location:** `synthesis-coordinator/design.md` — overview section
**Description:** The reviewer check asked: "Does synthesis-coordinator SDD note that CoordinatorDO is now in @factory/gears, not coordinator.ts?" The current synthesis-coordinator/design.md describes `SynthesisCoordinator extends Agent<CoordinatorEnv>` as the coordinator. The new KSP `CoordinatorDO` (in `@factory/gears`) is a different class entirely — it's a bead lifecycle coordinator, not the synthesis agent graph coordinator. These are different concepts that happen to share "Coordinator" in the name. There is no naming conflict in practice, but a reader may confuse them.

**Fix required:** Add a note to synthesis-coordinator/design.md overview: "Note: `@factory/gears` introduces a separate `CoordinatorDO` class for KSP bead lifecycle management. This class is unrelated to `SynthesisCoordinator`. The naming similarity is coincidental."

---

### GAP-KSP-08: gascity-supervisor/design.md does not reference CoordinatorDO relationship

**Severity:** MODERADO
**Location:** `gascity-supervisor/design.md` — overview
**Description:** The reviewer check asked: "Does gascity-supervisor SDD reference the CoordinatorDO relationship correctly?" The gascity-supervisor/design.md does not mention `CoordinatorDO` at all, which is correct — in the current Gas City era, Gas City supervisor handles bead execution independently. In the KSP era, `CoordinatorDO` replaces Gas City as the bead lifecycle owner. The gascity-supervisor SDD is accurate for current deployed behavior. A forward note about the KSP transition would be useful.

**Fix required:** Add a note to gascity-supervisor/design.md: "In the KSP era (Phase 4+ build), `@factory/gears:CoordinatorDO` replaces Gas City as the per-run bead lifecycle owner. GasCitySupervisor continues to host the Git execution environment (Container DO) but bead state tracking transitions to CoordinatorDO."

---

## COSMÉTICO (KSP — documentation hygiene)

### GAP-KSP-09: @koales/* references in code-analysis.md, domain.md, flowcharts, and ADR-KSP-005

**Severity:** COSMÉTICO
**Location:** `code-analysis.md:3804-3806`, `domain.md:226,262`, `flowcharts/ksp-gears.md:14`, `adrs/ADR-KSP-005-ksp-sdk-isolation.md`
**Description:** Several cross-cutting artifacts still use `@koales/*` package names in code examples and explanatory text. The SDD unit files consistently use `@factory/*`. Once GAP-KSP-01 is resolved (Q-11), any remaining `@koales/` references in the SDD should be updated to `@factory/` for consistency. Current state: these references exist as "former name" context which is accurate per the historical evolution described in ksp-flue-workflow headers.

**Fix required:** After Q-11 resolution, update `adrs/ADR-KSP-005-ksp-sdk-isolation.md` code examples (lines 33-36) from `@koales/bead-graph` to `@factory/bead-graph`. Update `flowcharts/ksp-gears.md` participant label. The `domain.md:226,262` references are explicit acknowledgement of the naming evolution and may be left as historical context.

---

### GAP-KSP-10: ksp-artifact-graph design.md §4.2 lists wrong consumer package names

**Severity:** COSMÉTICO
**Location:** `ksp-artifact-graph/design.md` §4.2 (What Calls This Package)
**Description:** The table lists `@factory/ksp-sdk (Phase 2)` as importing `ArtifactNode, ArtifactEdge types only`. In practice, `@factory/ksp-sdk` only re-exports from `@factory/bead-graph` — it does not import from `@factory/artifact-graph`. The loop-closure package (not ksp-sdk) uses artifact graph types. The consumer table is slightly inaccurate for ksp-sdk.

**Fix required:** Remove the ksp-sdk row from §4.2 or correct it to note "ksp-sdk does NOT import @factory/artifact-graph; only @factory/loop-closure and @factory/factory-graph do."

---

## Patch 2026-06-13 Gaps (Flue Retirement + New KSP Specs)

### GAP-THINK-01: claimBead Never Called Before ThinkExecutor.executeAtom()

**Severity:** CRÍTICO
**Location:** `packages/gears/src/agents/think-executor.ts` — `executeAtom()` method
**Description:** `ThinkExecutor.executeAtom()` does not call `claimHook(coordinatorDO, directive.atomId, directive.directiveId)` before executing. `releaseBead()` and `failBead()` in `CoordinatorDO` use `WHERE id=? AND assigned_to=?`. Since `assigned_to` is NULL (claim never happened), both UPDATE statements silently match 0 rows. The bead stays `ready` forever. The 5-min stale-bead alarm will re-dispatch it, creating an infinite execution loop.
**Fix required:** Add `await claimHook(coordinatorDO, directive.atomId, directive.directiveId)` as the first step of `executeAtom()`. If claim returns null (bead already claimed by another agent), abort execution.
- Source: `coordinator-do.ts:154-162` (claimBead), `think-executor.ts:63-112` (no claim); 🟢 CONFIRMADO gap

### GAP-THINK-02: /consent Route Missing in CoordinatorDO

**Severity:** CRÍTICO
**Location:** `packages/gears/src/beads/coordinator-do.ts` — `fetch()` handler
**Description:** `ConsentBeadAuditProcessor` POSTs to `CoordinatorDO /consent` for every tool call to write an audit record before checking the `permittedTools` allowlist. The `/consent` route does not exist in `CoordinatorDO.fetch()` — returns 404. The audit trail for tool calls is silently broken. I4 enforcement (ConsentDeniedError) still fires correctly because it's checked after the DO fetch, but no ConsentBead records are persisted.
**Fix required:** Add `if (url.pathname === '/consent') { ... }` handler to `CoordinatorDO.fetch()` that persists a ConsentBead record (beadId, toolName, toolCallId, timestamp) to the DO's SQLite storage.
- Source: `consent-bead-audit-processor.ts:44-54` (POST /consent), `coordinator-do.ts:284-296` (no /consent case); 🟢 CONFIRMADO gap

### GAP-THINK-03: No Auto-Dispatch of Next Ready Bead After ThinkExecutor Completes

**Severity:** MODERADO
**Location:** Queue execution path — no owner
**Description:** After `ThinkExecutor` completes (releases or fails a bead), nothing queries `CoordinatorDO.getNextReady()` and sends the next `synthesis-queue` message. The old `atom-results` consumer re-dispatches dependent atoms for the legacy `AtomExecutor` path via the completion ledger. The new KSP `ThinkExecutor` path does not publish to `atom-results` and has no equivalent chaining mechanism. Multi-bead molecules stall after the first bead completes.
**Fix required:** Either (a) `ThinkExecutor` publishes to `atom-results` after completion so the existing ledger-based re-dispatch fires, or (b) a new `coordinator-dispatch` queue consumer polls `getNextReady()` after each bead completion.
- Source: `queue-handler.ts:166-316` (atom-results consumer, ledger re-dispatch for old path); 🟢 CONFIRMADO gap

### GAP-SOURCE-GRAPH-01: SOURCE_GRAPH DO Binding Not in wrangler.jsonc or PipelineEnv

**Severity:** MODERADO (blocks BP6 wiring)
**Location:** `workers/ff-pipeline/wrangler.jsonc`, `_reversa_sdd/ff-pipeline/design.md`
**Description:** SPEC-KSP-LOOP-CLOSURE-001-AMENDMENT-BP6 §8e requires adding a `SOURCE_GRAPH` DO binding to `wrangler.jsonc` and `PipelineEnv` for factory-side wiring of `ingestSpecification`. Neither exists yet. This is a spec-draft gap — the spec is not yet implemented — but must be tracked.
**Fix required:** Once `SourceGraphDO` is implemented (SPEC-KSP-SOURCE-GRAPH-001), add `{ "name": "SOURCE_GRAPH", "class_name": "SourceGraphDO" }` to `wrangler.jsonc` durable_objects.bindings and corresponding migration tag. Add `SOURCE_GRAPH: DurableObjectNamespace` to PipelineEnv.
- Source: BP6 amendment §8e; 🟡 INFERIDO (spec-draft, implementation pending)

### GAP-SOURCE-GRAPH-02: tessera-shared Schema Update Is Untracked Architecture Gate

**Severity:** CRÍTICO (blocks SPEC-KSP-SOURCE-GRAPH-001 entirely)
**Location:** External — `tessera-shared` package in Tessera repo
**Description:** SPEC-KSP-SOURCE-GRAPH-001 §8 mandates adding SR types (Capability, Initiative, Decision, Thesis, Assumption, Constraint, Option, Risk, Metric, Stakeholder, Dependency, Tradeoff, Evidence) to `NODE_TABLES` + `NodeLabel`, and adding SUPPORTS/CONTRADICTS/CONSTRAINS/etc. to `REL_TYPES` + `RelationshipType` in `tessera-shared`. This is a cross-repo architecture gate in the Tessera repository. No implementation tracking exists in function-factory. Without this, the management adapter cannot use typed labels and the Source Graph stores free-form strings.
**Fix required:** Create a Tessera-side task (or Linear ticket) for `tessera-shared` schema update. Add prerequisite note to SPEC-KSP-SOURCE-GRAPH-001 implementation plan.
- Source: SPEC-KSP-SOURCE-GRAPH-001 §8; 🟢 CONFIRMADO prerequisite gap

### GAP-SOURCE-GRAPH-03: Source Graph Requires New D1 Database — Not Yet Provisioned

**Severity:** MODERADO
**Location:** `workers/ff-pipeline/wrangler.jsonc` — d1_databases
**Description:** SPEC-KSP-SOURCE-GRAPH-001 §3.1 defines `sg_nodes` and `sg_relationships` tables. These require a new D1 database (separate from `ff-factory` and `factory-bead-audit`). No `source-graph` D1 binding exists in `wrangler.jsonc`. Mixing Source Graph tables into `ff-factory` would violate the 128 MB D1 limit at scale.
**Fix required:** Provision `wrangler d1 create factory-source-graph` and add `{ "binding": "D1_SOURCE", "database_name": "factory-source-graph", "database_id": "..." }` to wrangler.jsonc.
- Source: SPEC-KSP-SOURCE-GRAPH-001 §3.1; 🟡 INFERIDO (provisioning not shown in spec, separation is implied by design constraints)

### GAP-BP6-01: SpecificationIngester Type Not Yet in packages/loop-closure

**Severity:** MODERADO (blocks BP6 implementation)
**Location:** `packages/loop-closure/src/types.ts` (or service.ts)
**Description:** SPEC-KSP-LOOP-CLOSURE-001-AMENDMENT-BP6 requires adding `SpecificationIngester` type and `ingestSpecification?: SpecificationIngester` field to `LoopClosureConfig`. Neither exists yet in the loop-closure package. `adoptAmendment()` does not call any BP6 hook.
**Fix required:** Add types (§Config Addition in BP6 spec) and non-fatal call (§Service Addition) to `packages/loop-closure/src/service.ts`.
- Source: `loop-closure/src/service.ts:344-346` (adoptAmendment exists, BP6 hook missing); 🟢 CONFIRMADO gap
