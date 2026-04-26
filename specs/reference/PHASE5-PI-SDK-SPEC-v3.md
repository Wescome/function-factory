# Phase 5 v3 -- Pi SDK in Cloudflare Containers (Corrected API Surface)

**Author:** Architecture spec for Wislet J. Celestin / Koales.ai
**Date:** 2026-04-26
**Status:** Spec v3 -- revised after Engineer review of v2 API surface
**Lineage:** ADR-003 (pi SDK default executor, amended herein),
FULL-PI-DEPLOYMENT-ARCHITECTURE.md SS4-5, Phase 4 Coordinator DO (live),
Phase 5 v1 review (5 fatal blockers: no child_process in DO), Phase 5 v2
review (correct architecture, wrong CF Container API surface).

**Root cause of v2 failure:** v2 treated CF Containers as an external
service started via `this.env.FACTORY_CONTAINER.start({ image })`. CF
Containers are actually Durable Object subclasses -- you define
`class FactoryAgent extends Container`, declare it in wrangler.jsonc with
`class_name` + `image` + DO binding, and communicate via
`getContainer(env.FACTORY_AGENT, name).fetch()`. The Container class has
built-in lifecycle methods like `startAndWaitForPorts()`. v3 corrects every
API surface to match the actual CF Container DO model.

---

## 0. What Changed From v2

| v2 (wrong API surface) | v3 (this spec) |
|---|---|
| `this.env.FACTORY_CONTAINER.start({ image })` | `getContainer(env.FACTORY_AGENT, name)` via `@cloudflare/containers` |
| `container.url` stored, then `fetch(url + endpoint)` | `getContainer(...).fetch(new Request(url, ...))` via Container helper |
| `session.send(prompt)` returns result | `session.prompt(text)` returns void; use `session.subscribe()` for events |
| `getModel(provider, modelId, { apiKey })` | `getModel(provider, modelId)` -- keys from `process.env` |
| API keys in request bodies | Container reads keys from env vars set at class definition |
| `containers: [{ binding, image }]` in wrangler | `containers` array + `durable_objects` binding + `class_name` + migration |
| No Container class definition | `class FactoryAgent extends Container` with `fetch()` handler |
| Custom health-check polling loop | `this.startAndWaitForPorts()` built-in Container method |
| Tool gating via custom wrapper functions | `createAgentSession({ customTools })` pi SDK parameter |

What survived from v2 unchanged (Architect approved):

- Three-tier dispatch: dry-run / piAiRole fallback / containerRole
- Container reuse across Coder -> Tester (shared workspace)
- Repair loop lifecycle: patch = keep workspace, resample = fresh
- Workspace lifecycle: clone -> branch -> install -> code -> test -> collect
- Cost model: ~$0.009/synthesis
- Fallback to Phase 4 if Container unavailable
- Every step reversible
- Container image contents (Node 22, git, pnpm, pi SDK, agent-server)
- Agent-server HTTP interface pattern (workspace/coder/tester/collect/cleanup/health)
- Security model (keys in env vars, network isolation, ephemeral containers)

---

## 1. Architecture

### 1.1 Call Chain

```
CF Workflow
  |
  +-> CF Queue (synthesis-queue, enqueue + waitForEvent)
        |
        +-> Queue Consumer (fresh Worker context)
              |
              +-> Coordinator DO (SynthesisCoordinator)
                    |
                    +-- Planner, Critic, Verifier: piAiRole (LLM calls, stay in DO)
                    |
                    +-- Coder, Tester: containerRole
                          |
                          +-> Container DO (FactoryAgent extends Container)
                                |
                                +-- agent-server on :8080
                                +-- pi SDK sessions
                                +-- real filesystem (git, npm, code, tests)
```

