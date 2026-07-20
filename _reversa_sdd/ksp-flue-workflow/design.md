# Design — ksp-flue-workflow (.flue/workflows/atom-execution.ts)

> Module: `.flue/workflows/atom-execution.ts`
> Source spec: SPEC-FF-JUSTBASH-001-004
> doc_level: completo | Generated: 2026-06-10
> Package naming: `@factory/*` (former `@koales/*`), `ksp-sdk` (former `knowing-state-sdk`)

---

## 1. Package Structure

This module is a single Flue workflow file plus prerequisite packages it depends on. The workflow itself lives at the project root alongside `cloudflare.ts`; supporting gears packages are in `packages/gears/`.

```
.flue/
  workflows/
    atom-execution.ts         ← Main Flue workflow: run(), executeWithRetry(),
                                runFlueSession(), evaluateSuccessCondition(),
                                extractWorkspaceDelta(), storeFullOutput(), sleep()

packages/
  schemas/
    src/
      atom-directive.ts       ← AtomDirective Zod schema — adds skillRef + role fields
                                (SPEC-FF-JUSTBASH-001)

  gears/
    src/
      flue/
        sandbox.ts            ← Sandbox extends @cloudflare/sandbox with outboundByHost
                                API key injection for Anthropic/OpenAI/DeepSeek/GitHub
                                (SPEC-FF-JUSTBASH-002)
        agents.ts             ← PROFILE_BY_ROLE map; plannerProfile, coderProfile,
                                criticProfile, testerProfile, verifierProfile
                                (SPEC-FF-JUSTBASH-002)
      beads/
        coordinator-do.ts     ← CoordinatorDO class: initRun(), claimBead(),
                                releaseBead(), failBead(), getNextReady(),
                                writeAudit() (D1), recordOutcome() (LoopClosure),
                                alarm() stalled-bead recovery
                                (SPEC-FF-JUSTBASH-003 / SPEC-FF-GEARS-001 §7b)
        hook.ts               ← claimHook(), releaseHook(), failHook(), getNextReady()
                                — DO fetch wrappers (SPEC-FF-GEARS-001 §7)
        types.ts              ← ExecutionBead Zod schema
      index.ts                ← Barrel export for @factory/gears

cloudflare.ts                 ← Root Cloudflare entry; exports Sandbox + wires workflow
wrangler.jsonc                ← Binding declarations for COORDINATOR_DO,
                                SANDBOX_OUTPUT_BUCKET, Sandbox, secrets
.agents/
  skills/                     ← Renamed from .agent/skills/ — Flue discovers skills here
```

### Retired Packages (deleted after workflow passes tsc --noEmit)

```
packages/harness-bridge/      ← DELETED — replaced by @flue/runtime direct imports
packages/runtime/             ← DELETED — replaced by @flue/runtime direct imports
```

---

## 2. Key Algorithms and Data Flows

### 2.1 Main Workflow: run()

The top-level `run()` function is the Flue workflow entry point. It takes a `FlueContext<AtomExecutionPayload, Env>` and returns a status object.

```
run({ init, payload, env, id })
  1. Destructure: repoId, agentId, workGraphId, workGraphVersion, moleculeId from payload
  2. Compute runId = sha256(workGraphId + workGraphVersion).hex()   [GD-002]
  3. Resolve doStub = env.COORDINATOR_DO.get(idFromName(`coordinator:${runId}`))
  4. POST /init on doStub: body = JSON.stringify([runId, repoId])   [BR-KSP-16]
  5. bead = await getNextReady(doStub, moleculeId)
     └─ if null → return { status: 'complete' }
  6. parseResult = AtomDirective.safeParse(JSON.parse(bead.payload ?? '{}'))
     └─ if !success → failHook(...) → return { status: 'error', reason: 'invalid-directive' }
  7. directive = parseResult.data
  8. trace = await executeWithRetry(directive, bead.id, agentId, id, env, init)
  9. if trace.outcome === 'success' → releaseHook(doStub, bead.id, agentId, JSON.stringify(trace))
     else                           → failHook(doStub, bead.id, agentId, JSON.stringify(trace))
  10. return { status: 'executed', outcome: trace.outcome }
```

### 2.2 Retry Loop: executeWithRetry()

