# Phase 5 v4 -- Hybrid Agents SDK + Sandbox Architecture

**Author:** Architect Agent for Wislet J. Celestin / Koales.ai
**Date:** 2026-04-26
**Status:** Spec v4 -- supersedes v3. Incorporates Agents SDK + Sandbox SDK.
**Lineage:** PHASE5-PI-SDK-SPEC-v3.md, PAI-TO-PI-AI-ARCHITECTURE.md,
PIPELINE-SEMANTIC-GROUNDING.md, ADR-003 (pi SDK default executor, amended
in v3, further amended herein), DECISIONS.md (2026-04-24: Stage 6 topology
is hybrid with pluggable binding modes; semantic-alignment via Critic role;
crystallization-from-execution; PiAgentBindingMode authorized).

---

## Amendment Log

| Version | Date | Summary |
|---|---|---|
| v4.0 | 2026-04-26 | Initial v4 spec (Agents SDK + Sandbox topology) |
| v4.1 | 2026-04-26 | GDK substrate amendment. ADR: DECISIONS.md 2026-04-26. Analysis: GDK-PLATFORM-ANALYSIS.md |

**v4.1 changes (GDK substrate):**

- SS0: "What is PRESERVED" table amended -- ofox.ai routing replaced by gdk-ai, tool gating via `beforeToolCall` hooks
- SS2.3: model-bridge-do.ts replaced by `@weops/gdk-ai` `getModel()` + `streamSimple()`/`complete()`
- SS3.1: ArchitectAgent model calls use gdk-ai directly
- SS5.5: Sandbox sessions use `@weops/gdk-agent` `agentLoop()` + `@weops/gdk-ts` `buildCoreTools()` instead of pi-coding-agent `createAgentSession()`
- SS10: Dockerfile installs `@weops/gdk-agent` + `@weops/gdk-ai` + `@weops/gdk-ts` instead of `@mariozechner/pi-coding-agent`
- SS12: File scope gate and command policy gate become `beforeToolCall` implementations
- SS18: New section -- GDK Substrate Integration

---

## 0. What Changed From v3

| Concern | v3 | v4 (this spec) |
|---|---|---|
| Coordinator DO | `extends DurableObject` | `extends Agent` (`agents` SDK) |
| Container access | `getContainer(env.FACTORY_AGENT, name).fetch()` | `getSandbox(env.SANDBOX, name, opts)` |
| Container API | `@cloudflare/containers` Container class | `@cloudflare/sandbox` Sandbox class |
| Architect role | pi SDK session in Container DO | `extends Agent` (Agents SDK), no Container |
| Critic role | `callModel()` in Coordinator DO | `extends Agent` (Agents SDK), no Container |
| Coder/Tester execution | Custom agent-server on port 8080 | `sandbox.exec()`, `sandbox.writeFile()`, pi SDK inside Sandbox |
| Container class | `FactoryAgent extends Container` | `Sandbox` from `@cloudflare/sandbox` (managed) |
| Workspace persistence | None (ephemeral per Container DO) | R2 backup via `sandbox.createBackup()` / `sandbox.restoreBackup()` |
| Inter-DO communication | `getContainer().fetch()` proxy to agent-server | `sandbox.exec()` direct command, `sandbox.containerFetch()` for HTTP |
| Wrangler config | `@cloudflare/containers` import, Container class export | `@cloudflare/sandbox` binding, Sandbox class declaration |
| Dockerfile | Custom with agent-server | Standard Node.js + pi SDK + git (no custom HTTP server) |

**What is PRESERVED from v3 unchanged:**

- `graph-runner.ts` (StateGraph orchestration logic)
- Queue bridge (Workflow -> Queue -> Consumer -> Coordinator DO)
- CRP flow (custom business logic, not Agents SDK tool approval)
- ~~ofox.ai routing (called from inside Agent methods via model-bridge)~~ (amended v4.1 -- GDK substrate): replaced by `@weops/gdk-ai` `getModel()` + `streamSimple()`/`complete()`
- Planner/Verifier stay inline in Coordinator graph nodes
- Three-tier dispatch: dry-run / sandbox / piAiRole fallback
- Repair loop lifecycle: patch = keep workspace, resample = fresh
- Cost model structure (~$0.009/synthesis base)
- Security model (keys in env vars, ephemeral sandboxes)
- ~~Tool gating via pi SDK `customTools`~~ (amended v4.1 -- GDK substrate): tool gating via `@weops/gdk-agent` `beforeToolCall`/`afterToolCall` hooks

---

## 1. Architecture Diagram

```
CF Workflow (FactoryPipeline)
  |
  +-> CF Queue (synthesis-queue, enqueue + waitForEvent)
        |
        +-> Queue Consumer (fresh Worker context)
              |
              +-> SynthesisCoordinator (extends Agent, Agents SDK)
                    |
                    +-- Planner:  inline piAiRole (callModel in Coordinator)
                    +-- Verifier: inline piAiRole (callModel in Coordinator)
                    |
                    +-- ArchitectAgent (extends Agent, Agents SDK)
                    |     Reads codebase context (pre-loaded snapshots)
                    |     Produces BriefingScript
                    |     No Container/Sandbox needed
                    |
                    +-- CriticAgent (extends Agent, Agents SDK)
                    |     Semantic review (post-Architect, pre-compile)
                    |     Code review (post-Coder)
                    |     No Container/Sandbox needed
                    |
                    +-- Sandbox (@cloudflare/sandbox)
                          Coder: gdk-agent session with write tools (amended v4.1)
                          Tester: gdk-agent session with bash/read tools (amended v4.1)
                          Shared workspace (real filesystem)
                          R2 backup for repair loops
```

**Key architectural property:** The Coordinator Agent calls Architect and
Critic Agents via `@callable()` methods (Agents SDK RPC). The Coordinator
calls the Sandbox via `getSandbox()` from `@cloudflare/sandbox`. All three
paths are DO-to-DO calls OUTSIDE Workflow steps. The Workflow->DO deadlock
only applies inside `step.do()`.

---

## 2. Coordinator Agent (`extends Agent`)

The Coordinator transitions from `extends DurableObject` to `extends Agent`
from the `agents` npm package. The Agent base class provides built-in state
management, callable methods, and lifecycle hooks. The StateGraph orchestration
remains inside the Agent.

