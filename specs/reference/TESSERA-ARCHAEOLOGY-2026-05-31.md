# Tessera Archaeology — Session 2026-05-31

**Type:** Discovery log — non-obvious findings from codebase exploration
**Session:** 2026-05-31 (Tessera cloud architecture + domain adapter suite)
**Repos explored:** tessera, function-factory, gascity, weops-enterprise

This document preserves insights that are not derivable from the current code or spec files alone — things discovered by digging, cross-referencing, and running Tessera queries across repos. Intended to survive context loss and prevent re-investigation.

---

## 1. Tessera Core — Correctness Bugs Found and Fixed

### Impact direction was backwards in every cloud draft (C1)

The v0.1 cloud spec wrote impact analysis as a forward traversal (following `CALLS` edges from target to callees). The real engine (`local-backend.ts:_runImpactBFS`) traverses **backward** — `INBOUND` edges to find callers. "Who breaks if I change X" means finding nodes whose edges point AT X, not nodes X points at.

**Ground truth:** `local-backend.ts:1716` — `MATCH (caller)-[r:CodeRelation]->(n {id: $symId})` for upstream.

**Decision:** `upstream` = `INBOUND` (callers, "who breaks"), `downstream` = `OUTBOUND` (callees, "what does this depend on").

### Classes and Interfaces return zero impact without seeding fix (C2 / GT-CTX480)

Classes and Interfaces have **no direct CALLS or IMPORTS edges** in the graph. Their callers reach them through Constructor nodes (via `HAS_METHOD`) and File nodes (via `DEFINES`). A naive traversal starting at a Class returns empty — the seed nodes themselves are the fix.

**Ground truth:** `local-backend.ts:1724-1800` — BFS seeding expansion for Class/Interface, documented as fix #480.

**Seeding rule:** When `target.kind IN ["Class", "Interface"]`:
1. Find Constructor nodes: 1 hop OUTBOUND via `HAS_METHOD`, filtered to `kind == "Constructor"`
2. Find owning File: 1 hop INBOUND via `DEFINES`, filtered to `kind == "File"`
3. Traverse INBOUND from both seed sets
4. Never return the seed nodes themselves (Constructors and Files are containers, not dependents)

### Risk thresholds: GT-RISK is authoritative, not the simple 5/10 heuristic

The simple thresholds (CRITICAL = d1 > 10) were invented for the cloud spec. The production thresholds from `local-backend.ts:2937-2948` are:

```
CRITICAL  directCount >= 30  OR  processCount >= 5  OR  moduleCount >= 5  OR  total >= 200
HIGH      directCount >= 15  OR  processCount >= 3  OR  moduleCount >= 3  OR  total >= 100
MEDIUM    directCount >= 5   OR  total >= 30
LOW       everything else
```

V1 caveat: process and module detection are deferred to V2, so only `directCount` and `total` are active.

### Confidence floors: HAS_METHOD is 0.95, not 0.85

GT-CONF (`local-backend.ts:144-154`):
```
CALLS / IMPORTS           → 0.90
EXTENDS / IMPLEMENTS      → 0.85
METHOD_OVERRIDES          → 0.85
METHOD_IMPLEMENTS         → 0.85
HAS_METHOD / HAS_PROPERTY → 0.95   ← commonly misstated as 0.85
CONTAINS                  → 0.95
fallback                  → 0.50
```

Rule: stored edge confidence is used when `> 0`; per-type floor is the fallback only.

### The MCP surface is 13 tools, not 6

`tessera/src/mcp/tools.ts` exposes 13 tools: `list_repos`, `query`, `cypher`, `context`, `detect_changes`, `rename`, `impact`, `route_map`, `tool_map`, `shape_check`, `api_impact`, `group_list`, `group_sync`.

`rename` is a **write** tool — it cannot be served by a read-only DO or a stateless Worker. Architecture: read-only plan from the graph + ephemeral Worker that opens a PR.

`group_*` tools are the cross-repo bridge (`tessera/src/core/group/cross-impact.ts`), implementing confidence-scored `ContractLink` edges between repos. V2 — needs a bridge DO or cross-repo coordination.

---

## 2. LadybugDB — Bugs Fixed

### "basic_string" Cypher error is a corrupt index symptom, not a query bug

When the graph was loaded with 0 nodes (from a failed first analyze), KuzuDB threw `std::basic_string` C++ exceptions on any Cypher query. The error message is a raw C++ type name with no context.

**Root cause:** Two concurrent `tessera analyze` processes on the same repo deleted each other's WAL files mid-checkpoint. The first process's WAL was deleted by the second process's cleanup, causing DuckDB's COPY checkpoint to fail with "No such file or directory."

**Fix shipped:** Three changes to `tessera/src/core/`:
1. `run-analyze.ts` — PID-based lock file (`.analyzing`) prevents concurrent analyze
2. `run-analyze.ts` — post-load integrity check: throws if 0 nodes loaded
3. `pool-adapter.ts` — catches `basic_string`, `bad_alloc`, `runtime_error` and re-throws with actionable message ("run `--force` to rebuild")

