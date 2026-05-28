# Current Workspace

## Status
Active continuation at 2026-05-28T03:18:45Z. Gas City roadmap cleanup is verification-green; latest slice adds Cloudflare-hosted Gas City autonomy monitoring through Phase 5 roadmap shape.

## Last update
2026-05-28T03:18:45Z

## Current focus
Gas City era structural cleanup and webhook lifecycle slice:
- Removed active NLAH/harness dispatch imports and made stale harness queue messages ack without dispatch.
- Converted active execution packet IDs from legacy `TEP-*` to canonical `EP-*`; `FORM-*` and `EP-*` are accepted by `ArtifactId`, `TEP-*` is not.
- Quarantined synthesis-era tests under `src/_attic/` and excluded `_attic` from active package test scripts.
- Synthesis-era diagnostic routes now return 410; Gas City webhook fidelity is the replacement path.
- Added Gas City fidelity verification report schema and tests, keyed by `VR-*`, `FN-*`, `IS-*`, `ES-*`, `EP-*`, and `FORM-*` lineage.
- Added `POST /webhooks/gascity` receiver with `v1` HMAC verification, duplicate/orphan/mismatch handling, completion/fidelity persistence, and amendment signal creation for revise outcomes.
- Added function lifecycle transition helper for dispatched-to-accepted/rejected state transitions and transition edge evidence.
- Removed the unreachable commented implementation body from the retired `/debug/lifecycle-acceptance` route so active `index.ts` no longer carries dead references to deleted synthesis lifecycle/fidelity modules.
- Updated workspace install state and lockfile so `workers/ff-arango` can resolve declared Cloudflare Worker types during recursive typecheck.
- Ignored generated local agent/Wrangler/run artifacts and removed generated ff-pipeline local state from the worktree.
- Updated ontology hard-cut audit for the Gas City era: Trellis packet schemas are quarantined under `_attic`, Gas City fidelity/lifecycle/webhook surfaces are now required audit anchors, and `_attic` is skipped for active-source forbidden-pattern scans.
- Added Arango schema helpers for edge collections and named indexes.
- Added Gas City collection provisioning for `completion_events`, `fidelity_verdicts`, `lifecycle_transitions` as an edge collection, and `webhook_rejections`, with the critical hash/skiplist indexes from the architecture reference.
- Wired Gas City collection provisioning into `POST /webhooks/gascity` before intake writes.
- Added `GAS_CITY_MAX_AMENDMENT_DEPTH` with default `3`.
- Gas City `revise` callbacks whose `factory_attempt` exceeds the configured amendment depth now write `INC-GC-AMENDMENT-DEPTH-*` to `specs_incidents`, return the incident id, and do not emit another amendment `SIG-*`.
- Made `GAS_CITY_MAX_AMENDMENT_DEPTH=3` explicit in the production Worker vars.
- Documented the Factory-side `GAS_CITY_HMAC_SECRET_V1` secret in the Worker config.
- Updated `scripts/ops/first-dispatch.sh` so the live bootstrap path provisions one generated HMAC secret to both Gas City (`GAS_CITY_HMAC_SECRET`) and Factory (`GAS_CITY_HMAC_SECRET_V1`), closing the release callback provisioning gap.
- Live Cloudflare audit showed `ff-pipeline` reachable at `/version` and currently serving Worker version `a52a7d1d-8a9a-4aa3-b0a1-e29688b4b30d` from `2026-05-25T23:03:22.546207Z`.
- Live Cloudflare secret audit showed `GAS_CITY_HMAC_SECRET_V1` is not yet set on `ff-pipeline`; production webhook callbacks remain blocked until the shared secret is installed.
- Production HMAC bridge secret was generated and installed on both `gascity-supervisor` (`GAS_CITY_HMAC_SECRET`) and `ff-pipeline` (`GAS_CITY_HMAC_SECRET_V1`).
- Full live bootstrap rotated matching Gas City/Factory bearer and HMAC secrets, rotated `OPERATOR_CONTROL_TOKEN`, redeployed `ff-pipeline`, seeded `EP-MPOWFZ17`, and dispatched `FORM-0E2B308B65D0ACE9` to Gas City.
- Gas City accepted live bead/workflow `gc-11`; monitor URL: `https://gascity-supervisor.koales.workers.dev/v0/city/factory/beads/gc-11`.
- Final production Worker version after live bootstrap: `28bb1d8d-1d16-42d8-88d9-bf93526ce32a` at `2026-05-28T02:53:27.044601Z`.
- Added Cloudflare cron/operator Gas City autonomy monitor:
  - `GET /gascity/autonomy/status` reports Function lifecycle counts, recent Persistence VRs, open Gas City incidents, and operational Pressures.
  - `POST /gascity/autonomy/run` runs the monitor under operator auth.
  - Scheduled cron now runs the Gas City monitor alongside the governance cycle.
