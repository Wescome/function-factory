# Tasks — packages/ontology-loader

> Unit: @factory/ontology-loader
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — new module)

---

## Implementation Tasks

### T-01: Implement seedOntology Four-Pass Seeder
**Source:** `packages/ontology-loader/src/index.ts:118`
**Behavior:**
- For each of ONTOLOGY_CLASSES, ONTOLOGY_PROPERTIES, ONTOLOGY_CONSTRAINTS, ONTOLOGY_INSTANCES:
  - Call `db.save(collection, doc)` in try/catch; increment counter on success; swallow errors silently
- Return `{ classes, properties, constraints, instances }`
**Criterion for done:** Empty D1 → all 4 counters > 0; second call succeeds with same or higher counts (no thrown errors).
**Confidence:** 🟢 CONFIRMADO

### T-02: Implement getConstraintsForClass (Double-Filter)
**Source:** `packages/ontology-loader/src/index.ts:173`
**Behavior:**
- Stage 1: `db.query("SELECT json FROM documents WHERE collection='ontology_constraints' AND json_extract(json,'$.targetClasses') LIKE ?", ['%' + className + '%'])`
- Stage 2: `rows.filter(c => Array.isArray(c.targetClasses) && c.targetClasses.includes(className))`
- Parse each `{ json: string }` row via `JSON.parse(r.json) as OntologyConstraint`
**Criterion for done:** Query for 'Signal' returns C1 (includes Signal); does NOT return constraints that only match substring 'Signal' in class names like 'CIFeedbackSignal'.
**Confidence:** 🟢 CONFIRMADO

### T-03: Implement getRoleSpec
**Source:** `packages/ontology-loader/src/index.ts:191`
**Behavior:** `db.queryOne("SELECT json FROM documents WHERE collection='ontology_instances' AND key=? LIMIT 1", [roleKey])` → parse JSON → return `OntologyInstance | null`
**Criterion for done:** getRoleSpec(db, 'CoderRole') returns CoderRole instance; getRoleSpec(db, 'unknown') returns null.
**Confidence:** 🟢 CONFIRMADO

### T-04: Implement getLifecycleState
**Source:** `packages/ontology-loader/src/index.ts:207`
**Behavior:** `db.queryOne("SELECT json FROM documents WHERE collection='specs_functions' AND key=? LIMIT 1", [functionKey])` → parse JSON → return `doc.lifecycleState ?? null`
**Criterion for done:** Function with lifecycleState='InProgress' returns 'InProgress'; missing function returns null.
**Confidence:** 🟢 CONFIRMADO

### T-05: Implement getPendingCRPs
**Source:** `packages/ontology-loader/src/index.ts:225`
**Behavior:** `db.query("SELECT json FROM documents WHERE collection='consultation_requests' AND json_extract(json,'$.status')='pending'")` → parse each row → project `{ _key, context, confidence }`
**Criterion for done:** Returns only CRPs with status='pending'; non-pending CRPs excluded; empty set returns [].
**Confidence:** 🟢 CONFIRMADO

### T-06: Implement getPersistenceTarget
**Source:** `packages/ontology-loader/src/index.ts:243`
**Behavior:** `db.queryOne("SELECT json FROM documents WHERE collection='ontology_classes' AND key=? LIMIT 1", [className])` → parse JSON → return `doc.persistsIn ?? null`
**Criterion for done:** getPersistenceTarget(db, 'Signal') returns 'specs_signals'; class without persistsIn returns null.
**Confidence:** 🟢 CONFIRMADO

### T-07: Implement buildOntologyTool
**Source:** `packages/ontology-loader/src/ontology-tool.ts:40`
**Behavior:**
- Return plain object with: `name: 'ontology_query'`, `label`, `description`, `parameters: { type:'object', properties:{queryType,argument}, required:['queryType','argument'] }`, `execute`
- Do NOT import TypeBox
- `execute(_toolCallId, params)`: switch on `params.queryType`, dispatch to helper, return `{ content: [{ type:'text', text }], details }`
- Default case: return "Unknown queryType: ..." message
**Criterion for done:** Tool returned by buildOntologyTool satisfies gdk-agent AgentTool interface structurally; execute returns correct { content, details } shape for all 5 queryType values.
**Confidence:** 🟢 CONFIRMADO

### T-08: Define TypeScript Interfaces and Export Types
**Source:** `packages/ontology-loader/src/index.ts:31-85`
**Behavior:** Export `OntologyClass`, `OntologyProperty`, `OntologyConstraint`, `OntologyInstance`, `SeedResult` interfaces. Export `OntologyQueryType` union type and `OntologyQueryParams` interface from `ontology-tool.ts`.
**Criterion for done:** All exported types importable in consuming packages without type errors.
**Confidence:** 🟢 CONFIRMADO

### T-09: Validate 7 Domains in ONTOLOGY_CLASSES
**Source:** `packages/ontology-loader/src/index.test.ts:94-103`
**Behavior:** Test MUST verify all ONTOLOGY_CLASSES have `domain` values within the 7 known domains: `'signals'`, `'specification'`, `'governance'`, `'execution'`, `'dialogue'`, `'agents'`, `'infrastructure'`.
**Criterion for done:** Test passes; any class with unknown domain fails the test.
**Confidence:** 🟢 CONFIRMADO

### T-10: Validate 16 Constraints (C1–C16) Exist
**Source:** `packages/ontology-loader/src/index.test.ts:146-152`
**Behavior:** Test MUST verify ONTOLOGY_CONSTRAINTS contains exactly 16 entries with constraintIds C1 through C16.
**Criterion for done:** Test passes; missing or extra constraint IDs fail the test.
**Confidence:** 🟢 CONFIRMADO

### T-11: Validate 6 Agent Role Instances
**Source:** `packages/ontology-loader/src/index.test.ts:164-200`
**Behavior:** Test MUST verify ONTOLOGY_INSTANCES contains ArchitectRole, PlannerRole, CoderRole, CriticRole, TesterRole, VerifierRole with correct `runsIn` and non-empty `tools` arrays.
**Criterion for done:** Test passes; each role has correct runsIn ('V8Isolate' or 'SandboxContainer') and expected tools listed.
**Confidence:** 🟢 CONFIRMADO

### T-12: Validate 20 Persistence Targets
**Source:** `packages/ontology-loader/src/index.test.ts:248-257`
**Behavior:** Test MUST verify that 20 OWL classes have a `persistsIn` field mapping to the correct D1 collection names (Signal → specs_signals, etc.).
**Criterion for done:** Test passes; all 20 mappings verified; missing or wrong collection names fail the test.
**Confidence:** 🟢 CONFIRMADO
