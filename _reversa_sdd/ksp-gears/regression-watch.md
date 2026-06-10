# Regression Watch — @factory/gears (Steps 34–44)

> Phase: ksp-gears | Generated: 2026-06-10

---

## Watch Items

| ID | Source file + section | Expected rule after change | Check type | Violation signal |
|---|---|---|---|---|
| W001 | `packages/schemas/src/atom-directive.ts` — `AtomDirective.role` | `role` must be one of `['planner','coder','critic','tester','verifier']` — lowercase, no heuristic derivation | schema validation at parse time | `z.ZodError` on `role` field; or `deriveRole()` function found anywhere in codebase |
| W002 | `packages/schemas/src/atom-directive.ts` — `AtomDirective.skillRef` | `skillRef` is non-empty string, always populated by Mediation Agent from `Gear.skillRef` | schema validation | `skillRef` absent or empty in dispatched AtomDirective |
| W003 | `packages/gears/src/flue/agents.ts` — `PROFILE_BY_ROLE` | `PROFILE_BY_ROLE[directive.role]` must resolve for all 5 roles; no `deriveRole()` call anywhere in codebase | tsc + grep | `tsc` error on `PROFILE_BY_ROLE` indexing; grep finds `deriveRole` in any `.ts` file |
| W004 | `packages/gears/src/beads/coordinator-do.ts` — `initRun()` ordering | `initRun()` must be called before any `releaseBead()`, `failBead()`, or `getNextReady()` call that produces output | runtime guard + test | `writeAudit()` producing D1 insert with `runId=''`; `recordOutcome()` writing to loop-closure with empty `orgId` |
| W005 | `packages/gears/src/beads/coordinator-do.ts` — `writeAudit()` | D1 `bead_audit` INSERT must execute on every `releaseBead()` and `failBead()` call where `runId && orgId` are set | integration test | Missing rows in `bead_audit` after release/fail; `D1_AUDIT.prepare().bind().run()` never called |
| W006 | `packages/gears/src/beads/coordinator-do.ts` — `recordOutcome()` | `LoopClosureService.recordOutcome()` must be called on every `releaseBead()`/`failBead()` after Step 41; Bridge Point 3 | integration test | `BuildOutcomeBead` not written to Bead Graph after release; `ExecutionTrace` node absent from Artifact Graph |
| W007 | `packages/gears/src/beads/types.ts` — `ExecutionBead` schema | Field names must exactly match `execution_beads` SQLite column names: `id, molecule_id, gear_id, node_id, status, assigned_to, attempt_count, payload, result, created_at, updated_at` | schema + SQL diff | Zod parse failure on SQL RETURNING rows; column rename without schema update |
| W008 | `packages/gears/src/flue/sandbox.ts` — `Sandbox.outboundByHost` | All four host injectors must be present: `api.anthropic.com`, `api.openai.com`, `api.deepseek.com`, `api.github.com` | tsc + review | Missing host entry; handler returns `Request` instead of `Response` |
| W009 | `packages/gears/src/gears/types.ts` — `Gear.id` | All Gear IDs must start with `GEAR-` prefix | Zod regex validation | `Gear.parse()` succeeds with non-GEAR- prefixed id |
| W010 | `packages/gears/src/beads/coordinator-do.ts` — append-only bead state | Bead state transitions: `ready → in_progress → done|failed`. No reverse transitions. No DELETE from `execution_beads`. | code review + audit log | `DELETE FROM execution_beads` found in any CoordinatorDO method; status set to `ready` for a bead that already reached `done` |
| W011 | `packages/schemas/src/gear-types.ts` — `@factory/` naming | All imports in `@factory/gears` must use `@factory/` prefix. No `@koales/` imports. | grep | `import.*from '@koales/'` found in any file under `packages/gears/` |
| W012 | `packages/gears/package.json` — workspace dependencies | `@factory/loop-closure`, `@factory/factory-graph`, `@factory/schemas` must remain as `workspace:*` dependencies | pnpm audit | `@factory/*` dependencies reference a published version instead of `workspace:*` |
| W013 | `packages/gears/src/beads/coordinator-do.ts` — Bridge Point 3 | `LoopClosureService` import must be from `@factory/loop-closure` — never `@koales/loop-closure` | grep + tsc | `import.*from '@koales/loop-closure'` found anywhere |
| W014 | `packages/schemas/src/atom-directive.ts` — no `deriveRole()` | The `deriveRole()` function must NOT exist in any file in the repository | grep | `function deriveRole\|const deriveRole\|deriveRole(` found in any `.ts` file |