**Key architectural property:** The Queue consumer calls the Coordinator DO
via `stub.fetch()`. The Coordinator DO calls the Container DO via
`getContainer(env.FACTORY_AGENT, name).fetch()`. Both are DO-to-DO calls
OUTSIDE Workflow steps -- this works (the synthesis bridge proves the first
hop; the same mechanism applies to the second). The Workflow->DO deadlock
only applies inside `step.do()`.

### 1.2 Container as Durable Object

CF Containers are **Durable Object subclasses**. A Container class:
- Extends the `Container` base class from `@cloudflare/containers`
- Has a `fetch()` handler like any DO
- Has an automatically managed Linux container behind it
- Starts its container process via `this.startAndWaitForPorts()`
- Is accessed via `getContainer(env.FACTORY_AGENT, name).fetch()`

This means the Coordinator DO communicates with the Container DO using
`getContainer()` from `@cloudflare/containers` -- there is no special
"container start" API. The Container's fetch handler receives requests and
routes them to the agent-server running inside the Linux container.

---

## 2. Container DO Class Definition

```typescript
// containers/factory-agent/src/container.ts
import { Container, getContainer } from '@cloudflare/containers'

interface Env {
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY?: string
  DEEPSEEK_API_KEY?: string
}

export class FactoryAgent extends Container<Env> {
  // Called before any fetch reaches the container process.
  // Starts the Linux container and waits for it to bind port 8080.
  override async onStart(): Promise<void> {
    // startAndWaitForPorts() is a built-in Container class method.
    // It starts the container image and waits for the declared port(s)
    // to become reachable. No custom polling loop needed.
    await this.startAndWaitForPorts()
  }

  // Standard DO fetch handler. Proxies requests to the agent-server
  // running inside the Linux container on port 8080.
  override async fetch(request: Request): Promise<Response> {
    // The Container base class provides internal routing to the
    // container process. Forward the request to the agent-server.
    const url = new URL(request.url)
    const containerUrl = `http://localhost:8080${url.pathname}${url.search}`
    return fetch(containerUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    })
  }
}
```

**Key points:**
- `extends Container` from `@cloudflare/containers` -- not `extends DurableObject`
- `startAndWaitForPorts()` -- built-in, replaces custom health polling
- `fetch()` handler proxies to the agent-server on localhost:8080
- Env vars (API keys) are available via `this.env` in the Container class
  and via `process.env` inside the container process

---

## 3. Container Image

Identical to v2. A single Docker image:

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN npm install -g @mariozechner/pi-coding-agent@0.70.2

WORKDIR /factory-agent
COPY agent-server/ .
RUN pnpm install --frozen-lockfile

EXPOSE 8080
CMD ["node", "server.js"]
```

| Component | Purpose | Size |
|---|---|---|
| Node.js 22 | Runtime | ~180MB |
| git | Clone, branch, diff, commit | ~30MB |
| pnpm | Package management | ~10MB |
| pi-coding-agent | Agent loop + tools (read/write/edit/bash) | ~15MB |
| pi-ai | Model access, streaming, tool calling | ~5MB |
| agent-server | Factory HTTP wrapper around pi sessions | ~50KB |

Total: ~240MB. Well within CF Container limits.

---

## 4. Agent Server (Inside the Container)

The agent-server runs inside the Linux container. It receives HTTP requests
proxied from the FactoryAgent DO's fetch handler.

### 4.1 Endpoints

```
POST /workspace    -> prepare workspace (clone, branch, install)
POST /coder        -> run Coder session (pi SDK)
POST /tester       -> run Tester session (pi SDK, read-only)
GET  /status       -> session status (running/idle/error)
POST /collect      -> collect artifacts (diff, files, test results)
POST /cleanup      -> destroy workspace, prepare for shutdown
GET  /health       -> liveness check
```

### 4.2 Pi SDK API Usage (Verified)

The agent-server uses pi SDK with the CORRECT API surface:

