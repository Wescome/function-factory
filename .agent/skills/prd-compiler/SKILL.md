---
name: prd-compiler
version: 2026-04-18
triggers:
  - "compile PRD"
  - "compile spec"
  - "generate WorkGraph"
  - "Stage 5"
  - "run the compiler"
tools: [bash, view, create_file, str_replace]
preconditions:
  - "target PRD file exists in specs/prds/"
  - "packages/compiler is installed"
constraints:
  - "never skip a pass to save cycles"
  - "never emit a WorkGraph that fails Gate 1"
  - "every pass must preserve source_refs, explicitness, rationale"
  - "on ambiguity, fail closed and emit UncertaintyEntry"
category: factory-core
---

# PRD Compiler (Stage 5)

The eight-pass compiler that transforms a PRD into a WorkGraph. This is the
core Factory pipeline. Every pass is a pure function with strict I/O types.

## Passes in order

### Pass 0 — normalize
Input: raw PRD markdown.
Output: NormalizedPRD (structured object with sections identified).
- Split into sections (problem, goal, constraints, acceptance criteria,
  success metrics, out-of-scope).
- Preserve source line references for every section.
- Emit UncertaintyEntry for unrecognized sections rather than discarding.

### Pass 1 — extract atoms
Input: NormalizedPRD.
Output: RequirementAtom[].
- One semantic claim per atom.
- Categorize: user_story | business_rule | constraint | nfr | integration |
  acceptance.
- Each atom carries subject, action, object, conditions, qualifiers,
  success_condition, source_refs, explicitness, rationale.

### Pass 2 — derive contracts
Input: RequirementAtom[].
Output: Contract[].
- Contracts are typed: api | schema | behavior | invariant.
- Each contract references the atom IDs that produced it.
- Producer hint and consumer hints where applicable.

### Pass 3 — derive invariants
Input: RequirementAtom[] + Contract[].
Output: Invariant[].
- Every invariant carries a complete detector spec (see
  invariant-authoring skill).
- Scope: entity | workflow | system.
- Violation impact: low | medium | high.
- An invariant without a detector is a bug; emit UncertaintyEntry and halt.

### Pass 4 — derive dependencies
Input: all prior passes' outputs.
Output: Dependency[].
- Typed: blocks | constrains | implements | validates | informs.
- Both endpoints must resolve to artifact IDs in the same PRD's scope or
  in a cited upstream PRD.

### Pass 5 — derive validations
Input: all prior passes' outputs.
Output: ValidationSpec[].
- Typed: compile | lint | unit | integration | scenario | property |
  security | performance.
- Priority: required | recommended | optional.
- Every validation backmaps to ≥1 atom, contract, or invariant via
  covers* fields.

### Pass 6 — consistency check
Input: all prior passes' outputs.
Output: ConsistencyReport or halt.
- Cross-pass consistency: do invariants reference atoms that exist? Do
  validations reference invariants that exist?
- Duplicate detection: are two atoms saying the same thing?
- Contradiction detection: do two constraints contradict?
- If inconsistency is critical, halt. If minor, surface warnings.

### Pass 7 — Gate 1 (Compile Coverage Gate)
Input: all prior passes' outputs.
Output: CoverageReport.
- See `coverage-gate-1` skill. This is the hard gate.
- Atom coverage, invariant coverage, validation coverage, dependency
  closure.
- If any fails, halt before Pass 8.

### Pass 8 — assemble WorkGraph
Input: all prior outputs + passing CoverageReport.
Output: WorkGraph.
- Typed nodes and edges.
- Every node references the Function ID it implements.
- Every edge typed by dependency kind.

## Rules

1. **Passes are pure functions.** No pass reads or writes state outside
   its input/output contract. Side effects (file writes, logs) happen in
   a thin orchestration layer.

2. **Source references flow through every pass.** An atom's source_refs
   point to PRD sections. A contract's source_refs include the atom IDs.
   An invariant's source_refs include atoms and contracts. A validation's
   source_refs include atoms, contracts, invariants. Lineage is cumulative.

3. **Explicit vs. inferred is tracked per pass.** If Pass 3 infers an
   invariant from two atoms that didn't individually state it, the
   invariant's `explicitness` is `inferred` and the `rationale` explains
   the inference.

4. **Uncertainty is typed.** When a pass cannot confidently produce an
   artifact, it emits an UncertaintyEntry:
   ```yaml
   pass: <pass_number>
   source: <source_ref>
   reason: "specific reason the pass could not produce"
   suggested_resolution: "what would let the pass proceed"
   ```
   The compiler does not guess. The architect or upstream stage resolves.

5. **The compiler fails closed.** Any pass that cannot produce a valid
   output halts the pipeline. The partial outputs are saved for debugging
   but no WorkGraph is emitted.

## Self-rewrite hook

After every 10 compilations OR on any systematic pass failure:
1. Check which passes are failing most often.
2. If a specific pass consistently produces UncertaintyEntries from the
   same PRD pattern, propose a refinement to that pass's extraction
   heuristic.
3. Commit: `META: skill-update: prd-compiler, {one-line reason}`
