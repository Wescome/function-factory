# Tasks — @factory/ksp-sdk

> Reversa SDD · Phase: Writer · Generated: 2026-06-10
> Module: `packages/knowing-state-sdk/` → published as `@factory/ksp-sdk`
> Source: CLAUDE.md Step 21 (Phase 3); SPEC-KSP-ARCH-001 §3; domain.md BR-KSP-15

---

## Prerequisite Gate

**This module is Phase 3.** Do not begin any task below until Phase 2 (`@factory/bead-graph`) compiles clean:

```
tsc --noEmit   # run from packages/bead-graph/
# Required: zero errors before proceeding
```

If `@factory/bead-graph` is not yet clean, stop. `@factory/ksp-sdk` has nothing to implement until its sole dependency exists.

---

## T-01: Scaffold package.json and tsconfig.json

**File:** `packages/knowing-state-sdk/package.json`
**File:** `packages/knowing-state-sdk/tsconfig.json`

**What to implement:**

`package.json`:
- `name`: `@factory/ksp-sdk`
- `version`: `0.1.0`
- `private`: `true`
- `main` and `types`: both point to `src/index.ts`
- `dependencies`: exactly one entry — `"@factory/bead-graph": "workspace:*"`
- No other `@factory/*` entries permitted in any field

`tsconfig.json`:
- `extends`: root tsconfig (`../../tsconfig.json`)
- `compilerOptions.outDir`: `dist`
- `compilerOptions.rootDir`: `src`
- `references`: `[{ "path": "../bead-graph" }]`
- `include`: `["src"]`

**Gate:** `pnpm install` completes without error. `@factory/bead-graph` resolves.

**Done criterion:** workspace dependency resolves; no missing module errors on install.

**Confidence:** 🟢 SPEC-KSP-BEAD-GRAPH-001 §12 + CLAUDE.md Phase 3 scaffold instructions.

---

## T-02: Write src/index.ts — re-export from @factory/bead-graph

**File:** `packages/knowing-state-sdk/src/index.ts`

**What to implement:**

```typescript
export * from '@factory/bead-graph';
```

That is the complete file. Do not add any additional imports, re-exports from other packages, type aliases, utility functions, or comments beyond what is shown. This is the complete specification for this file.

**Constraint (BR-KSP-15):** The file MUST contain zero imports from any `@factory/*` package other than `@factory/bead-graph`. Specifically: no imports from `@factory/schemas`, `@factory/compiler`, `@factory/verification`, `@factory/db-client`, `@factory/gears`, `@factory/factory-graph`, or any other monorepo package.

**Gate:** `tsc --noEmit` — zero errors required.

**Verification step (explicit):** After the gate passes, grep the compiled output or source for any `@factory/` string other than `@factory/bead-graph`. If any match is found, the constraint is violated and must be corrected before proceeding.

```bash
grep -r '@factory/' packages/knowing-state-sdk/src/ | grep -v '@factory/bead-graph'
# Expected output: empty (no matches)
```

**Done criterion:** `tsc --noEmit` exits with code 0 AND the grep above produces no output.

**Confidence:** 🟢 CLAUDE.md Step 21 exact specification. SPEC-KSP-BEAD-GRAPH-001 §12 confirms the re-export shape.

---

## T-03: Register package in monorepo workspace

**File:** root `pnpm-workspace.yaml` (or equivalent workspace config)
**File:** root `tsconfig.json` `references` array

**What to implement:**

Ensure `packages/knowing-state-sdk` is included in:
1. The pnpm workspace `packages` glob (if not already covered by `packages/*`)
2. The root `tsconfig.json` composite references array (add `{ "path": "packages/knowing-state-sdk" }` if not present)

**Gate:** `pnpm install` from the repo root resolves `@factory/ksp-sdk` as a workspace package.

**Done criterion:** A package in Phase 3+ can add `"@factory/ksp-sdk": "workspace:*"` to its dependencies and `pnpm install` resolves it without error.

**Confidence:** 🟢 Standard monorepo workspace registration pattern. Inferred from repository structure.

---

## Summary

| Task | File | Gate | Confidence |
|------|------|------|------------|
| T-01 | `package.json` + `tsconfig.json` scaffold | `pnpm install` | 🟢 |
| T-02 | `src/index.ts` — `export * from '@factory/bead-graph'` | `tsc --noEmit` (zero errors) + grep zero `@factory/*` violations | 🟢 |
| T-03 | Workspace registration in root config | `pnpm install` resolves `@factory/ksp-sdk` | 🟢 |

**Total files to create:** 3 (`package.json`, `tsconfig.json`, `src/index.ts`)
**Total lines of logic:** 1 (the `export *` statement)
**Estimated implementation time:** < 15 minutes

---

## Phase Unblock

After T-02 gate passes, Phase 3 (`@factory/loop-closure`) is unblocked. The loop-closure package can now import `@factory/ksp-sdk` for its KnowingState type dependencies.

Do not proceed to Phase 4 (`packages/factory-graph`) or any later phase until the Phase 3 tests (`packages/loop-closure/tests/loop.test.ts`) pass. That is a hard gate from SPEC-KSP-ARCH-001 and domain.md BR-KSP-14.