**Commit:** `3748e925` on `main`.

### function-factory re-index revealed better stats

First (corrupt) index: 13,612 nodes, 12,207 edges.
After `--force` re-index: 15,467 nodes, 24,286 edges, 512 clusters, 300 flows.
The first analyze was racing with itself.

---

## 3. Factory Architecture — Discoveries

### The Factory loop is Specification → Verification → Execution, not a PR loop

The Factory does not follow a "write code → open PR → review → merge" loop. It follows:
**Specification** (IS → ES → EP) → **Verification** (coherence VR, fidelity VR) → **Execution** (Gas City runs the formula) → **back to Specification** if verification fails.

GasCity agents in the factory config: only **two roles**:
- `control-dispatcher` — singleton, routes work, manages molecule lifecycle
- `coder` — pool of 3, executes harness steps via `pi-rpc` to ff-pipeline

Harness tuple slots (E, T, C, S, L, V, G, P) are pipeline stages, not agent roles.

### Factory IS format — the compilation input

The Factory compiles **Intent Specifications (IS-*)** — markdown files with YAML frontmatter containing:
```yaml
id: IS-*
version: N
sourceCapabilityId: BC-*
sourceFunctionId: FP-*
source_refs: [...]
explicitness: explicit
rationale: >
  ...
```
Followed by sections: JTBD, Problem, Goal, Scope (in/out), Acceptance Criteria (numbered AC-*), Environment dependencies, Non-negotiables, Success Metrics.

The pipeline: Signal (SIG-*) → Pressure (PRS-*) → Capability (BC-*) → Function Proposal (FP-*) → Intent Specification (IS-*) → Executable Specification (ES-*) → Function (FN-*).

### The 3 "critical bugs" from May 18 session are moot

The May 18 session identified 3 critical bugs: `buildStageContextForRun` pre-try placement, `notifyWorkflowComplete` swallowing sendEvent failures, and `harness-dlq` having no consumer. By the 2026-05-31 session:
- `buildStageContextForRun` doesn't exist in the current codebase
- `harness-dlq` and `harness-queue` are explicitly deprecated: "removed in the Gas City era; acknowledging stale message" (`index.ts:1388`)
- The harness queue system has been superseded by the Gas City architecture

### ArangoDB is staying — DO artifact migration failed

The `DO-BEAD-STORE-ARCHITECTURE.md` spec targeted replacing both bd/Dolt beads AND ArangoDB artifacts with a single FactoryStore DO. The artifact migration didn't work. ArangoDB reverted.

**Impact on Tessera:** The Tessera cloud spec went through 3 versions before landing on ArangoDB as the graph store:
- v0.1: DO + SQLite (wrong — invented infrastructure)
- v0.2: DO + SQLite (corrected direction/seeding, but DO substrate abandoned)
- v1.0 (current): ArangoDB (proven infrastructure, already deployed)

The ArangoDB choice is grounded in the same reasoning as every other Factory storage decision: proven > invented.

---

## 4. WeOps / k-dense — Discoveries

### k-dense is a governed capability registry, not just a document corpus

134 k-dense scientific skills were loaded into WeOps as `corpus/skill_definitions.json` and validated through the WeOps governance kernel via `cmd/kdense-harness`. The harness runs 10 test cases per skill through the PDP (Policy Decision Point):

- 134 skills × 10 TC = 1,340 test cases, 3,082 assertions
- Last run (2026-04-16): 1,206 pass / **938 fail**
- Root cause: TC-01, TC-02, TC-10 used autonomy tier `T0` instead of `T1`; `T0 + tool.invoke = DENY` per `pdp.go:checkAutonomyGate`
- Secondary: deny reasons were silently dropped (harness read `body["errors"]`, kernel returned `body.result.reasons`)

**Documented in:** `tasks/kdense-tier-fix/task.md`, `tasks/kdense-harness-deny-trace/spec.md`

### WeOps knowledge module KT suite — clinical data contracts

`tests/knowledge/knowledge_integration_test.go` — 10+1 integration tests (KT-01 through KT-10 + KTExtra) define the actual clinical knowledge module contract:
- KT-01: Ingest clinical document → search by condition (Hypertension)
- KT-02: Entity graph with TREATS / PREVENTS relations (Warfarin TREATS DVT, Aspirin PREVENTS DVT)
- KT-03: ICD-10 ontology registration and term resolution
- KT-04: Cross-corpus access control
- KT-05: Local vs global graph query modes
- KT-06: Evidence trail completeness
- KT-07: Domain event emission
- KT-08: CareGraph vs Cognifiq assembly config isolation
- KT-09: Idempotent re-ingest
- KT-10: Validation denials
- KTExtra: Multi-hop traversal depth

