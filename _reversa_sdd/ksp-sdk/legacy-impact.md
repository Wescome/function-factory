# Legacy Impact — @factory/ksp-sdk (Step 21)

> Phase: Writer · Step: 21 · Generated: 2026-06-10

## Impact Table

| File affected | Component | Impact type | Severity |
|---|---|---|---|
| `packages/knowing-state-sdk/package.json` | @factory/ksp-sdk (new package) | componente-novo | low |
| `packages/knowing-state-sdk/tsconfig.json` | @factory/ksp-sdk build config | componente-novo | low |
| `packages/knowing-state-sdk/src/index.ts` | @factory/ksp-sdk public API surface | componente-novo | low |

## Impact Descriptions

### `package.json` — componente-novo
New pnpm workspace package `@factory/ksp-sdk` at `packages/knowing-state-sdk/`. Declares a single runtime dependency on `@factory/bead-graph` (workspace). No other monorepo packages are imported. No existing package is affected by this addition — it is an additive change only.

### `tsconfig.json` — componente-novo
Package-local TypeScript configuration extending `../../tsconfig.base.json`. Includes `@cloudflare/workers-types` and `@types/node` to resolve Cloudflare-specific globals re-exported transitively from `@factory/bead-graph`. No root-level tsconfig changes were required; pnpm-workspace.yaml glob `packages/*` already covers this package.

### `src/index.ts` — componente-novo
Single-line re-export: `export * from '@factory/bead-graph'`. This is the complete public API surface. No domain-specific types, no additional imports. Consumers of `@factory/ksp-sdk` receive the full bead-graph surface with no additional coupling.

---

## Preserved Rules (cross-reference against domain.md)

The following business rules from domain.md were explicitly preserved and enforced during this step:

| Rule | Source | Status |
|---|---|---|
| BR-KSP-15: @factory/ksp-sdk Zero Factory Import Rule | domain.md §KSP | PRESERVED — `src/index.ts` contains zero `@factory/*` imports other than `@factory/bead-graph`. Verified by grep (exit code 1 = no matches). |
| BR-KSP-01: I1 Externalization | domain.md §KSP | PRESERVED — package is a thin re-export layer; no knowing-state content is held in the SDK itself. |
| BR-KSP-05: Append-Only Both Layers | domain.md §KSP | PRESERVED — no write operations added to this package; it only re-exports the bead-graph surface which enforces INV-BG-001. |
| BR-KSP-06: Content-Addressed Bead Identity | domain.md §KSP | PRESERVED — `computeBeadId()` is re-exported from bead-graph unchanged. |
| BR-KSP-07: AuditBead in Every Bead Write Transaction | domain.md §KSP | PRESERVED — `writeBead()` enforcement lives in bead-graph and is re-exported unchanged. |
