# Code Analysis Patch — packages/ontology-loader

> Phase 2 · Archaeologist · PATCH
> Generated: 2026-06-09
> Change type: modified (new module — no prior section in code-analysis.md)

**Package:** `@factory/ontology-loader`
**Version:** 0.1.0
**Files:**
- `packages/ontology-loader/package.json`
- `packages/ontology-loader/src/index.ts`
- `packages/ontology-loader/src/ontology-tool.ts`
- `packages/ontology-loader/src/classes.ts` (data, not in patch scope but read for completeness)
- `packages/ontology-loader/src/constraints.ts` (data, not in patch scope but read)
- `packages/ontology-loader/src/instances.ts` (data, not in patch scope but read)
- `packages/ontology-loader/src/properties.ts` (data, not in patch scope but read)

**Role:** Translates the Function Factory OWL ontology (`factory-ontology.ttl`) and SHACL shapes (`factory-shapes.ttl`) into TypeScript constants and seeds them into ArangoDB collections as queryable documents. Provides query helpers and an `ontology_query` AgentTool for use in agent sessions.

**Dependencies:**
- `@factory/db-client` (runtime — ArangoClient interface)
- `@weops/gdk-ai`, `@weops/gdk-agent` (dev only — type compatibility)
- `vitest` (dev — test runner)

---

## 6.1 Control Flow

### `seedOntology(db: ArangoClient): Promise<SeedResult>`

🟢 CONFIRMADO — Defined at `index.ts:118`.

Sequential four-pass seeder. Each pass iterates over one constant array and calls `db.save(collection, doc)` per element. All errors are silently swallowed (`catch {}`) to implement upsert semantics — a conflict or duplicate key does NOT abort the loop. Returns a count struct of successfully saved documents per collection.

```
seedOntology(db)
  ├── for cls of ONTOLOGY_CLASSES   → db.save('ontology_classes', cls)        classes++
  ├── for prop of ONTOLOGY_PROPERTIES → db.save('ontology_properties', prop)  properties++
  ├── for constraint of ONTOLOGY_CONSTRAINTS → db.save('ontology_constraints', c)  constraints++
  └── for instance of ONTOLOGY_INSTANCES → db.save('ontology_instances', i)   instances++
  → return { classes, properties, constraints, instances }
```

**Error handling:** Each `db.save` call is individually wrapped in `try/catch`. A failed save decrements the counter (increments only on success) and silently continues. 🟢 CONFIRMADO

**Idempotency:** Safe to call multiple times. Failed saves (duplicates) are ignored. 🟢 CONFIRMADO (module-level comment: "Upserts each document — safe to call multiple times.")

---

### Query Helpers

All five query helpers follow the same pattern: issue a parameterized SQL-style query against ArangoDB via `db.query()` or `db.queryOne()`, parse the returned `{ json: string }` rows, and return a typed domain object or null. 🟢 CONFIRMADO

#### `getConstraintsForClass(db, className): Promise<OntologyConstraint[]>`

🟢 CONFIRMADO — `index.ts:173`.

Two-stage filter:
1. SQL `LIKE` query using `%className%` pattern against `json_extract(json,'$.targetClasses')` — returns candidate rows (may include false positives due to substring matching).
2. In-process `.filter(c => Array.isArray(c.targetClasses) && c.targetClasses.includes(className))` — exact match to eliminate false positives from the LIKE pattern.

**Non-trivial logic:** The double-filter is intentional — the DB-level LIKE is an index-assisted pre-filter; the in-process filter is the authoritative check. 🟢 CONFIRMADO

#### `getRoleSpec(db, roleKey): Promise<OntologyInstance | null>`

🟢 CONFIRMADO — `index.ts:191`.

Exact key lookup via `WHERE collection='ontology_instances' AND key=? LIMIT 1`. Returns parsed `OntologyInstance` or `null`.

#### `getLifecycleState(db, functionKey): Promise<string | null>`

🟢 CONFIRMADO — `index.ts:207`.