### 2.1 Class Definition

```typescript
// workers/ff-pipeline/src/coordinator/coordinator.ts
import { Agent, callable } from "agents";
import { createClientFromEnv, type ArangoClient } from "@factory/arango-client";
import { buildSynthesisGraph } from "./graph";
import type { GraphDeps } from "./graph";
import { createModelBridge } from "./model-bridge-do";
import { createInitialState, type GraphState, type Verdict } from "./state";
import { getSandbox } from "@cloudflare/sandbox";

export interface CoordinatorEnv {
  ARANGO_URL: string;
  ARANGO_DATABASE: string;
  ARANGO_JWT: string;
  ARANGO_USERNAME?: string;
  ARANGO_PASSWORD?: string;
  OFOX_API_KEY?: string;
  SANDBOX: DurableObjectNamespace;       // Sandbox DO binding
  ARCHITECT: DurableObjectNamespace;     // ArchitectAgent DO binding
  CRITIC: DurableObjectNamespace;        // CriticAgent DO binding
  WORKSPACE_BUCKET: R2Bucket;           // R2 for workspace backups
}

export class SynthesisCoordinator extends Agent<CoordinatorEnv> {
  private db: ArangoClient | null = null;

  private getDb(): ArangoClient {
    if (!this.db) {
      this.db = createClientFromEnv(this.env);
    }
    return this.db;
  }

  // Agents SDK: callable from external Workers / other DOs
  @callable()
  async synthesize(
    workGraph: Record<string, unknown>,
    opts?: { dryRun?: boolean },
  ): Promise<SynthesisResult> {
    // ... graph construction + run logic preserved from v3 ...
    // See SS2.2 for graph changes
  }

  // Agents SDK: callable for CRP resolution from gateway
  @callable()
  async resolveCrp(
    crpId: string,
    resolution: { decision: string; rationale: string },
  ): Promise<void> {
    // Persist VCR, resume waitForEvent if blocking
  }
}
```

### 2.2 What Changes Inside the Coordinator

The `synthesize()` method keeps its exact structure: create initial state,
build graph, run graph, persist result. What changes:

1. **`extends Agent` instead of `extends DurableObject`.** Agent provides
   `this.state` (reactive state management) and `@callable()` for RPC.
   The `fetch()` handler is replaced by `@callable()` methods.

2. **Graph deps gain sandbox and agent references.** `GraphDeps` adds
   `getSandbox`, `callArchitect`, and `callCritic` alongside the existing
   `callModel`, `persistState`, and `fetchMentorRules`.

3. **`this.state` replaces `this.ctx.storage`.** Agent state is reactive
   and automatically persisted. GraphState is stored as `this.state.graphState`.

4. **Alarm mechanism preserved.** `Agent` extends `DurableObject` under the
   hood. DO Alarms remain available for wall-clock timeout.

### 2.3 What Does NOT Change (amended v4.1 -- GDK substrate)

- `graph-runner.ts` -- zero changes. The StateGraph class is framework-agnostic.
- `contracts.ts` -- zero changes. ROLE_CONTRACTS stay as typed objects.
- ~~`model-bridge-do.ts` -- zero changes. ofox.ai routing stays internal.~~ **v4.1:** `model-bridge-do.ts` is replaced by a thin wrapper over `@weops/gdk-ai`. The bridge calls `getModel(provider, modelId)` for model resolution and `complete(model, context, options)` or `streamSimple(model, context, options)` for inference. The wrapper maps Factory role contracts to gdk-ai `Context` (systemPrompt + messages + tools). See SS18 for API signatures.
- `buildRoleMessage()` -- zero changes. Message assembly is state-driven.
- Planner and Verifier nodes -- stay as inline graph nodes calling gdk-ai `complete()`. These roles need no filesystem, no Container, no Agent. They are structured JSON producers.

---

## 3. Architect Agent (`extends Agent`)

The Architect Agent replaces pipeline Stages 2-4 (the telephone game of
Signal -> Pressure -> Capability -> FunctionProposal) with a single agent
that has full context.

### 3.1 Class Definition

```typescript
// workers/ff-pipeline/src/agents/architect-agent.ts
import { Agent, callable } from "agents";

interface ArchitectEnv {
  ARANGO_URL: string;
  ARANGO_DATABASE: string;
  ARANGO_JWT: string;
  OFOX_API_KEY?: string;
}

// (amended v4.1 — GDK substrate): model calls use @weops/gdk-ai
import { getModel, complete } from "@weops/gdk-ai";

export class ArchitectAgent extends Agent<ArchitectEnv> {
  @callable()
  async produceBriefingScript(input: {
    signal: { title: string; description: string; specContent?: string };
    memoryDigest: string;      // DECISIONS + LESSONS + MentorRules
    codebaseSnapshot?: string; // Pre-loaded relevant files
    skillContent: string;      // Role-scoped skills
  }): Promise<BriefingScript> {
    const model = getModel("anthropic", "claude-sonnet-4-5");
    const context = { systemPrompt: this.buildSystemPrompt(input), messages: [...] };
    const result = await complete(model, context);
    return this.parseBriefingScript(result);
  }
}
```

### 3.2 Why Agent, Not Sandbox

The Architect reads context and produces structured output (BriefingScript).
It does NOT:
- Write files to a filesystem
- Execute shell commands
- Run tests
- Modify a git repository

The Architect needs: LLM access, ArangoDB access (for memory digest), and
pre-loaded codebase snapshots (passed as string content by the Coordinator).
All of these are available in a V8 isolate. A Sandbox/Container would waste
compute on an idle Linux environment.

### 3.3 BriefingScript Output

The Architect produces a BriefingScript (per PIPELINE-SEMANTIC-GROUNDING
and PAI-TO-PI-AI-ARCHITECTURE SS4) with:

- Goal and Why
- What and Success Criteria
- Architectural Context (loaded DECISIONS, relevant codebase files, constraints)
- Strategic Advice (approach, patterns, anti-patterns from LESSONS.md)
- Known Gotchas (platform-specific warnings)
- Validation Loop (test strategy)
- Derived lineage artifacts (Pressure, Capability, PRD) extracted from content

