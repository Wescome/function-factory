# Flowchart: ksp-flue-workflow (.flue/workflows/atom-execution.ts)

> Source: SPEC-FF-JUSTBASH-001-004.md

---

## Main workflow: `run()` — top-level call flow

```mermaid
sequenceDiagram
    participant Caller as Orchestrator<br/>(Mediation Agent / DO hook)
    participant WF as atom-execution<br/>FlueWorkflow
    participant DO as CoordinatorDO
    participant BG as Bead Graph<br/>(getNextReady / hooks)
    participant FL as Flue Runtime<br/>(init / session / skill)
    participant SB as CF Sandbox<br/>(optional)
    participant R2 as R2 Bucket<br/>(SANDBOX_OUTPUT_BUCKET)

    Caller->>WF: POST /workflows/atom-execution<br/>{repoId, agentId, workGraphId, workGraphVersion, moleculeId}

    Note over WF: Derive runId = sha256(workGraphId+workGraphVersion)

    WF->>DO: POST /init {runId, repoId}
    DO-->>WF: 200 OK (idempotent — sets run context)

    WF->>BG: getNextReady(doStub, moleculeId)
    alt No ready bead
        BG-->>WF: null
        WF-->>Caller: { status: 'complete' }
    else Bead available
        BG-->>WF: bead {id, payload}
    end

    Note over WF: AtomDirective.safeParse(bead.payload)
    alt Parse failure
        WF->>DO: failHook(bead.id, agentId, {error: 'invalid-directive'})
        WF-->>Caller: { status: 'error', reason: 'invalid-directive' }
    end

    WF->>WF: executeWithRetry(directive, bead.id, ...)

    loop attempt 1..maxAttempts
        Note over WF: if attempt > 1: sleep(backoffMs)
        WF->>WF: runFlueSession(directive, ...)
        WF->>WF: evaluateSuccessCondition(...)
        Note over WF: outcome = 'timeout'|'success'|'failure'
        alt outcome === 'success'
            Note over WF: break loop, return trace
        else !isolatedRetry OR attempt >= maxAttempts
            Note over WF: break loop
        end
    end

    alt trace.outcome === 'success'
        WF->>DO: releaseHook(bead.id, agentId, trace)
    else
        WF->>DO: failHook(bead.id, agentId, trace)
    end

    WF-->>Caller: { status: 'executed', outcome: trace.outcome }
```

---

## `runFlueSession()` — Flue harness bridge points

```mermaid
sequenceDiagram
    participant WF as executeWithRetry
    participant FS as runFlueSession
    participant PR as PROFILE_BY_ROLE
    participant CA as createAgent()
    participant FL as ctx.init(agent)<br/>FlueHarness
    participant VFS as harness.fs
    participant SS as harness.session()<br/>FlueSession
    participant SK as session.skill()

    WF->>FS: runFlueSession(directive, agentId, workflowId, env, init)

    FS->>PR: PROFILE_BY_ROLE[directive.role]
    PR-->>FS: AgentProfile (planner/coder/critic/tester/verifier)

    Note over FS: needsContainer = permittedTools.includes('git')<br/>|| sandboxConfig.persistFilesystem

    alt needsContainer
        FS->>CA: createAgent with getSandbox(env.Sandbox, agentRunId)
        Note over CA: CF Container sandbox
    else
        FS->>CA: createAgent without sandbox field
        Note over CA: virtual sandbox (just-bash)
    end

    FS->>FL: init(agent)
    FL-->>FS: FlueHarness

    opt directive.envVars['AGENTS_MD'] exists
        FS->>VFS: harness.fs.writeFile('AGENTS.md', agentsMd)
    end

    FS->>SS: harness.session('atom-{directiveId}')
    SS-->>FS: FlueSession

    FS->>SK: Promise.race([<br/>  session.skill(directive.skillRef, { args: { instruction } }),<br/>  sleep(directive.timeoutMs)<br/>])

    alt skill responds in time
        SK-->>FS: response.text → stdout
    else timeout fires
        Note over FS: timedOut = true, stdout = ''
    else skill throws
        Note over FS: stdout = String(err)
    end

    FS-->>WF: { stdout, timedOut, durationMs, harness }
```

---

## `evaluateSuccessCondition()` — async dispatch

```mermaid
flowchart TD
    IN[evaluateSuccessCondition\ncondition, result, harness]
    T{condition.type}
    IN --> T

    T -- exit-code --> EC["!result.timedOut → bool"]
    T -- output-contains --> OC["result.stdout.includes\n(condition.substring) → bool"]
    T -- output-matches --> OM["new RegExp(condition.pattern)\n.test(result.stdout) → bool"]
    T -- file-exists --> FE["harness.shell('test -f {path} && echo exists')\ncheck stdout.trim() === 'exists'"]
    T -- composite --> CO["Promise.all(\n  condition.all.map(\n    c => evaluateSuccessCondition(c,...)\n  )\n).every(Boolean)"]
```

---

## stdout overflow path

```mermaid
flowchart LR
    OUT[result.stdout]
    LEN{length > 4096?}
    OUT --> LEN

    LEN -- no --> RAW["rawOutput = stdout\nsandboxOutputRef = undefined"]
    LEN -- yes --> TRUNC["rawOutput = stdout.slice(0,4096)"]
    TRUNC --> R2["storeFullOutput(stdout, directiveId, env)\n→ R2 key: sandbox-output/{directiveId}/{ts}.txt\n→ sandboxOutputRef = 'r2://...'"]
```

---

## Sandbox outbound injection (`@factory/gears/flue/sandbox.ts`)

```mermaid
flowchart TD
    REQ[Outbound Request from Sandbox]
    HOST{req.hostname}
    REQ --> HOST

    HOST -- api.anthropic.com --> A["inject(req, 'x-api-key', ANTHROPIC_API_KEY)"]
    HOST -- api.openai.com --> B["inject(req, 'Authorization', 'Bearer OPENAI_API_KEY')"]
    HOST -- api.deepseek.com --> C["inject(req, 'Authorization', 'Bearer DEEPSEEK_API_KEY')"]
    HOST -- api.github.com --> D["inject(req, 'Authorization', 'Bearer GITHUB_TOKEN')"]
    HOST -- other --> PASS[Pass through unchanged]
```