Queries `specs_functions` (runtime collection, not an ontology collection) for `lifecycleState` field. Returns `null` if the function document doesn't exist or has no `lifecycleState`. Note: crosses collection boundary — this helper queries application data, not ontology data.

#### `getPendingCRPs(db): Promise<{ _key, context, confidence }[]>`

🟢 CONFIRMADO — `index.ts:225`.

Queries `consultation_requests` where `json_extract(json,'$.status')='pending'`. Projects only three fields: `_key`, `context`, `confidence` — not the full CRP document.

#### `getPersistenceTarget(db, className): Promise<string | null>`

🟢 CONFIRMADO — `index.ts:243`.

Key lookup in `ontology_classes` for `persistsIn` field. Returns the collection name or `null`.

---

### `buildOntologyTool(db: ArangoClient)` — `ontology-tool.ts:40`

🟢 CONFIRMADO

Factory function that closes over `db` and returns a tool object compatible with the `gdk-agent` AgentTool interface (without importing TypeBox at runtime). Returns a plain object with:

- `name: 'ontology_query'` (literal const)
- `label: 'Query Factory Ontology'`
- `description: string`
- `parameters: { type: 'object', properties: {...}, required: [...] }` — JSON Schema object, hand-written (no TypeBox)
- `execute(_toolCallId, params): Promise<ToolResult>`

**Dispatch logic in `execute`:** Switch on `params.queryType` with five cases:

| `queryType` | Delegates to | Response when empty |
|---|---|---|
| `constraints_for_class` | `getConstraintsForClass(db, argument)` | "No constraints found for class…" |
| `role_spec` | `getRoleSpec(db, argument)` | "No role spec found for…" |
| `lifecycle_state` | `getLifecycleState(db, argument)` | "No lifecycle state found for function…" |
| `pending_crps` | `getPendingCRPs(db)` | "No pending CRPs found." |
| `persistence_target` | `getPersistenceTarget(db, argument)` | "No persistence target found for class…" |
| `default` | — | "Unknown queryType: …" |

**Return shape:** Every branch returns `{ content: [{ type: 'text', text: string }], details: any }`. 🟢 CONFIRMADO

---

## 6.2 Algorithms

### Double-Filter Pattern (`getConstraintsForClass`)

🟢 CONFIRMADO

The LIKE pattern `%className%` on a JSON array stored as a string is imprecise — a class named `"Signal"` would also match `"CIFeedbackSignal"`. The in-process `Array.includes()` filter is the precision layer. This is a deliberate two-step: broad DB scan → exact in-memory match.

### Silent-Error Counter Pattern (`seedOntology`)

🟢 CONFIRMADO

Counter is only incremented inside the `try` block, after `await db.save` succeeds. Any exception bypasses the increment. This implements "count of successfully written documents" without a separate try/catch return-value check.

### JSON Serialization Round-trip (all query helpers)

🟢 CONFIRMADO

ArangoDB rows arrive as `{ json: string }`. Every helper calls `JSON.parse(r.json)` and casts to the typed interface. No validation is performed on the parsed shape — the type assertion is a cast, not a runtime check.

---

## 6.3 Data Structures

### `OntologyClass` — `index.ts:31`

🟢 CONFIRMADO

| Field | Type | Required | Description |
|---|---|---|---|
| `_key` | `string` | yes | ArangoDB document key. Matches the OWL class name (e.g. `'Signal'`). |
| `uri` | `string` | yes | Prefixed URI (e.g. `'ff:Signal'`). |
| `label` | `string` | yes | Human-readable name. |
| `superClass` | `string` | optional | Parent class key. |
| `domain` | `string` | yes | One of 7 domain values (see constants below). |
| `comment` | `string` | yes | Description from `rdfs:comment`. |
| `persistsIn` | `string` | optional | ArangoDB collection name where instances of this class are stored. |
| `enumValues` | `string[]` | optional | Enumeration values for enumeration classes. |

### `OntologyProperty` — `index.ts:42`

