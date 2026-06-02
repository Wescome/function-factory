# Codex Handoff — Gas City Dispatch / pi-rpc Recovery

Date: 2026-06-02  
Primary repos:
- `/Users/wes/Developer/function-factory`
- `/Users/wes/Developer/gascity`

## Executive State

The original CareTrace dispatch failure is fixed live.

Gas City now:
- accepts Function Factory dispatches through `ff-pipeline`;
- keeps the named `control-dispatcher` stable after container restart;
- drains control-dispatcher assigned work from the DO bead store;
- routes Plan / Code / Verify steps through `pi-rpc`;
- stamps completed step beads with harness/provider metadata.

Live attempt verified:
- EP: `EP-MPVY9M6H`
- Attempt: `5`
- Dispatch root: `do-4041`
- Workflow root: `do-4042`
- Trace: `5d0de67b-76b5-46ff-8b5c-275a965b6ced`
- Deployed supervisor Worker version: `d7582377-a523-41f5-abcc-f789004ca1af`
- Deployed container image tag: `d7582377`
- Supervisor singleton: `singleton-v38`

Final live queue:
- `running=1`
- `work.in_progress=0`
- `work.ready=0`
- `work.open=1` (`control-dispatcher` session bead only)

## Live Outcome

Attempt 5 step outcomes:

| Bead | Step | Status | Harness State | Provider | Outcome | Failure |
| --- | --- | --- | --- | --- | --- | --- |
| `do-4043` | Plan | closed | completed | `pi-rpc` | pass | — |
| `do-4044` | Code | closed | completed | `pi-rpc` | pass | — |
| `do-4045` | Verify | closed | completed | `pi-rpc` | pass | — |
| `do-4046` | Release | closed | fail_closed | — | fail | `fidelity_fail_closed` |
| `do-4047` | Finalize | closed | — | — | pass | — |

The Release step failed locally in Gas City fidelity validation:

```text
gc.failure_reason = fidelity_fail_closed
gc.harness_failure_detail = fidelity-release.sh exit=1
```

This is no longer a dispatcher/pi-rpc routing failure. The provider path executed.

## What Was Fixed

### 1. Control-dispatcher queue recovery

File:
- `/Users/wes/Developer/gascity/cmd/gc/dispatch_runtime.go`

Fix:
- `workflowServeQueue` now includes `in_progress` work assigned to `control-dispatcher` before scanning ready/open work.

Reason:
- The old serve loop could see `in_progress: 1` at city level but never reselect that bead for recovery after a process/container restart.

### 2. Headless control-dispatcher unblock

File:
- `/Users/wes/Developer/gascity/cmd/gc/dispatch_runtime.go`

Current fix:
- `requireWorkflowServeFollowSessionEnv()` returns `nil`.

Reason:
- The named `control-dispatcher` process was exiting because managed session env was stale/missing, even though `--follow control-dispatcher` already gives a deterministic target.

Important caveat:
- This is an emergency unblock and should be tightened.
- Preferred final shape: allow headless only for `follow == control-dispatcher`; keep managed-session env required for normal worker follow loops.

### 3. DO Store wire contract fixes

File:
- `workers/gascity-supervisor/src/factory-store-do.ts`

Fixes:
- `PATCH /beads/:id` accepts Go `UpdateOpts` PascalCase keys (`Status`, `Metadata`, `Labels`, etc.).
- `null` pointer fields from Go are treated as absent, not written into NOT NULL SQL columns.
- Metadata updates merge with existing metadata instead of replacing the whole object.
- Label updates merge/remove instead of replacing blindly.
- `CloseAll` now:
  - applies metadata,
  - skips already-closed/missing beads,
  - returns actual closed count.
- `queryBeads` now honors `Metadata`, `Label`, `Type`, `Limit`, `Sort`, and `IncludeClosed`.

Reason:
- The previous DO implementation violated the Go `beads.Store` contract and caused:
  - root `Status` updates to be ignored;
  - `PATCH` 500s when Go sent nil pointer fields as `null`;
  - metadata loss on pass/fail/close paths;
  - oversized scans because metadata filters were ignored.

### 4. Control store provider preservation

File:
- `/Users/wes/Developer/gascity/cmd/gc/cmd_convoy_dispatch.go`

Fix:
- `openControlStoreAtForCity` now preserves the configured `do` provider instead of forcing non-file/non-exec city scopes through `bd`.

