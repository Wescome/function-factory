# Implementation Tasks — @factory/loop-closure (ksp-loop-closure)

> Reversa SDD · doc_level: completo · Generated 2026-06-10
> Source: SPEC-KSP-LOOP-CLOSURE-001 §8; SPEC-KSP-ARCH-001 implementation ordering; domain.md BR-KSP-14

---

## Prerequisites

Before any task in this module begins:

- `@factory/artifact-graph` implementation complete and all tests passing.
- `@factory/bead-graph` implementation complete and all tests passing.
- `@factory/ksp-sdk` scaffold compiled clean (`tsc --noEmit` zero errors).

These are hard sequencing gates defined in SPEC-KSP-ARCH-001 Phase 3 and domain.md BR-KSP-14. Do not start Task 22 until both upstream packages compile.

---

## Task 22 — Package Scaffold [X]

**Step**: 22
**Gate**: `pnpm install` completes without errors; `tsc --noEmit` zero errors on empty source tree.
**Confidence**: 🟢 — exact scaffold shape confirmed by SPEC-KSP-LOOP-CLOSURE-001 §9 and code-analysis.md §ksp-loop-closure module file layout.

### Files to Create

**`packages/loop-closure/package.json`**

```json
{
  "name": "@factory/loop-closure",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@factory/artifact-graph": "workspace:*",
    "@factory/bead-graph": "workspace:*"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "@cloudflare/workers-types": "catalog:",
    "vitest": "catalog:"
  }
}
```

**`packages/loop-closure/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "references": [
    { "path": "../artifact-graph" },
    { "path": "../bead-graph" }
  ],
  "include": ["src/**/*"]
}
```

**`packages/loop-closure/src/index.ts`**

Empty barrel re-export stub (will be filled in subsequent tasks):

```typescript
export {};
```

### Done Criterion

`pnpm install` in repo root completes without new resolution errors. `cd packages/loop-closure && tsc --noEmit` exits with code 0.

---

## Task 23 — src/types.ts [X]

**Step**: 23
**Gate**: `tsc --noEmit` zero errors.
**Confidence**: 🟢 — all types explicitly defined in SPEC-KSP-LOOP-CLOSURE-001 §4, §5, §7 and code-analysis.md §ksp-loop-closure data structures.

### What to Implement

`packages/loop-closure/src/types.ts` — all TypeScript interfaces and injectable function types for the module. No logic. No imports from `@factory/factory-graph` or any domain-specific package.

Key interfaces:

```typescript
import type { ArtifactGraphDOBase } from '@factory/artifact-graph';
import type { BeadGraphDOBase } from '@factory/bead-graph';

// Injectable function types (domain-provided)
export type DivergenceDetector = (
  traceNodeId:     string,
  specificationId: string,
  artifactGraph:   ArtifactGraphDOBase<unknown>
) => Promise<DetectedDivergence[]>;

export type HypothesisBuilder = (
  divergenceId:  string,
  artifactGraph: ArtifactGraphDOBase<unknown>
) => Promise<Hypothesis>;

export type AmendmentVerifier = (
  amendmentId:     string,
  proposedChange:  unknown,
  artifactGraph:   ArtifactGraphDOBase<unknown>
) => Promise<VerificationResult>;

// Core config
export interface LoopClosureConfig {
  artifactGraphDO:   ArtifactGraphDOBase<unknown>;
  beadGraphDO:       BeadGraphDOBase<unknown>;
  kvStore:           KVNamespace;
  detectDivergences: DivergenceDetector;
  buildHypothesis:   HypothesisBuilder;
  verifyAmendment:   AmendmentVerifier;
}

// Session state (stored in KV)
export interface Session {
  sessionId:              string;
  orgId:                  string;
  roleId:                 string;
  agentId:                string;
  ksRetrievedAt:          number;
  activeSpecificationId:  string;
  autonomyFloor:          Autonomy;
  policyBeadId?:          string;
  trustBeadId?:           string;
}

export type Autonomy = 'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL';

export interface DetectedDivergence {
  claimId:     string;
  description: string;
  severity:    'low' | 'medium' | 'high' | 'critical';
}

export interface Hypothesis {
  attribution:    string;
  explanation:    string;
  confidence:     number;
  targetBeadId:   string;
  targetType:     'trust' | 'policy';
  proposedChange: unknown;
}

export interface VerificationResult {
  passed: boolean;
  gate:   string;
  score:  number;
}

export interface ExecutionContent {
  domain:        string;
  action:        string;
  toolCallCount: number;
  status:        string;
  summary:       string;
}

export interface OutcomeContent {
  toolCallCount:         number;
  status:                string;
  summary:               string;
  triggers_amendment?:   boolean;
}
```

