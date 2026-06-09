# Function Factory — Ontology-Aligned Refactoring Plan

**Date:** 2026-05-07
**Input:** FF-ONTOLOGY v0.2, current repo state (38 files, 47 dirs, mostly skeleton)
**Purpose:** Make the repo legible to bootstrap agents by aligning its structure, naming, and entry points with the ontology

---

## What the Repo Looks Like Now

Two packages have source (schemas, compiler skeleton). Six packages are empty directories. All seven `specs/` buckets are empty. Eight SKILL.md files use numbered stage/gate language. AGENTS.md is the entry point but speaks the old vocabulary (Stage 5, Coherence Verification/2/3, 8-pass compiler). The schemas package uses implementation names (Intent Specification, Executable Specification, VerificationCoherenceVerificationReport) rather than ontological names.

A bootstrap agent reading this repo today has to mentally translate between implementation addresses and architectural concepts on every file it touches. The refactoring eliminates that translation cost.

---

## Principles

**Rename toward concepts, not numbers.** An agent reading a directory name should know what *kind* of thing lives there without consulting a lookup table.

**The ontology is the AGENTS.md.** The ontology document becomes the primary architectural reference. AGENTS.md points to it first, then to specific working locations.

**Separate charter from harness.** The current SKILL.md files blend shared runtime policy with task-specific control logic. Split them so an agent knows which parts are non-negotiable substrate and which parts are the task it's working on.

**Implementation mapping lives in code comments, not in the ontology.** The ontology says what things are. Package READMEs say where the code is.

**Sequence by dependency, not by stage number.** The build order follows what blocks what, not the pipeline's logical numbering.

---

## Phase A: Legibility (no new code — renaming, splitting, documentation)

This phase produces zero new functionality. It makes the existing skeleton readable by an agent that has internalized the ontology. Every change is a rename, a split, or a documentation update.

### A.1 — Place the ontology in the repo

```
.agent/
  ONTOLOGY.md          ← FF-ONTOLOGY v0.2 (the primary architectural reference)
  AGENTS.md            ← rewritten to point to ONTOLOGY.md first
```

Rewrite AGENTS.md to say: "Read ONTOLOGY.md for what things are. Read this file for where things live and what to do next." Remove all stage numbers and gate numbers from AGENTS.md. Replace with ontological names.

### A.2 — Rename specs/ directories

Current → Renamed:

```
specs/pressures/         → specs/pressure-artifacts/
specs/capabilities/      → specs/capability-artifacts/
specs/functions/         → specs/function-proposals/
specs/intent-specifications/              → specs/intent-specifications/
specs/executable-specifications/        → specs/executable-specifications/
specs/invariants/        → specs/invariant-specifications/
specs/verification-reports/  → specs/verification-reports/
```

Each directory gets a README.md that quotes the ontological definition verbatim and names the Zod schema that validates its contents.

### A.3 — Rename packages/ directories

Current → Renamed:

```
packages/compiler/         → packages/compilation/
packages/verification/   → packages/verification/
packages/assurance-graph/  → packages/assurance/
packages/runtime/          → packages/persistence-verification/
packages/harness-bridge/   → packages/harness-adapters/
packages/schemas/          → packages/schemas/  (unchanged — canonical)
```

Each package gets a README.md stating which ontological category it implements, what axioms constrain it, and what its inputs/outputs are.

### A.4 — Restructure packages/compilation/ by transformation kind

The compiler's internal structure should reflect transformation kinds, not pass numbers.

```
packages/compilation/
  src/
    decomposition/       ← narrative → atomic claims
    binding/             ← claims → typed contracts
    obligation/          ← claims → monitored invariants
    assembly/            ← bound elements → executable graph
    certification/       ← graph → coverage verdict (internal)
    types.ts             ← shared transformation types
    pipeline.ts          ← orchestrates transformations in order
  tests/
    decomposition/
    binding/
    obligation/
    assembly/
    certification/
```

`pipeline.ts` is the *only* file that knows execution order. Every transformation module is independently testable. An agent assigned to implement Binding doesn't need to know about Decomposition's internals — only its output type.

### A.5 — Restructure packages/verification/ by verification kind

```
packages/verification/
  src/
    coherence/           ← structural completeness of static artifacts
    fidelity/            ← behavioral correspondence under simulation
    shared/
      types.ts           ← VerificationReport, Verdict, Evidence types
      fail-closed.ts     ← shared enforcement: default block, evidence-required pass
  tests/
    coherence/
    fidelity/
```

Persistence Verification stays in `packages/persistence-verification/` because it has fundamentally different temporal characteristics (unbounded, continuous) and different infrastructure dependencies (deployed system monitoring, not pipeline artifact checking).

### A.6 — Split SKILL.md files into charter and harness

Current state: eight SKILL.md files mixing runtime policy with task logic.

Split into:

```
.agent/
  charter/                          ← RUNTIME CHARTER (shared, non-negotiable)
    CHARTER.md                      ← single document: extracted from all skills
    verification-enforcement.md     ← fail-closed rules, acceptance derivation
    lineage-discipline.md           ← per-transformation write rules
    artifact-persistence.md         ← path-addressable, compaction-stable
    agent-lifecycle.md              ← contract, execution, trace, verdict
    orchestrator-minimality.md      ← coordinator role constraints

  skills/                           ← HARNESS SKILLS (task-family-specific)
    _index.md                       ← registry (rewritten)
    factory-bootstrap/SKILL.md      ← was factory-meta
    compilation/SKILL.md            ← was prd-compiler (remove all pass numbers)
    coherence-verification/SKILL.md ← was coherence-verification
    fidelity-verification/SKILL.md  ← was fidelity-verification
    persistence-verification/SKILL.md ← was persistence-verification
    invariant-authoring/SKILL.md    ← keep (already concept-named)
    lineage-authoring/SKILL.md      ← was lineage-preservation
    memory-manager/SKILL.md         ← keep
```

Each harness skill is rewritten to satisfy the NLAH component checklist (ontology axiom: Harness Completeness). That means every skill must have: contracts, roles, stage structure, adapters/scripts, state semantics, **failure taxonomy**. The failure taxonomy is new — none of the current skills have one.

### A.7 — Rename schema types

In `packages/schemas/src/`:

```
core.ts renames:
  Intent SpecificationSchema             → IntentSpecificationSchema
  Executable SpecificationSchema       → ExecutableSpecificationSchema
  (PressureSchema, CapabilitySchema, FunctionSchema, InvariantSchema — keep,
   already concept-named)

coverage.ts renames:
  VerificationCoherenceVerificationReport   → CoherenceVerificationReport
  VerificationFidelityVerificationReport   → FidelityVerificationReport
  VerificationPersistenceVerificationReport   → PersistenceVerificationReport
  (or better: single VerificationReport with a `kind` discriminant)

lineage.ts:
  No renames needed — already concept-named (source_refs, explicitness)
```

Export aliases for backward compatibility during transition:
```typescript
/** @deprecated Use IntentSpecificationSchema */
export const Intent SpecificationSchema = IntentSpecificationSchema
```

### A.8 — Add failure taxonomy template

Create a template that every harness skill must include:

```
.agent/templates/
  failure-taxonomy.md   ← template with required fields
```

Required fields per failure mode: name, detection condition, recovery action (retry / regenerate / escalate / block), escalation path if recovery fails. Populate for the compilation harness skill first (the most likely first bootstrap target).

---

## Phase B: Durable State (first real code — highest-ROI module)

Pan et al.'s empirical evidence says this is the single most impactful thing to build. The ontology calls it the Durable State Module. It's the substrate everything else writes to and reads from.

### B.1 — ArangoDB read-write paths

Implement the actual CRUD operations for the artifact collections that are already designed. Every operation:

- Writes a lineage edge at the operation boundary (Lineage Completeness axiom)
- Returns a path-addressable reference (Durable State Module: path-addressable property)
- Is idempotent on retry (Durable State Module: compaction-stable property)

Package: `packages/schemas/` gets a sibling `packages/state/` (or `packages/durability/`) that owns the ArangoDB client and the read-write functions.

```
packages/state/
  src/
    client.ts            ← ArangoDB connection, retry logic
    artifact-store.ts    ← write/read/query for any artifact type
    lineage-store.ts     ← write/read/traverse for lineage edges
    types.ts             ← PathReference, StoreResult
  tests/
    artifact-store.test.ts
    lineage-store.test.ts
```

### B.2 — Verification report persistence

Verification reports are the evidence trail. Implement write paths so that when coherence verification or fidelity verification eventually runs, it has somewhere to put its results. This unblocks Phase C.

### B.3 — Execution trace persistence

Agent calls produce execution traces. Implement the trace schema and write path so that when agent calls eventually run, traces are captured for later instruction tuning and for persistence verification.

---

## Phase C: Coherence Verification (first real verification — unblocks compilation)

Coherence verification is the *first* verification kind that matters because it evaluates the compiler's output. Without it, the compiler has no external check. Build it before the compiler so the compiler has a target to satisfy.

### C.1 — Implement coherence checks

```
packages/verification/src/coherence/
  checker.ts             ← takes an executable specification, checks:
                            - every atomic claim has a downstream binding
                            - every contract is fully typed
                            - every invariant has a detector spec
                            - no orphan atoms, no untyped contracts
  report.ts              ← produces a CoherenceVerificationReport
```

Fail-closed: if the checker errors or times out, the report verdict is `block`. This is the Fail-Closed Verification axiom implemented.

### C.2 — Wire to durable state