Lineage artifacts are persisted to ArangoDB with `derivationMode: "architect-extracted"`.

### 3.4 Context Loading

The Coordinator assembles context BEFORE calling the Architect:

1. Fetch memory digest from ArangoDB (DECISIONS last 20, LESSONS full, active MentorRules)
2. Load role-scoped skills from ArangoDB `agent_skills` collection
3. If specContent present: resolve via `resolveSpecContent()` (inline, arango:, or file:)
4. If codebase context needed: read relevant files from R2 or git snapshot

Context is passed as string parameters to `produceBriefingScript()`.
The Architect Agent itself makes no filesystem calls.

---

## 4. Critic Agent (`extends Agent`)

The Critic Agent performs two review types at different graph positions:
semantic review (post-Architect, pre-compile) and code review (post-Coder).

### 4.1 Class Definition

```typescript
// workers/ff-pipeline/src/agents/critic-agent.ts
import { Agent, callable } from "agents";

interface CriticEnv {
  ARANGO_URL: string;
  ARANGO_DATABASE: string;
  ARANGO_JWT: string;
  OFOX_API_KEY?: string;
}

export class CriticAgent extends Agent<CriticEnv> {
  @callable()
  async semanticReview(input: {
    briefingScript: BriefingScript;
    specContent: string | null;      // Ground truth
    memoryDigest: string;
    mentorRules: { ruleId: string; rule: string }[];
  }): Promise<SemanticReviewResult> {
    // Verdict: aligned | miscast | uncertain
    // Citations to specContent passages
    // MentorRule compliance check
  }

  @callable()
  async codeReview(input: {
    code: CodeArtifact;
    plan: Plan;
    workGraph: Record<string, unknown>;
    mentorRules: { ruleId: string; rule: string }[];
  }): Promise<CritiqueReport> {
    // Standard critique: passed, issues, mentorRuleCompliance
  }
}
```

### 4.2 Why Agent, Not Sandbox

Same reasoning as the Architect. The Critic reads artifacts and produces
structured verdicts. It does not touch a filesystem. All inputs arrive as
structured data from the Coordinator. LLM calls go through the model bridge.

### 4.3 Dual Review Positions

The Critic runs at two positions in the graph:

1. **Semantic review** (after `architect` node, before `compile`):
   Compares BriefingScript against specContent ground truth.
   Verdict: `aligned` -> continue, `miscast` -> END, `uncertain` -> continue with flag.

2. **Code review** (after `coder` node, before `tester`):
   Standard code review against WorkGraph specification and MentorRules.
   Output: CritiqueReport (existing contract, unchanged from v3).

---

## 5. Sandbox Container (Coder + Tester)

The Coder and Tester roles run inside a `@cloudflare/sandbox` container.
This replaces the custom `FactoryAgent extends Container` from v3 with the
managed Sandbox SDK.

### 5.1 Sandbox Lifecycle

```typescript
// In Coordinator graph node for 'coder'
import { getSandbox } from "@cloudflare/sandbox";

const sandbox = getSandbox(this.env.SANDBOX, `synth-${state.workGraphId}`, {
  // Options if needed
});

// Prepare workspace
await sandbox.writeFile("/workspace/setup.sh", setupScript);
await sandbox.exec("chmod +x /workspace/setup.sh && /workspace/setup.sh");

// Run Coder session
await sandbox.writeFile("/workspace/coder-prompt.json", JSON.stringify(coderInput));
await sandbox.exec("node /factory/run-coder.js");

// Collect results
const result = await sandbox.exec("cat /workspace/output.json");
const codeArtifact = JSON.parse(result.stdout);
```

### 5.2 Sandbox API Usage

The Sandbox SDK provides direct methods -- no custom HTTP server needed:

```typescript
// Execute commands
const { stdout, stderr, exitCode } = await sandbox.exec("git clone ...");

// Write files into the sandbox
await sandbox.writeFile("/workspace/prompt.txt", promptContent);

// Start long-running process (pi SDK agent-server)
await sandbox.startProcess("node /factory/agent-server.js", { env: { ... } });

// HTTP calls to processes inside the sandbox
const response = await sandbox.containerFetch(
  new Request("http://localhost:8080/coder", { method: "POST", body: ... }),
  8080,
);

// Backup workspace to R2
const handle = await sandbox.createBackup({ dir: "/workspace", ttl: 3600 });

// Restore from backup (for repair loops)
await sandbox.restoreBackup(handle);

// Cleanup
await sandbox.destroy();
```

### 5.3 Two Execution Strategies

**Strategy A: Direct exec (simpler, preferred for v1)**

The Coordinator writes prompts as files, runs pi SDK CLI inside the sandbox,
and reads results. No HTTP server needed.

```typescript
// Write the coder prompt
await sandbox.writeFile("/workspace/coder-input.json", JSON.stringify({
  provider: "anthropic",
  modelId: "claude-sonnet-4-5",
  plan: state.plan,
  workGraph: state.workGraph,
  fileScope: state.workGraph.fileScope,
}));

// Run the coder session script
const coderResult = await sandbox.exec(
  "node /factory/run-session.js coder /workspace/coder-input.json",
);

// Read output
const output = await sandbox.exec("cat /workspace/coder-output.json");
```

**Strategy B: Agent-server via containerFetch (v3 pattern, for complex flows)**

Start the agent-server as a process, call it via `sandbox.containerFetch()`.
This preserves the v3 agent-server pattern if session management complexity
warrants it.

```typescript
await sandbox.startProcess("node /factory/agent-server.js", {
  env: { ANTHROPIC_API_KEY: "..." },
});

const res = await sandbox.containerFetch(
  new Request("http://localhost:8080/coder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(coderPayload),
  }),
  8080,
);
```

### 5.4 Coder + Tester Shared Workspace

Coder and Tester share the same Sandbox instance. The Tester runs against
the Coder's workspace -- same filesystem, same git state, same installed
dependencies. This is architecturally identical to v3 SS7 (Container reuse
across Coder -> Tester).

