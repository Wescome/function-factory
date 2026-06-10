# Design — packages/ontology-loader

> Unit: @factory/ontology-loader
> Phase 4 · Writer · Updated 2026-06-10 (PATCH — new module)

---

## Overview

`@factory/ontology-loader` translates the Function Factory OWL ontology (`factory-ontology.ttl`) and SHACL shapes (`factory-shapes.ttl`) into TypeScript constants and seeds them into D1 via `@factory/db-client`. Also provides query helpers and an `ontology_query` AgentTool for use in synthesis agent sessions.

---

## Component Hierarchy

```
index.ts
├── seedOntology(db) → SeedResult
│   ├── db.save('ontology_classes', cls)        for each ONTOLOGY_CLASSES
│   ├── db.save('ontology_properties', prop)    for each ONTOLOGY_PROPERTIES
│   ├── db.save('ontology_constraints', c)      for each ONTOLOGY_CONSTRAINTS
│   └── db.save('ontology_instances', i)        for each ONTOLOGY_INSTANCES
├── getConstraintsForClass(db, className) → OntologyConstraint[]
│   └── D1 LIKE pre-filter → in-process includes() exact match
├── getRoleSpec(db, roleKey) → OntologyInstance | null
├── getLifecycleState(db, functionKey) → string | null  [queries specs_functions]
├── getPendingCRPs(db) → { _key, context, confidence }[]
└── getPersistenceTarget(db, className) → string | null

ontology-tool.ts
└── buildOntologyTool(db) → AgentTool (name: 'ontology_query')
    └── execute(toolCallId, params) → dispatch on queryType
```

---

## Key Algorithms

### seedOntology — Silent-Error Counter Pattern

```typescript
for (const cls of ONTOLOGY_CLASSES) {
  try {
    await db.save('ontology_classes', cls)
    classes++
  } catch {}  // silent — duplicate or conflict ignored
}
// repeat for properties, constraints, instances
```

Counter increments only on success. Failed saves (duplicates, conflicts) are silently swallowed. This implements "count of successfully written documents" without a separate error-return check.

### getConstraintsForClass — Double-Filter Pattern

```
Stage 1 (D1):
  SELECT json FROM documents
  WHERE collection='ontology_constraints'
    AND json_extract(json,'$.targetClasses') LIKE '%className%'
  → returns rows (may include false positives due to substring match)

Stage 2 (in-process):
  rows.filter(c => Array.isArray(c.targetClasses) && c.targetClasses.includes(className))
  → exact match eliminates false positives
```

Rationale: D1 LIKE is an index-assisted pre-filter; in-process `includes()` is the authoritative check. A class named `"Signal"` would match `"%Signal%"` LIKE for `"CIFeedbackSignal"` — the second stage corrects this.

### JSON Serialization Round-Trip (all helpers)

All query helpers:
```typescript
const rows = await db.query<{ json: string }>(sql, params)
return rows.map(r => JSON.parse(r.json) as T)
```

No runtime validation on the parsed shape — type assertion is a cast, not a guard. Schema drift in D1 would surface as undefined field access.

---

## Data Structures

### OntologyClass
```typescript
{
  _key: string          // OWL class name (e.g., 'Signal')
  uri: string           // prefixed URI: 'ff:Signal'
  label: string
  superClass?: string   // parent class key
  domain: string        // one of 7 domains
  comment: string
  persistsIn?: string   // D1 collection name for instances
  enumValues?: string[]
}
```

### OntologyProperty
```typescript
{
  _key: string          // e.g., 'derivesFrom'
  uri: string
  label: string
  propertyType: 'object' | 'datatype'
  domain?: string
  range?: string
  superProperty?: string
  comment: string
}
```

### OntologyConstraint
```typescript
{
  _key: string          // e.g., 'C1-lineage'
  constraintId: string  // 'C1' .. 'C16'
  name: string
  shapeName: string
  targetClasses: string[]
  severity: 'violation' | 'warning' | 'info'
  message: string
  requiredProperties?: string[]
  optionalProperties?: string[]
  minCount?: number
  sparqlCheck?: boolean
  confidenceThreshold?: number
  secretPatterns?: string[]
  lifecycleRules?: { from, to, requires? }[]
  additionalChecks?: Record<string, unknown>[]
}
```