```typescript
// agent-server/server.ts
import { createAgentSession } from '@mariozechner/pi-coding-agent'
import { getModel } from '@mariozechner/pi-ai'

// Model access: getModel takes (provider, modelId) -- NO apiKey parameter.
// Keys are read from process.env (ANTHROPIC_API_KEY, etc.)
const model = getModel(provider, modelId)

// Session creation: customTools parameter for Factory tool gating
const session = await createAgentSession({
  model,
  cwd: workDir,
  customTools: buildGatedTools(fileScope, commandPolicy),
})

// Execution: session.prompt() returns VOID.
// Results come via session.subscribe() events.
session.prompt(objectiveText)

// Event collection via subscribe
const events: SessionEvent[] = []
session.subscribe((event) => {
  events.push(event)
})

// Wait for completion (session emits 'done' or 'error' event)
await waitForSessionComplete(session)
```

### 4.3 Tool Gating via customTools

Pi SDK's `createAgentSession` accepts a `customTools` parameter. Each
custom tool wraps a default tool with a pre-call validation gate:

- **write/edit:** Check `args.path` against `fileScope` array. Block if outside scope.
- **bash:** Check `args.command` against `commandPolicy.allow`/`deny`. Block if denied.
- **read:** Unrestricted (use default).

Blocked calls return `{ error: "Blocked: ..." }` and are recorded in
the response's `blockedToolCalls` array.

### 4.4 Server Implementation

```typescript
// agent-server/server.ts (abridged -- full impl in containers/factory-agent/)
import { createServer } from 'node:http'
import { createAgentSession } from '@mariozechner/pi-coding-agent'
import { getModel } from '@mariozechner/pi-ai'

const server = createServer(async (req, res) => {
  const body = await readBody(req)
  switch (`${req.method} ${req.url}`) {

    case 'POST /coder': {
      const { provider, modelId, plan, workGraph, repairNotes,
              fileScope, commandPolicy } = body
      // No apiKey in body. Keys from process.env.
      const model = getModel(provider, modelId)
      const session = await createAgentSession({
        model,
        cwd: currentWorkspace!.workDir,
        customTools: buildGatedTools(fileScope, commandPolicy),
      })
      const events: unknown[] = []
      session.subscribe((event: unknown) => events.push(event))
      session.prompt(buildCoderPrompt({ plan, workGraph, repairNotes }))
      await waitForSessionComplete(session)
      await exec(`cd ${currentWorkspace!.workDir} && git add -A && git commit -m "factory: coder" --allow-empty`)
      const artifacts = await collectArtifacts(currentWorkspace!.workDir, currentWorkspace!.ref)
      respond(res, 200, { status: 'complete', artifacts, tokenUsage: extractTokenUsage(events) })
      break
    }

    case 'POST /tester': {
      const { provider, modelId, code, workGraph } = body
      const model = getModel(provider, modelId)
      const session = await createAgentSession({
        model, cwd: currentWorkspace!.workDir,
      })
      const events: unknown[] = []
      session.subscribe((event: unknown) => events.push(event))
      session.prompt(buildTesterPrompt({ code, workGraph }))
      await waitForSessionComplete(session)
      respond(res, 200, { status: 'complete', testReport: parseTestResults(events) })
      break
    }

    // POST /workspace, POST /collect, POST /cleanup, GET /status, GET /health
    // follow the same pattern as v2 (workspace.ts module unchanged)
  }
})
server.listen(8080)
```

**Workspace module:** Unchanged from v2 (`workspace.ts`). Uses
`child_process.execSync` for git/pnpm, `fs/promises` for file collection.

---

## 5. Coordinator DO -- Container Orchestration

The Coordinator DO (SynthesisCoordinator) calls the Container DO via the
standard DO binding pattern.

### 5.1 Container Lifecycle

