# Current Workspace

## Status
Active continuation at 2026-06-03T00:40:00Z.

Latest root cause:
- Live Code bead showed `Expected outputs: []`.
- `harnesses/gascity-templates/factory-coding-v1.toml` uses `{{coder_outputs}}`; the template was not the broken part.
- The formula compiler passed sparse or legacy EP role outputs directly into `factory-coding-v1` vars, so Code could be dispatched without a declared artifact contract.

Fix in progress:
- `workers/ff-pipeline/src/compilers/formula-compiler.ts` now canonicalizes `factory-coding-v1` role outputs:
  - `coder_outputs` => `["CandidatePatch"]` when EP outputs are empty or generic aliases such as `["diff"]`.
  - `verifier_outputs` => `["VerifierReport"]` when EP outputs are empty or generic aliases such as `["verdict"]`.
- Regression added in `workers/ff-pipeline/src/compilers/formula-compiler.test.ts`.

Validation:
- Passed: `pnpm --filter @factory/ff-pipeline exec vitest run src/compilers/formula-compiler.test.ts -t 'AC-3' --no-file-parallelism`
- Passed: `pnpm --filter @factory/ff-pipeline run typecheck`
- Tessera `detect-changes --repo function-factory`: medium scope in expected `compileAndDispatchFormula` flows, no HIGH/CRITICAL.
- Full `src/compilers/formula-compiler.test.ts` still has three unrelated/stale failures around extra `POST start` and a 409 expectation.

Not completed:
- Function Factory commit/deploy for this latest `coder_outputs` fix not completed yet.
- No authenticated live attempt was run in this turn.

## Last update
2026-06-03T00:40:00Z

## Notes
This file is auto-updated on session end. Manual edits will be overwritten.
Archive to `.agent/memory/episodic/snapshots/` if you need to preserve a specific state.