🟢 CONFIRMADO

| Field | Type | Required | Description |
|---|---|---|---|
| `_key` | `string` | yes | Property name key (e.g. `'derivesFrom'`). |
| `uri` | `string` | yes | Prefixed URI. |
| `label` | `string` | yes | Human-readable name. |
| `propertyType` | `'object' \| 'datatype'` | yes | ObjectProperty vs DatatypeProperty. |
| `domain` | `string` | optional | OWL class that is the subject. |
| `range` | `string` | optional | OWL class or XSD type that is the object/value. |
| `superProperty` | `string` | optional | Parent property key. |
| `comment` | `string` | yes | Description. |

### `OntologyConstraint` — `index.ts:53`

🟢 CONFIRMADO

| Field | Type | Required | Description |
|---|---|---|---|
| `_key` | `string` | yes | E.g. `'C1-lineage'`. |
| `constraintId` | `string` | yes | Short ID: `'C1'` through `'C16'`. |
| `name` | `string` | yes | Human-readable constraint name. |
| `shapeName` | `string` | yes | SHACL `sh:NodeShape` name. |
| `targetClasses` | `string[]` | yes | OWL class keys this constraint targets. |
| `severity` | `'violation' \| 'warning' \| 'info'` | yes | SHACL severity level. |
| `message` | `string` | yes | Violation message. |
| `requiredProperties` | `string[]` | optional | Property keys that must be present. |
| `optionalProperties` | `string[]` | optional | Recommended but not required properties. |
| `minCount` | `number` | optional | Minimum cardinality. |
| `sparqlCheck` | `boolean` | optional | Whether this constraint requires a SPARQL-style cross-artifact check (not enforceable by local shape alone). |
| `confidenceThreshold` | `number` | optional | Numeric threshold for C7. |
| `secretPatterns` | `string[]` | optional | Regex-like patterns for C15 secret detection. |
| `lifecycleRules` | `{ from, to, requires? }[]` | optional | State machine transition rules for C14. |
| `additionalChecks` | `Record<string, unknown>[]` | optional | Supplemental check descriptors (e.g. minLength, hasValue). |

### `OntologyInstance` — `index.ts:71`

🟢 CONFIRMADO

| Field | Type | Required | Description |
|---|---|---|---|
| `_key` | `string` | yes | Instance key (e.g. `'ArchitectRole'`). |
| `uri` | `string` | yes | Prefixed URI. |
| `type` | `string` | yes | OWL class key (e.g. `'AgentRole'`, `'Tool'`, `'ArangoCollection'`). |
| `label` | `string` | optional | Human-readable name. |
| `comment` | `string` | optional | Description. |
| `legacyAliasOf` | `string` | optional | Migration alias for renamed instances. |
| `tools` | `string[]` | optional | AgentRole only — tool keys available to this role. |
| `permissions` | `string[]` | optional | AgentRole only — permission enum values. |
| `memoryAccess` | `string[]` | optional | AgentRole only — memory stores loaded at session start. |
| `runsIn` | `string` | optional | AgentRole only — `'V8Isolate'` or `'SandboxContainer'`. |

### `SeedResult` — `index.ts:85`

🟢 CONFIRMADO

```ts
{ classes: number; properties: number; constraints: number; instances: number }
```

Counts of successfully seeded documents per collection.

### `OntologyQueryType` — `ontology-tool.ts:21`

🟢 CONFIRMADO

Union literal type:
```ts
'constraints_for_class' | 'role_spec' | 'lifecycle_state' | 'pending_crps' | 'persistence_target'
```

### `OntologyQueryParams` — `ontology-tool.ts:28`

🟢 CONFIRMADO

```ts
{ queryType: OntologyQueryType; argument: string }
```

`argument` is empty string (`''`) for `pending_crps` queries (no key needed). For all other types it is a class name, role key, or function key.

---

## 6.4 Metadata

### Domain Constants (7 domains)

🟢 CONFIRMADO — enforced by tests at `index.test.ts:94–103`.

