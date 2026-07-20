# Tasks — @factory/bead-graph (ksp-bead-graph)

> Reversa Writer · doc_level: completo · Generated 2026-06-10
> Source spec: SPEC-KSP-BEAD-GRAPH-001 (v1.0) §11 Implementation Ordering
> Executor: pi-coding-agent
> Gate discipline: tsc --noEmit must pass at every step before proceeding

---

## Execution Rules

1. Execute strictly in order — each step must pass its gate before the next step begins
2. Gate = `tsc --noEmit` zero errors unless specified otherwise
3. Never skip a step to unblock the next — fix the typecheck failure first
4. Each task is independently committable after its gate passes
5. Done criterion is stated explicitly per task — "gate passes with zero errors" is the minimum

---

## Task 10: Package Scaffold [X]

**File(s):** `packages/bead-graph/package.json`, `packages/bead-graph/tsconfig.json`

**What to implement:**

`package.json`:
```json
{
  "name": "@factory/bead-graph",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240529.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts", "bindings.ts", "migrations/**/*.ts"]
}
```

**Gate:** `pnpm install` completes without error; `tsc --noEmit` with empty `src/` produces no error (empty project is valid)

**Done criterion:** `pnpm install` succeeds and TypeScript resolves `@cloudflare/workers-types` without error

**Confidence:** 🟢 (spec §12 — package placement confirmed; stack is CF Workers + TypeScript)

---

## Task 11: Content-Addressed Bead Identity [X]

**File(s):** `packages/bead-graph/src/bead-id.ts`

**What to implement:**

```typescript
import { createHash } from 'crypto';

/**
 * Compute the content-addressed bead_id.
 *
 * bead_id = SHA-256(type + canonical_json(content) + sorted_join(parent_ids))
 *
 * Guarantees:
 *   - Deterministic: same inputs always produce the same ID
 *   - Parent-order independent: sorted parent_ids before join
 */
export function computeBeadId(
  type: string,
  content: Record<string, unknown>,
  parentIds: string[]
): string {
  const canonical =
    type +
    JSON.stringify(content, Object.keys(content).sort()) +
    [...parentIds].sort().join('');
  return createHash('sha256').update(canonical).digest('hex');
}
```

**Gate:** Unit test — `tests/bead.test.ts` with two assertions:
1. `computeBeadId('trust', { a: 1, b: 2 }, ['x', 'y'])` equals `computeBeadId('trust', { b: 2, a: 1 }, ['y', 'x'])` (content key order and parent order do not affect result)
2. Two calls with identical inputs produce the same hex string

**Done criterion:** Both unit test assertions pass; `tsc --noEmit` zero errors

**Confidence:** 🟢 (SPEC-KSP-BEAD-GRAPH-001 §3 — implementation quoted verbatim)

---

## Task 12: Zod Schemas (All 8 Bead Types) [X]

**File(s):** `packages/bead-graph/src/schemas.ts`

**What to implement:** All 8 Bead schemas plus enums and the `AnyBead` discriminated union, matching SPEC-KSP-BEAD-GRAPH-001 §5 exactly:

- `BaseBead` — base schema with `bead_id`, `org_id`, `type`, `parent_ids`, `written_by`, `ts`
- `TrustStatus` enum — `PENDING | APPROVED | SUSPENDED | REVOKED`
- `OutcomeStatus` enum — `SUCCESS | PARTIAL | FAILURE | DISPUTED`
- `AmendmentStatus` enum — `PENDING | APPROVED | REJECTED | SUPERSEDED`
- `Autonomy` type — `'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL'`
- `PolicyBead` — extends BaseBead; `type: z.literal('policy')`; content has `scope`, `rules`, `autonomy`, `effective_at`, `expires_at?`
- `TrustBead` — extends BaseBead; `type: z.literal('trust')`; content has `subject_id`, `subject_type`, `status`, `trust_score`, `rationale`, `evidence_refs`, `expiry?`
- `ExecutionBead` — extends BaseBead; `type: z.literal('execution')`; content has `subject_id`, `action`, `autonomy_level`, `trust_bead_id`, `policy_bead_id`, `rationale`, `artifact_graph_execution_id?`
- `OutcomeBead` — extends BaseBead; `type: z.literal('outcome')`; content has `execution_bead_id`, `status`, `summary`, `metrics?`, `triggers_amendment`, `artifact_graph_divergence_id?`
- `AmendmentBead` — extends BaseBead; `type: z.literal('amendment')`; content has `target_bead_id`, `target_type`, `proposed_change`, `rationale`, `triggered_by`, `status`, `reviewed_by?`, `reviewed_at?`, `if_approved_produces?`, `artifact_graph_amendment_id?`
- `ConsentBead` — extends BaseBead; `type: z.literal('consent')`; content has `role_id`, `grants`, `status`, `granted_by`, `granted_at`, `expires_at?`, `revokes?`
- `EscalationBead` — extends BaseBead; `type: z.literal('escalation')`; content has `trigger_bead_id`, `reason`, `escalated_to`, `resolved_at?`, `resolution?`, `resolution_bead_id?`
- `AuditBead` — extends BaseBead; `type: z.literal('audit')`; content has `audited_bead_id`, `audited_type`, `action` (enum CREATE|SUPERSEDE|ESCALATE|CONSENT_GRANT|CONSENT_REVOKE), `actor_id`, `session_id`, `ts`
- `AnyBead = z.discriminatedUnion('type', [PolicyBead, TrustBead, ExecutionBead, OutcomeBead, AmendmentBead, ConsentBead, EscalationBead, AuditBead])`
- Export all types via `z.infer<typeof ...>`