Coherence verification reads from the state module (the executable specification it's checking) and writes to the state module (the verification report it produces). Both operations produce lineage edges.

---

## Phase D: Compilation Transformations (first real pipeline code)

With durable state and coherence verification in place, the compiler has infrastructure to write to and a gate to satisfy.

### D.1 — Decomposition

First transformation kind. Takes an intent specification, produces atomic claims. This is the most natural starting point because its input is natural language (we have that) and its output is structured (schema-validated).

Test strategy: create fixture intent specifications in `examples/`, run decomposition, validate output against AtomicClaimSchema, check that lineage edges were written.

### D.2 — Binding

Takes atomic claims from D.1, produces typed contracts. Depends on D.1's output schema.

### D.3 — Obligation Extraction

Takes atomic claims from D.1, produces invariant specifications with detector specs. Can run in parallel with D.2 — they share the same input but produce different outputs.

### D.4 — Structural Assembly

Takes contracts from D.2, invariants from D.3, assembles the executable specification graph. Depends on D.2 and D.3.

### D.5 — Completeness Certification + Coherence Verification

The compiler's internal self-check (completeness certification) runs first, then the external coherence verification from Phase C evaluates the result. If coherence verification blocks, the executable specification doesn't emit.

---

## Phase E: Bootstrap Loop

With Phases A-D complete, the Factory can compile its own intent specifications into executable specifications and verify them for structural coherence. This is the bootstrap loop.

### E.1 — Write the Factory's own intent specifications

The meta-pressure: "The Factory needs to build itself." The Factory's own capabilities, function proposals, and intent specifications go into the `specs/` directories. These are the first real artifacts in the pipeline.

### E.2 — Compile them

Run the compilation pipeline on the Factory's own intent specifications. Produce executable specifications. Pass coherence verification.

### E.3 — Execute them

This is where agent calls, the orchestrator, and workers come in. But now they're executing a *verified* executable specification, not improvising from a SKILL.md.

---

## Phase F: Fidelity Verification and Beyond

Fidelity verification, persistence verification, instruction tuning, the assurance graph — these all depend on having execution traces from Phase E. They can't be built in a vacuum. Sequence:

- **Fidelity Verification** needs: executable specifications + intent specifications + execution traces (to compare behavior against intent)
- **Instruction Tuning** needs: execution traces + verification verdicts (to optimize instruction text against empirical outcomes)
- **Persistence Verification** needs: deployed invariant detectors (produced by the compilation pipeline and the execution phase)
- **Assurance Graph** needs: multiple deployed functions with typed dependencies (produced over time as the Factory builds more of itself)

These are not designed in advance. They emerge as the bootstrap loop produces the data they need.

---

## What a Bootstrap Agent Sees After Phase A

An agent cloned into this repo reads:

```
AGENTS.md → "Read ONTOLOGY.md first"
ONTOLOGY.md → categorical structure, axioms, slot map, terminology crosswalk
.agent/charter/ → non-negotiable rules (verification enforcement, lineage discipline, etc.)
.agent/skills/ → task-family harness skills, each with NLAH checklist including failure taxonomy
packages/ → named by concept (compilation/, verification/, state/, etc.)
specs/ → named by artifact kind (intent-specifications/, executable-specifications/, etc.)
```

Every directory has a README quoting its ontological definition. Every package README names its axiom constraints. Every harness skill has a failure taxonomy. The agent doesn't need the intellectual history. It reads the ontology, reads the charter, picks up a harness skill, and starts working.

---

## Dependency Graph (no numbers, just arrows)

```
Legibility (Phase A)
    │
    ↓
Durable State Module (Phase B)
    │
    ├───────────────────┐
    ↓                   ↓
Coherence          Execution Trace
Verification       Persistence
(Phase C)          (Phase B.3)
    │
    ↓
Compilation Transformations (Phase D)
    │ (Decomposition → Binding ─┐)
    │ (Decomposition → Obligation ─┤)
    │                    Assembly ←─┘
    │                       │
    │                Completeness Certification
    │                       │
    │               Coherence Verification (gate)
    │
    ↓
Bootstrap Loop (Phase E)
    │
    ├── writes intent specs for the Factory itself
    ├── compiles them
    ├── verifies them (coherence)
    └── executes them (agent calls)
            │
            ↓
      Execution Traces Accumulate
            │
            ├── Fidelity Verification (Phase F)
            ├── Instruction Tuning (Phase F)
            ├── Persistence Verification (Phase F)
            └── Assurance Graph (Phase F)
```

---

## Immediate Next Actions

These are the first concrete tasks a bootstrap agent or a human can pick up:

**Task: Place ontology in repo.** Copy FF-ONTOLOGY v0.2 to `.agent/ONTOLOGY.md`. Rewrite AGENTS.md to reference it. Remove all stage/gate numbers from AGENTS.md.

**Task: Rename specs/ directories.** Seven renames as listed in A.2. Add README.md to each with ontological definition.

**Task: Rename packages/ directories.** Five renames as listed in A.3. Add README.md to each with ontological category, axiom constraints, input/output types.

**Task: Restructure compilation package.** Create subdirectories by transformation kind as listed in A.4. Move `pipeline.ts` to be the sole sequencing file.

**Task: Restructure verification package.** Create subdirectories by verification kind as listed in A.5.

**Task: Split SKILL.md files.** Extract charter content to `.agent/charter/`. Rewrite remaining skills with NLAH checklist. Add failure taxonomy to each.

**Task: Rename schema types.** Rename in `core.ts` and `coverage.ts` as listed in A.7. Add deprecation aliases.

**Task: Create failure taxonomy template.** Write template as described in A.8. Populate for compilation harness skill.

Each of these is a single PR. No task depends on another within Phase A — they can all proceed in parallel.

---

*End of plan.*