| Domain string | Coverage |
|---|---|
| `'signals'` | EnvironmentalInput, Signal, SignalType, CIFeedbackSignal, ObservabilitySignal, ArchitectObservation |
| `'specification'` | Pressure, BusinessCapability, FunctionProposal, IntentSpecification, ExecutableSpecification, atoms, contracts, invariants, etc. |
| `'governance'` | Verification, VerificationReport, TrustComposite, Trajectory, MentorScript, PolicyStressReport, GovernanceDecision, SASE activities |
| `'execution'` | BriefingScript, Plan, CodeArtifact, CritiqueReport, TestReport, Verdict, SynthesisSession, RepairCycle, SandboxSession |
| `'dialogue'` | ConsultationRequestPack, VersionControlledResolution, MergeReadinessPack, ArchitectApproval, GateOverride, FeedbackCorrection |
| `'agents'` | AgentRole, Tool, Permission, MemoryAccess, ExecutionEnvironment |
| `'infrastructure'` | InfrastructureComponent, FunctionLifecycleState, FactoryMode, PipelineStage, ModelRoute, Provider, TaskKind |

### Constraint Inventory (16 constraints, C1–C16)

🟢 CONFIRMADO — enforced by test at `index.test.ts:146–152`.

| ID | Name | Severity | Targets |
|---|---|---|---|
| C1 | Lineage Completeness | violation | Pressure, BusinessCapability, FunctionProposal, IntentSpecification, ExecutableSpecification, VerificationReport |
| C2 | specContent Propagation | violation | Pressure, BusinessCapability, FunctionProposal |
| C3 | BriefingScript Completeness | violation | BriefingScript |
| C4 | Agent Is Real Agent | violation | AgentRole |
| C5 | Invariant Has Detector | violation | Invariant |
| C6 | Every Artifact Reviewed | violation | ExecutableSpecification, CodeArtifact, IntentSpecification |
| C7 | CRP Escalation on Low Confidence | violation | ExecutionArtifact (confidence < 0.7 threshold) |
| C8 | MentorScript Enforcement | violation | CritiqueReport |
| C9 | Verification Fail-Closed | violation | VerificationReport |
| C10 | Semantic Review Grounded | warning | CritiqueReport |
| C11 | Coder Has Filesystem | warning | CoderRole |
| C12 | Tester Runs Real Tests | warning | TesterRole |
| C13 | ExecutableSpecification Has Atoms | violation | ExecutableSpecification |
| C14 | Function Lifecycle Transitions | violation | FunctionProposal |
| C15 | No Secrets in Artifacts | violation | CodeArtifact |
| C16 | Event-Driven Communication | violation | Workflow |

### Agent Role Instances (6 roles)

🟢 CONFIRMADO — enforced by tests at `index.test.ts:164–200`.

| Role key | runsIn | Permissions | Notable tools |
|---|---|---|---|
| `ArchitectRole` | V8Isolate | ReadOnly | FileReadTool, GrepSearchTool, ArangoQueryTool |
| `PlannerRole` | V8Isolate | ReadOnly | FileReadTool, GrepSearchTool |
| `CoderRole` | SandboxContainer | CanRead, CanWrite, CanExecute | FileWriteTool, BashExecuteTool, GitTool |
| `CriticRole` | V8Isolate | ReadOnly | ArangoQueryTool |
| `TesterRole` | SandboxContainer | CanRead, CanExecute | BashExecuteTool |
| `VerifierRole` | V8Isolate | ReadOnly | ArangoQueryTool |

### Lifecycle State Machine (C14)

🟢 CONFIRMADO — `constraints.ts:203–210`.

```
Proposed → Designed → InProgress → Implemented --[FidelityVerification]--> Verified --[PersistenceVerification]--> Monitored → Retired
```

Transitions from `Implemented → Verified` require `FidelityVerification`. Transitions from `Verified → Monitored` require `PersistenceVerification`. All other transitions are unconditional.

### Persistence Targets (key mappings)