```
Sandbox lifecycle:
  1. sandbox = getSandbox(env.SANDBOX, name)
  2. Workspace prep: git clone, pnpm install
  3. Coder session: gdk-agent Agent with write tools (amended v4.1)
  4. Code-Critic review (CriticAgent, no sandbox needed)
  5. Tester session: gdk-agent Agent with bash/read tools, same sandbox (amended v4.1)
  6. Verifier decision (Coordinator, no sandbox needed)
     +-- pass      -> sandbox.destroy()
     +-- patch     -> sandbox stays alive, Coder runs again
     +-- resample  -> sandbox.restoreBackup(freshHandle) or sandbox.destroy() + new
     +-- interrupt -> sandbox.destroy()
     +-- fail      -> sandbox.destroy()
```

### 5.5 GDK Agent Loop Inside the Sandbox (amended v4.1 -- GDK substrate)

The `@weops/gdk-agent` agent loop runs inside the sandbox's Linux environment
with full POSIX capabilities. This replaces `@mariozechner/pi-coding-agent`
`createAgentSession()` with `agentLoop()` + `Agent` class from gdk-agent,
using `@weops/gdk-ts` `buildCoreTools()` for file_read/file_write/bash_execute/grep_search:

```typescript
// Inside /factory/run-session.js (runs in sandbox)
import { Agent } from "@weops/gdk-agent";
import { getModel } from "@weops/gdk-ai";
import { buildCoreTools } from "@weops/gdk-ts/tools/core-tools";

const model = getModel("anthropic", "claude-sonnet-4-5");
const tools = buildCoreTools({ workDir: "/workspace" });

const agent = new Agent({
  systemPrompt: roleSystemPrompt,
  model,
  tools,
  beforeToolCall: fileScopeGate,   // see SS12 for gate impl
  afterToolCall: evidenceCapture,
});

agent.subscribe((event) => { /* stream AgentEvents */ });
await agent.prompt(objectiveText);
await agent.waitForIdle();
```

The `Agent` class provides: `prompt()`, `subscribe()`, `abort()`,
`waitForIdle()`, and `steer()` for mid-run injection. The `agentLoop()`
function (used internally by `Agent`) implements the loop: prompt -> model
response -> tool calls (parallel by default) -> tool results -> repeat.
`beforeToolCall`/`afterToolCall` hooks gate every tool call (see SS12, SS18).

---

## 6. R2 Workspace Persistence

### 6.1 Backup on First Workspace Prep

After the initial workspace setup (clone + install), the Coordinator creates
a backup. This serves as the "clean" restore point for `resample` verdicts.

```typescript
// After workspace prep in sandbox
const freshBackup = await sandbox.createBackup({
  dir: "/workspace",
  ttl: 7200,  // 2 hours, covers max synthesis duration
});
state.freshBackupHandle = freshBackup;
```

### 6.2 Backup After Each Coder Pass

After each Coder session, create a backup before the Tester runs.
This enables `patch` verdicts to restore to post-Coder state if the
Tester corrupts the workspace.

```typescript
const coderBackup = await sandbox.createBackup({
  dir: "/workspace",
  ttl: 3600,
});
state.coderBackupHandle = coderBackup;
```

### 6.3 Restore Strategies

| Verdict | Restore Strategy |
|---|---|
| `patch` | Keep workspace as-is. Coder receives repair notes. |
| `resample` | `sandbox.restoreBackup(state.freshBackupHandle)` -- reset to post-install |
| `pass` | `sandbox.destroy()` -- workspace no longer needed |
| `fail` | Backup final state for debugging, then `sandbox.destroy()` |
| `interrupt` | Same as fail |

### 6.4 R2 Bucket Configuration

```jsonc
"r2_buckets": [{ "binding": "WORKSPACE_BUCKET", "bucket_name": "ff-workspaces" }]
```

Backups are automatically stored in R2 by the Sandbox SDK. TTL-based
expiration prevents unbounded storage growth.

---

## 7. Context Loading Protocol

### 7.1 Memory Digest Assembly

The Coordinator assembles a memory digest once per synthesis run:

```typescript
async function buildMemoryDigest(db: ArangoClient, workGraphId: string): Promise<string> {
  // 1. DECISIONS: last 20 entries + lineage-relevant entries
  const decisions = await db.query<{ date: string; summary: string }>(
    `FOR d IN memory_semantic
       FILTER d.layer == 'decisions'
       SORT d.date DESC
       LIMIT 20
       RETURN { date: d.date, summary: d.summary }`
  );

  // 2. LESSONS: full content (small, <2KB)
  const lessons = await db.query<{ content: string }>(
    `FOR l IN memory_semantic
       FILTER l.layer == 'lessons'
       RETURN { content: l.content }`
  );

  // 3. Active MentorScript rules
  const mentorRules = await db.query<{ ruleId: string; rule: string }>(
    `FOR r IN mentorscript_rules
       FILTER r.status == 'active'
       RETURN { ruleId: r._key, rule: r.rule }`
  );

  // 4. Recent episodic events for this lineage chain
  const episodes = await db.query<{ action: string; detail: string }>(
    `FOR e IN memory_episodic
       FILTER e.functionId == @id
       SORT e.timestamp DESC
       LIMIT 10
       RETURN { action: e.action, detail: e.detail }`,
    { id: workGraphId },
  );

  // Serialize as single string block, target <4K tokens
  return formatDigest({ decisions, lessons, mentorRules, episodes });
}
```

### 7.2 Context Size Budget

| Component | Estimated Tokens | Cacheable? |
|---|---|---|
| Role identity (system prompt) | 200-500 | Yes (static per role) |
| Memory digest (DECISIONS + LESSONS) | 2,000-4,000 | Yes (per synthesis run) |
| Skills (role-scoped) | 1,000-3,000 | Yes (per synthesis run) |
| MentorScript rules | 500-1,500 | Yes (per synthesis run) |
| specContent (Architect only) | 1,000-5,000 | No (varies per Signal) |
| WorkGraph + BriefingScript | 2,000-5,000 | No (varies per task) |
| **Total per session** | **7,000-19,000** | |

### 7.3 Skill Loading

