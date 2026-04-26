# GDK Platform Analysis — weops-pi-foundation

**Date:** 2026-04-26
**Purpose:** Deep-read of every source file in 7 GDK packages to inform Function Factory Phase 5
**Repo:** /Users/wes/Developer/weops-pi-foundation

---

## 1. Package-by-Package API Surface

### 1.1 @weops/gdk-ai (packages/gdk-ai/src/)

**Fork of:** @mariozechner/pi-ai (with WeOps-specific modifications)

**Core Types** (types.ts L1-403):

| Type | Description |
|------|-------------|
| `Model<TApi>` | Provider-agnostic model descriptor: id, name, api, provider, baseUrl, reasoning, input, cost, contextWindow, maxTokens |
| `Context` | LLM request: systemPrompt, messages[], tools[] |
| `Message` | Union: UserMessage \| AssistantMessage \| ToolResultMessage |
| `AssistantMessage` | Model response with content[], usage, stopReason, errorMessage |
| `Tool<TParameters>` | name + description + TypeBox TSchema parameters |
| `AssistantMessageEvent` | 12-variant discriminated union for streaming (start, text_delta, thinking_delta, toolcall_delta, done, error, etc.) |
| `StreamFunction<TApi, TOptions>` | (model, context, options?) => AssistantMessageEventStream |
| `StreamOptions` | temperature, maxTokens, signal, apiKey, cacheRetention, sessionId, headers, metadata |
| `SimpleStreamOptions` | StreamOptions + reasoning: ThinkingLevel + thinkingBudgets |
| `ThinkingLevel` | "minimal" \| "low" \| "medium" \| "high" \| "xhigh" |

**Providers Supported** (types.ts L19-42):
amazon-bedrock, anthropic, google, google-gemini-cli, google-antigravity,
google-vertex, openai, azure-openai-responses, openai-codex, github-copilot,
xai, groq, cerebras, openrouter, vercel-ai-gateway, zai, mistral, minimax,
minimax-cn, huggingface, opencode, opencode-go, kimi-coding

**APIs** (types.ts L5-15):
openai-completions, mistral-conversations, openai-responses,
azure-openai-responses, openai-codex-responses, anthropic-messages,
bedrock-converse-stream, google-generative-ai, google-gemini-cli, google-vertex

**Key Functions** (stream.ts L25-59):
```typescript
stream(model, context, options?): AssistantMessageEventStream
complete(model, context, options?): Promise<AssistantMessage>
streamSimple(model, context, options?): AssistantMessageEventStream  // with reasoning
completeSimple(model, context, options?): Promise<AssistantMessage>
```

**Model Registry** (models.ts L20-26):
```typescript
getModel<TProvider, TModelId>(provider, modelId): Model<...>
getModels(provider): Model[]
getProviders(): KnownProvider[]
calculateCost(model, usage): Usage["cost"]
supportsXhigh(model): boolean
```

**API Provider Registry** (api-registry.ts L66-98):
```typescript
registerApiProvider(provider, sourceId?): void
getApiProvider(api): ApiProviderInternal | undefined
unregisterApiProviders(sourceId): void
clearApiProviders(): void
```

**Streaming Infrastructure** (utils/event-stream.ts L4-87):
- `EventStream<T, R>`: Generic push-based async iterable with result() promise
- `AssistantMessageEventStream`: Specialized for AssistantMessageEvent -> AssistantMessage
- Pattern: push events as they arrive, end() when done, result() returns final message

**Faux Provider** (providers/faux.ts L391-498):
Full mock provider for testing. Supports response scripting via FauxResponseFactory,
simulated streaming with configurable token timing, and prompt cache simulation.

**Key Difference from pi-ai:**
- Namespace changed from @mariozechner/pi-ai to @weops/gdk-ai
- All internal imports use @weops/gdk-ai
- Otherwise structurally identical to upstream pi-ai

---

### 1.2 @weops/gdk-agent (packages/gdk-agent/src/)

**Fork of:** @mariozechner/pi-agent (with WeOps-specific modifications)

