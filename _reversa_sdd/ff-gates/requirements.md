# Requirements — ff-gates

> Unit: ff-gates (Coherence Verification)
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — D1 migration, check behavior corrections)

---

## JTBD

When an ExecutableSpecification is produced by the compilation pipeline, I want the system to deterministically verify its structural completeness, so that Formula dispatch is never attempted on an incomplete or malformed specification.

---

## Functional Requirements

### FR-01: Service Binding Only (No Public HTTP)
The ff-gates Worker MUST only accept calls via CF Service Binding. The default `fetch()` handler MUST return 404 with message "ff-gates: use via Service Binding, not HTTP". The real entry point is `GatesService extends WorkerEntrypoint<GatesEnv>`.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-gates/src/index.ts:16-20`, `src/index.ts:44`

### FR-02: Parseability Gate (Short-Circuit)
The gate MUST first run `checkParseable()` verifying that the input is a non-null object with all four required top-level fields: `_key`, `atoms`, `invariants`, `dependencies`. If any are missing, ALL subsequent checks MUST be skipped and the report returned immediately with only the parse failure.
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:70-94`, `src/index.ts:99-118`

### FR-03: Atom Coverage Check
The gate MUST verify that every atom in `executableSpecification.atoms` has at least one of `binding` or `implementation` set to a truthy value. Atoms with BOTH absent or falsy MUST be flagged as unbound. The check MUST fail if `atoms` is absent, not an array, or any atom is unbound.
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:120-139`
- **Correction from prior doc:** Check does NOT exclude 'stub' values — any truthy `binding` or `implementation` passes. There is no special handling of the string 'stub'.

### FR-04: Invariant Coverage Check
The gate MUST verify that every invariant in `executableSpecification.invariants` has at least one of `detector` or `detectorSpec` set to a truthy value at the top level. The check MUST fail if `invariants` is absent, not an array, or any invariant lacks both fields.
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:141-160`
- **Correction from prior doc:** Check does NOT inspect nested `detector.check`. Only top-level `detector` or `detectorSpec` existence is checked.

### FR-05: Dependency Closure Check
The gate MUST verify that all dependencies' `target` or `to` fields reference valid atom IDs in the `atoms` array. If `dependencies` is absent or empty, the check MUST pass with "No dependencies declared". Dangling references MUST fail the check.
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:162-189`
- **Known gap:** Dependencies missing BOTH `target` and `to` fields evaluate as falsy and silently pass rather than being flagged.

### FR-06: Lineage Completeness Check (D1 SQL Recursive CTE)
The gate MUST verify that at least one Signal node is reachable within 10 hops from the ExecutableSpecification via `lineage_edges`. The traversal MUST use a D1 SQLite `WITH RECURSIVE` CTE (not AQL). A Signal is identified by either `d.json->>'$.type' = 'signal'` OR `d.key LIKE 'SIG-%'`.
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:191-231`
- **Correction from prior doc:** Lineage check uses D1 SQLite recursive CTE, NOT ArangoDB AQL.

### FR-07: Field Completeness Check
The gate MUST verify the following fields are truthy on the ExecutableSpecification: `title`, `intentSpecificationId`, `atoms`, `invariants`, `repo`. It MUST also spot-check `atoms[0]` for: `id`, `type`, `description`. Only `atoms[0]` is checked (not all atoms — performance trade-off for <10ms target).
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:233-263`
- **Correction from prior doc:** `source_refs` and `compiledBy` are NOT required fields. Only `title`, `intentSpecificationId`, `atoms`, `invariants`, `repo` are checked.

### FR-08: Fail-Closed Behavior
The gate MUST fail the report if ANY single check fails. `passed = checks.every(c => c.passed)`. Partial passes are not permitted.
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:267-288`

---

## Non-Functional Requirements

### NFR-01: Latency Target
Deterministic checks (parseable, atom-coverage, invariant-coverage, dependency-closure, field-completeness) MUST complete within 10ms. The lineage check involves D1 SQL and may take longer — target < 100ms.
- 🟡 INFERIDO — comment in source: "Target: <10ms"

### NFR-02: No LLM Calls
The gate MUST NOT make any LLM calls. All checks MUST be deterministic (array membership tests, SQL queries only).
- 🟢 CONFIRMADO — no model-bridge or callModel calls in ff-gates

### NFR-03: D1 Database Binding
The gate MUST use a D1 binding (`DB`) via `@factory/db-client` (`ArangoClient` shim). The `GatesEnv.ENVIRONMENT` field is declared in the interface but currently unused in gate logic.
- 🟢 CONFIRMADO — `src/index.ts:22-25`, `wrangler.jsonc`

### NFR-04: ENVIRONMENT Binding Not in wrangler.jsonc
`GatesEnv.ENVIRONMENT: string` is declared as required but not bound in `wrangler.jsonc`. It is either injected at runtime by the platform or effectively optional in practice.
- 🔴 LACUNA — `wrangler.jsonc` has no ENVIRONMENT var binding

---

## Acceptance Criteria

**Scenario: All checks pass**
```
Dado: Well-formed ExecutableSpecification with bound atoms, detector-equipped invariants, closed dependency graph, and lineage traceable to a Signal (SIG-* key or type='signal')
Quando: evaluateCoherenceVerification() is called
Then: CoherenceVerificationReport.passed = true; all checks[].passed = true
```

**Scenario: Atom without binding or implementation**
```
Dado: ExecutableSpecification with one atom where binding=null and implementation=undefined
Quando: evaluateCoherenceVerification() is called
Then: checkAtomVerification().passed = false; CoherenceVerificationReport.passed = false
Note: atom with implementation='stub' PASSES (truthy string is truthy)
```

**Scenario: Invariant without detector or detectorSpec**
```
Dado: ExecutableSpecification with one invariant missing both detector and detectorSpec
Quando: evaluateCoherenceVerification() is called
Then: checkInvariantVerification().passed = false; CoherenceVerificationReport.passed = false
```

**Scenario: Dangling dependency reference**
```
Dado: ExecutableSpecification with dependency { to: 'atom-999' } but 'atom-999' absent from atoms[]
Quando: checkDependencyClosure() runs
Then: check.passed = false; CoherenceVerificationReport.passed = false
```

**Scenario: Parseable check fails (short-circuit)**
```
Dado: Input is a non-null object missing the 'atoms' field
Quando: evaluateCoherenceVerification() is called
Then: Report returned immediately with only the parseable check; no other checks run
```

**Scenario: Lineage completeness — Signal found in D1**
```
Dado: ES with a lineage path in D1 edges table: ES → FP → BC → PRS → SIG-001
Quando: checkLineageCompleteness(esKey) runs
Then: check.passed = true; depth=4 in success detail message
```