```
executeWithRetry(directive, beadId, agentId, workflowId, env, init)
  { maxAttempts, backoffMs, isolatedRetry } = directive.retryPolicy
  lastTrace = null

  for attempt = 1 to maxAttempts:
    if attempt > 1: await sleep(backoffMs)

    result = await runFlueSession(directive, agentId, workflowId, env, init)

    rawOutput        = result.stdout.slice(0, 4096)
    sandboxOutputRef = if result.stdout.length > 4096:
                         await storeFullOutput(result.stdout, directive.directiveId, env)
                         → `r2://sandbox-output/{directiveId}/{Date.now()}.txt`
                       else: undefined

    success = await evaluateSuccessCondition(directive.successCondition, result, result.harness)
    outcome = result.timedOut ? 'timeout' : success ? 'success' : 'failure'

    lastTrace = {
      executionId:      `${beadId}-attempt-${attempt}`,
      directiveId, atomRef, workGraphVersion, repoId,   ← from directive
      outcome, rawOutput, sandboxOutputRef,
      durationMs:    result.durationMs,
      attemptNumber: attempt,
      producedAt:    new Date().toISOString(),
    }

    if outcome === 'success': return lastTrace
    if !isolatedRetry OR attempt >= maxAttempts: break

  return lastTrace!
```

### 2.3 Flue Session: runFlueSession() — Five Bridge Points

```
runFlueSession(directive, agentId, workflowId, env, init)
  start = Date.now()

  [Bridge 1] profile = PROFILE_BY_ROLE[directive.role]    ← NO deriveRole()

  needsContainer = directive.permittedTools.includes('git')
                || directive.sandboxConfig.persistFilesystem

  [Bridge 2] agent = needsContainer
    ? createAgent<Payload, Env>(({ id: agentRunId, env: e }) => ({
        profile, sandbox: getSandbox(e.Sandbox, agentRunId), cwd: directive.workingDir || '/workspace'
      }))
    : createAgent(() => ({
        profile, cwd: directive.workingDir || '/workspace'
        // no sandbox = virtual just-bash
      }))

  [Bridge 3] harness = await init(agent)    ← ctx.init() — ONLY available in Flue workflow

  [Bridge 4] if directive.envVars['AGENTS_MD']:
               await harness.fs.writeFile('AGENTS.md', directive.envVars['AGENTS_MD'])

  [Bridge 5] session = await harness.session(`atom-${directive.directiveId}`)

  stdout = '', timedOut = false
  try:
    response = await Promise.race([
      session.skill(directive.skillRef, { args: { instruction: directive.instruction } }),
      sleep(directive.timeoutMs).then(() => { timedOut = true; return null })
    ])
    if response: stdout = response.text ?? ''
  catch err:
    stdout = String(err)

  return { stdout, timedOut, durationMs: Date.now() - start, harness }
```

### 2.4 SuccessCondition Evaluation (async)

```
evaluateSuccessCondition(condition, result, harness) → Promise<boolean>

  switch condition.type:
    'exit-code':       return !result.timedOut
    'output-contains': return result.stdout.includes(condition.substring)
    'output-matches':  return new RegExp(condition.pattern).test(result.stdout)
    'file-exists':     check = await harness.shell(`test -f ${condition.path} && echo exists`)
                       return check.stdout.trim() === 'exists'
    'composite':       return (await Promise.all(
                         condition.all.map(c => evaluateSuccessCondition(c, result, harness))
                       )).every(Boolean)
```

### 2.5 Workspace Delta Extraction

```
extractWorkspaceDelta(harness, seedPaths: Set<string>)
  result = await harness.shell('find /workspace -type f 2>/dev/null')
  allPaths = result.stdout.split('\n').filter(Boolean)
  deltas = []

  for vPath in allPaths:
    if !seedPaths.has(vPath):
      content = await harness.fs.readFile(vPath)
      deltas.push({ virtualPath: vPath, kind: 'added', content })

  for seedPath in seedPaths:
    if !allPaths.includes(seedPath):
      deltas.push({ virtualPath: seedPath, kind: 'deleted' })

  return deltas
```

### 2.6 Deterministic Coordinator DO Key (GD-002)

```
runId = createHash('sha256')
          .update(workGraphId + workGraphVersion)
          .digest('hex')
