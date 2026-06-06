# Commit Tracing Specification
**ID**: SPEC-FF-COMMIT-TRACING-001
**Status**: Draft — pending Architect sign-off
**Date**: 2026-06-05
**Layer**: I-layer runtime — lineage closure
**Touches**: `packages/conducting-agent/src/conducting-agent.ts`,
            `harness/hooks/pre_tool_call.ts`,
            `harness/hooks/post_execution.ts`,
            `packages/linear-sync/src/` (new endpoint)
**No new package required**

---

## 0. Conceptual Preamble

### 0.1 The lineage gap this closes

The current lineage chain runs:

```
PRD-* → WG-* → AtomDirective → CommitBead (ArangoDB) → BuildOutcomeBead
```

But the git commit produced by the Conducting Agent's Gas City session
is orphaned from this chain. Nothing connects the commit SHA to the
`directiveId` that authorized it. A developer looking at a commit sees
code; they cannot determine which Specification governed it, which
invariants were in scope at the time, or whether it was produced under
a favorable Fidelity Verdict.

Commit tracing closes this gap by:

1. Injecting lineage context into the Gas City session as env vars
   (so the commit message can carry it)
2. Intercepting every `git commit` call in `pre_tool_call.ts` to append
   Factory trailer lines to the commit message
3. Reading the produced commit SHA in `post_execution.ts` and writing
   it back to the atom's Linear issue and to the CommitBead in ArangoDB
4. Adding a new `commitShaVerificationDetector` INV-* that enforces
   tracing as a governance invariant for git-permitted atoms

### 0.2 The full closed chain

After this spec is implemented:

```
PRD-* ──▶ WG-* ──▶ AtomDirective ──▶ Linear issue (WEO-N)
                         │
                         ▼
                   CommitBead ──▶ BuildOutcomeBead
                         │
                         ▼
                   git commit (SHA: abc1234)
                         │
                         ├──▶ Linear issue link (via WEO-N in trailer)
                         └──▶ CommitBead.commitSha (ArangoDB)
```

Every artifact in this chain is traversable in both directions via the
`factory-lineage` ArangoDB graph.

---

## 1. Env Var Injection (AtomDirective → Gas City session)

### 1.1 Change: Mediation Agent DO compile step

When compiling `AtomDirective[]` from a WorkGraph on `/commission`, the
Mediation Agent resolves the Linear issue binding for each atom (via
`linear_bindings` ArangoDB collection) and injects it into `envVars`:

```typescript
// Added to AtomDirective.envVars during compile step
// Only injected if a LinearBinding exists for this directiveId
{
  FACTORY_DIRECTIVE_ID:        directive.directiveId,
  FACTORY_ATOM_REF:            directive.atomRef,
  FACTORY_WORK_GRAPH_VERSION:  directive.workGraphVersion,
  FACTORY_REPO_ID:             directive.repoId,
  FACTORY_POLICY_BEAD_ID:      policyBeadId,
  FACTORY_LINEAR_ISSUE_ID:     linearBinding?.linearIssueId ?? '',
}
```

If no `LinearBinding` exists for a given `directiveId` at compile time
(e.g., `LinearSyncService` has not yet created the issue), the
`FACTORY_LINEAR_ISSUE_ID` field is set to empty string. The hook in
`pre_tool_call.ts` omits the Linear trailer line when it is empty.

The Linear binding will exist for all atoms in normal operation because
`LinearSyncService` runs on the same alarm that triggers the compile
step. The empty-string fallback handles the edge case where the sync
service has not yet run.

### 1.2 No schema change to AtomDirective

`AtomDirective.envVars` is already typed as
`Record<string, string>` with no fixed keys. The injected fields are
conventional, not schema-enforced. The `FACTORY_*` prefix is reserved
by convention — no non-Factory env var should use it. This is documented
in `AGENTS.md` as a constraint on human-authored env var keys.

---

## 2. pre_tool_call.ts Hook Changes

### 2.1 Current responsibility

The existing hook enforces the `permittedTools` allowlist — it rejects
any tool call not in `directive.permittedTools`.