**Agent Loop** (agent-loop.ts L31-54):
```typescript
function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn
): EventStream<AgentEvent, AgentMessage[]>
```

**Agent Class** (agent.ts L157-539):
```typescript
class Agent {
  state: AgentState                    // systemPrompt, model, thinkingLevel, tools, messages
  prompt(message | string): Promise<void>  // start new conversation turn
  continue(): Promise<void>            // continue from current state
  steer(message): void                 // inject mid-run message
  followUp(message): void              // queue post-completion message
  subscribe(listener): () => void      // listen to AgentEvent stream
  abort(): void
  waitForIdle(): Promise<void>
  reset(): void
}
```

**AgentLoopConfig** (types.ts L96-214):
- `model: Model<any>` -- active model
- `convertToLlm: (AgentMessage[]) => Message[]` -- transforms custom messages to LLM format
- `transformContext?: (AgentMessage[], signal?) => Promise<AgentMessage[]>` -- context window mgmt
- `getApiKey?: (provider) => string | undefined` -- dynamic key resolution for expiring tokens
- `getSteeringMessages?: () => Promise<AgentMessage[]>` -- mid-run steering injection
- `getFollowUpMessages?: () => Promise<AgentMessage[]>` -- post-completion follow-ups
- `toolExecution?: "sequential" | "parallel"` -- default: "parallel"
- `beforeToolCall?: (BeforeToolCallContext, signal?) => Promise<BeforeToolCallResult>` -- gate
- `afterToolCall?: (AfterToolCallContext, signal?) => Promise<AfterToolCallResult>` -- post-hook

**AgentTool** (types.ts L292-307):
```typescript
interface AgentTool<TParameters, TDetails> extends Tool<TParameters> {
  label: string
  prepareArguments?: (args: unknown) => Static<TParameters>
  execute: (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>
}
```

**AgentEvent** (types.ts L326-341):
agent_start, agent_end, turn_start, turn_end, message_start, message_update,
message_end, tool_execution_start, tool_execution_update, tool_execution_end

**Proxy** (proxy.ts L85-206):
`streamProxy(model, context, options: ProxyStreamOptions)` -- routes through server,
reconstructs partial messages client-side from bandwidth-optimized SSE events.

**Loop Algorithm** (agent-loop.ts L155-232):
1. Outer loop: check for follow-up messages after agent would stop
2. Inner loop: process steering messages, stream assistant response, execute tool calls
3. Tool calls: prepare (validate + beforeToolCall gate), execute, finalize (afterToolCall)
4. Parallel execution default: prepare sequentially, execute concurrently, emit in order

---

### 1.3 @weops/gdk-ts (packages/gdk-ts/src/)

**This is the governance layer. Original WeOps code, not forked.**

#### 1.3.1 Agent Governance (agent-governance.ts L1-440)

**AOMA Tier System** (L19-29):
```typescript
enum Tier {
  Autonomous = 0,   // T0: Execute without approval
  Escalation = 1,   // T1: Execute and notify
  ExpertApproval = 2,// T2: Suspend until approved
  Blocked = 99,      // T99: Unconditionally deny
}
```

**GovernedAction** (L32-47):
```typescript
interface GovernedAction {
  intentClass: string              // e.g., "READ_ONLY", "WRITE", "EXECUTE"
  tier: Tier
  context?: Record<string, unknown>
  action: ((ctx) => Promise<void>) | null
  idempotencyKey: string           // Required per SDD-GDK 9.6
  reversible?: boolean
  reversibleWindowSeconds?: number
}
```

**PolicyDecision** (L50-57):
```typescript
interface PolicyDecision {
  policyDecisionId: string
  decision: 'PERMIT' | 'DENY'
  reasons?: Array<{ code?: string; summary: string }>
  obligations?: Array<{ type: string; value: string }>
  escalationRung?: number
  evaluatedAt: string
}
```

**Factory Function** (L234-416):
```typescript
createGovernedAgentConfig(service: GovernedService, options?: GovernedAgentOptions)
  => { beforeToolCall, afterToolCall }
```
Algorithm:
1. Derive intentClass from tool name via sideEffectMap (fail-closed: unknown = EXECUTE)
2. Build idempotency key from session+turn+toolCallId
3. Call service.evaluatePolicy() or executeGovernedAction with null action
4. DENY: return { block: true, reason }. PERMIT: store state, return undefined
5. afterToolCall: compute output hash, commit evidence, clean up state

