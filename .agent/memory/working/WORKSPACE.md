# Current Workspace

## Status
Gas City dispatch/pi-rpc recovery handoff written at 2026-06-02T02:35:54Z.

## Last update
2026-06-02T02:35:54Z

## Current focus
- CareTrace dispatch `EP-MPVY9M6H` is live enough to execute Plan, Code, Verify, and Finalize through the `control-dispatcher` and pi-rpc path.
- Current live root beads: dispatch `do-4041`, workflow `do-4042`, trace `5d0de67b-76b5-46ff-8b5c-275a965b6ced`.
- Deployed Function Factory worker version `d7582377-a523-41f5-abcc-f789004ca1af`, image `d7582377`, singleton `singleton-v38`.
- Queue at handoff: `running=1`, `work.in_progress=0`, `work.ready=0`, `work.open=1`.

## Completed fixes
- `workflowServeQueue` now recovers `in_progress` runtime work already assigned to `control-dispatcher`.
- Factory Store Durable Object contract now handles PascalCase `UpdateOpts`, null-as-absent fields, metadata merges, labels, CloseAll metadata/count, query filters, limits, and `includeClosed`.
- Gas City `openControlStoreAtForCity` preserves DO-backed stores instead of forcing bd-backed control-store access.
- Headless control-dispatcher env guard was emergency-unblocked; follow-up should tighten this to only the `control-dispatcher` headless path.
- Formula template and supervisor binary were rebuilt and redeployed.

## Validation
- `go test ./cmd/gc -run 'TestOpenControlStoreAtForCityPreservesFileAndExecProviderStores|TestRunWorkflowServeFollowAllowsHeadlessControlDispatcher|TestWorkflowServeQueueIncludesInProgressControlDispatcherRuntimeWork' -count=1` passed.
- `npm run typecheck` passed.
- Live DO contract repro passed after deployment.
- Attempt 5 results: Plan `do-4043` pass, Code `do-4044` pass, Verify `do-4045` pass, Release `do-4046` fail-closed on `fidelity-release.sh exit=1`, Finalize `do-4047` pass.

## Handoff
- Primary handoff document: `specs/reference/CODEX-HANDOFF-GC-DISPATCH-PI-RPC-2026-06-02.md`.
- Remaining work: tighten the headless dispatcher guard, investigate Release fidelity failure, restore ff-pipeline run-monitor snapshots if required, and optionally close/clean older failed attempts.

## Dirty-state warning
- Function Factory and Gas City both had pre-existing unrelated dirty files before the final handoff. Do not treat every dirty file as part of this recovery without checking `git diff`.

## Notes
This file is auto-updated on session end. Manual edits may be overwritten.