### 2.2 New responsibility: git commit interception

When a `git commit` call is intercepted (i.e., the tool call is a shell
command that invokes `git commit`), the hook rewrites the commit message
to append Factory trailer lines before passing the call to Gas City.

**Detection:** the hook matches on:
```typescript
const isGitCommit = (toolCall: ToolCall): boolean =>
  toolCall.tool === 'shell' &&
  /\bgit\s+commit\b/.test(toolCall.input.command)
```

**Rewrite:** the hook extracts the `-m` message from the command and
appends trailers:

```typescript
function appendFactoryTrailers(
  command: string,
  env: Record<string, string>
): string {
  // Extract existing message (handles -m "..." and -m '...' and multiline)
  const messageMatch = command.match(/-m\s+(['"])([\s\S]*?)\1/)
  if (!messageMatch) return command  // non-standard commit form; pass through

  const originalMessage = messageMatch[2]
  const trailers: string[] = []

  if (env.FACTORY_DIRECTIVE_ID)
    trailers.push(`Factory-Directive: ${env.FACTORY_DIRECTIVE_ID}`)
  if (env.FACTORY_WORK_GRAPH_VERSION)
    trailers.push(`Factory-WorkGraph: WG-${env.FACTORY_REPO_ID}@${env.FACTORY_WORK_GRAPH_VERSION}`)
  if (env.FACTORY_LINEAR_ISSUE_ID)
    trailers.push(`Factory-Linear: ${env.FACTORY_LINEAR_ISSUE_ID}`)
  if (env.FACTORY_POLICY_BEAD_ID)
    trailers.push(`Factory-PolicyBead: ${env.FACTORY_POLICY_BEAD_ID}`)

  if (trailers.length === 0) return command  // no env vars injected; pass through

  // Git trailer format: blank line before trailers
  const newMessage = `${originalMessage}\n\n${trailers.join('\n')}`
  return command.replace(
    /-m\s+(['"])([\s\S]*?)\1/,
    `-m "${newMessage}"`
  )
}
```

**Why not `--trailer` flag:** `git commit --trailer` was added in Git
2.33. Gas City sandboxes may run older Git versions. String injection
into `-m` is universally compatible.

**Passthrough on non-match:** if the `git commit` command cannot be
parsed (e.g., uses `--file`, `--amend` without `-m`, or is part of a
script), the hook passes it through unmodified and logs a
`CommitTrailerSkipped` event to the DO event log. The tracing invariant
detector (§4) will fire as advisory on this atom.

### 2.3 Hook signature (updated)

```typescript
// harness/hooks/pre_tool_call.ts
export async function preToolCall(
  toolCall: ToolCall,
  context: {
    directive: AtomDirective
    sessionEnv: Record<string, string>
  }
): Promise<{ allowed: boolean; modifiedToolCall?: ToolCall; reason?: string }> {
  // 1. Permitted tools check (existing)
  if (!context.directive.permittedTools.includes(toolCall.tool)) {
    return { allowed: false, reason: `tool-not-permitted: ${toolCall.tool}` }
  }

  // 2. git commit interception (new)
  if (isGitCommit(toolCall) && context.directive.permittedTools.includes('git')) {
    const rewrittenCommand = appendFactoryTrailers(
      toolCall.input.command,
      context.sessionEnv
    )
    if (rewrittenCommand !== toolCall.input.command) {
      return {
        allowed: true,
        modifiedToolCall: {
          ...toolCall,
          input: { ...toolCall.input, command: rewrittenCommand }
        }
      }
    }
    // Passthrough (couldn't parse message)
    return { allowed: true }
  }

  return { allowed: true }
}
```

---

## 3. post_execution.ts Hook Changes

### 3.1 Current responsibility

The existing hook truncates `rawOutput` to 4KB before it is reported to
the Mediation Agent, storing the full output in R2.

### 3.2 New responsibility: commit SHA extraction

After a successful atom execution (Gas City session reports
`outcome: success`), the hook reads the git log to extract the SHA of
the most recent commit produced by this session.

**Extraction:**

