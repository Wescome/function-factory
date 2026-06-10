# Regression Watch — @factory/bead-graph (ksp-bead-graph)

> Generated: 2026-06-10 after steps 10–20 green.
> Format: W{n} | Source | Expected rule | Check type | Violation signal

---

## Watch List

| ID | Source file + section | Expected rule after change | Check type | Violation signal |
|----|-----------------------|---------------------------|-----------|-----------------|
| W001 | `src/bead-id.ts` — `computeBeadId()` | SHA-256(type + canonical_json + sorted_parent_ids) is deterministic and parent-order-independent | Unit test (Test 1 in bead.test.ts) | `id1 !== id2` when inputs are equivalent but in different order |
| W002 | `src/bead-queries.ts` — `writeBead()` | INSERT OR IGNORE makes writes idempotent; writing same bead_id twice yields exactly 1 row in beads | Unit test (Test 2 in bead.test.ts) | Row count > 1 for same bead_id; or error on second write |
| W003 | `src/bead-queries.ts` — `writeBead()` | Every non-audit write requires an auditBead (INV-BG-007); throws if omitted | Runtime invariant + unit assertion | `writeBead(sql, nonAuditBead)` without auditBead succeeds silently |
| W004 | `src/bead-queries.ts` — `writeBead()` | BEGIN/COMMIT wraps all writes; ROLLBACK on failure; partial writes never committed | Transactional consistency | bead written without its audit bead; or partial edge writes visible before commit |
| W005 | `src/schemas.ts` — `AnyBead` discriminated union | All 8 bead types parse without type error; `type` field discriminates correctly | tsc --noEmit + Zod parse | Zod parse throws on valid bead; or tsc error in downstream package that imports AnyBead |
| W006 | `src/sdk.ts` — `writeExecutionBead()` | Throws `SessionNotInitialized` when `session.ksRetrievedAt` not set (INV-BG-003) | Unit test (Test 4 in bead.test.ts) | writeExecutionBead succeeds without prior retrieveKnowingState call |
| W007 | `src/sdk.ts` — `retrieveKnowingState()` | On DO failure, sets `session.autonomyFloor = 'SUGGEST'` in KV (INV-BG-008) | Unit test (Test 5 in bead.test.ts) | autonomyFloor stays 'EXECUTE_FULL' after DO failure |
| W008 | `src/sdk.ts` — `writeExecutionBead()` | Throws `AutonomyDegradedError` when `session.autonomyFloor === 'SUGGEST'` and requested autonomy_level is not SUGGEST | Runtime invariant | EXECUTE_FULL action proceeds when session is degraded |
| W009 | `src/bead-queries.ts` — all query functions | No UPDATE or DELETE statement appears anywhere in bead-queries.ts (INV-BG-001) | Static grep: `grep -n 'UPDATE\|DELETE' src/bead-queries.ts` must return empty | Any UPDATE/DELETE in bead-queries.ts |
| W010 | `migrations/v00_base.ts` — SQL | beads table has no ON DELETE or ON UPDATE cascade; bead_edges uses REFERENCES but no CASCADE | Schema review: inspect migration SQL for CASCADE keywords | Any CASCADE appearing in v00_base.ts |
| W011 | `src/sdk.ts` — `writeOutcomeBead()` | When `outcome.triggers_amendment === true`, a PENDING AmendmentBead is written atomically (INV-I3) | Integration test | outcome written with triggers_amendment=true but no corresponding amendment bead exists |
| W012 | `package.json` — `name` field | Package is named `@factory/bead-graph`; never `@koales/` in this monorepo | Static check: `grep '"name"' packages/bead-graph/package.json` must return `@factory/bead-graph` | Package name contains `@koales/` |
| W013 | `src/sdk.ts` and `src/bead-queries.ts` — zero @factory/* imports except bead-graph itself | @factory/ksp-sdk must not import from other @factory/* packages; bead-graph is the only @factory dep allowed | Static grep: `grep '@factory/' packages/bead-graph/src/sdk.ts` — only self-references acceptable | Import of `@factory/artifact-graph`, `@factory/schemas`, or other @factory packages |
| W014 | `src/migrate.ts` — `migrate()` | Uses `transactionSync` / `DurableObjectStorage.transactionSync` wrapper; splits multi-statement SQL on semicolons | tsc --noEmit + functional test during wrangler dev | Schema applied partially (some CREATE tables missing after cold start) |
| W015 | `src/bead-queries.ts` — `retrieveKnowingState()` | Returns empty state (null policy, empty trustedSubjects, null consent) on empty DB without throwing | Unit test (Test 3 in bead.test.ts) | Throws on empty DB; or returns non-null policy |

---

## KSP Core Invariants (Always Watch)

| Invariant | Files | Signal |
|-----------|-------|--------|
| Append-only storage | `src/bead-queries.ts`, `src/sdk.ts` | Any `UPDATE` or `DELETE` SQL; `BeadImmutabilityError` not thrown when expected |
| Bridge field propagation | `src/schemas.ts` (ExecutionBead, OutcomeBead, AmendmentBead) | `artifact_graph_execution_id`, `artifact_graph_divergence_id`, `artifact_graph_amendment_id` fields removed or renamed — these are loop closure connectors per SPEC-KSP-LOOP-CLOSURE-001 |
| @factory/ naming | `package.json` | Package name changes to `@koales/` scope |
| Content-addressed identity | `src/bead-id.ts` | `computeBeadId` algorithm changes (key sort order, hash algorithm, encoding) |