```typescript
const ROLE_SKILL_MAP: Record<string, string[]> = {
  architect: ["factory-meta", "lineage-preservation", "prd-compiler"],
  planner:   ["factory-meta"],
  coder:     ["lineage-preservation"],
  critic:    ["coverage-gate-1", "lineage-preservation", "prd-compiler"],
  tester:    [],
  verifier:  ["factory-meta"],
};

async function loadSkills(db: ArangoClient, role: string): Promise<string> {
  const skillNames = ROLE_SKILL_MAP[role] ?? [];
  const skills = await db.query<{ name: string; content: string }>(
    `FOR s IN agent_skills
       FILTER s.name IN @names
       RETURN { name: s.name, content: s.content }`,
    { names: skillNames },
  );
  return skills.map(s => `### Skill: ${s.name}\n${s.content}`).join("\n\n");
}
```

---

## 8. Graph Topology

### 8.1 Extended Graph

The synthesis graph extends from the current 5-node topology to a 9-node
topology with the Architect and dual-Critic positions:

```
budget-check -> architect -> semantic-critic -> compile -> gate-1
  -> planner -> coder -> code-critic -> tester -> verifier -> [routing]
```

### 8.2 Node Implementations

| Node | Implementation | Location |
|---|---|---|
| `budget-check` | Inline (existing) | Coordinator graph node |
| `architect` | `ArchitectAgent.produceBriefingScript()` | Agents SDK Agent |
| `semantic-critic` | `CriticAgent.semanticReview()` | Agents SDK Agent |
| `compile` | Deterministic compiler passes | Coordinator graph node |
| `gate-1` | `evaluateGate1()` deterministic | Coordinator graph node |
| `planner` | gdk-ai `complete()` via model bridge | Coordinator graph node (existing, amended v4.1) |
| `coder` | gdk-agent `Agent` session in Sandbox | `@cloudflare/sandbox` (amended v4.1) |
| `code-critic` | `CriticAgent.codeReview()` | Agents SDK Agent |
| `tester` | gdk-agent `Agent` session in Sandbox | `@cloudflare/sandbox` (amended v4.1) |
| `verifier` | gdk-ai `complete()` via model bridge | Coordinator graph node (existing, amended v4.1) |

### 8.3 Graph Wiring

```typescript
export function buildSynthesisGraph(deps: GraphDeps): StateGraph<GraphState> {
  const graph = new StateGraph<GraphState>();

  // Existing nodes (unchanged)
  graph.addNode("budget-check", budgetCheckNode);
  graph.addNode("planner",  deps.piAiRole("planner"));
  graph.addNode("verifier", deps.piAiRole("verifier"));

  // New nodes (v4)
  graph.addNode("architect",       deps.architectNode());
  graph.addNode("semantic-critic", deps.semanticCriticNode());
  graph.addNode("compile",         deps.compileNode());
  graph.addNode("gate-1",          deps.gate1Node());
  graph.addNode("coder",           deps.sandboxRole("coder"));
  graph.addNode("code-critic",     deps.codeCriticNode());
  graph.addNode("tester",          deps.sandboxRole("tester"));

  // Entry
  graph.setEntryPoint("budget-check");

  // New front-matter edges
  graph.addEdge("architect", "semantic-critic");
  graph.addEdge("compile", "gate-1");
  graph.addEdge("planner", "coder");
  graph.addEdge("coder", "code-critic");
  graph.addEdge("code-critic", "tester");
  graph.addEdge("tester", "verifier");

  // Conditional: budget-check routes to architect (first pass) or planner (repair)
  graph.addConditionalEdge("budget-check", (state) => {
    if (state.verdict?.decision === "fail" || state.verdict?.decision === "interrupt") {
      return END;
    }
    // First pass: run architect pipeline. Repairs: skip to planner.
    if (state.briefingScript) return "planner";
    return "architect";
  });

  // Conditional: semantic-critic can reject
  graph.addConditionalEdge("semantic-critic", (state) => {
    if (state.semanticReview?.alignment === "miscast") return END;
    return "compile";
  });

  // Conditional: gate-1 can reject
  graph.addConditionalEdge("gate-1", (state) => {
    if (!state.gate1Passed) return END;
    return "planner";
  });

  // Conditional: verifier routes repairs or terminal
  graph.addConditionalEdge("verifier", (state) => {
    if (!state.verdict) return END;
    switch (state.verdict.decision) {
      case "pass":
      case "interrupt":
      case "fail":
        return END;
      case "patch":
      case "resample":
        return "budget-check";
      default:
        return END;
    }
  });

  return graph;
}
```

### 8.4 Repair Loop Behavior

On `patch` or `resample`, the graph routes back to `budget-check`, which
routes to `planner` (because `state.briefingScript` is already populated).
The Architect pipeline (architect -> semantic-critic -> compile -> gate-1)
runs ONCE per synthesis. Repairs only re-run the inner loop
(planner -> coder -> code-critic -> tester -> verifier).

---

## 9. Wrangler Configuration

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ff-pipeline",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat"],

  "workflows": [
    {
      "name": "factory-pipeline",
      "binding": "FACTORY_PIPELINE",
      "class_name": "FactoryPipeline"
    }
  ],

  "durable_objects": {
    "bindings": [
      { "name": "COORDINATOR", "class_name": "SynthesisCoordinator" },
      { "name": "ARCHITECT", "class_name": "ArchitectAgent" },
      { "name": "CRITIC", "class_name": "CriticAgent" },
      { "name": "SANDBOX", "class_name": "Sandbox" }
    ]
  },

  "containers": [
    {
      "class_name": "Sandbox",
      "image": "./Dockerfile",
      "max_instances": 10
    }
  ],

  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["SynthesisCoordinator"] },
    { "tag": "v2", "new_sqlite_classes": ["ArchitectAgent", "CriticAgent"] },
    { "tag": "v3", "new_sqlite_classes": ["Sandbox"] }
  ],

  "services": [
    { "binding": "GATES", "service": "ff-gates", "entrypoint": "GatesService" }
  ],

  "queues": {
    "producers": [{ "binding": "SYNTHESIS_QUEUE", "queue": "synthesis-queue" }],
    "consumers": [{ "queue": "synthesis-queue", "max_batch_size": 1, "max_retries": 2 }]
  },

  "r2_buckets": [
    { "binding": "WORKSPACE_BUCKET", "bucket_name": "ff-workspaces" }
  ],

  "vars": {
    "ENVIRONMENT": "production"
  }

  // Secrets (set via `wrangler secret put`):
  //   ARANGO_URL, ARANGO_DATABASE, ARANGO_JWT
  //   ANTHROPIC_API_KEY
  //   (optional: OPENAI_API_KEY, DEEPSEEK_API_KEY)
}
```