- Dispatch now materializes/updates `specs_functions/FN-*` into `dispatched` state after successful Gas City dispatch so RELEASE callbacks have a lifecycle target.
- Function lifecycle now supports `accepted -> monitored`, `monitored -> regressed`, and `regressed -> monitored` transitions.
- Gas City webhook intake now handles `health.stall`, `session.crash`, `molecule.failed`, and `convergence.evaluate` events in addition to completion callbacks.
- Autonomy monitor emits Persistence Verification Reports, promotes accepted Functions to monitored only with fresh Fidelity/completion evidence, creates stale persistence/dispatch Incidents, and escalates recurring Gas City Incidents into `PRS-OPS-GC-*` operational Pressures.
- Production bootstrap script now exercises dispatch, signed RELEASE webhook intake, and Cloudflare autonomy monitor in one run.

## Verification this continuation
- `pnpm --filter @factory/schemas typecheck` passed.
- `pnpm --filter @factory/schemas test` passed: 54 tests.
- `pnpm --filter @factory/compiler typecheck` passed.
- `pnpm --filter @factory/compiler test` passed: 36 tests.
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- `pnpm --filter @factory/ff-pipeline test -- src/diagnostic-routes.test.ts src/gascity/function-lifecycle.test.ts src/gascity/webhook-receiver.test.ts` passed after dead-code cleanup: 52 passed, 10 skipped.
- `pnpm --filter @factory/ff-pipeline test` passed: 989 passed, 10 skipped.
- `pnpm -r typecheck` passed.
- `pnpm -r test` passed.
- `pnpm -r lint` passed (package lint scripts are mostly TODO placeholders).
- `pnpm -r build` passed.
- `pnpm audit:docs` passed.
- `pnpm audit:ontology` passed.
- `git diff --check` passed.
- `pnpm --filter @factory/arango-client test` passed: 2 tests.
- `pnpm --filter @factory/ff-pipeline test -- src/gascity/collection-schema.test.ts src/gascity/webhook-receiver.test.ts` passed: 7 tests.
- `pnpm --filter @factory/ff-pipeline test -- src/gascity/webhook-receiver.test.ts` passed: 6 tests.
- `pnpm --filter @factory/ff-pipeline test` passed: 992 passed, 10 skipped.
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- `bash -n scripts/ops/first-dispatch.sh` passed.
- `pnpm --filter @factory/ff-pipeline test -- src/gascity/webhook-receiver.test.ts src/dispatch-formula-route.test.ts` passed: 21 tests.
- `git diff --check` passed.
- Live `curl https://ff-pipeline.koales.workers.dev/version` returned HTTP 200 with Worker version `28bb1d8d-1d16-42d8-88d9-bf93526ce32a`.
- Live `curl https://ff-pipeline.koales.workers.dev/debug/health` returned HTTP 200 with `status=healthy`, `arango=true`, and `aiBinding=true`.
- Live invalid-signature POST to `/webhooks/gascity` returned HTTP 401 `invalid_signature`, proving the route is configured and fails closed.
- `bash scripts/ops/first-dispatch.sh` passed and dispatched live Gas City bead `gc-11`.
- `pnpm --filter @factory/ff-pipeline test -- src/gascity/autonomy-monitor.test.ts src/gascity/webhook-receiver.test.ts src/gascity/function-lifecycle.test.ts src/dispatch-formula-route.test.ts` passed: 29 tests.
- `pnpm --filter @factory/ff-pipeline test` passed: 997 passed, 10 skipped.
- `pnpm --filter @factory/ff-pipeline typecheck` passed.
- `pnpm -r typecheck` passed.
- `pnpm audit:ontology` passed.

