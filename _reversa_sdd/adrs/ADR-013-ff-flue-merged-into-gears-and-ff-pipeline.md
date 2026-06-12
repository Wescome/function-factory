# ADR-013: ff-flue Worker Merged into @factory/gears and ff-pipeline

**Date**: 2026-06-10
**Status**: Accepted
**Confidence**: 🟢 CONFIRMADO

## Context

The `ff-flue` worker was a separate Cloudflare Worker that hosted the `FlueAtomExecutionWorkflow` Durable Object and its `FlueRegistry`. It was introduced to isolate the Flue workflow runtime from the main `ff-pipeline` worker.

However, three problems emerged:
1. The separate `ff-flue` worker created a competing DO artifact (`.flue/.flue-vite/_entry.ts`) that intercepted secret propagation, causing `FlueAtomExecutionWorkflow` to receive an empty env (no API keys, no bindings).
2. Maintaining two workers for what is architecturally one execution substrate added operational overhead (two `wrangler deploy` targets, two wrangler.jsonc files, two wrangler.toml files).
3. Three Flue workflow classes in `ff-flue` were fabricated with no backing spec (commit 45db2ea confirms deletion).

## Decision

Merge the Flue workflow substrate into `@factory/gears` (the existing execution substrate package) and re-export the DO binding classes from `ff-pipeline/index.ts`. Specifically:

- `FlueAtomExecutionWorkflow` DO class → `packages/gears/src/flue/workflows/atom-execution-do.ts`
- Flue workflow `run()` logic → `packages/gears/src/flue/workflows/atom-execution.ts`
- `FlueRegistry` → exported from `@factory/gears` barrel
- `ff-pipeline/index.ts` re-exports both for wrangler DO binding registration
- `ff-flue` worker deleted entirely

## Consequences

**Positive:**
- Single `wrangler deploy` target for the entire execution pipeline
- Secrets and bindings flow correctly — no competing DO artifact intercepts the env
- `@factory/gears` is now the complete execution substrate (as per SPEC-FF-GEARS-001 §1/§3)
- Only one specced workflow (`atom-execution`) exists — no fabricated classes

**Negative / Constraints:**
- `ff-pipeline/index.ts` barrel now re-exports CF-runtime classes from `@factory/gears`, which pulls `@flue/runtime/cloudflare` (.mjs) into Node.js test environments via the barrel import chain
- **Mitigation**: queue and route handlers extracted into clean modules (`queue-handler.ts`, `trigger-synthesis-handler.ts`) with type-only static imports; `vitest.config.ts` uses `alias` to `__mocks__` stubs (ADR inline, commit 919364e)

## References

- Commit `92e3708` — merge ff-flue worker into ff-pipeline
- Commit `b8f8ac2` — wire FlueAtomExecutionWorkflow into @factory/gears
- Commit `46b4868` — Flue atom-execution e2e passing
- Commit `919364e` — handler extraction fix for test isolation
- SPEC-FF-GEARS-001 §1/§3