### Done Criterion

`tsc --noEmit` exits with code 0. No imports from `@factory/factory-graph`, `@factory/gears`, or any domain package.

---

## Task 24 — src/bridge-fields.ts [X]

**Step**: 24
**Gate**: `tsc --noEmit` zero errors.
**Confidence**: 🟢 — bridge field definitions fully specified in SPEC-KSP-LOOP-CLOSURE-001 §3 and code-analysis.md bridge field table.

### What to Implement

`packages/loop-closure/src/bridge-fields.ts` — pure helper functions that annotate content objects with the `artifact_graph_*_id` bridge fields. No DO calls. No async. No side effects.

```typescript
// Bridge field constants — the four cross-layer reference field names
export const BRIDGE_EXECUTION_ID    = 'artifact_graph_execution_id'   as const;
export const BRIDGE_DIVERGENCE_ID   = 'artifact_graph_divergence_id'  as const;
export const BRIDGE_AMENDMENT_ID    = 'artifact_graph_amendment_id'   as const;
export const BRIDGE_SPECIFICATION_ID = 'artifact_graph_specification_id' as const;

// Helper functions — each returns a copy of content with the bridge field added
export function addExecutionBridge<T extends object>(content: T, executionNodeId: string): T & { artifact_graph_execution_id: string };
export function addDivergenceBridge<T extends object>(content: T, divergenceId: string | null): T & { artifact_graph_divergence_id: string | null };
export function addAmendmentBridge<T extends object>(content: T, amendmentNodeId: string): T & { artifact_graph_amendment_id: string };
export function addSpecificationBridge<T extends object>(content: T, specificationNodeId: string): T & { artifact_graph_specification_id: string };
```

### Done Criterion

`tsc --noEmit` exits with code 0. All four bridge field constants exported. All four helper functions exported with correct generic signatures.

---

## Task 25 — src/service.ts (one method at a time) [X]

**Step**: 25
**Gate**: After each sub-step, `tsc --noEmit` zero errors.
**Confidence**: 🟢 — all five method signatures and write sequences confirmed by SPEC-KSP-LOOP-CLOSURE-001 §4 and code-analysis.md §ksp-loop-closure bridge points.

### Step 25a — openSession()

**Gate**: `tsc --noEmit` zero errors.

Create `packages/loop-closure/src/service.ts` with the `LoopClosureService` class skeleton and implement `openSession`.

```typescript
// packages/loop-closure/src/service.ts
import type { LoopClosureConfig, Session, Autonomy } from './types.js';

export class LoopClosureService {
  constructor(private readonly config: LoopClosureConfig) {}

  async openSession(
    orgId:   string,
    roleId:  string,
    agentId: string,
    ns:      string
  ): Promise<Session> { ... }
  // Bridge Point 1:
  // 1. beadGraphDO.retrieveKnowingState (fail-closed: catch → autonomyFloor='SUGGEST')
  // 2. artifactGraphDO.getActiveSpecification(ns, domain)
  // 3. sessionId = crypto.randomUUID()
  // 4. kvStore.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 })
  // 5. return Session
}
```

---

### Step 25b — recordExecution()

**Gate**: `tsc --noEmit` zero errors.

Add `recordExecution` method to `LoopClosureService`.

