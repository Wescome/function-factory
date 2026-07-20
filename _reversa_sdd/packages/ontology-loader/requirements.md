# Requirements — packages/ontology-loader

> Unit: @factory/ontology-loader
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — new module, uses @factory/db-client)

---

## JTBD

When agents in a synthesis session need to understand the Factory's ontological constraints, role specifications, and lifecycle rules, I want the OWL ontology and SHACL shapes to be pre-seeded into queryable D1 documents and accessible via a tool call, so that agents can answer questions like "what permissions does the CoderRole have?" without needing a graph database.

---

## Functional Requirements

### FR-01: Seed Ontology into D1
`seedOntology(db: ArangoClient): Promise<SeedResult>` MUST iterate over `ONTOLOGY_CLASSES`, `ONTOLOGY_PROPERTIES`, `ONTOLOGY_CONSTRAINTS`, and `ONTOLOGY_INSTANCES` arrays, calling `db.save(collection, doc)` for each element. Errors MUST be silently swallowed per-element (upsert semantics). Returns counts of successfully written documents.
- Priority: **Must**
- 🟢 CONFIRMADO — `packages/ontology-loader/src/index.ts:118`

### FR-02: Idempotent Seed
`seedOntology` MUST be safe to call multiple times. Calling it twice produces the same state as calling it once (no duplicate rows, no errors).
- Priority: **Must**
- 🟢 CONFIRMADO — `db.save()` upsert + silent error swallow

### FR-03: getConstraintsForClass
`getConstraintsForClass(db, className): Promise<OntologyConstraint[]>` MUST perform a two-stage filter: (1) D1 LIKE query `%className%` on the JSON targetClasses field for broad pre-filter; (2) in-process `Array.includes(className)` for exact match. Returns all constraints that exactly target the given class.
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:173`

### FR-04: getRoleSpec
`getRoleSpec(db, roleKey): Promise<OntologyInstance | null>` MUST perform exact key lookup in `ontology_instances` collection. Returns `null` if not found.
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:191`

### FR-05: getLifecycleState
`getLifecycleState(db, functionKey): Promise<string | null>` MUST query `specs_functions` (application collection) for the `lifecycleState` field. Returns `null` if function not found or has no `lifecycleState`.
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:207`

### FR-06: getPendingCRPs
`getPendingCRPs(db): Promise<{ _key, context, confidence }[]>` MUST query `consultation_requests` WHERE `status='pending'`, projecting only `_key`, `context`, `confidence`.
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:225`

### FR-07: getPersistenceTarget
`getPersistenceTarget(db, className): Promise<string | null>` MUST look up the `persistsIn` field for the given class key in `ontology_classes`. Returns the collection name or `null`.
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:243`

### FR-08: buildOntologyTool (AgentTool Factory)
`buildOntologyTool(db: ArangoClient)` MUST return an AgentTool-compatible object with `name: 'ontology_query'`, a JSON Schema `parameters` object, and an `execute(_toolCallId, params)` function. MUST NOT import TypeBox at runtime. Uses plain JSON Schema object literal.
- Priority: **Must**
- 🟢 CONFIRMADO — `ontology-tool.ts:40`

### FR-09: ontology_query Tool Dispatch
The `execute()` function MUST dispatch on `params.queryType` with 5 cases: `constraints_for_class`, `role_spec`, `lifecycle_state`, `pending_crps`, `persistence_target`. MUST return `{ content: [{ type: 'text', text: string }], details: any }`.
- Priority: **Must**
- 🟢 CONFIRMADO — `ontology-tool.ts`

---

## Non-Functional Requirements

### NFR-01: Dependency on @factory/db-client
The package uses `ArangoClient` from `@factory/db-client` for all DB operations. The D1 migration of `db-client` means all ontology queries now run against D1 SQLite (not ArangoDB HTTP), using SQL with `?` placeholders.
- 🟢 CONFIRMADO

### NFR-02: No Runtime TypeBox Dependency
`buildOntologyTool` MUST express the tool's JSON Schema as a plain object literal. `@weops/gdk-agent` MUST remain a devDependency only — the AgentTool interface is satisfied structurally.
- 🟢 CONFIRMADO — `ontology-tool.ts:39-44`

### NFR-03: sparqlCheck Constraints Not Enforced
Constraints C2, C7, C10, C14, C15, C16 carry `sparqlCheck: true`. This flag is metadata only — no evaluation engine is wired in this package. Cross-collection join evaluation is out of scope.
- 🔴 LACUNA — documented gap

### NFR-04: No Runtime Validation on Parsed JSON
All query helpers cast `JSON.parse(row.json)` directly to typed interfaces without runtime validation. Schema drift in D1 would surface as `undefined` field access rather than a typed error.
- 🟡 INFERIDO — design decision, not a defect

---

## Acceptance Criteria

**Scenario: seedOntology is idempotent**
```
Dado: Empty D1 ontology collections
Quando: seedOntology(db) called twice
Then: Both calls succeed; second call produces same result as first (no duplicates, no errors)
```

**Scenario: getConstraintsForClass double-filter**
```
Dado: Ontology contains constraint C1 (targetClasses: ['Pressure','BusinessCapability','FunctionProposal'])
Quando: getConstraintsForClass(db, 'Pressure') called
Then: Returns C1; does NOT return constraints targeting only 'BusinessCapability'
Note: Class 'CIFeedbackSignal' does NOT match a query for 'Signal' despite substring match
```

**Scenario: getRoleSpec — CoderRole**
```
Dado: ONTOLOGY_INSTANCES contains { _key: 'CoderRole', type: 'AgentRole', runsIn: 'SandboxContainer', tools: ['FileWriteTool','BashExecuteTool','GitTool'] }
Quando: getRoleSpec(db, 'CoderRole')
Then: Returns the CoderRole instance with correct permissions and tools
```

**Scenario: ontology_query tool — constraints_for_class**
```
Dado: buildOntologyTool(db) returns tool; constraints seeded
Quando: execute('call-1', { queryType: 'constraints_for_class', argument: 'ExecutableSpecification' })
Then: Returns { content: [{ type: 'text', text: '<constraints JSON>' }], details: [...] }
```

**Scenario: lifecycle state not found**
```
Dado: specs_functions does not contain 'FP-unknown'
Quando: getLifecycleState(db, 'FP-unknown')
Then: Returns null
```