## Recent actions (last 4h from AGENT_LEARNINGS.jsonl)

- [22:02:39] Bash: echo "=== merge-readiness-pack.ts import of synthesis-pr-draft ===" && sed -n '1,15p' workers/ff-pipeline/src/merge-read
- [22:02:40] Bash: echo "=== index.ts:2230-2245 (/seed-dispatch-ep route, TEP emitter) ===" && sed -n '2168,2185p;2230,2248p' workers/ff-pi
- [22:02:55] Bash: echo "=== compiler test (spec step 2) ===" && pnpm --filter @factory/compiler test 2>&1 | tail -30; echo "COMPILER_TEST_
- [22:03:06] Bash: echo "=== architect-agent.ts:72 — is this in scope? (git blame whether modified) ===" && git log --oneline -1 -- workers
- [22:03:07] Bash: cd /Users/wes/Developer/function-factory/workers/ff-pipeline && ls tsconfig.typecheck.json 2>/dev/null && echo "--- type
- [22:03:08] Bash: cd /Users/wes/Developer/function-factory/packages/compiler && grep -rn "TEP-\|TEP\b\|/\^TEP\|ArtifactId" src/*.ts 2>/dev
- [22:03:16] Bash: curl -s -X POST http://localhost:8888/notify -H "Content-Type: application/json" -d '{"message":"Review complete. Revise
- [22:03:21] Bash: echo "=== ArtifactId regex in schemas lineage.ts ==="; grep -n "ArtifactId\|TEP\|EP-\|regex\|RegExp\|/\^" packages/schem
- [22:03:37] Bash: echo "=== is 'EP' a valid ArtifactId prefix? ==="; grep -oE "\|EP\||EP\)|FORM\|EP|EP\|" packages/schemas/src/lineage.ts;
- [22:03:38] Bash: echo "=== HARNESS_QUEUE / harness-queue across ALL configs ==="; grep -rn "HARNESS_QUEUE\|harness-queue\|harness-dlq" --
- [22:03:47] Bash: cd /Users/wes/Developer/function-factory/workers/ff-pipeline && echo "=== /trigger-harness route (NLAH harness entry) ==
- [22:03:49] Bash: echo "=== Gas City arch spec: harness/RunCoordinator/dispatch model ==="; grep -n "RunCoordinator\|harness-queue\|HARNES
- [22:03:57] Bash: echo "=== full DELETE list section of Gas City spec ==="; sed -n '260,310p' specs/reference/GAS-CITY-ERA-ARCHITECTURE.md
- [22:04:00] Bash: cd /Users/wes/Developer/function-factory/workers/ff-pipeline && echo "=== dispatch-formula handler: does it use RunCoord
- [22:04:05] Bash: cd /Users/wes/Developer/function-factory/workers/ff-pipeline && echo "=== handleDispatchFormula (2145-2225) ==="; sed -n
- [22:04:22] Agent: Architect review — revised Gas City cleanup spec
- [22:04:33] Bash: echo "=== schemas build ==="; (cd packages/schemas && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | head -2
- [22:04:34] Bash: echo "=== git: when was RunCoordinator/PiContainer migration added? still referenced by Gas City? ==="; git log --onelin
- [22:04:43] Bash: curl -s -X POST http://localhost:8888/notify -H "Content-Type: application/json" -d '{"message":"Risk review complete. T
- [22:05:50] Agent: SE review — revised Gas City cleanup spec v2

## Notes
This file is auto-updated on session end. Manual edits will be overwritten.
Archive to `.agent/memory/episodic/snapshots/` if you need to preserve a specific state.