```typescript
// In coordinator.ts -- additions to SynthesisCoordinator
import { getContainer } from '@cloudflare/containers'

interface CoordinatorEnv {
  // ... existing bindings ...
  FACTORY_AGENT: DurableObjectNamespace  // Container DO binding
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY?: string
  DEEPSEEK_API_KEY?: string
}

private containerName: string | null = null

private getContainerStub() {
  // Use a deterministic name derived from the Coordinator's own ID.
  // One Container per synthesis run.
  if (!this.containerName) {
    this.containerName = this.ctx.id.toString()
  }
  // getContainer() is the actual CF Containers API helper.
  // It resolves the DO namespace + name into a callable stub.
  return getContainer(this.env.FACTORY_AGENT, this.containerName)
}

private async containerFetch(path: string, body?: unknown): Promise<Response> {
  const container = this.getContainerStub()
  const init: RequestInit = {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) {
    init.body = JSON.stringify(body)
  }
  // FactoryAgent.onStart() runs automatically on first fetch.
  // startAndWaitForPorts() ensures the agent-server is ready.
  return container.fetch(new Request(`https://container${path}`, init))
}

private async waitForContainerHealthy(maxWaitMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await this.containerFetch('/health')
      if (res.ok) return
    } catch { /* container starting up */ }
    await scheduler.wait(1000) // DO-safe wait
  }
  throw new Error('Container failed to become healthy within 30s')
}
```

### 5.2 containerRole Implementation

```typescript
private containerRole(role: 'coder' | 'tester') {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    const { provider, model: modelId } = resolve(role)

    // Workspace prep: first Coder call or resample
    if (role === 'coder' && (!state.workspaceReady || state.verdict?.decision === 'resample')) {
      const repo = (state.workGraph as any).repo
      const wsRes = await this.containerFetch('/workspace', {
        repoUrl: repo.url, ref: repo.ref, branch: repo.branch,
        installCmd: 'pnpm install --frozen-lockfile',
      })
      if (!wsRes.ok) throw new Error(`Workspace prep failed: ${await wsRes.text()}`)
    }

    // Call role endpoint. NO apiKey in body.
    const res = await this.containerFetch(role === 'coder' ? '/coder' : '/tester', {
      provider, modelId,
      plan: state.plan, workGraph: state.workGraph, code: state.code,
      repairNotes: state.verdict?.decision === 'patch' ? state.verdict.notes : undefined,
      fileScope: (state.workGraph as any).fileScope,
      commandPolicy: (state.workGraph as any).commandPolicy,
    })
    if (!res.ok) throw new Error(`Container ${role} failed: ${await res.text()}`)

    const result = await res.json() as ContainerResult
    const output: Partial<GraphState> = {
      tokenUsage: state.tokenUsage + (result.tokenUsage ?? 0),
      roleHistory: [...state.roleHistory, {
        role, output: result.artifacts?.summary ?? result.testReport?.summary ?? 'complete',
        tokenUsage: result.tokenUsage ?? 0, timestamp: new Date().toISOString(),
      }],
    }
    if (role === 'coder') {
      output.code = { ...result.artifacts, toolCallCount: result.toolCalls }
      output.workspaceReady = true
    }
    if (role === 'tester') output.tests = result.testReport

    await this.persistState({ ...state, ...output } as GraphState, role)
    return output
  }
}
```

### 5.3 executionRole Dispatch (Three Tiers)

```typescript
private executionRole(role: 'coder' | 'tester') {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    // Tier 1: Dry-run (stub responses, zero cost)
    if (this.dryRun) {
      return this.dryRunRole(role)(state)
    }

    // Tier 2: Container (default -- real filesystem, real tests)
    try {
      return await this.containerRole(role)(state)
    } catch (err) {
      // Tier 3: piAiRole fallback (LLM JSON mode, no filesystem)
      console.warn(
        `Container ${role} failed: ${err instanceof Error ? err.message : err}. Falling back to piAiRole.`,
      )
      return await this.piAiRole(role)(state)
    }
  }
}