---

## 10. Dockerfile for Sandbox

```dockerfile
# (amended v4.1 — GDK substrate)
FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /factory
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY sandbox-scripts/ .

EXPOSE 8080
CMD ["node", "agent-server.js"]
```

Dependencies in `/factory/package.json`: `@weops/gdk-agent`, `@weops/gdk-ai`,
`@weops/gdk-ts` (core-tools only, no Node.js-specific governance imports).

| Component | Purpose | Size |
|---|---|---|
| Node.js 22 | Runtime | ~180MB |
| git | Clone, branch, diff, commit | ~30MB |
| pnpm | Package management | ~10MB |
| @weops/gdk-agent | Agent loop (agentLoop, Agent class, tool execution) | ~15MB |
| @weops/gdk-ai | Model access, streaming, 22 providers | ~5MB |
| @weops/gdk-ts (core-tools) | file_read, file_write, bash_execute, grep_search | ~2MB |
| sandbox-scripts | Session runner + optional agent-server | ~50KB |

Total: ~240MB. Well within CF Container limits.

The `sandbox-scripts/` directory contains:
- `run-session.js` -- CLI script: reads input JSON, creates gdk-agent `Agent`, runs session, writes output JSON
- `agent-server.js` -- Optional HTTP server (Strategy B from SS5.3)
- `tool-gates.js` -- File scope + command policy enforcement via `beforeToolCall` hooks (see SS12)

---

## 11. GraphState Additions

```typescript
interface GraphState {
  // ... existing Phase 4 fields (unchanged) ...
  workGraphId: string;
  workGraph: Record<string, unknown>;
  plan: Plan | null;
  code: CodeArtifact | null;
  critique: CritiqueReport | null;
  tests: TestReport | null;
  verdict: Verdict | null;
  roleHistory: { role: string; output: unknown; tokenUsage: number; timestamp: string }[];
  repairCount: number;
  tokenUsage: number;
  maxRepairs: number;
  maxTokens: number;

  // Phase 5 v4 additions
  briefingScript: BriefingScript | null;       // Architect output
  semanticReview: SemanticReviewResult | null;  // Critic semantic verdict
  gate1Passed: boolean;                         // Gate 1 result
  gate1Report: unknown | null;                  // Gate 1 Coverage Report
  compiledPrd: unknown | null;                  // Compiler output (PRD intermediates)

  // Sandbox state
  sandboxName: string | null;                   // Active sandbox identifier
  freshBackupHandle: string | null;             // R2 backup after initial workspace prep
  coderBackupHandle: string | null;             // R2 backup after Coder pass
  executionMode: "dry-run" | "sandbox" | "piAiRole"; // Which tier ran

  // Tool tracking
  coderToolCalls?: number;
  testerToolCalls?: number;
  blockedToolCalls?: {
    role: string;
    toolName: string;
    reason: string;
  }[];
}

interface CodeArtifact {
  // ... existing fields ...
  files: { path: string; content: string; action: "create" | "modify" | "delete" }[];
  summary: string;
  testsIncluded: boolean;

  // Phase 5 additions (sandbox mode)
  diff?: string;                // Real git diff
  commitLog?: string;           // Real git commit log
  toolCallCount?: number;       // Pi SDK tool calls
}

interface BriefingScript {
  goal: string;
  successCriteria: string[];
  architecturalContext: string;
  strategicAdvice: string;
  knownGotchas: string[];
  validationLoop: string;
  derivedPressure: Record<string, unknown>;
  derivedCapability: Record<string, unknown>;
  derivedPrd: Record<string, unknown>;
}

interface SemanticReviewResult {
  alignment: "aligned" | "miscast" | "uncertain";
  confidence: number;
  groundedCriteria: string[];
  ungroundedCriteria: string[];
  missedContent: string[];
  citations: string[];
  rationale: string;
}
```

---

## 12. Security Model

- **API keys:** Set via `wrangler secret put`. Available as `this.env.*` in
  Agent classes. Passed to sandbox via `startProcess({ env })` or
  `sandbox.exec()` environment. `getModel(provider, modelId)` reads from
  `process.env` inside the sandbox. NEVER in request bodies.

- **Agent isolation:** Each Agent (Coordinator, Architect, Critic) runs in
  its own V8 isolate via the Agents SDK / DO infrastructure. No shared
  mutable state between agents except through explicit `@callable()` RPC.

- **Sandbox isolation:** Each Sandbox is a Linux container with its own
  filesystem namespace. Sandboxes do not share filesystems. Network egress
  is restricted to LLM APIs, github.com, and npm registries.

- **File scope (amended v4.1 -- GDK substrate):** Enforced via `beforeToolCall` hook in the gdk-agent `Agent` config. The Coordinator sends `fileScope` / `commandPolicy` as part of the session input. The sandbox session runner builds a `beforeToolCall` function that checks file paths against `fileScope` and commands against `commandPolicy`. Denied calls return `{ block: true, reason }` to the agent loop; the model sees the denial and adjusts. Violations are recorded in `blockedToolCalls`. The `afterToolCall` hook captures evidence (output hash, timing) for audit.

- **Sandbox lifetime:** Fresh sandbox per synthesis (deterministic name from
  workGraphId). No cross-synthesis state. Destroyed after terminal verdict.
  R2 backups expire via TTL.

- **CRP flow is NOT Agents SDK tool approval.** CRP (Consultation Request
  Pack) is the Factory's custom human-in-the-loop flow: role emits CRP ->
  Coordinator persists to `crp_inbox` -> Queue -> Pipeline Workflow calls
  `waitForEvent()` -> Human resolves via ACE -> VCR returned to state.
  This is business logic, not the Agents SDK's built-in tool approval mechanism.

---

## 13. Cost Model

