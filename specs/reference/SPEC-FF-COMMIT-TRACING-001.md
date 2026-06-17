# Commit Tracing Specification
**ID**: SPEC-FF-COMMIT-TRACING-001  
**Version**: 2.0  
**Date**: 2026-06-14  
**Status**: Draft — pending Architect sign-off  
**Layer**: I-layer runtime — lineage closure  
**Touches**: `packages/gears/src/agents/conducting-agent.ts` (ThinkExecutor/Mastra), `packages/gears/src/processors/` (Mastra outputProcessors), `packages/linear-sync/src/`  
**No new package required**  
**v1.0 → v2.0**: Gas City and `pre_tool_call.ts` / `post_execution.ts` Flue hooks retired. Replaced by Mastra outputProcessor (`CommitTracingProcessor`) + ThinkExecutor post-generation hook. ArangoDB CommitBead → CoordinatorDO DO SQLite `execution_beads` + ArtifactGraphDO `ExecutionTrace` node `commitSha` field. Mediation Agent DO compile step corrected for v3.0.

---

## 0. Conceptual Preamble

### 0.1 The lineage gap this closes

Current chain:
```
PRD-* → WG-* → AtomDirective → ExecutionTrace node (ArtifactGraphDO)
```

The git commit produced by the Mastra Agent's tool execution is orphaned from this chain. Commit tracing closes this gap by:

1. Injecting lineage context into `AtomDirective.specFiles[]` as a `.factory-env` file written to `@cloudflare/shell` workspace by ThinkExecutor
2. Intercepting `git commit` calls in Mastra `outputProcessors` (`CommitTracingProcessor`) to append Factory trailer lines
3. Extracting the produced commit SHA post-generation and writing it to the `ExecutionTrace` node in ArtifactGraphDO
4. Adding INV-COMMIT-TRACE-001 as a governance invariant for git-permitted atoms

### 0.2 The full closed chain after this spec

```
PRD-* ──▶ WG-* ──▶ AtomDirective ──▶ Linear issue (WEO-N)
                        │
                        ▼
              ExecutionTrace node (ArtifactGraphDO)
                        │
                        ▼
                git commit (SHA: abc1234)
                        │
                        ├──▶ Linear issue comment (via WEO-N in trailer)
                        └──▶ ExecutionTrace.commitSha (ArtifactGraphDO)
```

---

## 1. Env Injection (AtomDirective → ThinkExecutor → @cloudflare/shell)

### 1.1 Change: Mediation Agent DO nine-step compile sequence (step 7)

When compiling `AtomDirective[]` during step 7 (write compiled molecules to DO SQLite), the Mediation Agent DO resolves the Linear issue binding for each atom from D1 `factory-artifacts` `linear_bindings` and populates a special `specFiles` entry:

```typescript
// Added to AtomDirective.specFiles[] during compile step 7
{
  virtualPath: '/spec/.factory-env',
  content: [
    `FACTORY_ATOM_ID=${directive.atomId}`,
    `FACTORY_WORK_GRAPH_VERSION=${directive.workGraphVersion}`,
    `FACTORY_REPO_ID=${repoId}`,
    `FACTORY_POLICY_BEAD_ID=${policyBeadId}`,
    `FACTORY_LINEAR_ISSUE_ID=${linearBinding?.linearIssueId ?? ''}`,
    `FACTORY_RUN_ID=${runId}`,
  ].join('\n'),
  d1ArtifactRef: directive.d1ArtifactRef,
}
```

ThinkExecutor writes all `specFiles` to `@cloudflare/shell` workspace before `mastraAgent.generate()` begins (per SPEC-FF-ILAYER-EXEC-001 v2.0 §5.2). The `.factory-env` file is available to any tool call that reads environment context from the workspace.

### 1.2 No AtomDirective schema change