// Graph wiring:
graph.addNode('coder',  this.executionRole('coder'))
graph.addNode('tester', this.executionRole('tester'))
// Planner, Critic, Verifier stay as piAiRole() -- no change
```

**Dispatch order (v3, amended from ADR-003):**
1. **dryRun** -- stub responses, testing orchestration
2. **containerRole** -- pi SDK in Container, real filesystem (DEFAULT)
3. **piAiRole** -- LLM JSON mode, no filesystem (FALLBACK)

This inverts ADR-003's original assumption that pi SDK runs in the DO.
The Container is the default executor; piAiRole is the fallback.

### 5.4 Container Cleanup

```typescript
private async destroyContainer(): Promise<void> {
  try {
    await this.containerFetch('/cleanup')
  } catch { /* container may already be gone */ }
  this.containerName = null
}
```

Called at the end of `synthesize()` after any terminal verdict.

---

## 6. Wrangler Configuration

### 6.1 Updated wrangler.jsonc

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ff-pipeline",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat"],

  // Workflow definition
  "workflows": [
    {
      "name": "factory-pipeline",
      "binding": "FACTORY_PIPELINE",
      "class_name": "FactoryPipeline"
    }
  ],

  // Durable Objects (includes Container DO)
  "durable_objects": {
    "bindings": [
      { "name": "COORDINATOR", "class_name": "SynthesisCoordinator" },
      { "name": "FACTORY_AGENT", "class_name": "FactoryAgent" }
    ]
  },

  // Container definitions (ties FactoryAgent class to Docker image)
  "containers": [
    { "class_name": "FactoryAgent", "image": "./Dockerfile", "max_instances": 10 }
  ],

  // Migrations (Container DO needs its own migration tag)
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["SynthesisCoordinator"] },
    { "tag": "v2", "new_sqlite_classes": ["FactoryAgent"] }
  ],

  // Service Bindings
  "services": [
    { "binding": "GATES", "service": "ff-gates", "entrypoint": "GatesService" }
  ],

  // Queue bindings (Stage 6 synthesis bridge)
  "queues": {
    "producers": [{ "binding": "SYNTHESIS_QUEUE", "queue": "synthesis-queue" }],
    "consumers": [{ "queue": "synthesis-queue", "max_batch_size": 1, "max_retries": 2 }]
  },

  "vars": {
    "ENVIRONMENT": "production"
  }

  // Secrets (set via `wrangler secret put`):
  //   ARANGO_URL, ARANGO_DATABASE, ARANGO_JWT
  //   ANTHROPIC_API_KEY
  //   (optional: OPENAI_API_KEY, DEEPSEEK_API_KEY)
}
```

### 6.2 Key Configuration Points

- **`FACTORY_AGENT` binding:** Standard DO binding in the `durable_objects.bindings` array
- **`class_name: "FactoryAgent"`:** Maps to the exported `FactoryAgent extends Container` class
- **`containers` array:** Each entry has `class_name`, `image` (path to Dockerfile), and `max_instances`. CF builds and manages the container image.
- **Migration tag `v2`:** Required for the new DO class. Uses `new_sqlite_classes` (Container DOs use SQLite storage like other DOs).
- **`getContainer()` helper:** Imported from `@cloudflare/containers`. Resolves DO namespace + name into a callable container stub.
- **Secrets:** API keys set via `wrangler secret put` are available as `this.env.*` in the Container DO class and as `process.env.*` inside the container process

### 6.3 Worker Entry Point Export

```typescript
// workers/ff-pipeline/src/index.ts -- add export
export { FactoryAgent } from '../containers/factory-agent/src/container'
```

The FactoryAgent class must be exported from the Worker entry point for
Cloudflare to discover and instantiate it.

---

## 7. Container Lifecycle Across Repair Loop

