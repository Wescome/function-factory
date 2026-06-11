/**
 * atom-execution.ts — shim for local Flue dev (.flue/ path).
 *
 * The authoritative implementation lives in @factory/gears.
 * This shim keeps `flue dev --root .flue` working for local iteration.
 * Production deployment uses wrangler deploy --config workers/ff-pipeline/wrangler.jsonc
 * which pulls FlueAtomExecutionWorkflow directly from @factory/gears.
 *
 * SPEC-FF-JUSTBASH-004
 */

export { run, route, extractWorkspaceDelta } from '@factory/gears'