```typescript
async recordExecution(
  sessionId: string,
  payload:   ExecutionContent
): Promise<{ executionBeadId: string; executionNodeId: string }> { ... }
```

Write sequence (enforced, INV-LC-003):
1. Read session from KV.
2. `artifactGraphDO.upsertNode(executionId, 'Execution', {...})` — FIRST.
3. `artifactGraphDO.upsertEdge(activeSpecificationId, executionId, 'governs')`.
4. `addExecutionBridge(payload, executionId)` — annotate bead content.
5. `beadGraphDO.writeBead(execBead, auditBead)` — SECOND (after artifact graph).

---

### Step 25c — recordOutcome()

**Gate**: `tsc --noEmit` zero errors.

Add `recordOutcome` method.

```typescript
async recordOutcome(
  sessionId:       string,
  executionBeadId: string,
  outcome:         OutcomeContent
): Promise<{ divergenceId?: string; outcomeBeadId: string }> { ... }
```

Write sequence:
1. Write `ExecutionTrace` node + `produces` edge.
2. Call `config.detectDivergences(traceId, activeSpecificationId, artifactGraphDO)`.
3. If divergences: write `Divergence` node + `evidences` edge + `diverges_from` edge.
4. `addDivergenceBridge(outcomeContent, divergenceId ?? null)`.
5. `beadGraphDO.writeBead(outcomeBead, auditBead)`.

---

### Step 25d — proposeAmendment()

**Gate**: `tsc --noEmit` zero errors.

Add `proposeAmendment` method.

```typescript
async proposeAmendment(
  divergenceId: string,
  outcomeBeadId: string,
  orgId:         string
): Promise<{ amendmentId: string; amendmentBeadId: string }> { ... }
```

Write sequence:
1. Call `config.buildHypothesis(divergenceId, artifactGraphDO)`.
2. Write `Hypothesis` node + `evidence_for` edge.
3. Write `Amendment` node (status `'candidate'`) + `motivates` edge + `proposes_modification_of` edge.
4. `addAmendmentBridge(amendmentBeadContent, amendmentId)`.
5. `beadGraphDO.writeBead(amendmentBead, auditBead)`.

---

### Step 25e — adoptAmendment()

**Gate**: `tsc --noEmit` zero errors.

Add `adoptAmendment` method (the longest and most critical).

```typescript
async adoptAmendment(
  amendmentId:        string,
  amendmentBeadId:    string,
  reviewer:           string,
  verificationResult: VerificationResult
): Promise<{ newSpecId: string; newBeadId: string } | { rejected: true }> { ... }
```

Seven-step sequence (all steps or early exit on verification failure):
1. Write `VerificationProcess` + `Verdict` nodes and edges. If `!verificationResult.passed` → `return { rejected: true }`.
2. Write new `Specification` node + `version_of` edge + `if_adopted_produces` edge.
3a. Write `DispositionEvent` node (Q-13 resolution — must precede ElucidationArtifact):
    ```typescript
    const dispositionEventId = generateId('disposition-event');
    await artifactGraphDO.upsertNode(dispositionEventId, 'DispositionEvent', {
      occurred_at:  Date.now(),
      context:      'amendment_adoption',
      amendment_id: amendmentId,
    });
    ```
3b. Write `ElucidationArtifact` node + `produced_at` edge to `dispositionEventId`. **UNCONDITIONAL — never skip.**
    `artifact_graph_*_id` bridge field `artifact_graph_amendment_id` must be set on the ElucidationArtifact.
4. Write new TrustBead or PolicyBead + `supersedes` edge in bead graph. Bridge field `artifact_graph_specification_id` must be set.
5. Invalidate KV keys `ks:{orgId}:*`, `head:{orgId}:*`, `maintenance:{orgId}`. **Must complete before returning.**
6. Write approved `AmendmentBead` (status `'APPROVED'`).

---

## Task 26 — tests/loop.test.ts [X]

**Step**: 26
**Gate**: ALL FIVE bridge point tests pass (vitest).

