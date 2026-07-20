# Regression Watch — @factory/ksp-sdk (Step 21)

> Phase: Writer · Step: 21 · Generated: 2026-06-10

## Watch Items

| ID | Source file + section | Expected rule after change | Check type | Violation signal |
|---|---|---|---|---|
| W001 | `packages/knowing-state-sdk/src/index.ts` line 1 | `export * from '@factory/bead-graph'` is the ONLY export statement; no other imports or exports may be added | grep + tsc | Any line containing `import` or `export` beyond the single `export * from '@factory/bead-graph'` line |
| W002 | `packages/knowing-state-sdk/package.json` `dependencies` section | `@factory/bead-graph` is the ONLY `@factory/*` dependency; no other `@factory/*` entries in `dependencies`, `devDependencies`, or `peerDependencies` | grep on package.json | `grep '"@factory/' packages/knowing-state-sdk/package.json \| grep -v bead-graph` returns any output |
| W003 | `packages/knowing-state-sdk/src/index.ts` | `tsc --noEmit` exits 0 on every build | tsc gate | `pnpm --filter @factory/ksp-sdk typecheck` exits non-zero |
| W004 | `packages/knowing-state-sdk/src/` (directory) | No source file imports from any `@factory/*` package other than `@factory/bead-graph` | grep | `grep -r '@factory/' packages/knowing-state-sdk/src/ \| grep -v '@factory/bead-graph'` returns any output |
| W005 | `packages/knowing-state-sdk/package.json` `name` field | Package name must be `@factory/ksp-sdk`, never `@factory/knowing-state-sdk` or `@koales/*` | grep | `jq '.name' packages/knowing-state-sdk/package.json` returns anything other than `"@factory/ksp-sdk"` |
| W006 | `packages/bead-graph/src/index.ts` (upstream) | All 8 Bead types (`PolicyBead`, `TrustBead`, `ExecutionBead`, `OutcomeBead`, `AmendmentBead`, `ConsentBead`, `EscalationBead`, `AuditBead`) must be exported; ksp-sdk re-exports this surface transitively | tsc + export check | `tsc --noEmit` on ksp-sdk fails with `Module ... has no exported member` for any of the 8 Bead types |
| W007 | SPEC-KSP-BEAD-GRAPH-001 §3 + INV-BG-002 | `computeBeadId()` is re-exported from bead-graph and accessible via ksp-sdk import | import check | `import { computeBeadId } from '@factory/ksp-sdk'` fails to compile |
| W008 | SPEC-KSP-BEAD-GRAPH-001 INV-BG-007 | `writeBead()` exported and enforces `auditBead` parameter requirement | import + runtime | `import { writeBead } from '@factory/ksp-sdk'` fails to compile OR `writeBead()` signature changes to make `auditBead` optional for non-audit types |