doId  = env.COORDINATOR_DO.idFromName(`coordinator:${runId}`)
```

This ensures that for any given (workGraphId, workGraphVersion) pair, the same CoordinatorDO instance is always addressed — across retries, re-invocations, and parallel workflow executions for the same run.

### 2.7 R2 Overflow Key Pattern

```
key = `sandbox-output/${directiveId}/${Date.now()}.txt`
sandboxOutputRef = `r2://${key}`
```

The full stdout is written to R2 only when `result.stdout.length > 4096`. The `rawOutput` field in `ConductingAgentTraceFragment` always contains the first 4096 characters.

---

## 3. Cloudflare Primitives Used and Why

| Primitive | Why |
|-----------|-----|
| **Flue Workflow** (`@flue/runtime`) | `ctx.init()` is only available inside a Flue workflow `run()`. The Conducting Agent needs `ctx.init(agent)` to initialize a FlueHarness. A plain CF Worker fetch handler has no `FlueContext`. The Conducting Agent is stateless and finite per atom — exactly the workflow model. |
| **Durable Object** (COORDINATOR_DO) | Single-writer, serialized bead lifecycle: `ready → in_progress → done/failed`. Deterministically addressed by `idFromName()` for idempotency. |
| **CF Container Sandbox** (`@cloudflare/sandbox`) | Used when the atom needs git access or persistent filesystem. CF Containers provide the isolated, stateful execution environment. |
| **Virtual Sandbox** (just-bash) | Default for atoms that do not need git or persistence. Lower overhead than a full container. |
| **R2 Bucket** (SANDBOX_OUTPUT_BUCKET) | Stores full stdout when output exceeds the 4096-char trace fragment limit. Referenced by `r2://` URI in `sandboxOutputRef`. |
| **Cloudflare Secrets** | API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GITHUB_TOKEN`) are bound as Cloudflare Secrets in `wrangler.jsonc`, injected at the sandbox outbound boundary by `Sandbox.outboundByHost`. They never appear in workflow payload. |

---

## 4. Integration Points

### 4.1 What This Module Calls

| Target | How | When |
|--------|-----|------|
| `CoordinatorDO (COORDINATOR_DO)` | `DurableObjectStub.fetch()` via `@factory/gears/beads` hooks | Every invocation: `/init`, `/next`, then `/release` or `/fail` |
| `@flue/runtime: createAgent()` | Import — builds `AgentRuntimeConfig` | In `runFlueSession()` |
| `@flue/runtime: ctx.init(agent)` | `init` param from `FlueContext` | In `runFlueSession()` to get `FlueHarness` |
| `FlueHarness.fs.writeFile()` | Harness VFS | When `AGENTS_MD` env var is set |
| `FlueHarness.session()` | Harness API | In `runFlueSession()` |
| `FlueSession.skill()` | Session API | Core skill execution with `Promise.race` timeout |
| `FlueHarness.shell()` | Harness API | In `evaluateSuccessCondition()` for `file-exists` and `extractWorkspaceDelta()` |
| `FlueHarness.fs.readFile()` | Harness VFS | In `extractWorkspaceDelta()` |
| `@cloudflare/sandbox: getSandbox()` | Binding helper | In `runFlueSession()` when `needsContainer` |
| `R2Bucket (SANDBOX_OUTPUT_BUCKET)` | `env.SANDBOX_OUTPUT_BUCKET.put()` | In `storeFullOutput()` when stdout > 4096 chars |
| `@factory/schemas: AtomDirective` | Zod parse | Validate bead payload |
| `@factory/gears/flue: PROFILE_BY_ROLE` | Import | Role-based profile selection |
| `@factory/gears/beads: claimHook, releaseHook, failHook, getNextReady` | Import | DO fetch wrappers |

### 4.2 What Calls This Module

| Caller | Method | Payload |
|--------|--------|---------|
| Mediation Agent / Orchestrator DO hook | `POST /workflows/atom-execution` | `AtomExecutionPayload` |
| Any orchestrator that previously called `POST /execute` on Conducting Agent CF Worker | `POST /workflows/atom-execution` | Same payload shape |

### 4.3 Phase 5 Dependencies (must be available before implementation)

```
@factory/artifact-graph  (Phase 1)
@factory/bead-graph      (Phase 1)
@factory/ksp-sdk         (Phase 2)
@factory/loop-closure    (Phase 3)
@factory/factory-graph   (Phase 4)
@factory/gears           (Phase 4 — flue/agents, flue/sandbox, beads/hook, beads/coordinator-do)
@factory/schemas         (no KSP phase dependency — can be extended in Step 1)
```

---

## 5. Data Structures

### AtomExecutionPayload (workflow input)

```typescript
interface AtomExecutionPayload {
  repoId:           string   // repository / org identifier
  agentId:          string   // agent identifier for audit trail
  workGraphId:      string   // WorkGraph identifier
  workGraphVersion: string   // WorkGraph version — used in runId derivation (GD-002)
  moleculeId:       string   // molecule identifier for getNextReady()
}
```

### AtomDirective — New Fields (SPEC-FF-JUSTBASH-001)

```typescript
// Added to existing AtomDirective Zod schema:
skillRef: z.string().min(1)
// declared skill name passed to session.skill()
// populated by Mediation Agent compile step from Gear.skillRef