| Component | Duration | vCPU | Est. cost |
|---|---|---|---|
| Architect Agent (V8 isolate) | ~10s | 0.1 | ~$0.0001 |
| Critic Agent - semantic (V8) | ~10s | 0.1 | ~$0.0001 |
| Compile + Gate 1 (V8) | ~5s | 0.1 | ~$0.00005 |
| Sandbox prep (clone + install) | ~30s | 0.5 | ~$0.001 |
| Coder session (sandbox) | ~2 min | 0.5 | ~$0.003 |
| Critic Agent - code (V8) | ~10s | 0.1 | ~$0.0001 |
| Tester session (sandbox) | ~1 min | 0.5 | ~$0.002 |
| Sandbox idle (Verifier decision) | ~30s | 0.5 | ~$0.001 |
| **Total per synthesis (no repairs)** | **~5 min** | | **~$0.007** |

LLM inference dominates (~$1.90/Function). Compute is negligible.

**v3 vs v4 cost comparison:** v4 is cheaper because the Architect and Critic
run in V8 isolates (no Container overhead) instead of Containers. Only the
Coder and Tester need the sandbox. Net savings: ~$0.002/synthesis from
eliminating the Architect Container.

---

## 14. ADR Amendments

### 14.1 ADR-003 Amendment (second amendment)

**v3 amendment:** Container is the default executor. piAiRole is the fallback.

**v4 further amendment:** Sandbox replaces Container as the execution
environment. The three-tier dispatch becomes:

1. **dryRun:** Stub responses, zero cost (testing orchestration)
2. **sandboxRole:** Pi SDK in a `@cloudflare/sandbox` (DEFAULT). Real
   filesystem, real tests, real git.
3. **piAiRole:** LLM produces JSON via model bridge in the Coordinator
   Agent (FALLBACK). No filesystem. Phase 4 behavior.

The pi SDK substrate alignment benefits from ADR-003 SS3.1-3.5 still hold.
`getModel()` routing, `customTools` gating, and cross-role workspace
continuity are preserved. The execution environment changes from a custom
Container DO class to a managed Sandbox.

### 14.2 Agents SDK Adoption

**Decision:** The Coordinator, Architect, and Critic adopt the `agents` npm
package (`cloudflare:agents`) as their base class. Rationale:

- `@callable()` provides typed RPC between DOs without manual `fetch()` routing
- `this.state` provides reactive state management
- Agent extends DurableObject, so all DO capabilities (Alarms, storage, SQL) remain available
- The SDK is Cloudflare's official agent framework, aligned with platform direction

**What Agents SDK is NOT used for:**
- Tool approval (CRP flow is custom business logic)
- Model routing (`@weops/gdk-ai` handles this -- amended v4.1)
- Session management (`@weops/gdk-agent` handles coding sessions inside sandboxes -- amended v4.1)

### 14.3 Sandbox SDK Adoption

**Decision:** Coder and Tester execution uses `@cloudflare/sandbox` instead
of raw `Container` subclass. Rationale:

- `getSandbox()` eliminates the need for a custom Container DO class
- `sandbox.exec()` replaces the custom agent-server HTTP proxy pattern
- `sandbox.writeFile()` enables direct file injection without HTTP
- `sandbox.createBackup()` / `sandbox.restoreBackup()` provide built-in R2 persistence
- `sandbox.destroy()` provides explicit lifecycle management
- The Sandbox class is declared in wrangler config, not in application code

---

## 15. Verification Plan

### 15.1 Local (Pre-deploy)

1. Build Sandbox image: `docker build -t ff-sandbox:latest -f Dockerfile .`
2. Verify Agents SDK: unit test `SynthesisCoordinator extends Agent` compiles
3. Verify `@callable()` decorator works on `synthesize()` and `resolveCrp()`
4. Verify `ArchitectAgent.produceBriefingScript()` returns valid BriefingScript
5. Verify `CriticAgent.semanticReview()` returns valid SemanticReviewResult
6. Test gdk-agent inside Docker container: `Agent` constructor, `agent.prompt()`, `agent.subscribe()` (amended v4.1)
7. Verify gdk-ai `getModel("anthropic", "claude-sonnet-4-5")` reads key from `process.env` (amended v4.1)
8. Test tool gating: confirm `beforeToolCall` blocks writes outside fileScope (amended v4.1)

### 15.2 Cloudflare Integration

1. Deploy with all DO bindings in wrangler.jsonc
2. Verify all four DO classes recognized (check wrangler deploy output)
3. Run dry-run synthesis (Sandbox skipped -- Phase 4 parity)
4. Verify DO-to-DO calls: Coordinator -> ArchitectAgent, Coordinator -> CriticAgent
5. Verify Sandbox lifecycle: getSandbox, exec, writeFile, destroy
6. Run full synthesis with the bootstrap Signal

### 15.3 First Live Test

Same signal as v3 SS12.3: `"Add GET /version to ff-pipeline that returns { name, version, phase }."`

Expected flow:
1. Coordinator receives WorkGraph via `@callable() synthesize()`
2. ArchitectAgent produces BriefingScript from spec context
3. CriticAgent semantic review: `aligned`
4. Compiler + Gate 1: PASS
5. Planner produces plan via model bridge
6. Sandbox starts, Coder clones repo, implements endpoint
7. CriticAgent code review: passed
8. Tester runs real tests in same sandbox
9. Verifier: pass
10. Real git diff in ArangoDB. Sandbox destroyed.

### 15.4 Bootstrap Proof Criteria

1. BriefingScript's `derivedPrd.acceptanceCriteria` traceable to specContent
2. Semantic Critic verdict: `aligned` (not `miscast`)
3. Gate 1: PASS
4. Coder produces a real git diff (not JSON code artifacts)
5. Tester runs real tests (vitest output, not simulated)
6. Verifier verdict: `pass`
7. The resulting PR, when reviewed by the human Architect, is merge-ready

---

## 16. Migration Steps

