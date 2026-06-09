---
name: prd-compiler
version: 2026-04-19
triggers:
  - "compile Intent Specification"
  - "compile spec"
  - "generate Executable Specification"
  - "Stage 5"
  - "run the compiler"
tools: [bash, view, create_file, str_replace]
preconditions:
  - "target Intent Specification file exists in specs/intent-specifications/"
  - "packages/compiler is installed"
constraints:
  - "never skip a pass to save cycles"
  - "never emit a Executable Specification/Executable Specification that fails Coherence Verification"
  - "every transformation must preserve source_refs, explicitness, rationale"
  - "on ambiguity, fail closed and emit UncertaintyEntry"
category: factory-core
---

# Compilation Harness

The compiler transforms an Intent Specification (Intent Specification) into an Executable
Specification (Executable Specification). Historical Stage 5 and pass numbers remain
compatibility labels. Ontology categories are primary. Every transformation is
a pure function with strict I/O types.

## Transformations in order

### Compatibility Pass 0 — normalize
Input: raw Intent Specification markdown.
Output: NormalizedIntentSpecification (structured object with sections identified).
- Split into sections (problem, goal, constraints, acceptance criteria,
  success metrics, out-of-scope).
- Preserve source line references for every section.
- Emit UncertaintyEntry for unrecognized sections rather than discarding.

### Decomposition (legacy Pass 1) — extract atoms
Input: NormalizedIntentSpecification.
Output: RequirementAtom[].
- One semantic claim per atom.
- Categorize: user_story | business_rule | constraint | nfr | integration |
  acceptance.
- Each atom carries subject, action, object, conditions, qualifiers,
  success_condition, source_refs, explicitness, rationale.

### Binding (legacy Pass 2) — derive contracts
Input: RequirementAtom[].
Output: Contract[].
- Contracts are typed: api | schema | behavior | invariant.
- Each contract references the atom IDs that produced it.
- Producer hint and consumer hints where applicable.

### Obligation Extraction (legacy Pass 3) — derive invariants
Input: RequirementAtom[] + Contract[].
Output: Invariant[].
- Every invariant carries a complete detector spec (see
  invariant-authoring skill).
- Scope: entity | workflow | system.
- Violation impact: low | medium | high.
- An invariant without a detector is a bug; emit UncertaintyEntry and halt.

### Structural Assembly subdivision (legacy Pass 4) — derive dependencies
Input: all prior passes' outputs.
Output: Dependency[].
- Typed: blocks | constrains | implements | validates | informs.
- Both endpoints must resolve to artifact IDs in the same Intent Specification's scope or
  in a cited upstream Intent Specification.

### Structural Assembly subdivision (legacy Pass 5) — derive validations
Input: all prior passes' outputs.
Output: ValidationSpec[].
- Typed: compile | lint | unit | integration | scenario | property |
  security | performance.
- Priority: required | recommended | optional.
- Every validation backmaps to ≥1 atom, contract, or invariant via
  covers* fields.

### Completeness preflight slot (legacy Pass 6) — consistency check
Input: all prior passes' outputs.
Output: ConsistencyReport or halt.
- Cross-pass consistency: do invariants reference atoms that exist? Do
  validations reference invariants that exist?
- Duplicate detection: are two atoms saying the same thing?
- Contradiction detection: do two constraints contradict?
- If inconsistency is critical, halt. If minor, surface warnings.

### Completeness Certification / Coherence Verification (legacy Pass 7)
Input: all prior passes' outputs.
Output: VerificationReport.
- See `coherence-verification` skill. This is the hard verification.
- Atom coverage, invariant coverage, validation coverage, dependency
  closure.
- If any fails, halt before Executable Specification Assembly.

### Executable Specification Assembly (legacy Pass 8 compatibility)
Input: all prior outputs + passing VerificationReport.
Output: Executable Specification.
- Typed nodes and edges.
- Every node references the Function ID it implements.
- Every edge typed by dependency kind.

Ontology Pass 8 is future Instruction Tuning. Do not use the current Executable Specification
assembly compatibility label as the Instruction Tuning category.

## Intent Specification structure- compiler-consumed vs informational

Pass 0 recognizes six section titles (case-insensitive exact-match)-
`## Problem`, `## Goal`, `## Constraints`, `## Acceptance criteria`,
`## Success metrics`, `## Out of scope`. Content in any other section
is flagged as `unrecognizedSections` in the NormalizedIntentSpecification and not
consumed by any downstream pass.

Several section titles are conventionally used in Factory Intent Specifications for
human-audience content that the compiler is not expected to consume-

- **`## Shared <X> shape`** — describes the structural contract shared
  across a family of Functions (e.g., "Shared GateEvaluator shape" in
  the Coherence Verification Intent Specification, "Shared ControlFunction shape" in the detect-regression
  Intent Specification). Read by authors of sibling Intent Specifications in the same Function family,
  not by the compiler.

- **`## Schema <X> required`** / **`## Schema additions required`** —
  flags upcoming schema changes that must land before the Function can
  be implemented. Read by the Architect during pre-merge review, not by
  the compiler.

- **`## Downstream artifacts <X> will enable`** — enumerates downstream
  PRs or Executable Specifications that depend on this Function's implementation. Read
  by the Architect and by authors of those downstream Intent Specifications, not by the
  compiler.

These sections are valid and welcome. They carry forward the design
thinking and implementation gating that written Intent Specifications use to communicate
with human audiences. **Place them at `##` after the six compiler-
consumed sections, so the compiler-consumed block reads as a contiguous
unit at the top of the Intent Specification body.** The compiler flags them as
unrecognized; that's intended — their purpose is human communication,
not pipeline input.

This convention is documentation, not enforcement. The compiler does
not currently validate that informational sections appear below the
consumed ones, and does not warn authors who invert the order. If a
future compile produces content in an unrecognized section whose
material SHOULD have been atom-extractable, that's the signal to either
(a) add the section name to Pass 0's map or (b) update this convention
to name it. Either choice is a skill/compiler amendment; neither is
silent.

## Rules

1. **Transformations are pure functions.** No transformation reads or writes state outside
   its input/output contract. Side effects (file writes, logs) happen in
   a thin orchestration layer.

2. **Source references flow through every transformation.** An atom's source_refs
   point to Intent Specification sections. A contract's source_refs include the atom IDs.
   An invariant's source_refs include atoms and contracts. A validation's
   source_refs include atoms, contracts, invariants. Lineage is cumulative.

3. **Explicit vs. inferred is tracked per transformation.** If Obligation Extraction infers an
   invariant from two atoms that didn't individually state it, the
   invariant's `explicitness` is `inferred` and the `rationale` explains
   the inference.

4. **Uncertainty is typed.** When a pass cannot confidently produce an
   artifact, it emits an UncertaintyEntry:
   ```yaml
   transformation: <name_or_compatibility_pass_number>
   source: <source_ref>
   reason: "specific reason the pass could not produce"
   suggested_resolution: "what would let the pass proceed"
   ```
   The compiler does not guess. The architect or upstream stage resolves.

5. **The compiler fails closed.** Any transformation that cannot produce a valid
   output halts the pipeline. The partial outputs are saved for debugging
   but no Executable Specification is emitted.

## Self-rewrite hook

After every 10 compilations OR on any systematic transformation failure:
1. Check which transformations are failing most often.
2. If a specific transformation consistently produces UncertaintyEntries from the
   same Intent Specification pattern, propose a refinement to that pass's extraction
   heuristic.
3. Commit: `META: skill-update: prd-compiler, {one-line reason}`