⚠️ HARD GATE: Do NOT proceed to `@factory/factory-graph` (ksp-factory-graph) until Step 26 is green. This sequencing gate is defined in domain.md BR-KSP-14 and SPEC-KSP-ARCH-001 §9.

### What to Implement

`packages/loop-closure/tests/loop.test.ts` — minimum required tests. Use a stub implementation of `ArtifactGraphDOBase` and `BeadGraphDOBase` (in-memory, not real DOs).

**Required test cases (all five must pass):**

1. **Bridge Point 2 — Execution write** (`recordExecution`):
   - Assert `ExecutionBead.content.artifact_graph_execution_id` matches the Execution node ID written to the stub artifact graph.
   - Assert `governed_by` edge exists in stub artifact graph: `Specification → Execution`.
   - Assert artifact graph write precedes bead graph write (verify call order on stubs).

2. **Bridge Point 3 — Outcome write with divergence** (`recordOutcome`):
   - Provide a `detectDivergences` stub that returns one divergence.
   - Assert `OutcomeBead.content.artifact_graph_divergence_id` is set to the Divergence node ID.
   - Assert `evidences` edge exists in stub artifact graph.

3. **Bridge Point 4 — Amendment proposal** (`proposeAmendment`):
   - Provide a `buildHypothesis` stub.
   - Assert `AmendmentBead.content.artifact_graph_amendment_id` is set to the Amendment node ID.
   - Assert `Hypothesis` and `Amendment` (status `'candidate'`) nodes exist in stub artifact graph.

4. **Bridge Point 5 — Amendment adoption** (`adoptAmendment` — verification passes):
   - Provide a `verifyAmendment` stub returning `{ passed: true, gate: 'test', score: 1.0 }`.
   - Assert new `Specification` node exists in stub artifact graph with `version_of` edge.
   - Assert new TrustBead/PolicyBead exists in stub bead graph with `supersedes` edge.
   - Assert `ElucidationArtifact` node exists in stub artifact graph.
   - Assert KV keys for org are invalidated before return.
   - Assert return value is `{ newSpecId, newBeadId }`.

5. **Partial failure recovery** (Bridge Point 2 retry):
   - First call: `artifactGraphDO.upsertNode` succeeds, `beadGraphDO.writeBead` throws.
   - Second call with same payload: assert `upsertNode` is called with same ID (idempotent), assert `writeBead` succeeds and `ExecutionBead` exists.

### Done Criterion

`pnpm vitest run packages/loop-closure` exits with code 0 and all 5 test cases pass. Zero TypeScript errors. `@factory/factory-graph` implementation may begin only after this gate is green.

---

## Task Summary

| Task | Step | File | Gate |
|------|------|------|------|
| Package scaffold | 22 | `package.json`, `tsconfig.json`, `src/index.ts` | `pnpm install` + `tsc --noEmit` |
| Types | 23 | `src/types.ts` | `tsc --noEmit` |
| Bridge field constants | 24 | `src/bridge-fields.ts` | `tsc --noEmit` |
| openSession | 25a | `src/service.ts` | `tsc --noEmit` |
| recordExecution | 25b | `src/service.ts` | `tsc --noEmit` |
| recordOutcome | 25c | `src/service.ts` | `tsc --noEmit` |
| proposeAmendment | 25d | `src/service.ts` | `tsc --noEmit` |
| adoptAmendment | 25e | `src/service.ts` | `tsc --noEmit` |
| Bridge point tests | 26 | `tests/loop.test.ts` | ALL 5 tests pass — **HARD GATE** |

---

## Sequencing Constraint

```
@factory/artifact-graph tests pass
         ↓
@factory/bead-graph tests pass
         ↓
@factory/loop-closure: Tasks 22 → 23 → 24 → 25a → 25b → 25c → 25d → 25e → 26
         ↓
                ⚠️ HARD GATE: Step 26 green
         ↓
@factory/factory-graph (ksp-factory-graph) — Step 27+
```

Each step must compile clean before the next begins. Serial execution is required — these tasks have linear dependencies.