`AtomDirective.specFiles` is already `SpecFileEntry[]`. The `.factory-env` entry uses the existing schema. `FACTORY_*` prefix is reserved by convention in `AGENTS.md`.

---

## 2. CommitTracingProcessor (Mastra outputProcessor)

### 2.1 Position in processor chain

```typescript
outputProcessors: [
  new ConsentBeadAuditProcessor(directive.toolPolicy, env.COORDINATOR_DO),
  new ToolCallFilter(directive.toolPolicy.permittedTools),
  new CommitTracingProcessor(directive, env),  // new — after consent gate
  new PIIDetector(env),
]
```

`CommitTracingProcessor` runs after `ConsentBeadAuditProcessor` and `ToolCallFilter` — only if the tool call is permitted. It never runs on denied tool calls.

### 2.2 What it does

When a tool call is a `shell` command matching `/\bgit\s+commit\b/`:

```typescript
class CommitTracingProcessor implements OutputProcessor {
  async processOutputStep(toolCall: ToolCall): Promise<ToolCall> {
    if (!this.isGitCommit(toolCall)) return toolCall
    if (!this.directive.toolPolicy.permittedTools.includes('shell')) return toolCall

    const rewritten = this.appendFactoryTrailers(toolCall.input.command)
    if (rewritten === toolCall.input.command) {
      // Could not parse -m flag; pass through; INV-COMMIT-TRACE-001 will fire
      await this.logSkipped(toolCall)
      return toolCall
    }

    return { ...toolCall, input: { ...toolCall.input, command: rewritten } }
  }

  private appendFactoryTrailers(command: string): string {
    const messageMatch = command.match(/-m\s+(['"])([\s\S]*?)\1/)
    if (!messageMatch) return command

    const env = this.readFactoryEnv()
    const trailers: string[] = []
    if (env.FACTORY_ATOM_ID)           trailers.push(`Factory-Atom: ${env.FACTORY_ATOM_ID}`)
    if (env.FACTORY_WORK_GRAPH_VERSION) trailers.push(`Factory-WorkGraph: WG-${env.FACTORY_REPO_ID}@${env.FACTORY_WORK_GRAPH_VERSION}`)
    if (env.FACTORY_LINEAR_ISSUE_ID)   trailers.push(`Factory-Linear: ${env.FACTORY_LINEAR_ISSUE_ID}`)
    if (env.FACTORY_POLICY_BEAD_ID)    trailers.push(`Factory-PolicyBead: ${env.FACTORY_POLICY_BEAD_ID}`)
    if (trailers.length === 0) return command

    const newMessage = `${messageMatch[2]}\n\n${trailers.join('\n')}`
    return command.replace(/-m\s+(['"])([\s\S]*?)\1/, `-m "${newMessage}"`)
  }

  private readFactoryEnv(): Record<string, string> {
    // Reads /spec/.factory-env from @cloudflare/shell workspace
    // Returns parsed key=value pairs
  }

  private isGitCommit(toolCall: ToolCall): boolean {
    return toolCall.tool === 'shell' && /\bgit\s+commit\b/.test(toolCall.input.command)
  }
}
```

**Why not `--trailer` flag:** Git 2.33+. Shell sandboxes may run older versions. `-m` string injection is universally compatible.

---

## 3. Commit SHA Extraction (post-generation)

### 3.1 Where it runs

After `mastraAgent.generate()` completes in ThinkExecutor (entering `evaluating` state per SM10), before `releaseBead()` is called:

```typescript
// In ThinkExecutor.executeAtom(), after mastraAgent.generate() resolves:
let commitSha: string | undefined
if (directive.toolPolicy.permittedTools.includes('shell')) {
  commitSha = await this.extractCommitSha(directive)
}

// Include in trace fragment
const trace = buildTraceFragment(executionId, directive.atomId, result, commitSha)
```

### 3.2 Extraction