```typescript
async function extractCommitSha(
  sessionResult: GasCitySessionResponse,
  directive: AtomDirective,
  gasCityUrl: string
): Promise<string | undefined> {
  // Only attempt on atoms with git permission
  if (!directive.permittedTools.includes('git')) return undefined

  // Run git log --oneline -1 in the session's working dir
  // via a lightweight follow-up shell call to Gas City
  const logResult = await runFollowUpCommand(
    `git -C ${directive.workingDir} log --oneline -1 --format=%H`,
    gasCityUrl,
    directive
  )

  if (!logResult || logResult.exitCode !== 0) return undefined

  const sha = logResult.stdout.trim()
  // Validate: 40-char hex SHA
  return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined
}
```

This follow-up command runs in the same Gas City session before it is
closed — a lightweight read-only operation that does not constitute a
second atom execution. The session is not billed as a new execution.

### 3.3 SHA propagation

Once the SHA is extracted, it is:

1. Included in the `ConductingAgentTraceFragment` as `commitSha`:

```typescript
// Extended TraceFragment (additive — no breaking change)
type ConductingAgentTraceFragment = {
  // ... existing fields ...
  commitSha?: string     // undefined if atom has no git permission or no commit produced
}
```

2. The Mediation Agent DO's `/trace` handler writes it to the
   `TraceEvent` payload (no schema change needed — `TracePayload`
   already accepts the full `ConductingAgentTraceFragment`).

3. On the next Bead flush, the `CommitBead` written to ArangoDB is
   updated with `commitSha`:

```typescript
// CommitBead addition
type CommitBead = BeadEnvelope & {
  beadType: 'CommitBead'
  directiveId: string
  atomRef: string
  workGraphVersion: string
  sessionId: string
  outcome: string
  commitSha?: string     // new field — populated by post_execution hook
}
```

4. `LinearSyncService` receives the SHA via a new `POST /sync/commit-sha`
   endpoint (see §5) and posts it as a comment on the atom's Linear issue.

### 3.4 Hook signature (updated)

```typescript
// harness/hooks/post_execution.ts
export async function postExecution(
  sessionResult: GasCitySessionResponse,
  context: {
    directive: AtomDirective
    executionId: string
    gasCityUrl: string
  }
): Promise<{
  rawOutput: string          // truncated to 4KB
  sandboxOutputRef?: string  // presigned R2 URL
  commitSha?: string         // new
}> {
  // 1. Truncate output (existing)
  const rawOutput = sessionResult.stdout.slice(0, 4096)
  const sandboxOutputRef = sessionResult.stdout.length > 4096
    ? await storeFullOutput(sessionResult.stdout, context.directive.directiveId)
    : undefined

  // 2. Extract commit SHA (new)
  const commitSha = sessionResult.outcome === 'success'
    ? await extractCommitSha(sessionResult, context.directive, context.gasCityUrl)
    : undefined

  return {
    ...(sandboxOutputRef !== undefined ? { sandboxOutputRef } : {}),
    rawOutput,
    ...(commitSha !== undefined ? { commitSha } : {}),
  }
}
```

---

## 4. Commit Tracing Invariant Detector

A new INV-* detector spec enforces that every atom with `git` tool
permission produces a traceable commit.

```yaml
# specs/invariants/INV-COMMIT-TRACE-001.yaml
id: INV-COMMIT-TRACE-001
name: CommitTraceability
severity: warning
statement: >
  Every atom with 'git' in permittedTools that produces outcome: success
  must have a non-null commitSha in its TraceFragment.
detector:
  type: trace-field-check
  condition:
    if:
      permittedTools_contains: git
      outcome: success
    then:
      field: commitSha
      must_be: non-null
failure_action: >
  Advisory Divergence. Hypothesis formation: the atom likely made a git
  operation without committing (e.g., git add only), or the commit message
  was non-standard and the trailer could not be injected.
```

This INV-* spec is `severity: warning` → `advisory` Divergence per the
severity classification policy (DECISIONS N+2). It does not block
execution — it surfaces a traceability gap for Hypothesis formation.