**Default Side Effect Map** (L160-169):
bash_execute=EXECUTE, file_write=WRITE, file_read=READ_ONLY,
file_list=READ_ONLY, grep_search=READ_ONLY, git_commit=WRITE,
git_status=READ_ONLY, git_diff=READ_ONLY

#### 1.3.2 Agent Session (agent-session.ts L1-703)

**GovernedSessionConfig** (L34-63):
```typescript
interface GovernedSessionConfig {
  assemblyId: string; purposeId: string; actorId: string
  model: ModelConfig; apiKey: string; fallbackModel?: ModelConfig
  governedService: GovernedService; autonomyTier?: Tier
  tools: AgentTool<any>[]; sideEffectMap?: Record<string, string>
  maxTurns?: number;  maxTokens?: number
  systemPrompt: string; workDir: string
}
```

**SessionResult** (L66-73):
```typescript
interface SessionResult {
  sessionId: string; workOrderId: string
  status: "completed" | "failed" | "aborted" | "turn_limit"
  turns: number; metrics: SessionMetrics
}
```

**SessionMetrics** (L76-84):
totalInputTokens, totalOutputTokens, totalCachedTokens,
gatesEvaluated, gatesDenied, gatesEscalated, evidenceRecords, durationMs

**GovernedAgentSession.run()** (L190-389):
1. Create work order via GovernedService
2. Build governance-wrapped beforeToolCall/afterToolCall hooks
3. Create agent context with tools
4. Build model from ModelConfig
5. Call agentLoop(prompt, context, config, signal)
6. Stream events, track metrics (tokens, turns, gates)
7. Close work order with final status
8. Return SessionResult

#### 1.3.3 KernelClient (client.ts L68-462)

HTTP client for AOMA Kernel. All requests carry Authorization, X-Assembly-ID,
X-Idempotency-Key, X-Work-Order-ID headers.

```typescript
class KernelClient {
  createWorkOrder(req): Promise<string>        // POST /v1/workorders
  createChildWorkOrder(parentId, req): Promise<string>
  getWorkOrder(workOrderId): Promise<ExecutionStatus>
  evaluatePolicy(req: PDPDecideRequest): Promise<PDPDecideResponse>
  getEvidence(evidenceId): Promise<Record<string, unknown>>
}
```

All methods use ResilienceWrapper (circuit breaker + retry with exponential backoff)
and create OpenTelemetry spans when observability is enabled.

#### 1.3.4 GovernedService (service.ts L27-499)

Base class for all GDK-governed services. Algorithm for executeGovernedAction():
1. Validate idempotencyKey
2. PII filter context
3. Create Work Order via kernel
4. Evaluate policy via kernel PDP
5. DENY -> throw AuthorizationError
6. T2 -> poll for approval
7. Execute action function

Also supports: executeBatchGovernedActions (parent + child work orders),
executeReversibleAction (forward + compensation).

#### 1.3.5 Observability (observability.ts L1-633)

Full OpenTelemetry integration with graceful degradation:
- Zero-dep when disabled (no OTEL_EXPORTER_OTLP_ENDPOINT)
- All spans: session, turn, governance, kernel request, tool, evidence, work order
- Metrics: gates evaluated/permitted/denied, kernel duration, tool duration,
  session tokens, session cost, circuit state
- Lazy-loaded OTel SDK via dynamic import

#### 1.3.6 Resilience (resilience.ts L1-315)

- **CircuitBreaker**: 3-state (closed/open/half-open), 5 failure threshold,
  30s recovery timeout, configurable success threshold
- **RetryHandler**: exponential backoff (200ms/400ms/800ms), max 3 retries,
  retries on 502/503/504 and network errors
- **ResilienceWrapper**: combines both -- circuit breaker wraps retry

#### 1.3.7 Tools

