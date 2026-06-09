# Codex Handoff — Fix Coding Agent Authoring Mode

Date: 2026-06-03  
Repo: `/Users/wes/Developer/function-factory`

## Problem

The coding agent never writes code. Plan, Code, and Verify steps all complete
in ~2 seconds by creating 59-61 byte stub files via bash, with no LLM call.

Root cause: `normalizePiContainerExecuteInput` in
`workers/ff-pipeline/src/gascity/pi-container-execute.ts` never sets
`execution.authoringMode`. The pi-container defaults to
`contract_materialized_when_possible`, which tries to satisfy every declared
output via a bash command before calling the LLM. Since `CandidatePatch` and
`VerifierReport` are plain text artifacts, bash can create them as stubs — and
does.

The fix is one line: when the incoming `ExecutionRequest` carries
`workspace_write_scope` in its `policy.filesystem_scope`, set
`execution.authoringMode = "autonomous_filesystem"` on the `WorkerInput`.
`autonomous_filesystem` mode skips all contract materialization and runs the
LLM unconditionally.

## Fix

**File:** `workers/ff-pipeline/src/gascity/pi-container-execute.ts`

**Function:** `normalizePiContainerExecuteInput` (line 38)

**Where to detect coding steps:** Gas City maps `workspace_write_scope` to
`policy.filesystem_scope = ["/workspace"]` in `harnessPolicyForRequirements`
(`gascity/cmd/gc/harness_dispatch.go:347`). The `runtime_config` object is
always `{}` — requirements never appear there.

The correct field is `body.policy.filesystem_scope`. When it contains
`"/workspace"`, this is a coding step.

**Current (broken) condition in the uncommitted fix:**
```ts
// WRONG — runtimeConfig.runtime_requirements is always undefined
const hasWorkspaceWriteScope = Array.isArray(runtimeConfig.runtime_requirements)
  && runtimeConfig.runtime_requirements.includes('workspace_write_scope')
```

**Correct condition:**
```ts
const policy = body.policy && typeof body.policy === 'object'
  ? (body.policy as Record<string, unknown>)
  : {}
const fsScope = Array.isArray(policy.filesystem_scope)
  ? (policy.filesystem_scope as unknown[])
  : []
const hasWorkspaceWriteScope = fsScope.includes('/workspace')
if (hasWorkspaceWriteScope) {
  workerInput.execution = { authoringMode: 'autonomous_filesystem' }
}
```

**Why this works:** `autonomous_filesystem` makes `shouldMaterializeContracts`
return `false`, so `materializableContracts = []`. No bash stubs are created.
The LLM runs with the step description as `context.taskText` and writes real
code to the workspace.

**`WorkerInput.execution` field:** Already exists — `server.mjs` reads
`input?.execution?.authoringMode`. Add a TypeScript declaration if the type
doesn't already have it:

```ts
execution?: { authoringMode?: string }
```

## Validation

1. Add a unit test in
   `workers/ff-pipeline/src/gascity/pi-container-execute.test.ts` asserting
   that a request with `policy.filesystem_scope: ["workspace_write_scope"]`
   produces `workerInput.execution.authoringMode === "autonomous_filesystem"`.

2. Add a test asserting that a request WITHOUT `workspace_write_scope` produces
   no `execution` field (other steps should keep the default behaviour).

3. `pnpm --filter @factory/ff-pipeline run typecheck` must pass.

4. Deploy and run a live dispatch. Code bead should show:
   - `model.response` event in `step_outputs.events` (LLM actually called)
   - `artifact_manifest` with `CandidatePatch` at more than ~100 bytes
   - Step runtime > 5 seconds

## Do NOT change

- `execution-policy.mjs` — the `CODE_AND_VERIFY_ARTIFACTS` guard is still
  correct as a defence-in-depth layer; leave it.
- `normalizeOutputContracts` in `server.mjs` — leave it.
- Gas City harness dispatch — no changes needed there.