**Gate:** `tsc --noEmit` zero errors. All 8 schemas must parse without type errors.

**Done criterion:** `tsc --noEmit` exits 0; `AnyBead` discriminates correctly on `type` field

**Confidence:** 🟢 (SPEC-KSP-BEAD-GRAPH-001 §5 — full TypeScript + Zod quoted verbatim)

---

## Task 13: Base Migration SQL [X]

**File(s):** `packages/bead-graph/migrations/v00_base.ts`

**What to implement:**

```typescript
import type { Migration } from '../src/migrate';

export const v00_base: Migration = {
  version: 0,
  name: 'v00_bead_graph_base',
  sql: `
    CREATE TABLE IF NOT EXISTS beads (
      id          TEXT    PRIMARY KEY,
      org_id      TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      written_by  TEXT    NOT NULL,
      ts          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bead_edges (
      child_id    TEXT    NOT NULL REFERENCES beads(id),
      parent_id   TEXT    NOT NULL REFERENCES beads(id),
      rel         TEXT    NOT NULL,
      PRIMARY KEY (child_id, parent_id, rel)
    );

    CREATE INDEX IF NOT EXISTS idx_beads_org_type ON beads(org_id, type);
    CREATE INDEX IF NOT EXISTS idx_beads_org_ts   ON beads(org_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_edges_child    ON bead_edges(child_id);
    CREATE INDEX IF NOT EXISTS idx_edges_parent   ON bead_edges(parent_id);

    CREATE TABLE IF NOT EXISTS schema_history (
      version INTEGER PRIMARY KEY,
      name    TEXT    NOT NULL,
      applied INTEGER NOT NULL
    );
  `,
};
```

**Gate:** Syntax check — file must parse without TypeScript error. `Migration` interface must be defined in `src/migrate.ts` before this file can typecheck.

**Done criterion:** `tsc --noEmit` exits 0 after `src/migrate.ts` (Task 14) is written

**Confidence:** 🟢 (SPEC-KSP-BEAD-GRAPH-001 §4.1 — SQL quoted verbatim)

---

## Task 14: Migration Runner [X]

**File(s):** `packages/bead-graph/src/migrate.ts`

**What to implement:**

```typescript
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function migrate(
  storage: { sql: { exec: (sql: string, ...bindings: unknown[]) => unknown } },
  migrations: Migration[]
): void {
  const sql = storage.sql;

  // Ensure schema_history table exists (bootstrapping)
  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_history (
      version INTEGER PRIMARY KEY,
      name    TEXT    NOT NULL,
      applied INTEGER NOT NULL
    )
  `);

  // Find current version
  const rows = [...(sql.exec('SELECT MAX(version) as v FROM schema_history') as Iterable<{ v: number | null }>)];
  const currentVersion = rows[0]?.v ?? -1;

  // Apply pending migrations in order
  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    sql.exec(migration.sql);
    sql.exec(
      'INSERT INTO schema_history (version, name, applied) VALUES (?, ?, ?)',
      migration.version,
      migration.name,
      Date.now()
    );
  }
}
```

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0; `Migration` interface is exported and consumable by `v00_base.ts`

**Confidence:** 🟢 (pattern inferred from DO startup convention in spec §9; structure confirmed by `blockConcurrencyWhile` usage)

---

## Task 15: Storage Operations (`bead-queries.ts`) — One Function at a Time [X]

**File(s):** `packages/bead-graph/src/bead-queries.ts`

Implement each function below and run `tsc --noEmit` after each addition. Do not proceed to the next function until the gate passes.

**15a: `toBeadRow` (helper) + `writeBead`**

`toBeadRow`: converts a `Record<string, unknown>` row from SqlStorage into `BaseBead & { content: Record<string, unknown> }`.

`writeBead(sql, bead, auditBead?)`:
- Throws if `bead.type !== 'audit'` and `auditBead` is absent
- `BEGIN` → INSERT bead → INSERT parent edges → INSERT auditBead → INSERT audit edge → `COMMIT`
- On failure: `ROLLBACK` + re-throw
- Uses `INSERT OR IGNORE` for idempotency

Gate: `tsc --noEmit` zero errors

**15b: `getBead`**

`getBead(sql, beadId)`: SELECT from `beads` WHERE `id = beadId`; reconstitute `parent_ids` from `bead_edges WHERE child_id = beadId AND rel = 'parent'`.

Gate: `tsc --noEmit` zero errors

**15c: `getCurrentTrustBead`**

`getCurrentTrustBead(sql, orgId, subjectId)`: Anti-join query — TrustBead with no `supersedes`-typed incoming edge; ORDER BY `ts DESC LIMIT 1`.

Gate: `tsc --noEmit` zero errors

**15d: `getActiveConsent`**

`getActiveConsent(sql, orgId, roleId)`: consent bead WHERE `status = 'ACTIVE'` AND `role_id = roleId`; ORDER BY `ts DESC LIMIT 1`.

Gate: `tsc --noEmit` zero errors

**15e: `getTrustLineage`**

`getTrustLineage(sql, orgId, subjectId)`: All trust + outcome + amendment beads for subject, ORDER BY `ts ASC`.

Gate: `tsc --noEmit` zero errors

**15f: `getOpenAmendments`**

`getOpenAmendments(sql, orgId)`: amendment beads WHERE `status = 'PENDING'`, ORDER BY `ts DESC`.

Gate: `tsc --noEmit` zero errors

**15g: `retrieveKnowingState`**

`retrieveKnowingState(sql, orgId, roleId, category?)`: Three independent queries (policy + trusted subjects + consent) composed into `{ policy, trustedSubjects, consent }`. Category filter on `subject_type` when provided.

Gate: `tsc --noEmit` zero errors

**Done criterion for Task 15:** All seven sub-tasks complete; `tsc --noEmit` exits 0 with all functions present

**Confidence:** 🟢 (SPEC-KSP-BEAD-GRAPH-001 §6 — all SQL and function signatures quoted verbatim)

---

## Task 16: `BeadGraphDOBase` Abstract Class [X]

**File(s):** `packages/bead-graph/src/do.ts`

**What to implement:**

```typescript
import { DurableObject } from 'cloudflare:workers';
import { migrate } from './migrate';
import type { Migration } from './migrate';
import * as BQ from './bead-queries';
import { computeBeadId } from './bead-id';
import type { AnyBead } from './schemas';

