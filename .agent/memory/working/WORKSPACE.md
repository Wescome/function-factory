# Current Workspace

## Status
Active continuation at 2026-06-03T00:10:00Z.

Continuation from confirmed Gate B fixes:
- Phantom completion and fidelity raw `exit=1` were confirmed fixed in production.
- Remaining Code failure was a real provider failure, but investigation found missing task context in the pi-rpc request path.
- Gas City now fills AC-RQ1 `Purpose` from the full formula step description instead of just the bead title, and pi-rpc passes `Purpose` through as ff-pipeline `context.taskText` (`gascity` commit `8636f4af`).
- ff-pipeline direct AC-RQ1 normalizer now preserves `purpose` as `context.taskText`.
- SeedWorkspace setup now initializes `./workspace` as a clean git repo so `git diff > ../CandidatePatch` works.
- Pi prompt and repair prompt now explicitly require patch artifacts like `./CandidatePatch` at the root, not only edits inside `./workspace`.

Validation passed:
- `go test ./internal/harness/pirpc ./cmd/gc -run 'TestExecuteStep_TranslatesRequestToWorkerInput|TestHarnessExecutionRequestPurposeUsesStepDescription' -count=1`
- `go test ./internal/harness/pirpc ./cmd/gc -run 'TestExecuteStep|TestHarnessExecutionRequest|TestFidelity' -count=1`
- `pnpm --filter @factory/ff-pipeline exec vitest run pi-container/execution-policy.test.mjs pi-container/execution-contract.test.mjs pi-container/workspace-seed.test.mjs pi-container/contract-evaluator.test.mjs src/gascity/pi-container-execute.test.ts src/gascity/pi-container-execute-route.test.ts --no-file-parallelism`
- `pnpm --filter @factory/ff-pipeline run typecheck`
- `npm run typecheck` in `workers/gascity-supervisor`
- Tessera `detect-changes --repo function-factory`: low scope for current prompt/seed/normalizer changes.

Committed:
- Gas City: `8636f4af fix(harness): pass step purpose into pi-rpc`

Deployment prep:
- Rebuilt `workers/gascity-supervisor/gc-linux-amd64` from Gas City commit `8636f4af`.
- Rotated supervisor singleton marker to `singleton-v41`.

Deployed:
- `ff-pipeline` Worker version `54a9d96a-03c2-44d7-9788-4da8cff2e072`; sandbox image digest `sha256:37f6be01fe50604ce7ff31d2ff89a8fd820bb8cdf8cc94bf6925ace2c302a406`; Pi container image digest `sha256:c7018c75fe03164493aa6f2be9db9461858f5139d8fb18b22f7c8f9302393e63`.
- `gascity-supervisor` Worker version `df9dbcda-20a7-409d-aa7f-769b29a381e7`; container image digest `sha256:73d63c4ea33e4e0512f0464b75e816df141398337b90d40acb19048ebe01a681`; singleton marker `singleton-v41`.

Not completed:
- Full `go test ./internal/harness/pirpc ./cmd/gc -count=1` parked after pi-rpc package passed and was terminated.
- No authenticated live attempt was run; tokens are still not exported in this shell and no secret files were read.

## Last update
2026-06-03T00:25:00Z

## Notes
This file is auto-updated on session end. Manual edits will be overwritten.
Archive to `.agent/memory/episodic/snapshots/` if you need to preserve a specific state.