### OntologyInstance
```typescript
{
  _key: string          // e.g., 'ArchitectRole'
  uri: string
  type: string          // OWL class key: 'AgentRole', 'Tool', 'ArangoCollection'
  label?: string
  comment?: string
  legacyAliasOf?: string
  tools?: string[]       // AgentRole only
  permissions?: string[] // AgentRole only
  memoryAccess?: string[]// AgentRole only
  runsIn?: string        // 'V8Isolate' | 'SandboxContainer'
}
```

### SeedResult
```typescript
{ classes: number; properties: number; constraints: number; instances: number }
```

### OntologyQueryParams (tool)
```typescript
{ queryType: OntologyQueryType; argument: string }
// argument = '' for 'pending_crps'; class/role/function key for others
type OntologyQueryType = 'constraints_for_class' | 'role_spec' | 'lifecycle_state' | 'pending_crps' | 'persistence_target'
```

---

## Domain Constants

### 7 Domains

| Domain | Classes covered |
|---|---|
| `'signals'` | Signal, SignalType, CIFeedbackSignal, ObservabilitySignal, ArchitectObservation |
| `'specification'` | Pressure, BusinessCapability, FunctionProposal, IntentSpecification, ExecutableSpecification |
| `'governance'` | Verification, VerificationReport, TrustComposite, GovernanceDecision, MentorScript |
| `'execution'` | BriefingScript, Plan, CodeArtifact, CritiqueReport, TestReport, Verdict |
| `'dialogue'` | ConsultationRequestPack, MergeReadinessPack, ArchitectApproval |
| `'agents'` | AgentRole, Tool, Permission, MemoryAccess, ExecutionEnvironment |
| `'infrastructure'` | FunctionLifecycleState, ModelRoute, Provider, TaskKind, PipelineStage |

### 16 Constraints (C1–C16)

| ID | Severity | sparqlCheck |
|---|---|---|
| C1 Lineage Completeness | violation | false |
| C2 specContent Propagation | violation | true |
| C3 BriefingScript Completeness | violation | false |
| C4 Agent Is Real Agent | violation | false |
| C5 Invariant Has Detector | violation | false |
| C6 Every Artifact Reviewed | violation | true |
| C7 CRP Escalation on Low Confidence | violation | true (threshold: 0.7) |
| C8 MentorScript Enforcement | violation | false |
| C9 Verification Fail-Closed | violation | false |
| C10 Semantic Review Grounded | warning | true |
| C11 Coder Has Filesystem | warning | false |
| C12 Tester Runs Real Tests | warning | false |
| C13 ExecutableSpecification Has Atoms | violation | false |
| C14 Function Lifecycle Transitions | violation | true |
| C15 No Secrets in Artifacts | violation | true |
| C16 Event-Driven Communication | violation | true |

### Agent Role Instances (6 roles)

| Role | runsIn | Notable tools |
|---|---|---|
| ArchitectRole | V8Isolate | FileReadTool, GrepSearchTool, ArangoQueryTool |
| PlannerRole | V8Isolate | FileReadTool, GrepSearchTool |
| CoderRole | SandboxContainer | FileWriteTool, BashExecuteTool, GitTool |
| CriticRole | V8Isolate | ArangoQueryTool |
| TesterRole | SandboxContainer | BashExecuteTool |
| VerifierRole | V8Isolate | ArangoQueryTool |

### Lifecycle State Machine (C14)

```
Proposed → Designed → InProgress → Implemented --[FidelityVerification]--> Verified --[PersistenceVerification]--> Monitored → Retired
```

### Collections Seeded
```
ontology_classes      ← ONTOLOGY_CLASSES
ontology_properties   ← ONTOLOGY_PROPERTIES
ontology_constraints  ← ONTOLOGY_CONSTRAINTS
ontology_instances    ← ONTOLOGY_INSTANCES
```

Application collections queried (not seeded): `specs_functions`, `consultation_requests`

---

## Package Metadata

| Field | Value |
|---|---|
| Name | `@factory/ontology-loader` |
| Version | `0.1.0` |
| Runtime deps | `@factory/db-client` |
| DevDeps | `@weops/gdk-ai`, `@weops/gdk-agent` (type compat only), `vitest` |
| No TypeBox at runtime | Tool parameters expressed as JSON Schema object literal |