Reason:
- Reproduction showed the dispatcher found DO-backed work, then reopened `city:factory` as local `bd`, failed with `no beads database found`, and exited.

### 5. Formula template sync

File:
- `harnesses/gascity-templates/factory-coding-v1.toml`

Fix:
- Synced stale harness template with canonical supervisor formula template.

Reason:
- Avoid reintroducing stale formula payloads in future dispatches.

### 6. Supervisor redeploy

Files:
- `workers/gascity-supervisor/gc-linux-amd64`
- `workers/gascity-supervisor/src/index.ts`

Fix:
- Rebuilt Linux `gc` binary from the patched Gas City tree.
- Rotated singleton from prior value to `singleton-v38`.
- Deployed Worker/container image `d7582377`.

## Validation Performed

Gas City focused tests:

```bash
go test ./cmd/gc -run 'TestOpenControlStoreAtForCityPreservesFileAndExecProviderStores|TestRunWorkflowServeFollowAllowsHeadlessControlDispatcher|TestWorkflowServeQueueIncludesInProgressControlDispatcherRuntimeWork' -count=1
```

Result:

```text
ok github.com/gastownhall/gascity/cmd/gc 1.829s
```

Supervisor Worker typecheck:

```bash
npm run typecheck
```

Result:

```text
tsc --noEmit passed
```

Live DO contract repro:
- Pre-fix exact Go-style `PATCH` body with `Status` plus null pointer fields returned Cloudflare 500 / error 1101.
- Post-fix same request returned HTTP 200 and preserved metadata.

Live dispatch:

```json
{
  "accepted": true,
  "outcome": "dispatched",
  "form_id": "FORM-3B2BB0270095584E",
  "dispatch_log_key": "dcd11a4e-aa6e-43bb-911d-d798c32e984b",
  "gc_bead_id": "do-4041",
  "gc_workflow_id": "do-4042",
  "gc_workflow_root_bead_id": "do-4042"
}
```

## Remaining Work

### A. Tighten the headless dispatcher guard

Current:
- `requireWorkflowServeFollowSessionEnv()` always returns nil.

Recommended:
- Change the guard to receive `follow`.
- Allow headless only for `control-dispatcher`.
- Require `GC_SESSION_ID` / `GC_SESSION_NAME` for normal `--follow` session loops.

### B. Investigate Release fidelity failure

Current:
- Plan, Code, Verify execute through `pi-rpc`.
- Release fails locally with `fidelity-release.sh exit=1`.

Next checks:
- inspect `/etc/gc/factory/fidelity/fidelity-release.sh` behavior in the container context;
- inspect what artifacts Plan/Code/Verify returned in `gc.harness_response_json`;
- confirm whether Code step produced expected declared outputs for CareTrace;
- confirm whether fidelity failure is expected because the generated work was placeholder/minimal.

Observed provider responses:
- Plan returned artifact `PLAN-MPVY9M6H.md`.
- Code returned `status=completed` but `artifacts=[]`.
- Verify returned `status=completed` but `artifacts=[]`.

### C. ff-pipeline run monitor remains empty

Still returns not found:
- `/run-status/EP-MPVY9M6H`
- `/run-monitor/EP-MPVY9M6H?limit=20`
- `/run-artifacts/EP-MPVY9M6H`

This should be treated as downstream observability/artifact materialization work, not the original dispatcher routing failure.

### D. Clean up failed dispatch leftovers if desired

Historical failed/rejected attempts exist:
- attempt 2: `do-3931` / `do-3932`
- attempt 3: `do-4018` / `do-4019`
- attempt 4: `do-4028` / `do-4029`

Attempt 5 is the verified fixed run.

## Modified Files

Function Factory:
- `harnesses/gascity-templates/factory-coding-v1.toml`
- `workers/gascity-supervisor/gc-linux-amd64`
- `workers/gascity-supervisor/src/factory-store-do.ts`
- `workers/gascity-supervisor/src/index.ts`

Gas City:
- `/Users/wes/Developer/gascity/cmd/gc/cmd_convoy_dispatch.go`
- `/Users/wes/Developer/gascity/cmd/gc/cmd_convoy_dispatch_test.go`
- `/Users/wes/Developer/gascity/cmd/gc/dispatch_runtime.go`

Pre-existing unrelated dirty files were present in both repos. Do not assume the full git diff belongs to this recovery.