```
First Coder turn:
  Coordinator DO calls getContainer(env.FACTORY_AGENT, name).fetch('/workspace')
    -> FactoryAgent.onStart() runs (first call triggers startAndWaitForPorts)
    -> Agent-server clones repo, installs deps
  Coordinator DO calls stub.fetch('/coder')
    -> Agent-server runs pi SDK Coder session
  Container stays alive (DO is still addressable)
       |
Critic (in Coordinator DO) -> reads CodeArtifact from GraphState
       |
Tester:
  Coordinator DO calls stub.fetch('/tester') -> SAME Container
    -> Agent-server runs pi SDK Tester session (same workspace)
  Container stays alive
       |
Verifier (in Coordinator DO) -> reads all outputs
       |
       +-- pass      -> stub.fetch('/cleanup') -> Container idle
       |
       +-- patch     -> Container stays alive
       |    stub.fetch('/coder') again with repairNotes
       |    Coder modifies existing files (same workspace)
       |    -> Critic -> Tester -> Verifier (repeat)
       |
       +-- resample  -> stub.fetch('/workspace') again (fresh clone)
       |    Same Container DO instance, new workspace contents
       |    -> Planner -> Coder -> Critic -> Tester -> Verifier
       |
       +-- interrupt -> stub.fetch('/cleanup') -> Container idle
       |
       +-- fail      -> stub.fetch('/cleanup') -> Container idle
```

Container uptime per synthesis:
- Minimum: ~2 min (single pass, no repairs)
- Maximum: ~15 min (5 repairs x 3 min per cycle)
- Cost: CF Container per-second billing

---

## 8. GraphState Additions

```typescript
interface GraphState {
  // ... existing Phase 4 fields ...

  // Phase 5 additions
  workspaceReady: boolean           // workspace prepared in Container
  executionMode: 'dry-run' | 'container' | 'piAiRole'  // which tier ran
  coderToolCalls?: number           // pi SDK tool calls in Coder session
  testerToolCalls?: number          // pi SDK tool calls in Tester session
  blockedToolCalls?: {              // tool calls blocked by policy gates
    role: string
    toolName: string
    reason: string
  }[]
}

interface CodeArtifact {
  // ... existing Phase 4 fields ...

  // Phase 5 additions
  diff?: string                     // real git diff (Container mode only)
  commitLog?: string                // real git commit log (Container mode only)
  toolCallCount?: number            // total pi SDK tool calls
}
```

---

## 9. Security Model

- **API keys:** Set via `wrangler secret put`. Available as `this.env.*` in Container DO class, `process.env.*` in container process. NEVER in request bodies. `getModel(provider, modelId)` reads from env implicitly.
- **File scope:** Enforced via `customTools` in `createAgentSession()`. Coordinator sends `fileScope`/`commandPolicy` in request body. Agent-server builds gated tools. Violations blocked pre-filesystem.
- **Network isolation:** Allow outbound to LLM APIs, github.com, npm registries. Deny all else.
- **Container lifetime:** Fresh DO instance per synthesis (deterministic ID from workGraphId). No cross-synthesis state. Cleaned up after terminal verdict.

---

## 10. Cost Model

Unchanged from v2.

| Phase | Duration | vCPU | Est. cost |
|---|---|---|---|
| Workspace prep (clone + install) | ~30s | 0.5 | ~$0.001 |
| Coder session | ~2 min | 0.5 | ~$0.003 |
| Tester session | ~1 min | 0.5 | ~$0.002 |
| Idle (waiting for Critic/Verifier in DO) | ~2 min | 0.5 | ~$0.003 |
| **Total per synthesis (no repairs)** | **~6 min** | | **~$0.009** |

At 50 Functions/month: ~$0.45/mo in Container compute. LLM inference
dominates (~$1.90/Function).

---

## 11. ADR-003 Amendment

### Original ADR-003 Claim

> "Default execution path is pi SDK, not Containers. The Coordinator DO's
> `executionRole()` method dispatches to `piSdkRole()` (default) or
> `containerRole()` (fallback)."

> "pi SDK gives Coder and Tester real filesystem access on the same
> substrate. Phase 4 = full automated synthesis without Containers."

### Why This Claim Is Not Viable