| Step | What | Reversible? |
|---|---|---|
| 1 | Install `agents` npm package in ff-pipeline | Yes (remove dep) |
| 2 | Change `SynthesisCoordinator extends DurableObject` to `extends Agent` | Yes (revert) |
| 3 | Add `@callable()` to `synthesize()` method | Yes (remove decorator) |
| 4 | Create `ArchitectAgent extends Agent` class | N/A (additive) |
| 5 | Create `CriticAgent extends Agent` class | N/A (additive) |
| 6 | Create Dockerfile and sandbox-scripts/ | N/A (additive) |
| 7 | Add SANDBOX, ARCHITECT, CRITIC bindings to wrangler.jsonc | Yes (remove entries) |
| 8 | Add R2 bucket binding to wrangler.jsonc | Yes (remove entry) |
| 9 | Add migrations v2 (agents) and v3 (sandbox) | Yes (remove entries) |
| 10 | Export all new classes from Worker entry point | Yes (remove exports) |
| 11 | Extend GraphState with v4 fields | Yes (remove fields) |
| 12 | Extend graph topology with architect/critic/compile/gate-1 nodes | Yes (remove nodes) |
| 13 | Implement sandboxRole() replacing containerRole() | Yes (revert to piAiRole) |
| 14 | Deploy ff-pipeline | Yes (redeploy previous version) |
| 15 | Dry-run test (Sandbox skipped -- Phase 4 parity) | N/A |
| 16 | Live test with bootstrap Signal | N/A |

Every step reversible. Fallback to Phase 4 is automatic if Sandbox or Agent
instantiation fails. Worst case: "Phase 5 v4 doesn't work yet, Phase 4
still works."

---

## 17. v3 vs v4 Comparison

| Concern | v3 | v4 |
|---|---|---|
| Coordinator base | `DurableObject` | `Agent` (Agents SDK) |
| Coordinator RPC | `fetch()` handler with URL routing | `@callable()` typed methods |
| Coordinator state | `this.ctx.storage.put/get` | `this.state` (reactive) |
| Architect execution | Container DO (pi SDK in Linux) | Agent (V8 isolate, no Container) |
| Critic execution | `callModel()` inline in graph | Agent (V8 isolate, `@callable()`) |
| Coder/Tester env | `FactoryAgent extends Container` (custom class) | `@cloudflare/sandbox` (managed) |
| Container access | `getContainer(env.FACTORY_AGENT, name).fetch()` | `getSandbox(env.SANDBOX, name)` |
| Agent-server | Required (custom HTTP on :8080) | Optional (sandbox.exec preferred) |
| Workspace backup | Not specified | R2 via `sandbox.createBackup()` |
| Graph topology | 5 nodes (planner/coder/critic/tester/verifier) | 9 nodes (+architect/semantic-critic/compile/gate-1) |
| DO classes | 2 (Coordinator + FactoryAgent) | 4 (Coordinator + Architect + Critic + Sandbox) |
| npm packages | `@cloudflare/containers` | `agents`, `@cloudflare/sandbox`, `@weops/gdk-ai`, `@weops/gdk-agent`, `@weops/gdk-ts` (amended v4.1) |
| LLM routing | ofox.ai via model-bridge | `@weops/gdk-ai` `getModel()` + `complete()`/`streamSimple()` (amended v4.1) |
| Agent substrate | pi-coding-agent `createAgentSession()` | `@weops/gdk-agent` `Agent` class + `agentLoop()` (amended v4.1) |
| Session API | `session.prompt()` + `subscribe()` | `agent.prompt()` + `agent.subscribe()` + `agent.waitForIdle()` (gdk-agent, amended v4.1) |
| Model API | `getModel(provider, modelId)` from pi-ai | `getModel(provider, modelId)` from `@weops/gdk-ai` (amended v4.1) |
| CRP flow | Custom (Coordinator -> Queue -> waitForEvent) | Custom (unchanged, NOT Agents SDK approval) |
| graph-runner.ts | StateGraph class | StateGraph class (unchanged) |
| Repair loop | patch/resample via verifier routing | patch/resample via verifier routing (unchanged) |
| Cost per synthesis | ~$0.009 | ~$0.007 (cheaper: no Architect Container) |

---

## 18. GDK Substrate Integration (added v4.1)

**ADR:** DECISIONS.md 2026-04-26 "GDK substrate adoption for Factory agent infrastructure"
**Analysis:** `specs/reference/GDK-PLATFORM-ANALYSIS.md`

### 18.1 Package Mapping

| GDK Package | Replaces | Used For |
|---|---|---|
| `@weops/gdk-ai` | ofox.ai + `@factory/task-routing` + `@mariozechner/pi-ai` | Model resolution (`getModel`), inference (`complete`, `streamSimple`), 22-provider routing, faux provider for testing |
| `@weops/gdk-agent` | `@mariozechner/pi-coding-agent` `createAgentSession()` | Agent loop (`agentLoop`, `Agent` class), parallel tool execution, `beforeToolCall`/`afterToolCall` hooks, streaming `AgentEvent` |
| `@weops/gdk-ts` (core-tools only) | Custom tool implementations in sandbox-scripts | `buildCoreTools()`: file_read, file_write, bash_execute, grep_search |

### 18.2 Key API Signatures (verified from source)

**Model resolution and inference (gdk-ai):**
```typescript
getModel<TProvider, TModelId>(provider, modelId): Model<...>
complete(model, context, options?): Promise<AssistantMessage>
streamSimple(model, context, options?): AssistantMessageEventStream  // with reasoning
```

**Agent loop (gdk-agent):**
```typescript
class Agent {
  prompt(message | string): Promise<void>
  subscribe(listener: (event: AgentEvent) => void): () => void
  waitForIdle(): Promise<void>
  abort(): void
  steer(message): void       // inject mid-run
  followUp(message): void    // queue post-completion
}
```

**Tool gating hooks (gdk-agent AgentLoopConfig):**
```typescript
beforeToolCall?: (ctx: BeforeToolCallContext, signal?) => Promise<BeforeToolCallResult>
afterToolCall?: (ctx: AfterToolCallContext, signal?) => Promise<AfterToolCallResult>
// BeforeToolCallResult: undefined (permit) | { block: true, reason: string } (deny)
```

### 18.3 What the Factory KEEPS Custom

Pipeline orchestration (CF Workflow + Queue bridge), Coordinator Agent (extends `agents` SDK `Agent`), `graph-runner.ts` (StateGraph), compiler passes, coverage gates (Gate 1/2/3), lineage graph (ArangoDB), WorkGraph assembly, CRP/VCR flow, Dream DO consolidation, R2 workspace backup. These are Factory-specific logic that GDK does not address.