role: z.enum(['planner', 'coder', 'critic', 'tester', 'verifier'])
// for PROFILE_BY_ROLE[directive.role] lookup
// populated by Mediation Agent compile step from Gear.role
// replaces deriveRole() heuristic — DELETED
```

### ConductingAgentTraceFragment (output, written as bead result JSON)

```typescript
interface ConductingAgentTraceFragment {
  executionId:      string    // `${beadId}-attempt-${attempt}`
  directiveId:      string
  atomRef:          string
  workGraphVersion: string
  repoId:           string
  outcome:          'success' | 'failure' | 'timeout'
  rawOutput:        string    // stdout.slice(0, 4096)
  sandboxOutputRef: string | undefined  // `r2://sandbox-output/...` if overflow
  durationMs:       number
  attemptNumber:    number
  producedAt:       string    // ISO 8601
}
```

### SessionResult (internal to atom-execution.ts)

```typescript
type SessionResult = {
  stdout:     string
  timedOut:   boolean
  durationMs: number
  harness:    FlueHarness   // needed for evaluateSuccessCondition file-exists
}
```

### Env Bindings (wrangler.jsonc)

| Binding | Type | Purpose |
|---------|------|---------|
| `COORDINATOR_DO` | DurableObjectNamespace | CoordinatorDO for bead lifecycle + run init |
| `SANDBOX_OUTPUT_BUCKET` | R2Bucket | Overflow stdout beyond 4096 chars |
| `Sandbox` | DurableObjectNamespace | CF Container sandbox identity for `getSandbox()` |
| `ANTHROPIC_API_KEY` | Secret (string) | Injected by Sandbox.outboundByHost at api.anthropic.com |
| `OPENAI_API_KEY` | Secret (string) | Injected by Sandbox.outboundByHost at api.openai.com |
| `DEEPSEEK_API_KEY` | Secret (string) | Injected by Sandbox.outboundByHost at api.deepseek.com |
| `GITHUB_TOKEN` | Secret (string) | Injected by Sandbox.outboundByHost at api.github.com |

### AgentProfile Definitions (PROFILE_BY_ROLE, packages/gears/src/flue/agents.ts)

```typescript
const PROFILE_BY_ROLE = {
  planner:  defineAgentProfile({ name: 'planner',  model: 'anthropic/claude-opus-4-6', instructions: '...' }),
  coder:    defineAgentProfile({ name: 'coder',    model: 'anthropic/claude-opus-4-6', instructions: '...' }),
  critic:   defineAgentProfile({ name: 'critic',   model: 'openai/gpt-5.5',            instructions: '...' }),
  tester:   defineAgentProfile({ name: 'tester',   model: 'openai/gpt-5.5',            instructions: '...' }),
  verifier: defineAgentProfile({ name: 'verifier', model: 'openai/gpt-5.5',            instructions: '...' }),
} as const
```

Note: `defineAgentProfile` is from `@flue/runtime`. There is NO `sandbox` field on profiles — sandbox is set at `createAgent()` time. There is NO `skill` field — skills are workspace-discovered from `.agents/skills/` or passed via `skills: [SkillReference]` on `createAgent`/`AgentHarnessOptions`.

---

## 6. Retired Packages — What They Were and Why Deleted

| Package | Purpose (was) | Replaced by | Deletion gate |
|---------|--------------|-------------|---------------|
| `packages/harness-bridge/` | Adapter shim between Conducting Agent and old harness API | `@flue/runtime` direct imports in `atom-execution.ts` | `tsc --noEmit` repo-wide zero errors |
| `packages/runtime/` | Runtime stub (placeholder for Flue runtime types/mocks) | `@flue/runtime` direct imports | `tsc --noEmit` repo-wide zero errors |

Both packages are deleted only AFTER `atom-execution.ts` passes `tsc --noEmit` and the `.agent/skills/` → `.agents/skills/` rename is complete. Premature deletion breaks the typecheck gate.

---

## 7. Flowchart Reference

The complete Mermaid sequence diagrams for `run()`, `runFlueSession()`, `evaluateSuccessCondition()`, the stdout overflow path, and sandbox outbound injection are documented in:

`_reversa_sdd/flowcharts/ksp-flue-workflow.md`