Pi SDK requires `child_process` (for bash tool), real filesystem access
(for read/write/edit tools), `node:os`, and bundles at ~15MB+. Durable
Objects are V8 isolates with none of these. Pi SDK cannot run inside a DO.
This was proven empirically (v1 spec review, 5 fatal blockers).

### Amended Claim

**Container is the default executor. piAiRole is the fallback.**

The three-tier dispatch becomes:

1. **dryRun:** Stub responses, zero cost (testing orchestration)
2. **containerRole:** Pi SDK in a CF Container DO (DEFAULT). Real
   filesystem, real tests, real git. The Container DO runs a Linux
   environment with full POSIX capabilities.
3. **piAiRole:** LLM produces JSON via pi-ai `complete()` in the
   Coordinator DO (FALLBACK). No filesystem. Phase 4 behavior.

The pi SDK substrate alignment benefits from ADR-003 SS3.1-3.5 still hold:
unified cost tracking, same `getModel()` routing, Factory-aware tool
gating. They just run inside a Container instead of inside the DO. The
architectural properties are preserved; only the execution location changes.

### What Survives From ADR-003 Unchanged

- Pi SDK is the default coding agent (not OpenHands, not Aider, not Claude Code)
- `getModel()` provides unified model routing across all roles
- Pi SDK's tool gating (via `customTools`) enforces Factory write-domain policy
- Container executors (OpenHands, Aider) remain available as specialty fallbacks
- Claude Code is dropped as a container executor
- Cross-role context continuity within the Container (Coder -> Tester share workspace)
- Session tree inspection for repair-loop debugging

### What Changes

| ADR-003 original | ADR-003 amended |
|---|---|
| Pi SDK runs in-process in the Coordinator DO | Pi SDK runs in a CF Container DO |
| `piSdkRole()` is default, `containerRole()` is fallback | `containerRole()` is default, `piAiRole()` is fallback |
| Phase 4 = full synthesis (pi in DO) | Phase 4 = LLM JSON mode (no filesystem) |
| Phase 5 = optional Container fallback | Phase 5 = pi SDK in Container (required for real code) |
| Zero container overhead for common case | ~$0.009/synthesis container overhead |

---

## 12. Verification Plan

### 12.1 Local (Pre-deploy)

1. Build Container image: `docker build -t factory-agent:latest -f containers/factory-agent/Dockerfile .`
2. Run locally: `docker run -p 8080:8080 -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY factory-agent:latest`
3. Test all endpoints manually: `/health`, `/workspace`, `/coder`, `/tester`, `/collect`
4. Verify `createAgentSession()` works inside the container
5. Verify `session.prompt()` executes and events stream via `session.subscribe()`
6. Verify `getModel('anthropic', 'claude-sonnet-4-5')` reads key from `process.env`
7. Verify tool gating blocks writes outside fileScope

### 12.2 Cloudflare Integration

1. Deploy with Container DO binding in wrangler.jsonc
2. Verify `FactoryAgent` class is recognized (check wrangler deploy output)
3. Run dry-run synthesis (Container skipped -- Phase 4 parity, no regressions)
4. Run live synthesis with simple Signal (Container starts, Coder produces code)
5. Verify DO-to-DO call works: Coordinator DO -> FactoryAgent Container DO

### 12.3 First Live Test

Same signal as v2: `"Add GET /version to ff-pipeline that returns { name, version, phase }."`
Expected: Container starts, Coder clones repo, adds endpoint, commits.
Tester runs tests. Real git diff in ArangoDB. Factory modifying itself
through a real filesystem for the first time.

---