**Core Tools** (tools/core-tools.ts): file_read, file_write, bash_execute, grep_search
**Coding Agent Tool** (tools/coding-agent-tool.ts): spawns Go CodingAgent binary as subprocess

#### 1.3.8 Decorators (decorators.ts L1-182)

@governed, @audited, @reversible -- method decorators that wrap in executeGovernedAction.
Support both TC39 Stage 3 and legacy TypeScript decorators.

#### 1.3.9 Errors (errors.ts L1-202)

GovernanceError -> AuthorizationError, FidelityInsufficientError,
EscalationTimeoutError, PolicyViolationError, CircuitOpenError, RetryExhaustedError.
All carry code, auditTrailId, workOrderId, nextSteps.

---

### 1.4 @koales/del-sdk (packages/del-sdk/src/)

**Decision Expression Language** -- a structured grammar for institutional decisions.

**DELExpression** (types.ts L319-327):
```typescript
interface DELExpression {
  $del?: string        // version "0.1"
  decide: DecideClause // id, intent, stratum, domain, urgency
  given?: GivenClause  // facts, assumptions, constraints, signals
  where?: WhereClause  // authority, delegation, escalation, quorum
  when?: WhenClause    // triggers, deadline, preconditions, window
  decompose?: DecomposeClause  // strategy, sub_decisions, aggregation
  yield: YieldClause   // status, outcome, resolved_by, confidence, trace
}
```

Key concepts: Stratum (strategic/tactical/operational/reflexive),
Urgency levels, Principal types (role/agent/committee/system/individual),
Decomposition strategies (parallel/sequential/conditional/delegated),
QuorumRules, EscalationPaths, AuditTraces.

Factory functions: createExpression(), createDecideClause(), createYieldClause()
Validation: validateExpression() with per-clause validators
Plugin system: 12 plugin interface types (ConstraintEvaluator, FactResolver,
SignalAdapter, AuthorityValidator, QuorumEngine, etc.)
Model Resolution: extractModelRequirements() bridges DEL constraints to P13 requirements

---

### 1.5 midnight-architect (packages/midnight-architect/)

**Rust/WASM Leptos application** -- governance visualization dashboard.

Not TypeScript. A Leptos (Rust) WebAssembly SPA with:
- WebSocket connection to AOMA kernel
- Work order lifecycle visualization
- 10-layer ABAC policy pipeline display
- We-Gradient (G0-G3) governance level visualization
- Chat interface with governance events
- Evidence bundle display with hash chains

Types mirror the kernel's canonical message envelope (types.rs L1-323).
This is the visual surface for AOMA governance, not a runtime dependency.

---

### 1.6 @weops/gdk-cli (packages/gdk-cli/src/)

**Ink-based CLI** (React for terminal) with commands:
- `gdk architect init|conformance|antipatterns`
- `gdk sprint run|status`

**useGovernedSession hook** (hooks/useGovernedSession.ts): Bridges
GovernedAgentSession to React UI state. Creates GovernedService, builds
GovernedSessionConfig, manages session lifecycle with mock fallback.

---

### 1.7 @weops/stream-types (packages/stream-types/src/)

**Canonical type definitions** for the AOMA kernel protocol:

- **kernel/**: WorkOrder, GovernanceProfile, Envelope, Policy (DecisionRequest/Response),
  Escalation, Evidence, Invocation, PDP, Messages, DomainEvent, BoundaryObject,
  CommonGround assembly types
- **stream/**: StreamConfig, DataParts, StreamMessage
- **mappers/**: drift, escalation, execution, governance, knowledge-graph,
  knowledge-ontology, knowledge-search, plan-validation, reasoning, work-order
- **validators/**: envelope, ids, taxonomy, workorder
- **coordination/**: assemblies, bridge, domain-context, product-assembly,
  router, template, validators, workspace

Branded ID types (WorkOrderID, PolicyDecisionID, InvocationID, EvidenceID, etc.)
with pattern-based validators and generators.

---

## 2. Mapping Table

| GDK Component | Factory Equivalent | Recommendation |
|---|---|---|
| gdk-ai `stream()/complete()` | ff-pipeline callModel() in coordinator | **USE GDK** -- replace custom model calling with gdk-ai |
| gdk-ai `Model<TApi>` | Factory has no unified model type | **USE GDK** -- adopt Model as canonical model descriptor |
| gdk-ai `AssistantMessageEventStream` | Custom SSE streaming in ff-pipeline | **USE GDK** -- standardize on EventStream pattern |
| gdk-ai providers (22 providers) | Factory talks only to Anthropic/OpenAI | **USE GDK** -- gain all providers for free |
| gdk-ai faux provider | No test mock for LLM calls | **USE GDK** -- use for testing Factory pipeline |
| gdk-agent `Agent` class | Factory has no agent abstraction | **USE GDK** -- this IS the Stage 6 executor |
| gdk-agent `agentLoop()` | Custom pipeline orchestration | **USE GDK** -- replace with agentLoop + hooks |
| gdk-agent `AgentTool` | Factory tools are ad-hoc | **USE GDK** -- standardize tool interface |
| gdk-agent `beforeToolCall/afterToolCall` | No governance hooks | **USE GDK** -- this is where governance plugs in |
| gdk-agent `streamProxy()` | ff-gateway proxies to pipeline | **HYBRID** -- adapt proxy pattern for edge |
| gdk-ts `GovernedAgentSession` | No governed session concept | **USE GDK** -- this IS Phase 5 core |
| gdk-ts `GovernedService` | No service governance base | **USE GDK** -- every Factory service extends this |
| gdk-ts `KernelClient` | No kernel client | **USE GDK** -- direct kernel communication |
| gdk-ts `createGovernedAgentConfig()` | No governance adapter | **USE GDK** -- plug governance into agent hooks |
| gdk-ts `Tier` (T0/T1/T2/T99) | Factory has no autonomy tiers | **USE GDK** -- adopt AOMA tier model |
| gdk-ts observability | No OTel integration | **USE GDK** -- get spans/metrics for free |
| gdk-ts resilience | No retry/circuit breaker | **USE GDK** -- production resilience |
| gdk-ts core-tools | Factory has custom tool impls | **HYBRID** -- extend core tools with Factory-specific tools |
| gdk-ts coding-agent-tool | No subprocess agent tool | **USE GDK** -- for delegating Go implementation work |
| gdk-ts decorators | No governance decorators | **USE GDK** -- @governed, @audited, @reversible |
| gdk-ts errors | Basic error handling | **USE GDK** -- structured governance error hierarchy |
| del-sdk DELExpression | Factory has no decision language | **USE GDK** -- decisions as data, not code |
| del-sdk validation | No decision validation | **USE GDK** -- validate decision expressions |
| del-sdk model-resolution | No model selection protocol | **USE GDK** -- P13 model resolution |
| stream-types kernel types | Factory has no kernel protocol types | **USE GDK** -- canonical protocol surface |
| stream-types branded IDs | Factory uses plain strings | **USE GDK** -- type-safe IDs |
| midnight-architect | No governance dashboard | **KEEP SEPARATE** -- visualization layer, not runtime |

---

## 3. The Governed Session Model in Detail

The governed session model is a 3-layer composition:

### Layer 1: Model Abstraction (gdk-ai)
Every LLM call goes through `streamSimple(model, context, options)`.
The Model type abstracts provider differences. The API registry allows
runtime registration of new providers. Streaming uses a push-based
EventStream that supports async iteration AND a result() promise.

### Layer 2: Agent Loop (gdk-agent)
`agentLoop()` implements the classic LLM agent pattern:
prompt -> model response -> tool calls -> tool results -> repeat.
The key innovation: `beforeToolCall` and `afterToolCall` hooks create
a governance injection point without the agent loop knowing about governance.
The Agent class adds statefulness (transcript, queues, lifecycle).

### Layer 3: Governance Wrapper (gdk-ts)
`createGovernedAgentConfig()` produces beforeToolCall/afterToolCall hooks
that evaluate every tool call through the AOMA kernel PDP before execution.
`GovernedAgentSession` wraps the entire flow in a work order lifecycle:
create WO -> run agent with governance -> track metrics -> close WO.

**Data flow for a single tool call:**

1. Agent loop receives tool call from model response
2. `beforeToolCall` fires -> derives intentClass from tool name
3. Builds GovernedAction with idempotency key
4. Calls service.evaluatePolicy() -> kernel PDP
5. DENY: blocks tool call, returns error to model
6. PERMIT: stores state (invocationId, policyDecisionId, evidenceId)
7. Tool executes
8. `afterToolCall` fires -> computes output hash, commits evidence
9. Tool result returns to model

**Session lifecycle:**

1. `GovernedAgentSession.run(prompt, output)` called
2. Creates work order via KernelClient.createWorkOrder()
3. Initializes governance hooks via createGovernedAgentConfig()
4. Calls agentLoop() with governance-wrapped config
5. Streams AgentEvents to output WritableStream
6. Tracks SessionMetrics (tokens, gates, evidence, duration)
7. On completion: closes work order, returns SessionResult
8. OpenTelemetry spans cover entire lifecycle

---

## 4. What the Factory Gains by Building on GDK

### 4.1 Immediate Gains

**22 LLM providers out of the box.** The Factory currently only calls Anthropic
and OpenAI. GDK-ai gives Bedrock, Vertex, Gemini CLI, Mistral, Groq, Cerebras,
xAI, OpenRouter, and more with a single `streamSimple()` call.

**Production agent loop.** The Factory's pipeline orchestration is custom.
GDK-agent provides a battle-tested loop with parallel tool execution,
steering/follow-up queues, abort handling, and streaming events.

**Governance as a hook, not a rewrite.** The beforeToolCall/afterToolCall
pattern means governance plugs into the standard agent loop without forking it.
The Factory can adopt governance incrementally.

**Full observability.** OpenTelemetry spans for every session, turn, tool call,
governance decision, and kernel request. Zero overhead when disabled.

**Resilience.** Circuit breaker + exponential backoff retry for kernel calls.
The Factory currently has no resilience patterns.

**Test infrastructure.** The faux provider enables deterministic testing of
the entire pipeline without real LLM calls. The Factory lacks this.

**Decision language.** DEL gives the Factory a structured way to express
architectural decisions, not just implement them. Every Function the Factory
produces could carry a DELExpression documenting the decision that created it.

### 4.2 Strategic Gains

**Same codebase as WeOps production.** The Factory running on GDK means
the Factory's agent runtime IS the WeOps agent runtime. No impedance mismatch
when the Factory produces Functions for WeOps deployment.

**Canonical types.** stream-types provides the exact protocol types the
AOMA kernel speaks. No translation layer needed.

**The Factory governs itself.** By running on GDK, every Factory operation
(PRD compilation, WorkGraph execution, trust computation) becomes a governed
action with evidence. The Factory's own operations produce the same evidence
artifacts it requires of the Functions it creates.

---

## 5. Gaps -- What GDK Does Not Provide

### 5.1 Cloudflare Workers Runtime

GDK-ts uses Node.js APIs (crypto.createHash, child_process.execSync, fs.*).
The Factory runs on Cloudflare Workers. Specific gaps:

- `agent-governance.ts` L13: `import { createHash } from 'crypto'` -- needs Web Crypto API
- `tools/core-tools.ts` L4-5: `execSync`, `readFileSync`, etc. -- needs CF alternatives
- `tools/coding-agent-tool.ts` L6: `spawn` from child_process -- incompatible with Workers

**Mitigation:** The governance types and interfaces are runtime-agnostic.
Only the concrete implementations need Workers adaptation. The `KernelClient`
uses fetch() which works everywhere.

### 5.2 ArangoDB Integration

GDK has no graph database integration. The Factory's graph layer
(ArangoDB for lineage, trust scores, artifact relationships) is entirely
custom and must remain so.

### 5.3 Factory-Specific Compiler Passes

The Factory's core value -- PRD compilation, WorkGraph generation, trust
computation, coverage gates -- has no GDK equivalent. These are the Factory's
unique capabilities that GDK provides the runtime for.

### 5.4 Queue-Based Pipeline Orchestration

GDK's agent loop is request/response. The Factory's pipeline uses
Cloudflare Queues for async stage transitions. GDK doesn't provide
queue-based orchestration patterns.

### 5.5 Multi-Agent Coordination

GDK provides single-agent sessions. The Factory needs coordinated
multi-agent patterns (e.g., PRD compiler agent handing off to WorkGraph
generator agent). The coding-agent-tool shows one pattern (subprocess),
but true multi-agent coordination is not in GDK.

### 5.6 Deterministic Pipeline Stages

The Factory's pipeline stages (Parse -> Compile -> Verify -> Execute)
are deterministic code, not LLM conversations. GDK's agent loop is
for LLM-driven stages only. The deterministic stages remain custom.

---

## 6. Recommended Phase 5 v5 Approach

### Principle: GDK is the runtime substrate. Factory logic is the payload.

### 6.1 Layer Architecture

```
┌─────────────────────────────────────┐
│ Factory Logic (custom)              │
│  PRD Compiler, WorkGraph, Trust,    │
│  Coverage Gates, Lineage Graph      │
├─────────────────────────────────────┤
│ GDK Governance Layer (@weops/gdk-ts)│
│  GovernedAgentSession, Tiers,       │
│  Evidence, Observability            │
├─────────────────────────────────────┤
│ GDK Agent Layer (@weops/gdk-agent)  │
│  Agent, agentLoop, tools            │
├─────────────────────────────────────┤
│ GDK AI Layer (@weops/gdk-ai)       │
│  Model, stream, providers           │
├─────────────────────────────────────┤
│ CF Workers / Queues / DO (infra)    │
└─────────────────────────────────────┘
```

### 6.2 Phase 5 Implementation Steps

**Step 1: Replace callModel() with gdk-ai**

Current: ff-pipeline coordinator calls Anthropic/OpenAI directly.
Target: Use `streamSimple(model, context, options)` from gdk-ai.

- Import `getModel`, `streamSimple` from @weops/gdk-ai
- Replace custom model calling with `stream()` / `complete()`
- Use `Model<TApi>` as the canonical model descriptor
- Reference: gdk-ai/src/stream.ts L25-59, models.ts L20-26

**Step 2: Adopt Agent loop for LLM-driven stages**

Current: Custom LLM orchestration in pipeline coordinator.
Target: Use `Agent` class from gdk-agent for Stage 6 execution.

- Create `FactoryAgent` extending patterns from Agent class
- Define Factory-specific AgentTools (compile_prd, generate_workgraph, etc.)
- Use beforeToolCall/afterToolCall hooks for governance
- Reference: gdk-agent/src/agent.ts L157-539, types.ts L292-307

**Step 3: Wire governance via createGovernedAgentConfig()**

Current: No governance on pipeline operations.
Target: Every Factory operation is a governed action.

- Extend GovernedService for Factory-specific service
- Define Factory side-effect map (compile=EXECUTE, read_artifact=READ_ONLY, etc.)
- Use GovernedAgentSession for all LLM-driven stages
- Reference: gdk-ts/src/agent-governance.ts L234-416,
  agent-session.ts L127-389

**Step 4: Workers-compatible governance types**

Current: gdk-ts uses Node.js crypto.
Target: Fork governance types for Workers runtime.

- Replace `createHash('sha256')` with Web Crypto API `crypto.subtle.digest()`
- Replace fs/child_process tools with Workers-compatible alternatives
- KernelClient already uses fetch() -- works as-is
- The Tier enum, GovernedAction, PolicyDecision, EvidenceEntry are pure types
  and work everywhere without modification

**Step 5: Integrate DEL for Factory decisions**

Current: Decisions are implicit in code.
Target: Every Factory decision carries a DELExpression.

- Each PRD compilation produces a DELExpression documenting the decision
- WorkGraph nodes carry YieldClauses with outcomes
- Trust scores map to confidence fields
- Reference: del-sdk/src/types.ts L319-327, factory.ts L120-134

**Step 6: Adopt stream-types for kernel protocol**

Current: Factory invents its own message types.
Target: Use canonical stream-types for kernel communication.

- Import WorkOrder, GovernanceProfile, EvidenceBundle from stream-types
- Use branded ID types (WorkOrderID, EvidenceID) instead of plain strings
- Reference: stream-types/src/kernel/workorder.ts, kernel/governance.ts

### 6.3 What to Keep Building Custom

1. **ArangoDB graph layer** -- lineage, trust, relationships
2. **Compiler passes** -- PRD -> WorkGraph -> Functions (deterministic)
3. **Coverage gates** -- Gate 1/2/3 evaluation logic
4. **Queue orchestration** -- CF Queue bridges between pipeline stages
5. **Edge gateway** -- ff-gateway and ff-gates remain custom Workers
6. **Seed/schema** -- YAML schemas, artifact definitions

### 6.4 Dependency Strategy

Add to Factory's package.json:
```json
{
  "@weops/gdk-ai": "workspace:*",
  "@weops/gdk-agent": "workspace:*",
  "@weops/gdk-ts": "workspace:*",
  "@koales/del-sdk": "workspace:*",
  "@weops/stream-types": "workspace:*"
}
```

Option A: **Monorepo inclusion** -- add weops-pi-foundation as git submodule
Option B: **Published packages** -- publish GDK packages to private registry
Option C: **Selective copy** -- copy only the types and interfaces needed

Recommendation: Option A for development, Option B for CI/CD.

---

## 7. Critical File References

| What | Path | Lines |
|------|------|-------|
| Model type | packages/gdk-ai/src/types.ts | 379-402 |
| StreamFunction signature | packages/gdk-ai/src/types.ts | 125-129 |
| stream/complete API | packages/gdk-ai/src/stream.ts | 25-59 |
| AssistantMessageEvent union | packages/gdk-ai/src/types.ts | 237-249 |
| EventStream class | packages/gdk-ai/src/utils/event-stream.ts | 4-87 |
| API provider registry | packages/gdk-ai/src/api-registry.ts | 66-98 |
| Faux provider for testing | packages/gdk-ai/src/providers/faux.ts | 391-498 |
| agentLoop() signature | packages/gdk-agent/src/agent-loop.ts | 31-54 |
| Agent class | packages/gdk-agent/src/agent.ts | 157-539 |
| AgentLoopConfig | packages/gdk-agent/src/types.ts | 96-214 |
| AgentTool interface | packages/gdk-agent/src/types.ts | 292-307 |
| AgentEvent types | packages/gdk-agent/src/types.ts | 326-341 |
| AOMA Tier enum | packages/gdk-ts/src/agent-governance.ts | 19-29 |
| GovernedAction interface | packages/gdk-ts/src/agent-governance.ts | 32-47 |
| PolicyDecision interface | packages/gdk-ts/src/agent-governance.ts | 50-57 |
| createGovernedAgentConfig() | packages/gdk-ts/src/agent-governance.ts | 234-416 |
| GovernedSessionConfig | packages/gdk-ts/src/agent-session.ts | 34-63 |
| GovernedAgentSession.run() | packages/gdk-ts/src/agent-session.ts | 190-389 |
| SessionResult/Metrics | packages/gdk-ts/src/agent-session.ts | 66-84 |
| KernelClient | packages/gdk-ts/src/client.ts | 68-462 |
| GovernedService | packages/gdk-ts/src/service.ts | 27-499 |
| Observability (OTel) | packages/gdk-ts/src/observability.ts | 206-552 |
| Resilience (circuit+retry) | packages/gdk-ts/src/resilience.ts | 47-315 |
| Error hierarchy | packages/gdk-ts/src/errors.ts | 9-202 |
| DELExpression type | packages/del-sdk/src/types.ts | 319-327 |
| DEL validation | packages/del-sdk/src/validate.ts | 435-487 |
| WorkOrder type | packages/stream-types/src/kernel/workorder.ts | 16-34 |
| GovernanceProfile | packages/stream-types/src/kernel/governance.ts | 14-29 |
| Default G0-G3 profiles | packages/stream-types/src/kernel/governance.ts | 40-97 |