🟢 CONFIRMADO — class `persistsIn` fields; enforced by test at `index.test.ts:248–257`.

| OWL Class key | Collection |
|---|---|
| `Signal` | `specs_signals` |
| `Pressure` | `specs_pressures` |
| `BusinessCapability` | `specs_capabilities` |
| `FunctionProposal` | `specs_functions` |
| `IntentSpecification` | `intent_specifications` |
| `ExecutableSpecification` | `executable_specifications` |
| `Invariant` | `specs_invariants` |
| `VerificationReport` | `verification_reports` |
| `TrustComposite` | `trust_scores` |
| `Trajectory` | `memory_episodic` |
| `MentorScript` | `mentorscript_rules` |
| `BriefingScript` | `execution_artifacts` |
| `Plan` | `execution_artifacts` |
| `CodeArtifact` | `execution_artifacts` |
| `CritiqueReport` | `execution_artifacts` |
| `TestReport` | `execution_artifacts` |
| `Verdict` | `execution_artifacts` |
| `SynthesisSession` | `execution_artifacts` |
| `ConsultationRequestPack` | `consultation_requests` |
| `VersionControlledResolution` | `version_controlled_resolutions` |
| `MergeReadinessPack` | `merge_readiness_packs` |

### Collections Seeded

🟢 CONFIRMADO

```
ontology_classes        ← ONTOLOGY_CLASSES
ontology_properties     ← ONTOLOGY_PROPERTIES
ontology_constraints    ← ONTOLOGY_CONSTRAINTS
ontology_instances      ← ONTOLOGY_INSTANCES
```

Note: `getLifecycleState` queries `specs_functions` and `getPendingCRPs` queries `consultation_requests` — these are application collections not seeded by this package.

### Confidence Threshold (C7)

🟢 CONFIRMADO — `constraints.ts:105`.

`confidenceThreshold: 0.7` — any `ExecutionArtifact` with confidence below 0.7 MUST have an associated CRP.

### Secret Patterns (C15)

🟢 CONFIRMADO — `constraints.ts:224–228`.

```
'sk-ant-', 'sk-proj-', 'GOCSPX-', 'Bearer ey', 'AKIA',
'-----BEGIN RSA PRIVATE KEY', '-----BEGIN OPENSSH PRIVATE KEY',
'ghp_', 'glpat-', 'xoxb-', 'ya29.'
```

### `buildOntologyTool` — No TypeBox dependency

🟢 CONFIRMADO — `ontology-tool.ts:39–44`. The tool parameters are expressed as a plain JSON Schema object literal. The package depends on `@weops/gdk-agent` as a devDependency only — the AgentTool interface is satisfied structurally at runtime without importing the package.

---

## 6.5 Gaps and Lacunas

### SHACL `sparqlCheck: true` Constraints Not Enforced

🔴 LACUNA — Constraints C2, C7, C10, C14, C15, C16 carry `sparqlCheck: true`. The query helpers in this package do NOT implement SPARQL or cross-collection join evaluation. The `sparqlCheck` flag is metadata-only — it documents the intent that these constraints require graph traversal to evaluate, but no evaluation engine is wired here.

### No Runtime Validation on Parsed JSON

🟡 INFERIDO — All query helpers cast `JSON.parse(row.json)` directly to typed interfaces without runtime validation (no Zod, no type guards). Schema drift in ArangoDB would surface as runtime `undefined` field access rather than a typed error.

### `getConstraintsForClass` False Positives (mitigated)

🟡 INFERIDO — The LIKE pattern `%Signal%` would match `CIFeedbackSignal`. The in-process `includes()` filter corrects this. However, the DB query will return extra rows before filtering — minor performance concern at scale, not a correctness issue.

### No `db.update` / Actual Upsert

🟡 INFERIDO — The comment says "upsert semantics" but the implementation is `db.save` + silent error swallow. If the underlying `db.save` throws on a duplicate key (rather than overwriting), the existing document is never updated. True upsert (update if exists) is not implemented.
