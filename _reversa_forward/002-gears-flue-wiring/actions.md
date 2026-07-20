# actions.md — 002-gears-flue-wiring

> Feature: 002-gears-flue-wiring
> Source: _reversa_sdd/ksp-gears/design.md, _reversa_sdd/ksp-flue-workflow/design.md
> Architect review: 2026-06-11
> Gate type key: TYPECHECK = pnpm typecheck, WRANGLER = wrangler deploy --dry-run

---

## Phase 1 — Preparation

| ID | Action | File(s) | Dep | Parallel | Status |
|----|------|-----------|-----|-----|--------|
| T001 | Delete dead no-op stub `runtime-stub.js` — if alias is ever wired it silently kills model routing | `packages/gears/src/flue/runtime-stub.js` | — | — | [X] |
| T001b | Update coder profile in `packages/gears/src/flue/agents.ts`: change `coderProfile` model from `anthropic/claude-opus-4-6` to `cloudflare/kimi-k2.6`. Add `CF_API_TOKEN: string` to the comment noting kimi requires REST API (env.AI.run() returns empty for kimi — use CF REST path via configureProvider override in run()). | `packages/gears/src/flue/agents.ts` | — | T001 | [X] |

---

## Phase 2 — Core (gears)

| ID | Action | File(s) | Dep | Parallel | Status |
|----|------|-----------|-----|-----|--------|
| T002 | [X] Move `atom-execution.ts run()` into gears: copy `.flue/workflows/atom-execution.ts` to `packages/gears/src/flue/workflows/atom-execution.ts`. Update internal imports: `@factory/gears/flue` → `../agents.js`, `@factory/gears/beads` → `../../beads/hook.js` and `../../beads/types.js`. Keep `@factory/schemas`, `@flue/runtime`, `@cloudflare/sandbox`, `node:crypto` as-is. Add `configureProvider` import from `@flue/runtime`. Add `OFOX_API_KEY: string`, `CF_API_TOKEN: string`, and `AI: unknown` to local `Env` interface. Provider config block at top of `run()` before DO init: (1) ofox for anthropic+openai as before; (2) cloudflare provider override for kimi using CF REST API — same pattern as `workers/ff-pipeline/src/providers.ts` lines 18-44: `configureProvider('cloudflare', { baseUrl: 'https://api.cloudflare.com/client/v4/accounts/cb56a846c70a38987f31cf6e2b85cb57/ai/run/', apiKey: env.CF_API_TOKEN, headers: { Authorization: 'Bearer ' + env.CF_API_TOKEN } })`. | `packages/gears/src/flue/workflows/atom-execution.ts` (new) | — | — | [ ] |
| T003 | Gate: `pnpm --filter @factory/gears typecheck` passes after T002 | TYPECHECK | T002 | — | [X] |
| T004 | [X] Create `packages/gears/src/flue/workflows/atom-execution-do.ts` — hand-authored `FlueAtomExecutionWorkflow` class using `@flue/runtime/internal` functions (`handleWorkflowRequest`, `handleRunRouteRequest`, `handleStreamRead`, `handleStreamHead`, `failRecoveredRun`, `createFlueContext`, `createSqlSessionStore`, `createDurableRunStore`, `InMemorySessionStore`, `InMemoryRunStore`, `SqliteEventStreamStore`, `resolveModel`, `Bash`, `InMemoryFs`, `bashFactoryToSessionEnv`, `CLOUDFLARE_WORKFLOW_INTERNAL_METADATA_PATH`) and `@flue/runtime/cloudflare` (`runWithCloudflareContext`, `cfSandboxToSessionEnv`, `createCloudflareRunRegistry`). Also export `routeAtomExecutionWorkflow` helper. Use the exact pattern from `_entry.ts` lines 324–498 narrowed to one workflow. `virtual:flue/packaged-skills` → literal `{}`. | `packages/gears/src/flue/workflows/atom-execution-do.ts` (new) | T003 | — | [ ] |
| T005 | Gate: `pnpm --filter @factory/gears typecheck` passes after T004 | TYPECHECK | T004 | — | [X] |
| T006 | [X] Update `packages/gears/src/flue/index.ts` — add re-exports: `export * from './workflows/atom-execution-do.js'` and `export { FlueRegistry } from '@flue/runtime/cloudflare'` | `packages/gears/src/flue/index.ts` | T005 | — | [ ] |
| T007 | [X] Update `packages/gears/src/index.ts` barrel — surface `FlueAtomExecutionWorkflow`, `FlueRegistry`, `routeAtomExecutionWorkflow` | `packages/gears/src/index.ts` | T006 | — | [ ] |
| T008 | Gate: `pnpm --filter @factory/gears typecheck` passes after T007 | TYPECHECK | T007 | — | [X] |