## 13. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| CF Container DO API surface not yet GA or changes | High | Pin to known-working wrangler version. Test against staging before production. Build behind feature flag. |
| Container cold start too slow | Medium | Container stays alive across Coder -> Tester. Cold start once per synthesis. `startAndWaitForPorts()` is optimized by CF runtime. |
| `session.prompt()` + `subscribe()` event model mismatch | Medium | Build + test Container image locally before deploying. Pin pi-coding-agent@0.70.2. Write integration test for event collection. |
| DO-to-DO call from Coordinator to Container times out | Medium | Set DO alarm as wall-clock deadline (existing pattern). Container has /health endpoint for liveness check. |
| Container image too large for CF | Low | ~240MB is well within limits. Monitor via wrangler deploy output. |
| `customTools` API shape incorrect | Medium | Verify against pi SDK source. Build unit test that creates session with customTools. Run locally before deploy. |
| API keys not propagated to container process.env | Medium | Test locally with `docker run -e KEY=value`. Verify in /health response (hash of key presence, not key value). |
| Git clone auth fails inside Container | Medium | Use GitHub App installation token per SDLC-ARCHITECTURE SS4.11. Short-lived, scoped. |
| piAiRole fallback never tested because Container always works | Low | Periodic dry-run-then-piAiRole test in CI. Keep piAiRole path exercised. |

---

## 14. What Phase 5 Does NOT Do

- **Does not add OpenHands/Aider fallback containers.** That is Phase 5b.
- **Does not push to GitHub.** Stage 8 (PR creation) is Phase 7.
- **Does not change Planner, Critic, or Verifier.** They stay as piAiRole() in the DO.
- **Does not change the pipeline Workflow.** `stage-6-synthesis` still calls `coordinator.synthesize()`.
- **Does not change the API surface.** No new gateway routes.
- **Does not change the Queue bridge pattern.** Workflow -> Queue -> Consumer -> DO is unchanged.

---

## 15. Migration Steps

| Step | What | Reversible? |
|---|---|---|
| 1 | Create `containers/factory-agent/` directory with Dockerfile + agent-server | N/A (additive) |
| 2 | Build Container image locally, test all endpoints | N/A |
| 3 | Add `FactoryAgent extends Container` class | N/A (additive) |
| 4 | Add DO binding + migration + containers config to wrangler.jsonc | Yes (remove entries) |
| 5 | Export `FactoryAgent` from Worker entry point | Yes (remove export) |
| 6 | Add `containerRole()` + `executionRole()` to Coordinator DO | Yes (revert to piAiRole only) |
| 7 | Deploy ff-pipeline | Yes (redeploy previous version) |
| 8 | Dry-run test (Container skipped -- Phase 4 parity) | N/A |
| 9 | Live test with simple Signal | Yes (artifacts only) |
| 10 | Live test with Factory building itself | The bootstrap continues |

Every step reversible. Fallback to Phase 4 is automatic if Container
fails to start. Worst case: "Phase 5 doesn't work yet, Phase 4 still works."

---

## 16. Repo Structure Addition

```
containers/
  factory-agent/
    Dockerfile
    src/
      container.ts          <- FactoryAgent extends Container (DO class)
    agent-server/
      server.ts             <- HTTP interface (runs inside Linux container)
      workspace.ts          <- clone/collect/cleanup
      prompts.ts            <- Coder/Tester prompt builders
      tool-gates.ts         <- file scope + command policy via customTools
      package.json
```

---

## 17. Version Comparison (key deltas only)

| Concern | v1 | v2 | v3 |
|---|---|---|---|
| Pi SDK location | DO (fatal) | Container (correct) | Container DO (correct) |
| Container model | N/A | `.start({ image })` (wrong) | `extends Container` class (correct) |
| Container access | N/A | direct URL fetch (wrong) | `getContainer(env.FACTORY_AGENT, name).fetch()` (correct) |
| Session API | N/A | `session.send()` (wrong) | `session.prompt()` + `subscribe()` (correct) |
| Model API | N/A | `getModel(p,m,{apiKey})` (wrong) | `getModel(p,m)` keys from env (correct) |
| Wrangler | N/A | `containers: [{...}]` (wrong) | `containers` array + DO binding + `class_name` + migration (correct) |