The cases where this fires legitimately (atoms that manipulate git
without committing, e.g., `git add` staging steps) should have
`read-only` or `shell` tool permission, not `git`. The detector fires
as a signal that the atom's tool permissions may be over-broad.

---

## 5. LinearSyncService: new POST /sync/commit-sha endpoint

### 5.1 Input

```typescript
type CommitShaSyncRequest = {
  directiveId: string
  commitSha: string
  workGraphVersion: string
  repoId: string
  durationMs: number
  attemptNumber: number
}
```

### 5.2 Behavior

1. Look up `LinearBinding` for `directiveId`
2. If no binding: log and return (issue may not have been created yet;
   SHA will be visible in ArangoDB CommitBead regardless)
3. Post comment on atom issue:

```
✅ Atom completed successfully on attempt {attemptNumber}.
Duration: {durationMs}ms

**Commit**: `{commitSha}`
[View on GitHub](https://github.com/Wescome/function-factory/commit/{commitSha})
```

4. The GitHub link is constructed from a `GITHUB_REPO_URL` env var
   in the sync service. If absent: link is omitted.

### 5.3 Caller

The Conducting Agent Worker calls this endpoint after the `TraceFragment`
is reported to the Mediation Agent, if `commitSha` is present:

```typescript
// In conducting-agent.ts, after reportTrace()
if (trace.commitSha) {
  await fetch(`${env.LINEAR_SYNC_URL}/sync/commit-sha`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      directiveId: directive.directiveId,
      commitSha: trace.commitSha,
      workGraphVersion: directive.workGraphVersion,
      repoId: directive.repoId,
      durationMs: trace.durationMs,
      attemptNumber: trace.attemptNumber,
    }),
  })
  // Fire-and-forget: Linear failure does not affect Factory governance
}
```

---

## 6. Summary of Changes by File

| File | Change type | Description |
|------|------------|-------------|
| `packages/mediation-agent/src/mediation-agent-do.ts` | Additive | Inject `FACTORY_*` env vars during AtomDirective compile step, after resolving `linear_bindings` |
| `harness/hooks/pre_tool_call.ts` | Additive | `git commit` interception + trailer injection; passthrough on non-parseable commands |
| `harness/hooks/post_execution.ts` | Additive | Commit SHA extraction via follow-up `git log` call; included in returned payload |
| `packages/conducting-agent/src/types.ts` | Additive | `commitSha?: string` on `ConductingAgentTraceFragment` |
| `packages/conducting-agent/src/conducting-agent.ts` | Additive | Fire-and-forget call to `POST /sync/commit-sha` when `commitSha` is present |
| `packages/linear-sync/src/index.ts` | Additive | Route `POST /sync/commit-sha` to new handler |
| `packages/linear-sync/src/commit-sha-sync.ts` | New file | Handler for `POST /sync/commit-sha` |
| `packages/schemas/src/atom-directive.ts` | No change | `envVars: Record<string, string>` already accepts `FACTORY_*` keys |
| `specs/invariants/INV-COMMIT-TRACE-001.yaml` | New file | Warning-severity detector for commit traceability |

No new packages. No breaking changes to existing interfaces. All changes
are additive.

---

## 7. Open Items

| Item | Owner | Blocking |
|------|-------|---------|
| `runFollowUpCommand()` implementation — lightweight Gas City shell call after session completes, before close | Engineering | Yes — needed for SHA extraction |
| `GITHUB_REPO_URL` env var in `linear-sync` — for commit deep-link construction | Engineering | No — link omitted if absent |
| `INV-COMMIT-TRACE-001` registration in compiler — invariant must be associated with relevant WorkGraph atom types at authoring time | Engineering | No — can be manually registered for v1 |
| `CommitTrailerSkipped` event type addition to Mediation Agent DO event log types | Engineering | No — advisory only; non-blocking |
| Multi-commit atoms — if an atom produces multiple commits (e.g., a fixup loop), `git log --oneline -1` captures only the latest. Whether to capture all SHAs is a design question | Architect | No — single SHA is sufficient for v1 lineage tracing |