---

## Phase 3 — Integration (ff-pipeline)

| ID | Action | File(s) | Dep | Parallel | Status |
|----|------|-----------|-----|-----|--------|
| T009 | Add `FLUE_ATOM_EXECUTION_WORKFLOW: DurableObjectNamespace` and `FLUE_REGISTRY: DurableObjectNamespace` and `OFOX_API_KEY: string` to `PipelineEnv` in `workers/ff-pipeline/src/types.ts` | `workers/ff-pipeline/src/types.ts` | T008 | — | [ ] |
| T010 | Update `workers/ff-pipeline/src/index.ts` — add exports after existing KSP block: `export { FlueAtomExecutionWorkflow, FlueRegistry } from '@factory/gears'`. Add routing at TOP of fetch handler (before `/version` check): import `routeAtomExecutionWorkflow` from `@factory/gears`, if `env.FLUE_ATOM_EXECUTION_WORKFLOW` call it and return if non-null. | `workers/ff-pipeline/src/index.ts` | T009 | — | [ ] |
| T011 | Gate: `pnpm --filter @factory/ff-pipeline typecheck` passes after T010 | TYPECHECK | T010 | — | [ ] |
| T012 | Update `workers/ff-pipeline/wrangler.jsonc` — add to `durable_objects.bindings`: `FLUE_ATOM_EXECUTION_WORKFLOW` + `FLUE_REGISTRY`. Add v7 migration: `new_sqlite_classes: ["FlueAtomExecutionWorkflow", "FlueRegistry"]`. Add `OFOX_API_KEY` and `CF_API_TOKEN` to secrets comment block (CF_API_TOKEN already exists in wrangler — verify, do not duplicate). | `workers/ff-pipeline/wrangler.jsonc` | T011 | — | [ ] |

---

## Phase 4 — Polish

| ID | Action | File(s) | Dep | Parallel | Status |
|----|------|-----------|-----|-----|--------|
| T013 | Delete WeOps gateway block from `.flue/app.ts` — remove `configureProvider('anthropic', ...)`, `WEOPS_GATEWAY_URL`, `WEOPS_SIGNING_KEY` from Env interface. Gateway is unimplemented; ofox is now authoritative inside `run()`. Keep `flue().fetch()` routing. | `.flue/app.ts` | T012 | — | [ ] |
| T014 | Update `.flue/workflows/atom-execution.ts` (original) — replace with thin shim re-exporting `run`, `route`, `extractWorkspaceDelta` from `@factory/gears/flue/workflows/atom-execution.js`. Keeps `.flue/` local dev path working. | `.flue/workflows/atom-execution.ts` | T013 | — | [ ] |
| T015 | Gate: full repo typecheck `pnpm -r typecheck` — zero errors | TYPECHECK | T014 | — | [ ] |
| T016 | Gate: `wrangler deploy --config workers/ff-pipeline/wrangler.jsonc --dry-run` — exits 0, `FlueAtomExecutionWorkflow` and `FlueRegistry` listed as registered DO classes, no "Unbound class" errors | WRANGLER | T015 | — | [ ] |
