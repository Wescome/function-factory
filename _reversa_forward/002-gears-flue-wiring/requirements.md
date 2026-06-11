# Requirements — 002-gears-flue-wiring

> Source: Architect review 2026-06-11 + SE analysis
> Decision: wrangler deploy --config workers/ff-pipeline/wrangler.jsonc deploys everything — no external build tool

## Objective

Wire `FlueAtomExecutionWorkflow` and `FlueRegistry` into `@factory/gears` so that:
- `wrangler deploy --config workers/ff-pipeline/wrangler.jsonc` is the complete deployment
- Model calls route through ofox.ai (non-CF) and CF Workers AI binding (CF models)
- WeOps gateway placeholder is removed
- `atom-execution.ts run()` lives in `@factory/gears` per SPEC-FF-GEARS-001 §1/§3

## Requirements

- R01: `FlueAtomExecutionWorkflow` exported from `@factory/gears` — same pattern as `CoordinatorDO`
- R02: `FlueRegistry` exported from `@factory/gears` via `@flue/runtime/cloudflare`
- R03: `atom-execution.ts run()` moves into `packages/gears/src/flue/workflows/`
- R04: `FlueAtomExecutionWorkflow` hand-authored in gears using `@flue/runtime/internal` — no build tool
- R05: `configureProvider` routes `anthropic` and `openai` through ofox.ai inside `run()` — before `init(agent)`
- R05b: `coderProfile` uses `cloudflare/kimi-k2.6`; `configureProvider('cloudflare', ...)` overrides CF binding with REST API + `CF_API_TOKEN` — same pattern as `workers/ff-pipeline/src/providers.ts` lines 18-44 (env.AI.run() returns empty for kimi)
- R06: CF Workers AI inherited from isolate-boot registration — no duplicate `registerProvider` needed
- R07: WeOps gateway `configureProvider` block deleted from `.flue/app.ts` — it clobbers ofox config
- R08: `workers/ff-pipeline/src/index.ts` re-exports `FlueAtomExecutionWorkflow`, `FlueRegistry` from gears
- R09: `workers/ff-pipeline/src/index.ts` fetch handler routes `/workflows/atom-execution` via `routeAtomExecutionWorkflow`
- R10: `workers/ff-pipeline/wrangler.jsonc` v7 migration + DO bindings + OFOX_API_KEY secret declared
- R11: Dead code `packages/gears/src/flue/runtime-stub.js` deleted
- R12: `pnpm --filter @factory/gears typecheck` and `pnpm --filter @factory/ff-pipeline typecheck` pass after every step

## Out of scope

- Full WeOps gateway implementation
- OpenRouter provider wiring (available in gdk-ai but not active pipeline)
- `.flue/` local dev path — kept as-is for human dev iteration