export abstract class BeadGraphDOBase<Env> extends DurableObject<Env> {
  protected sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env, migrations: Migration[]) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ctx.blockConcurrencyWhile(async () => {
      migrate(ctx.storage, migrations);
    });
  }

  async writeBead(bead: AnyBead, auditBead?: AnyBead): Promise<void> {
    return BQ.writeBead(this.sql, bead, auditBead);
  }

  async getBead(beadId: string) {
    return BQ.getBead(this.sql, beadId);
  }

  async getCurrentTrustBead(orgId: string, subjectId: string) {
    return BQ.getCurrentTrustBead(this.sql, orgId, subjectId);
  }

  async getActiveConsent(orgId: string, roleId: string) {
    return BQ.getActiveConsent(this.sql, orgId, roleId);
  }

  async getTrustLineage(orgId: string, subjectId: string) {
    return BQ.getTrustLineage(this.sql, orgId, subjectId);
  }

  async getOpenAmendments(orgId: string) {
    return BQ.getOpenAmendments(this.sql, orgId);
  }

  async retrieveKnowingState(orgId: string, roleId: string, category?: string) {
    return BQ.retrieveKnowingState(this.sql, orgId, roleId, category);
  }

  computeBeadId(type: string, content: Record<string, unknown>, parentIds: string[]): string {
    return computeBeadId(type, content, parentIds);
  }
}
```

**Gate:** `tsc --noEmit` zero errors. `DurableObject` import from `cloudflare:workers` must resolve via `@cloudflare/workers-types`.

**Done criterion:** `tsc --noEmit` exits 0; `BeadGraphDOBase` is abstract and cannot be instantiated directly

**Confidence:** 🟢 (SPEC-KSP-BEAD-GRAPH-001 §9 — class body quoted verbatim)

---

## Task 17: `KnowingStateSDK` Implementation [X]

**File(s):** `packages/bead-graph/src/sdk.ts`

**What to implement:**

The concrete SDK class that implements `KnowingStateSDK<P,T,E,O>`. Key behaviors:

1. **Constructor**: accepts a DO RPC stub (typed as `BeadGraphDOBase<unknown>`) and a `KVNamespace`
2. **`openSession`**: generates a `sessionId` (UUID), writes `session:{sessionId}` to KV with `{ orgId, roleId, agentId, autonomyFloor: 'EXECUTE_FULL', ksRetrievedAt: undefined }`, TTL 86400s
3. **`closeSession`**: deletes `session:{sessionId}` from KV
4. **`retrieveKnowingState`**:
   - Reads session from KV; on miss → throw
   - Check KV hot cache `ks:{orgId}:{roleId}:{category ?? '*'}`; on hit → return
   - Cold path: call DO RPC `retrieveKnowingState(orgId, roleId, category)`
   - On success: write KV cache; set `session.ksRetrievedAt = Date.now()` in KV
   - On failure (throw): set `session.autonomyFloor = 'SUGGEST'` in KV; re-throw or return degraded
5. **`writeExecutionBead`**:
   - Read session KV; assert `session.ksRetrievedAt` is defined → throw `SessionNotInitialized` if not
   - If `session.autonomyFloor === 'SUGGEST'` AND `payload.autonomy_level !== 'SUGGEST'` → throw `AutonomyDegradedError`
   - Compute `bead_id` via `computeBeadId`
   - Build `AuditBead` for the transaction
   - Call DO RPC `writeBead(executionBead, auditBead)`
   - Call `invalidateKV(orgId, 'execution', payload)`
   - Return `bead_id`
6. **`writeOutcomeBead`**:
   - Write OutcomeBead + its AuditBead via DO RPC
   - If `outcome.triggers_amendment === true`: auto-create and write a PENDING AmendmentBead
   - Invalidate `maintenance:{orgId}` in KV
   - Return `bead_id`
7. **`evaluateTrust`**: call DO `getCurrentTrustBead`; derive `trusted` and `autonomy` from `TrustStatus` and `trust_score`
8. **`getOpenAmendments`**: proxy to DO `getOpenAmendments`
9. **`checkConsent`**: call DO `getActiveConsent`; check `content.grants` includes action

Export `SessionNotInitialized`, `AutonomyDegradedError`, `BeadImmutabilityError`, `BeadIntegrityError` as named error classes.

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0; `KnowingStateSDK` interface is fully implemented with no `any` types in method signatures

**Confidence:** 🟢 (SPEC-KSP-BEAD-GRAPH-001 §8 — interface quoted verbatim; session state machine confirmed in code-analysis.md §2965–2983)

---

## Task 18: Worker Fetch Handler and Bindings [X]

**File(s):** `packages/bead-graph/bindings.ts`, `packages/bead-graph/src/worker.ts`

**What to implement:**

`bindings.ts`:
```typescript
export interface Env {
  KV_NAMESPACE:    KVNamespace;
  BEAD_GRAPH_DO:   DurableObjectNamespace;
}
```

`src/worker.ts`:
```typescript
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../bindings';