These are the ground truth for any medicine/clinical domain adapter, not `defaults.go` which is a product config file.

### WeOps assembly configs — 10 domains defined

`pkg/knowledge/assembly/defaults.go` defines entity schemas for:
CareGraph (clinical), Cognifiq (cognitive science/research), FocusFlow (productivity), Marketing, Engineering, Ops, Strategy, LoveFlow, MiddleCare (HIPAA care coordination), Canvas.

The entity ontology codes in CareGraph: ICD-10, RxNorm, SNOMED CT, LOINC.

**Key insight:** `defaults.go` is one company's product configuration. The real domain ground truth for medicine/science is the standards themselves (FHIR, SNOMED, UMLS, PROV-O).

---

## 5. Domain Adapter Architecture — Key Insights

### The DomainAdapter interface is the right abstraction

The same 3-method interface (`id`, `filePatterns`, `extract()`, `resolveRelations()`) powers code (tree-sitter), management (Strategy.Recipes), spec (IS-*/BC-* YAML), skills (k-dense SKILL.md), and governance (PDP rules). No interface changes needed for any new domain.

**Critical:** `filePatterns` uses picomatch glob matching. The skills adapter must use schemaVersion detection for JSON files to avoid routing all JSON files to the management adapter.

### Management adapter is the domain-neutrality proof

The management adapter (921 lines, 46 tests, proven on real Strategy.Recipes data) demonstrates that community detection, impact analysis, and process tracing run unmodified on non-code data:
- Modularity: 0.4356 on a 36-entity recipe
- 11 communities detected: execution_core, sequence_strategy, qualification_logic, market_thesis, etc.
- Entity kinds: signal, thesis, constraint, stakeholder, assumption, decision, initiative, metric, risk, evidence
- Relation types: motivates, supports, constrains, depends_on, validates, threatens, tradeoff_with, owns, measures, decomposes_into, supersedes (all prefixed `management:`)
- Legacy alias resolution: claim→thesis, note→evidence, raises→threatens, etc.

### Skills + Governance adapters compose into a governed capability graph

Both adapters write to the `weops-enterprise` slug (same ArangoDB collections). The governance adapter emits `Purpose → GOVERNS → Skill` edges connecting the two graphs. After both are indexed:
- `tessera_impact` on a ClassificationRule traverses Rule → Purpose → GOVERNS → Skill
- The 938 k-dense harness failures become a Tessera impact query: "what skills does the T0 autonomy rule affect?"

### Spec adapter closes the self-referential loop

Once IS-TESSERA-SPEC-ADAPTER is deployed, the Factory can run `tessera_impact` on its own `BC-GC-FORMULA-DISPATCH` capability and get back every IS/ES that depends on it. Changing a capability's scope becomes a graph query, not a grep.

---

## 6. Tessera CF Spec History — Why Three Versions

**v0.1 (wrong):** Impact as a single recursive SQL CTE traversing forward (callees not callers). 6 tools not 13. tree-sitter "just runs" on CF Workers (it doesn't — native binary). No cost model.

**v0.2 (corrected architecture, wrong substrate):** Fixed all correctness bugs (C1/C2/C3/C4/C5). Introduced `TesseraStore` DO + `IndexerCoordinator` DO. Cost model revealed gascity full rebuild ~$300/mo from row-write billing. IndexerCoordinator was fully specified but unproven.

**v1.0 (current, correct):** ArangoDB replaces the DO. AQL `INBOUND`/`OUTBOUND` traversal replaces application-level BFS. ArangoSearch replaces FTS5. The staged-ingest protocol collapses to ArangoDB transactions. Cost model: Container cost already paid.

**Key lesson:** The DO substrate was invented to solve a problem ArangoDB already solves — durable, queryable graph storage reachable from CF Workers. The DO designs were technically sound but unnecessary. The right call was to recognize proven infrastructure.

---

## 7. Open Items Not Yet Resolved

1. **FP-TESSERA-* function proposals** — the BC-* capabilities reference `yields.execution: FP-TESSERA-*` but the FP-* YAML files don't exist. The Factory generates these from capabilities — they are Factory output, not human-authored.

2. **P0 open questions in TESSERA-CF-SPEC.md** — 4 unresolved: CF DO SQLite `auto_vacuum` support (no longer relevant), WASM parser parity with native tree-sitter, per-tick CPU budget for gascity indexing, row-write budget approval.

3. **Ingest atomicity** — TESSERA-CF-SPEC §4.4 defers the choice between stream transaction and build-aside collection swap. The readers-never-see-partial-graph invariant is unresolved.

4. **Tessera cloud is Factory's first post-dogfood candidate** — once the Factory proves itself on simpler targets, the IS-TESSERA-* suite is the first real production build. Spec quality directly determines execution quality.

5. **weops-enterprise index is stale** — indexed 2026-05-10. Needs re-indexing before any weops-enterprise Tessera queries are authoritative.
