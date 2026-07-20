# Design — ff-gates

> Unit: ff-gates (Coherence Verification)
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — D1 migration, check behavior corrections)

---

## Overview

`GatesService extends WorkerEntrypoint<GatesEnv>`. Exposed only via CF Service Binding (named export `GatesService`) from `ff-gateway` and `ff-pipeline`.

Single public method: `evaluateCoherenceVerification(executableSpecificationJson: unknown): Promise<CoherenceVerificationReport>`

Default `fetch()` returns 404 — Worker is not routable via public HTTP.

---

## Check Execution Order

```
evaluateCoherenceVerification(json: unknown):
  1. checkParseable(json)
       → if !passed: buildReport(json, [parseCheck]) and RETURN EARLY (short-circuit)
  2. checkAtomVerification(es)           → 'atom-coverage'
  3. checkInvariantVerification(es)      → 'invariant-coverage'
  4. checkDependencyClosure(es)          → 'dependency-closure'  [async — D1 query]
  5. checkLineageCompleteness(wgId)      → 'lineage-completeness' [async — D1 SQL recursive CTE]
  6. checkFieldCompleteness(es)          → 'field-completeness'
  7. buildReport(json, checks[1..6])
```

ID extraction: `wgId = es._key ?? es.id ?? 'unknown'`

---

## Check Implementations

### checkParseable (guard, not numbered)
- `typeof input === 'object' && input !== null`
- All four top-level fields present: `['_key', 'atoms', 'invariants', 'dependencies']`
- If any missing: return false with `detail` listing missing fields
- Short-circuit: subsequent checks do NOT run on parse failure

### Check 1 — checkAtomVerification → 'atom-coverage'
- Extract `atoms` as `Array<Record<string, unknown>>`
- Fail if absent or not array
- Unbound = atom with `!a.binding && !a.implementation` (truthiness check — no stub exclusion)
- Pass condition: `atoms.length > 0` AND every atom has truthy `binding` OR `implementation`
- Report: count and IDs of unbound atoms (`a.id ?? a._key ?? 'unknown'`)

### Check 2 — checkInvariantVerification → 'invariant-coverage'
- Extract `invariants` as `Array<Record<string, unknown>>`
- Fail if absent or not array
- Missing = invariant with `!i.detector && !i.detectorSpec` (top-level only — no nested check)
- Pass condition: every invariant has truthy `detector` OR `detectorSpec`

### Check 3 — checkDependencyClosure → 'dependency-closure' [async]
- Extract `dependencies` and `atoms`
- `atomIds = new Set(atoms.map(a => a.id ?? a._key))`
- Dangling = dependency where `target ?? to` value is not in `atomIds`
- Pass if `dependencies` absent/empty (with "No dependencies declared")
- **Known gap:** deps with BOTH `target` and `to` absent evaluate as falsy and silently pass

### Check 4 — checkLineageCompleteness → 'lineage-completeness' [async, D1]
```sql
WITH RECURSIVE lineage(id, depth) AS (
  SELECT e.to_id, 1
  FROM edges e
  WHERE e.collection = 'lineage_edges'
    AND e.from_id = 'executable_specifications/{wgId}'
  UNION ALL
  SELECT e.to_id, l.depth + 1
  FROM edges e
  JOIN lineage l ON e.from_id = l.id
  WHERE e.collection = 'lineage_edges' AND l.depth < 10
)
SELECT l.depth, d.json AS doc_json
FROM lineage l
JOIN documents d ON d.collection = SUBSTR(l.id, 1, INSTR(l.id,'/')-1)
                 AND d.key = SUBSTR(l.id, INSTR(l.id,'/')+1)
WHERE d.json->>'$.type' = 'signal' OR d.key LIKE 'SIG-%'
LIMIT 1
```
Pass: signal found within 10 hops. Fail: no signal found.
`startId = 'executable_specifications/{wgId}'` — IDs stored as `{collection}/{key}` format.

### Check 5 — checkFieldCompleteness → 'field-completeness'
ES-level required fields: `['title', 'intentSpecificationId', 'atoms', 'invariants', 'repo']` (falsy check)
Atom spot-check on `atoms[0]` only: `['id', 'type', 'description']`
Report paths: `executableSpecification.{f}` or `atoms[0].{f}`

---

## Report Assembly

```typescript
buildReport(executableSpecification: unknown, checks: CoherenceVerificationCheck[]): CoherenceVerificationReport {
  return {
    verification: "coherence",
    passed: checks.every(c => c.passed),
    timestamp: new Date().toISOString(),
    executableSpecificationId: obj?._key ?? obj?.id ?? 'unknown',
    checks,
    summary: passed
      ? `Coherence Verification PASSED: ${N} checks, all clear`
      : `Coherence Verification FAILED: ${failedCheckNames.join(', ')}`
  }
}
```

---

## Data Structures

### GatesEnv
```typescript
interface GatesEnv {
  DB: D1Database    // Cloudflare D1 binding — used via ArangoClient shim
  ENVIRONMENT: string  // set at runtime, not in wrangler.jsonc, currently unused in logic
}
```

### CoherenceVerificationReport
```typescript
interface CoherenceVerificationReport {
  verification: "coherence"
  passed: boolean
  timestamp: string                      // ISO 8601
  executableSpecificationId: string
  checks: CoherenceVerificationCheck[]
  summary: string
}
interface CoherenceVerificationCheck {
  name: string     // 'parseable' | 'atom-coverage' | 'invariant-coverage' | 'dependency-closure' | 'lineage-completeness' | 'field-completeness'
  passed: boolean
  detail: string
}
```

---

## Package Metadata

| Field | Value |
|---|---|
| Package name | `@factory/ff-gates` |
| Version | `0.1.0` |
| Worker name | `ff-gates` (wrangler.jsonc) |
| compatibility_date | `2026-01-01` |
| compatibility_flags | `["nodejs_compat"]` |
| D1 binding | `DB` → `ff-factory` (id: `6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3`) |
| Dependencies | `@factory/db-client` (workspace), `@cloudflare/workers-types ^4.20260101.0` |

---

## Feedback Loop Integration (upstream — ff-pipeline)

When `CoherenceVerificationReport.passed === false`, ff-pipeline (not ff-gates itself):
1. Persists the report to D1 `verification_reports` and `verification_status`
2. Enqueues `coherenceVerificationFailResult` to `FEEDBACK_QUEUE`
3. Returns `status: 'coherence-verification-failed'`

ff-gates has no awareness of the feedback loop. Retry/feedback behavior is entirely owned by ff-pipeline. No retry budget or depth counter inside ff-gates.

---

## Changes from Prior Documentation

| Prior claim | Current reality | Status |
|---|---|---|
| Atom check excludes 'stub' values | No stub exclusion — any truthy `binding` or `implementation` passes | CORRECTED |
| Invariant check inspects `detector.check` (nested) | Top-level `detector` or `detectorSpec` only | CORRECTED |
| `source_refs` and `compiledBy` in wgRequired | Not in wgRequired | CORRECTED |
| Lineage uses ArangoDB AQL traversal | D1 SQLite `WITH RECURSIVE` CTE | CORRECTED |
| 5 checks listed | Parse gate (short-circuit) + 5 numbered checks = 6 total check objects possible | CLARIFIED |
| Caller is ff-pipeline | Callers: ff-gateway (GATES service binding) + ff-pipeline (GATES service binding) | EXPANDED |