export default class BeadGraphWorker extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Route: /org/:orgId/*  → stub to BEAD_GRAPH_DO keyed by orgId
    const orgId = url.pathname.split('/')[2];
    if (!orgId) {
      return new Response('orgId required', { status: 400 });
    }
    const id = this.env.BEAD_GRAPH_DO.idFromName(orgId);
    const stub = this.env.BEAD_GRAPH_DO.get(id);
    return stub.fetch(request);
  }
}
```

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0; `Env` interface resolves both `KVNamespace` and `DurableObjectNamespace` from `@cloudflare/workers-types`

**Confidence:** 🟢 (standard CF Worker pattern; confirmed by other workers in the repo)

---

## Task 19: Wrangler Configuration [X]

**File(s):** `packages/bead-graph/wrangler.jsonc`

**What to implement:**

```jsonc
{
  "name": "bead-graph",
  "main": "src/worker.ts",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"],

  // Enable SQLite storage for Durable Objects
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["BeadGraphDO"]
    }
  ],

  "durable_objects": {
    "bindings": [
      {
        "name": "BEAD_GRAPH_DO",
        "class_name": "BeadGraphDO"
      }
    ]
  },

  "kv_namespaces": [
    {
      "binding": "KV_NAMESPACE",
      "id": "REPLACE_WITH_KV_NAMESPACE_ID"
    }
  ]
}
```

Note: `BeadGraphDO` is the concrete DO class exported by `src/worker.ts` (a domain instantiation extending `BeadGraphDOBase`). For the scaffold, this can be a minimal concrete class that passes `[v00_base]` as migrations.

**Gate:** `wrangler dev` starts without error; no `Error: SqlStorage is not available` or binding resolution errors

**Done criterion:** `wrangler dev` starts and accepts a request to `/org/test-org/` without crashing

**Confidence:** 🟢 (new_sqlite_classes pattern confirmed in spec §11 step 10; wrangler format confirmed from other workers in repo)

---

## Task 20: Tests [X]

**File(s):** `packages/bead-graph/tests/bead.test.ts`

**What to implement:** Five required test scenarios (SPEC-KSP-BEAD-GRAPH-001 §11 step 11):

**Test 1 — `computeBeadId` determinism:**
```typescript
test('computeBeadId is deterministic and parent-order-independent', () => {
  const id1 = computeBeadId('trust', { a: 1, b: 2 }, ['aaa', 'bbb']);
  const id2 = computeBeadId('trust', { b: 2, a: 1 }, ['bbb', 'aaa']);
  expect(id1).toBe(id2);
  expect(id1).toHaveLength(64); // SHA-256 hex
});
```

**Test 2 — `writeBead` idempotency on duplicate hash:**
```typescript
test('writeBead with duplicate bead_id is idempotent', async () => {
  // Setup: write bead twice with same content
  // Assert: no error; beads table row count = 1 (not 2)
});
```

**Test 3 — `retrieveKnowingState` returns empty when no beads exist:**
```typescript
test('retrieveKnowingState returns null policy and empty trustedSubjects on empty DB', () => {
  const result = retrieveKnowingState(sql, 'org1', 'role1');
  expect(result.policy).toBeNull();
  expect(result.trustedSubjects).toHaveLength(0);
  expect(result.consent).toBeNull();
});
```

**Test 4 — `writeExecutionBead` throws when `ksRetrievedAt` not set:**
```typescript
test('writeExecutionBead throws SessionNotInitialized when ksRetrievedAt not set', async () => {
  const session = await sdk.openSession('org1', 'role1', 'agent1');
  // Do NOT call retrieveKnowingState
  await expect(sdk.writeExecutionBead(session.sessionId, payload))
    .rejects.toThrow(SessionNotInitialized);
});
```

**Test 5 — `autonomyFloor` degrades to SUGGEST on retrieval failure:**
```typescript
test('autonomyFloor degrades to SUGGEST when retrieveKnowingState fails', async () => {
  const session = await sdk.openSession('org1', 'role1', 'agent1');
  // Simulate failure: mock DO throws
  await sdk.retrieveKnowingState(session.sessionId).catch(() => {});
  // Re-read session from KV
  const updatedSession = await getSessionFromKV(session.sessionId);
  expect(updatedSession.autonomyFloor).toBe('SUGGEST');
});
```

**Gate:** All 5 tests pass with `vitest run`

**Done criterion:** `vitest run` exits 0; all assertions green; no TypeScript errors in test file

**Confidence:** 🟢 (SPEC-KSP-BEAD-GRAPH-001 §11 step 11 — test scenarios listed verbatim)

---

## Dependency Map

```
Task 10 (scaffold)
  └── Task 11 (bead-id)          ← pure; no CF runtime dep
       └── Task 12 (schemas)     ← zod only
            └── Task 13 (migration SQL)
                 └── Task 14 (migrate runner)
                      └── Task 15 (bead-queries) ← one function at a time
                           └── Task 16 (do.ts)
                                └── Task 17 (sdk.ts)
                                     └── Task 18 (bindings + worker)
                                          └── Task 19 (wrangler.jsonc)
                                               └── Task 20 (tests)
```

All tasks are strictly sequential. No parallelism is safe — each file imports from the prior step.

---

## Phase Gate (Post-Task-20)

Before `@factory/ksp-sdk` (Phase 2) can begin:
- `tsc --noEmit` exits 0 in `packages/bead-graph/`
- All 5 Vitest tests pass
- `wrangler dev` starts without error
- `BeadGraphDOBase` is exported and abstract
- `KnowingStateSDK<P,T,E,O>` interface and implementation are exported
- `computeBeadId` is exported and independently unit-tested

This package is a Phase 1 leaf — it must compile clean before any Phase 2 or later package touches it.