```typescript
private async extractCommitSha(directive: AtomDirective): Promise<string | undefined> {
  // Run git log in @cloudflare/shell workspace
  const result = await this.workspace.exec(
    `git -C ${directive.workingDir ?? '/workspace'} log --oneline -1 --format=%H`
  )
  if (!result || result.exitCode !== 0) return undefined
  const sha = result.stdout.trim()
  return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined
}
```

### 3.3 SHA propagation

1. Included in `TraceFragment` as `commitSha?: string`
2. Written to `ExecutionTrace` node in ArtifactGraphDO by LoopClosureService:

```typescript
// ExecutionTrace node extension (additive)
type ExecutionTraceNode = {
  nodeType: 'ExecutionTrace'
  // ... existing fields ...
  commitSha?: string    // undefined if no git permission or no commit
}
```

3. On next CoordinatorDO `releaseBead()`, D1 bead audit row includes `commitSha`
4. LinearSyncService `POST /sync/commit-sha` posts SHA comment to atom issue

---

## 4. Commit Tracing Invariant Detector

```yaml
# specs/invariants/INV-COMMIT-TRACE-001.yaml
id: INV-COMMIT-TRACE-001
name: CommitTraceability
severity: warning         # advisory Divergence — does not block execution
statement: >
  Every atom with 'shell' in permittedTools that produces outcome: success
  and whose workspace contains git operations must have a non-null commitSha
  in its ExecutionTrace node.
detector:
  type: trace-field-check
  condition:
    if:
      permittedTools_contains: shell
      outcome: success
    then:
      field: commitSha
      must_be: non-null
failure_action: >
  Advisory Divergence. The atom likely made a git operation without
  committing, or the commit message was non-standard and the trailer
  could not be injected.
```

---

## 5. LinearSyncService: POST /sync/commit-sha

```typescript
type CommitShaSyncRequest = {
  atomId: string
  commitSha: string
  workGraphVersion: string
  repoId: string
  durationMs: number
}
```

Behavior: look up D1 `linear_bindings` for `atomId`. If no binding: log and return. Else post comment to atom issue:
```
✅ Atom completed successfully.
Duration: {durationMs}ms
Commit: `{commitSha}`
[View on GitHub](https://github.com/Wescome/function-factory/commit/{commitSha})
```

**Caller**: ThinkExecutor calls this fire-and-forget after `releaseBead()`, if `commitSha` is present.

---

## 6. Summary of Changes by File

| File | Change | Description |
|------|--------|-------------|
| `packages/mediation-agent/src/` | Additive | Compile step 7: add `/spec/.factory-env` to `AtomDirective.specFiles[]` after resolving D1 `linear_bindings` |
| `packages/gears/src/processors/commit-tracing-processor.ts` | New file | Mastra `OutputProcessor` — intercepts `git commit` shell calls, appends trailers |
| `packages/gears/src/agents/think-executor.ts` | Additive | Post-generate commit SHA extraction via `workspace.exec()` |
| `packages/gears/src/types.ts` | Additive | `commitSha?: string` on `TraceFragment` |
| `packages/loop-closure/src/loop-closure-service.ts` | Additive | Write `commitSha` to `ExecutionTrace` ArtifactGraphDO node |
| `packages/linear-sync/src/commit-sha-sync.ts` | New file | `POST /sync/commit-sha` handler |
| `packages/linear-sync/src/index.ts` | Additive | Route `POST /sync/commit-sha` |
| `specs/invariants/INV-COMMIT-TRACE-001.yaml` | New file | Warning-severity detector |

No new packages. No breaking changes.

---

## 7. Open Items

| Item | Blocking |
|------|---------|
| `workspace.exec()` API on `@cloudflare/shell` — confirm method signature for running a command and capturing stdout | Yes |
| `GITHUB_REPO_URL` env var in `linear-sync` — for commit deep-link | No |
| INV-COMMIT-TRACE-001 registration in Mediation Agent DO compile sequence | No |
