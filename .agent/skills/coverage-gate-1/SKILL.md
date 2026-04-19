---
name: coverage-gate-1
version: 2026-04-19
triggers:
  - "Gate 1"
  - "compile coverage"
  - "compile gate"
  - "coverage check before workgraph"
tools: [bash, view]
preconditions:
  - "compiler Pass 0–6 have completed"
constraints:
  - "fail closed on any coverage miss"
  - "emit Coverage Report to specs/coverage-reports/ even on pass"
  - "do not emit WorkGraph if gate fails"
  - "during Bootstrap mode, additionally verify META- prefix on PRD ID and every artifact ID referenced in compiler intermediates"
category: factory-core
---

# Compile Coverage Gate (Gate 1)

Runs between Pass 7 (consistency_check) and Pass 8 (assemble_workgraph) of
the Stage 5 compiler. Verifies that the compiled specification is
internally complete before any WorkGraph is emitted. During Bootstrap
mode, additionally enforces the META- prefix rule from ConOps §4.1
Rule 2.

## Inputs

- RequirementAtom[] from Pass 1
- Contract[] from Pass 2
- Invariant[] from Pass 3
- Dependency[] from Pass 4
- ValidationSpec[] from Pass 5
- PRD ID of the compilation target
- Factory mode (`bootstrap` | `steady_state`) — determines whether
  check #5 runs

## Coverage checks

Four checks run in Steady-State mode; five run in Bootstrap mode. Checks
#1–#4 are the core coverage discipline and run in both modes. Check #5
is Bootstrap-specific and enforces the META- prefix rule. All active
checks must pass for `overall: pass`; partial pass is fail regardless
of mode.

### 1. Atom coverage
Every RequirementAtom must have ≥1 downstream artifact (Contract, Invariant,
or ValidationSpec) that references it in its `source_refs` or `covers*`
fields.

An atom without a downstream artifact is dead specification: the PRD stated
something and nothing in the compiled output addresses it.

### 2. Invariant coverage
Every Invariant must have:
- ≥1 ValidationSpec whose `coversInvariantIds` includes this invariant's ID.
- ≥1 detector spec (compile-time: must be present and well-formed; runtime
  liveness is Gate 3's concern).

An invariant without a validation is untested. An invariant without a
detector is a wish. Both are required.

### 3. Validation coverage
Every ValidationSpec must have ≥1 backmap to an atom, contract, or invariant
via `coversAtomIds`, `coversContractIds`, or `coversInvariantIds`.

A validation that covers nothing is a dead test: it runs, it passes, it
proves nothing about the specification.

### 4. Dependency closure
Every Dependency's `from` and `to` endpoints must resolve to existing
artifact IDs. Dangling dependencies mean the graph is incomplete.

### 5. Bootstrap prefix check (Bootstrap mode only)
During Bootstrap, every Factory artifact must carry the `META-` qualifier
in its ID per ConOps §4.1 Rule 2. Gate 1 verifies that:

- The PRD ID being compiled matches the pattern `PRD-META-*`.
- Every artifact ID referenced in the compiler intermediates — atom IDs,
  contract IDs, invariant IDs, dependency endpoints, validation IDs, plus
  every ID inside those artifacts' `source_refs`, `derivedFromAtomIds`,
  `derivedFromContractIds`, `coversAtomIds`, `coversContractIds`,
  `coversInvariantIds`, `from`, and `to` fields — carries a `META-`
  qualifier after its type prefix (e.g., `ATOM-META-*`, `INV-META-*`,
  `DEP-META-*`).

Failing IDs are named in `bootstrap_prefix_check.non_meta_artifact_ids`.
A non-META reference from a META intermediate is both a coverage failure
and a lineage defect- it means the compiler intermediates reference an
artifact that does not exist under the Bootstrap discipline.

This check is skipped entirely when Factory mode is `steady_state`, and
the `bootstrap_prefix_check` field is absent from Gate1Reports emitted
outside Bootstrap.

## Output

A `CoverageReport` written to
`specs/coverage-reports/CR-<PRD-ID>-GATE1-<timestamp>.yaml`:

```yaml
id: CR-<PRD-ID>-GATE1-<timestamp>
gate: 1
prd_id: <PRD-ID>
timestamp: <ISO-8601>
overall: pass | fail
checks:
  atom_coverage:
    status: pass | fail
    orphan_atoms: [ATOM-ID, ...]
  invariant_coverage:
    status: pass | fail
    invariants_missing_validation: [INV-ID, ...]
    invariants_missing_detector: [INV-ID, ...]
  validation_coverage:
    status: pass | fail
    validations_covering_nothing: [VAL-ID, ...]
  dependency_closure:
    status: pass | fail
    dangling_dependencies: [DEP-ID, ...]
  # Present only when Factory mode is `bootstrap`; absent in steady_state.
  bootstrap_prefix_check:
    status: pass | fail
    non_meta_artifact_ids: [ARTIFACT-ID, ...]
remediation: |
  Human-readable description of what upstream artifact must be fixed and
  where. Always populated, even on pass (with "no remediation required").
```

## Behavior

- **On pass:** emit Coverage Report with `overall: pass`. Proceed to
  Pass 8.
- **On fail:** emit Coverage Report with `overall: fail` and `remediation`
  populated. Halt compiler. Do not emit WorkGraph. The PRD must be
  remediated upstream (new atoms added, invariants given detectors,
  validations given backmaps, dependencies resolved, or — during
  Bootstrap — artifact IDs re-prefixed with `META-`).
- **Mode-dependent check count:** Steady-State runs checks #1–#4.
  Bootstrap runs all five. The verdict is `fail` if any active check
  fails; there is no partial-credit or majority rule.

## Anti-patterns

- **Soft-warning on coverage miss.** Never. The gate is fail-closed by
  design. A soft warning that ships anyway is identical to not having the
  gate.
- **Auto-generating placeholder validations to pass the gate.** Never.
  Gate 1 failure is a specification defect, not a compiler defect; do not
  paper over it.
- **Emitting a WorkGraph on partial pass.** Never. All active coverage
  checks must pass; a majority is not enough, and the set of active
  checks is mode-dependent.
- **Emitting a WorkGraph in Bootstrap when non-META artifact IDs are
  referenced.** Never. The META- prefix rule (ConOps §4.1 Rule 2) is
  absolute during Bootstrap. A compiler intermediate that references a
  non-META artifact ID is a ConOps violation and a lineage defect;
  remediation is to either re-prefix the referenced artifact as META or
  to hold the PRD until the Bootstrap → Steady-State transition.

## Self-rewrite hook

After every 10 Gate 1 runs OR on any downstream failure traceable to a
coverage miss that this gate should have caught:
1. Review recent Coverage Reports.
2. If a class of coverage miss keeps slipping through, propose an
   additional check.
3. Commit: `META: skill-update: coverage-gate-1, {one-line reason}`
