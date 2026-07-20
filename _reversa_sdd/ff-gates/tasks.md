# Tasks — ff-gates

> Unit: ff-gates (Coherence Verification)
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — D1 migration, check behavior corrections)

---

## Implementation Tasks

### T-01: Implement evaluateCoherenceVerification Entry Point
**Source:** `workers/ff-gates/src/index.ts:GatesService.evaluateCoherenceVerification()` lines 66-95
**Behavior:**
- Run checkParseable; if !passed return early with single-check report
- Run checks 1-5 (atom, invariant, dependency-closure, lineage, field-completeness)
- Collect check results into `checks[]`
- Call `buildReport(json, checks)`
**Criterion for done:** Method returns CoherenceVerificationReport with up to 6 check results; parse failure short-circuits remaining checks.
**Confidence:** 🟢 CONFIRMADO

### T-02: Implement Atom Coverage Check
**Source:** `ff-gates/src/index.ts:checkAtomVerification()` lines 120-139
**Behavior:**
- Extract `atoms` as Array<Record<string,unknown>>; fail if absent or not array
- Unbound = `!a.binding && !a.implementation` (simple truthiness — no 'stub' exclusion)
- Return `{ name: 'atom-coverage', passed: bool, detail: string }`
**Criterion for done:** Atom with binding=null AND implementation=undefined fails; atom with implementation='stub' PASSES (truthy); atom with binding={} passes.
**Confidence:** 🟢 CONFIRMADO

### T-03: Implement Invariant Coverage Check
**Source:** `ff-gates/src/index.ts:checkInvariantVerification()` lines 141-160
**Behavior:**
- Extract `invariants` as Array<Record<string,unknown>>; fail if absent or not array
- Missing = `!i.detector && !i.detectorSpec` (top-level only — NOT nested field check)
- Return `{ name: 'invariant-coverage', passed: bool, detail: string }`
**Criterion for done:** Invariant without detector passes if detectorSpec is truthy; invariant without either fails.
**Confidence:** 🟢 CONFIRMADO

### T-04: Implement Dependency Closure Check
**Source:** `ff-gates/src/index.ts:checkDependencyClosure()` lines 162-189
**Behavior:**
- Build `atomIds = new Set(atoms.map(a => a.id ?? a._key))`
- Dangling = `target ?? to` value not in atomIds
- Pass with "No dependencies declared" if dependencies absent/empty
- Return `{ name: 'dependency-closure', passed: bool, detail: string }`
**Criterion for done:** Dependency with `to: 'atom-999'` where atom-999 not in atoms[] fails; all valid IDs pass; empty dependencies array passes.
**Confidence:** 🟢 CONFIRMADO

### T-05: Implement Lineage Completeness Check (D1 SQL)
**Source:** `ff-gates/src/index.ts:checkLineageCompleteness()` lines 191-231
**Behavior:**
- `startId = 'executable_specifications/{wgId}'`
- Run recursive CTE on D1 `edges` table (collection='lineage_edges') up to depth 10
- Signal found if: `d.json->>'$.type' = 'signal'` OR `d.key LIKE 'SIG-%'`
- `LIMIT 1` — stop at first hit
- Return `{ name: 'lineage-completeness', passed: bool, detail: string }`
**Criterion for done:** ES with 4-hop lineage chain to SIG-* passes; ES with no lineage to any Signal fails.
**Confidence:** 🟢 CONFIRMADO

### T-06: Implement Field Completeness Check
**Source:** `ff-gates/src/index.ts:checkFieldCompleteness()` lines 233-263
**Behavior:**
- ES required fields: `['title', 'intentSpecificationId', 'atoms', 'invariants', 'repo']`
- Atom spot-check on `atoms[0]` only: `['id', 'type', 'description']`
- Report missing paths: `executableSpecification.{f}` or `atoms[0].{f}`
- Return `{ name: 'field-completeness', passed: bool, detail: string }`
**Criterion for done:** ES missing 'repo' fails; ES with all fields + atoms[0] spot-check passes; atoms[1] with missing fields is not flagged.
**Confidence:** 🟢 CONFIRMADO

### T-07: Implement buildReport
**Source:** `ff-gates/src/index.ts:buildReport()` lines 267-288
**Behavior:**
- `passed = checks.every(c => c.passed)`
- `executableSpecificationId = obj?._key ?? obj?.id ?? 'unknown'`
- summary: `"Coherence Verification PASSED: {N} checks, all clear"` or `"FAILED: {failedNames}"`
- Return CoherenceVerificationReport
**Criterion for done:** Any single failing check produces passed=false; all passing checks produces passed=true.
**Confidence:** 🟢 CONFIRMADO

### T-08: Wire ArangoClient (D1 shim) via lazy initialization
**Source:** `ff-gates/src/index.ts:getDb()` lines 47-52
**Behavior:** Lazy-initialize `this.db = createClientFromEnv(this.env)` on first call. Instance cached on WorkerEntrypoint for request lifetime. Used only for checkLineageCompleteness D1 query.
**Criterion for done:** getDb() returns the same ArangoClient instance for multiple calls within one request; creates fresh instance for next request.
**Confidence:** 🟢 CONFIRMADO
