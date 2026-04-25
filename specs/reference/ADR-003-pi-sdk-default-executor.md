# ADR-003: Pi SDK as Default Coder/Tester Executor

## Status

Proposed — requires architect review before DECISIONS.md entry

## Date

2026-04-24

## Lineage

DECISIONS.md (hybrid topology, pluggable binding modes), ADR-002
(execution fabric), DogFood session (pi-ai substrate, CEF validation),
pi-mono repository review, OpenClaw SDK integration reference.

---

## 1. Decision

Adopt `@mariozechner/pi-coding-agent` SDK as the **default executor** for
the Coder and Tester roles in Stage 6. Container-based executors (OpenHands,
Aider) become **fallbacks** for specialty cases (browser automation, Docker
sandboxing). Claude Code is dropped as a container executor — pi accesses
the same Claude models via pi-ai.

---

## 2. Context: What pi Is

Pi (`pi.dev`, `@mariozechner/pi-coding-agent`) is a terminal-based coding
agent built on `@mariozechner/pi-ai` — the same unified LLM API the Factory
already uses as its model substrate. It is the coding agent layer of the
pi-mono toolkit.

### Core capabilities

**Four built-in tools:** `read`, `write`, `edit`, `bash`. These give the
agent real filesystem access, file editing, and shell execution. The agent
loop handles the full orchestration: send prompt → model produces tool
calls → execute tools → feed results back → repeat until done.

**SDK mode:** `createAgentSession()` embeds a pi agent programmatically.
No CLI, no TUI — just an importable function that returns a session object.
The session exposes `prompt()`, `subscribe()` for event streaming, and full
control over model, tools, thinking level, and session persistence.
OpenClaw (the personal AI assistant) is the production proof: it embeds pi
via SDK to run coding agents inside Sandbox containers with custom tool
replacements.

**RPC mode:** JSON-over-stdin/stdout for process-level integration from
non-Node.js hosts. Strict LF-delimited JSONL framing. This is the
interface for Container-based execution when SDK embedding is not possible.

**Skills:** On-demand capability packages with instructions and tools.
Loaded when triggered, not pre-loaded into every prompt. Progressive
disclosure without busting the prompt cache. Factory-specific skills
(e.g., "emit JSON footer matching WorkGraph output contract", "run
invariant detector suite after file writes") can be authored as pi skills
and loaded at session creation.

**Extensions:** TypeScript modules that hook into the agent lifecycle.
Before messages are sent to the LLM, before compaction runs, when a tool
is called, when a session starts. Extensions operate behind the scenes —
the LLM never sees them. This is where the Factory enforces write-domain
policy: an extension can gate `write` and `edit` tool calls against the
WorkGraph's `fileScope` rules, rejecting unauthorized file modifications
before they reach the filesystem.

**AGENTS.md support:** Pi reads AGENTS.md from the working directory at
startup — the same convention the Factory already uses for harness loading.
A Factory-specific AGENTS.md in the workspace directory gives the pi agent
its project context without custom prompt engineering.

**Auto-compaction:** When the context approaches the model's window limit,
pi auto-summarizes older messages. The full message history stays in the
session file; only the in-memory context gets compacted. Customizable via
extensions (topic-based compaction, code-aware summaries, different
summarization models).

**Session tree:** Sessions are stored as trees. Every branch is preserved
in a single file. The Factory can inspect the full conversation tree after
execution, including abandoned branches from repair loops.

### Provider support

Pi inherits pi-ai's full provider registry: Anthropic, OpenAI, Google,
Azure, Bedrock, Mistral, Groq, Cerebras, xAI, Hugging Face, OpenRouter,
Ollama, vLLM, and any OpenAI-compatible endpoint. Mid-session model
switching via `session.setModel()` or the `/model` command. Custom
providers via `models.json` or extensions.

---

## 3. Why pi Is the Default, Not One of Three Equals

### 3.1 Substrate alignment

Pi is built on pi-ai. The Factory is built on pi-ai. This is not a
coincidence — it is the architectural reason pi exists as a choice.

When the Coordinator DO runs the Planner role via `pi-ai complete()`, and
then runs the Coder role via `pi-coding-agent createAgentSession()`, both
calls flow through the same model access layer:

```
Planner (structured reasoning)     Coder (code execution)
       │                                  │
  pi-ai complete()                pi-coding-agent session.prompt()
       │                                  │
       └──── same getModel() ─────────────┘
             same provider routing
             same cost tracking
             same session management
             same streaming
             same tool-call validation
```

With OpenHands/Aider/Claude Code in a container, the Coder's model calls
are invisible to the Factory. The container has its own API keys, its own
provider configuration, its own cost accounting. The DCE formula has a
blind spot for Coder costs.

With pi, every token is tracked through pi-ai's native cost tracking.
The DCE formula gets complete data across all five roles.

### 3.2 Unified routing

The task-routing `resolve('coder')` returns `{ provider, model }`.
With pi, this feeds directly into `getModel(provider, model)` which feeds
into `createAgentSession({ model })`. Same routing config, same model
selection logic, same fallback rules.

With container executors, the routing config is ignored — the container's
own model configuration takes precedence.

### 3.3 Factory-aware tool gating

Pi's extension system allows the Coordinator DO to inject policy
enforcement that runs behind the scenes, invisible to the model:

```typescript
const fileGateExtension = {
  name: 'factory-file-gate',
  beforeToolCall: async (toolCall, context) => {
    if (toolCall.name === 'write' || toolCall.name === 'edit') {
      const allowed = matchesFileScope(toolCall.args.path, workGraph.fileScope)
      if (!allowed) {
        return { blocked: true, reason: `Path ${toolCall.args.path} outside fileScope` }
      }
    }
  }
}
```

This is structural enforcement, not prompt-based. The model cannot
write outside the allowed paths regardless of what it decides to do.
With container executors, file scope enforcement is a post-hoc
validation step — the agent may have already written the file.

### 3.4 Cross-role context continuity

Pi-ai supports cross-provider context handoffs. The Planner's session
context can feed into the Coder's session without serialization loss.
The Coder's artifacts are available in-memory to the Critic without
fetching from ArangoDB. The repair loop (Verifier → Coder) can pass
the Verifier's notes directly into the Coder's session context.

With container executors, every role boundary is a
serialize-to-JSON → write-to-ArangoDB → fetch-from-ArangoDB →
deserialize-to-prompt round trip.

### 3.5 No container overhead for the common case

Most Functions don't need browser automation or Docker-level sandboxing.
They need: read files, write files, edit files, run tests, run linters.
Pi's four tools cover this. Running pi via SDK inside the Coordinator DO
eliminates container cold start, heartbeat overhead, lease management,
and artifact upload/download for the 80% case.

---

## 4. When Containers Are Still Needed

Pi becomes the default. Containers become the fallback for cases pi
cannot handle:

| Capability need              | Pi SDK  | Container (OpenHands) | Container (Aider) |
|------------------------------|---------|----------------------|-------------------|
| Read/write/edit files        | Yes     | Yes                  | Yes               |
| Run tests (bash)             | Yes     | Yes                  | Yes               |
| Run linters (bash)           | Yes     | Yes                  | Yes               |
| Git operations (bash)        | Yes     | Yes                  | Best              |
| Browser automation           | No      | Yes (built-in)       | No                |
| Docker-in-Docker sandbox     | No      | Yes                  | No                |
| Visual UI testing            | No      | Yes (headless Chrome) | No                |
| Strict network isolation     | Partial | Full (Docker network) | Partial           |
| Factory-aware tool gating    | Yes     | No                   | No                |
| Unified cost tracking        | Yes     | No                   | No                |
| Same-substrate routing       | Yes     | No                   | No                |

**Container triggers** (Planner decides):
- Task requires browser interaction → OpenHands
- Task requires Docker-level sandboxing (untrusted code) → OpenHands
- Task requires strict network deny-all enforcement → OpenHands
- Task is a narrow, git-native edit pattern → Aider (optional)
- Everything else → pi SDK (default)

---

## 5. Claude Code Disposition

Claude Code is dropped as a container executor. Rationale:

- Pi accesses the same Claude models (Opus 4.6, Sonnet 4.6) via pi-ai
- Pi's tool set (read/write/edit/bash) is functionally equivalent to
  Claude Code's tool set
- Claude Code is Anthropic-only; pi is multi-provider
- Claude Code has no SDK/embedding mode
- Claude Code as a container executor means the Factory pays for both
  container compute AND Anthropic API calls, with no cost visibility
  into the latter

Claude Code remains the **development governor** — the human-facing
harness the architect uses during development. It is not a container
executor in the deployed Factory.

---

## 6. Executor Selection Logic (Revised)

```
Planner output
    │
    ├─ needs browser?          → OpenHands (Container)
    ├─ needs Docker sandbox?   → OpenHands (Container)
    ├─ narrow git-native edit? → Aider (Container, optional)
    └─ everything else         → pi SDK (in-process, default)
```

---

## 7. Consequences

### Benefits

- **Unified cost tracking** across all five roles (Planner through Verifier)
- **Structural write-domain enforcement** via pi extensions (not post-hoc)
- **No container overhead** for the common case (~80% of executions)
- **Same routing config** (task-routing) for structured and execution roles
- **Cross-role context continuity** without serialization round-trips
- **Session tree inspection** for repair-loop debugging
- **Factory-specific skills** loadable at session creation
- **Fewer moving parts** (fewer containers, fewer API key configurations)

### Tradeoffs

- Pi runs in the Coordinator DO's Node.js environment, not in an isolated
  container. If the Coder produces and executes malicious code via bash,
  it runs in the DO's process. Mitigation: pi's extension-based tool
  gating + command allowlist enforcement + the Coordinator can restrict
  which bash commands are permitted.
- Pi's `bash` tool gives shell access. For self-hosted or untrusted
  workloads, container isolation may still be required. For the Factory's
  own bootstrap (where the Factory is building itself), pi's in-process
  execution is acceptable — the code under production is the Factory's own.
- Container fallback path (OpenHands) must remain functional even if rarely
  used. Integration testing must cover both paths.

### What is NOT changed

- pi-ai remains the model substrate (unchanged)
- LangGraph.js remains the Stage 6 graph coordinator (unchanged)
- ADR-002's Container execution fabric remains available as fallback
- ADR-002's lease/heartbeat/policy model applies to container fallback runs
- The five-role topology (Planner/Coder/Critic/Tester/Verifier) is unchanged
- The FunctionJob contract is unchanged (used for container fallback)

---

## 8. Implementation Impact

### Coordinator DO changes

The `containerRole()` method becomes `piSdkRole()` (default) with
`containerRole()` as fallback:

```typescript
graph.addNode('coder', this.executionRole('coder'))
graph.addNode('tester', this.executionRole('tester'))

private executionRole(role: 'coder' | 'tester') {
  return async (state: GraphState) => {
    if (this.needsContainer(state.plan)) {
      return this.containerRole(role)(state)
    }
    return this.piSdkRole(role)(state)
  }
}
```

### New dependency

`@mariozechner/pi-coding-agent` added as a dependency of the
`packages/compiler` package (where the Coordinator DO lives).

### Container image changes

- Claude Code container image: **removed**
- OpenHands container image: **retained** (fallback)
- Aider container image: **retained** (optional fallback)

---

## 9. Status

Proposed. Requires architect review. If accepted, produces a DECISIONS.md
entry and patches to FULL-DEPLOYMENT-ARCHITECTURE.md §§0, 1, 4, 5, 9,
10, 11, 13, 14.
