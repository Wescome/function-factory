# DESIGN: ConductorDO -- Generalized Multi-Agent Orchestration Durable Object

> `pp.conductor.v1.0` -- Parameterized orchestration engine for any multi-agent workflow
>
> Generalizes SynthesisCoordinator from a hardcoded 9-node synthesis
> pipeline into a topology-driven orchestration runtime.
>
> Source lineage:
> - `coordinator.ts` (SynthesisCoordinator -- reference implementation)
> - `graph.ts` + `graph-runner.ts` (StateGraph engine)
> - `atom-executor-do.ts` + `atom-executor.ts` (per-atom parallel dispatch)
> - `DESIGN-GOVERNOR-AGENT.md` (upstream work feeder)
> - `SE-GAP-ANALYSIS-TIAGO-GOVERNOR.md` (architectural context)
> - `ORIENTATION-ONTOLOGY.md` (ontology alignment)

---

## 1. Problem Statement

The SynthesisCoordinator is the Factory's multi-agent orchestration
engine. It works. It has crash recovery (fibers), wall-clock timeouts
(alarms), parallel dispatch (layer-based atom execution), and
event-driven coordination (queues + completion ledgers).

But it is hardcoded for one workflow: synthesis. Every structural
element is synthesis-specific:

| Element | Hardcoded As |
|---------|-------------|
| Input type | `WorkGraph` with atoms, invariants, dependencies |
| Agent topology | architect -> critic -> compile -> gate-1 -> planner (Phase 1), then code -> critique -> test -> verify per atom (Phase 2) |
| Agent classes | `ArchitectAgent`, `CriticAgent`, `PlannerAgent`, `CoderAgent`, `TesterAgent`, `VerifierAgent` -- imported directly |
| State shape | `GraphState` with 25+ synthesis-specific fields |
| Output type | `SynthesisResult` with verdict, tokenUsage, repairCount |
| Graph construction | `buildSynthesisGraph()` builds one topology with conditional mode flags |
| Persistence | Synthesis-specific ArangoDB collections and schemas |

When the GovernorAgent needs to orchestrate a multi-agent diagnostic
workflow, or when a refactoring pipeline needs architect -> planner ->
coder -> reviewer, or when an evaluation harness needs generator ->
evaluator -> scorer, each one would need a new Durable Object class
with its own hardcoded topology.

The ConductorDO solves this: one DO class that accepts a typed work
specification including the topology, resolves agents from a registry,
and executes the graph.

---

## 2. JTBD

> When the Factory needs to orchestrate a multi-agent workflow (synthesis,
> refactoring, review, analysis, diagnostic), I want a single Durable
> Object that accepts a typed topology and executes it with crash
> recovery and governance, so I can add new workflow types without
> writing new Durable Object classes.

---

## 3. What It IS and What It Is NOT

### IS

- A Durable Object that receives a `WorkSpec` (typed intent + topology)
- A generalized graph execution engine that resolves agents from a registry
- The successor to `SynthesisCoordinator` (Phase 1 replaces it with identical behavior)
- A runtime for any DAG of agent invocations with serial, parallel, and conditional edges
- A crash-recoverable, alarm-guarded, fiber-backed orchestration unit

### IS NOT

- **Not a Governor.** The GovernorAgent reads signals, makes triage
  decisions, and dispatches work TO the ConductorDO. The ConductorDO
  executes what it is given.
- **Not an Engineer.** The agents spawned BY the ConductorDO do the
  reasoning/coding/testing. The ConductorDO is the conductor, not a
  musician.
- **Not a pipeline stage.** Pipeline stages (Stage 1-5 in ff-pipeline)
  are deterministic transformations. The ConductorDO handles
  non-deterministic multi-agent work with retries and conditional routing.
- **Not a workflow engine.** Cloudflare Workflows handle long-running
  sequential processes with durable step execution. The ConductorDO
  handles agent-graph execution within a single DO lifetime (up to 900s).
  Workflows may invoke the ConductorDO as a step.

---

## 4. WorkSpec Schema

The WorkSpec is the unit of work the ConductorDO accepts. It replaces
the implicit contract of "POST a WorkGraph to /synthesize."

```typescript
/**
 * WorkSpec — the typed input to ConductorDO.
 *
 * Every field that could be inferred from the topology or context
 * is explicit here. No implicit conventions.
 */
export interface WorkSpec {
  /** Unique identifier for this work unit. Used as DO storage key prefix. */
  id: string

  /** Human-readable label for telemetry and logging. */
  label: string

  /**
   * Workflow type. Used by the ConductorDO to select preset topologies
   * when `topology` is not provided inline.
   */
  type: WorkSpecType

  /**
   * Natural language intent. Included in agent context prompts
   * so agents understand the purpose of their invocation.
   */
  intent: string

  /**
   * The execution graph: nodes (agent invocations), edges
   * (dependencies), and parallel groups.
   *
   * When null, the ConductorDO uses a preset topology for the given `type`.
   */
  topology: GraphTopology | null

  /**
   * Input data for the first nodes in the graph.
   * Keys are field names that nodes declare as inputs.
   */
  context: Record<string, unknown>

  /** Governance constraints for this execution. */
  governance: GovernanceConfig

  /** Lineage: IDs of upstream artifacts that produced this WorkSpec. */
  sourceRefs: string[]

  /** Optional callback: queue name to publish results to. */
  resultQueue?: string

  /** Optional: workflow ID for Workflow step coordination. */
  workflowId?: string
}

export type WorkSpecType =
  | 'synthesis'
  | 'refactor'
  | 'review'
  | 'analysis'
  | 'diagnostic'
  | 'evaluation'
  | 'custom'

export interface GovernanceConfig {
  /** Maximum total tokens across all agent invocations. */
  maxTokens: number

  /** Maximum retry attempts per node (not global). */
  maxRetriesPerNode: number

  /** Wall-clock timeout in milliseconds for the entire execution. */
  timeoutMs: number

  /** Maximum graph steps before forced termination (loop guard). */
  maxSteps: number

  /**
   * Whether this execution requires approval at a governance gate.
   * When true, execution pauses at nodes marked `requiresApproval`
   * and waits for an external event.
   */
  requiresApproval: boolean

  /** Who can approve: human (via GitHub/UI), governor (GovernorAgent), auto (no gate). */
  approvalAuthority: 'human' | 'governor' | 'auto'

  /** Budget ceiling. Execution halts if estimated cost exceeds this. */
  maxCostUsd?: number
}
```

---

## 5. GraphTopology Schema

The topology describes the agent graph as a DAG with conditional
edges and parallel groups.

```typescript
/**
 * GraphTopology — the execution graph definition.
 *
 * Nodes are agent invocations. Edges are dependencies.
 * This is the parameterized version of what buildSynthesisGraph()
 * constructs imperatively.
 */
export interface GraphTopology {
  /** Ordered list of node definitions. */
  nodes: TopologyNode[]

  /** Edges between nodes. */
  edges: TopologyEdge[]

  /**
   * Groups of node IDs that can execute concurrently.
   * Nodes in a parallel group must have no edges between them.
   * The ConductorDO validates this constraint at topology load time.
   */
  parallelGroups?: string[][]

  /**
   * Entry point node ID. If not specified, the first node with
   * zero in-degree is used.
   */
  entryPoint?: string
}

export interface TopologyNode {
  /** Unique node ID within this topology. */
  id: string

  /**
   * Agent role key. Resolved via the AgentRegistry.
   * Examples: 'architect', 'semantic-critic', 'coder', 'planner',
   * 'tester', 'verifier', 'governor', 'diagnostician'
   */
  agentRole: string

  /**
   * Input field names. These are resolved from:
   * 1. The WorkSpec's `context` (for root nodes)
   * 2. Upstream node outputs (for dependent nodes)
   *
   * The ConductorDO builds each node's input by collecting
   * these named fields from the accumulated state.
   */
  inputs: string[]

  /**
   * Output field name. This node's result is stored under this key
   * in the accumulated execution state.
   */
  output: string

  /** Per-node retry policy. Overrides governance.maxRetriesPerNode. */
  retryPolicy?: {
    maxAttempts: number
    backoff: 'none' | 'linear' | 'exponential'
    backoffBaseMs?: number
  }

  /**
   * When true, execution pauses before this node and waits for
   * an external approval event. Only honored when
   * governance.requiresApproval is true.
   */
  requiresApproval?: boolean

  /**
   * When true, this node's failure is non-fatal. Execution continues
   * with a null output for this node. Useful for optional enrichment
   * steps (e.g., semantic review that can auto-pass on failure).
   */
  optional?: boolean

  /**
   * Context prompt fragment appended to the agent's system prompt
   * for this specific invocation. Allows topology-level prompt
   * customization without modifying agent implementations.
   */
  contextPromptFragment?: string

  /**
   * Timeout override for this specific node in milliseconds.
   * Defaults to governance.timeoutMs / nodes.length (evenly split).
   */
  timeoutMs?: number
}

export interface TopologyEdge {
  /** Source node ID. */
  from: string

  /** Target node ID. */
  to: string

  /**
   * Edge type:
   * - 'sequential': always traverse (from completes, then to starts)
   * - 'conditional': traverse only when condition evaluates to true
   */
  type: 'sequential' | 'conditional'

  /**
   * Condition expression for conditional edges.
   * Evaluated against the accumulated execution state.
   *
   * Format: a dot-path into the state with a comparison operator.
   * Examples:
   *   "semanticReview.alignment !== 'miscast'"
   *   "verdict.decision === 'pass'"
   *   "critique.passed === true"
   *
   * When the condition is false, the edge is not traversed.
   * If a node has only conditional outgoing edges and none match,
   * execution terminates at that node (equivalent to reaching END).
   */
  condition?: string
}
```

### 5.1 Topology Validation Rules

The ConductorDO validates the topology at load time before execution
begins. Invalid topologies fail fast with a descriptive error.

| Rule | Check | Error |
|------|-------|-------|
| **No cycles** | Run cycle detection on the directed graph | `TOPOLOGY_CYCLE: cycle detected involving nodes [A, B, C]` |
| **No orphan nodes** | Every node must be reachable from the entry point or have zero in-degree | `TOPOLOGY_ORPHAN: node "X" is unreachable` |
| **No missing targets** | Every edge references existing node IDs | `TOPOLOGY_MISSING_NODE: edge references unknown node "Y"` |
| **No missing agents** | Every node's `agentRole` resolves in the registry | `TOPOLOGY_MISSING_AGENT: no agent registered for role "Z"` |
| **Parallel group validity** | Nodes in a parallel group have no edges between them | `TOPOLOGY_PARALLEL_CONFLICT: nodes A and B are in a parallel group but have an edge between them` |
| **Single entry point** | Exactly one entry point (explicit or inferred) | `TOPOLOGY_ENTRY: multiple entry points found` |
| **Condition syntax** | Conditional edge conditions parse correctly | `TOPOLOGY_CONDITION: unparseable condition "..." on edge from A to B` |

---

## 6. Agent Registry

The AgentRegistry replaces the direct `import { ArchitectAgent } from ...`
pattern in the SynthesisCoordinator. Agents register themselves;
topologies reference roles; the registry resolves at runtime.

```typescript
/**
 * AgentCapability — the interface every Factory agent implements.
 *
 * This is intentionally minimal. The ConductorDO does not know what
 * agents do internally. It only knows:
 * 1. The agent accepts typed input
 * 2. The agent produces typed output
 * 3. The agent reports token usage
 */
export interface AgentCapability {
  /**
   * Execute the agent's primary function.
   *
   * @param input - Collected from upstream outputs and WorkSpec context
   * @param opts - Runtime options (dry run, model override, context prompt)
   * @returns The agent's output, to be stored under the node's `output` key
   */
  execute(
    input: Record<string, unknown>,
    opts: AgentExecutionOpts,
  ): Promise<AgentResult>
}

export interface AgentExecutionOpts {
  dryRun: boolean
  model?: { provider: string; model: string }
  contextPrompt?: string
  timeoutMs?: number
}

export interface AgentResult {
  /** The agent's primary output. Stored in execution state. */
  output: unknown
  /** Token usage for this invocation. */
  tokenUsage: number
  /** Duration in milliseconds. */
  durationMs: number
  /** Agent-specific metadata for telemetry. */
  metadata?: Record<string, unknown>
}

/**
 * AgentFactory — creates agent instances with injected dependencies.
 *
 * Factories are registered once at worker startup. The ConductorDO
 * calls `create()` when it needs an agent for a specific node.
 */
export interface AgentFactory {
  /** The role key this factory provides. */
  role: string

  /** Create an agent instance with the given environment. */
  create(deps: AgentFactoryDeps): AgentCapability
}

export interface AgentFactoryDeps {
  db: ArangoClient
  env: ConductorEnv
  hotConfig: HotConfig
  agentContext: AgentContext
}

/**
 * AgentRegistry — resolves agent roles to factory instances.
 *
 * Populated at worker startup. Immutable during execution.
 */
export class AgentRegistry {
  private factories = new Map<string, AgentFactory>()

  register(factory: AgentFactory): void {
    if (this.factories.has(factory.role)) {
      throw new Error(
        `REGISTRY_DUPLICATE: agent role "${factory.role}" already registered`
      )
    }
    this.factories.set(factory.role, factory)
  }

  resolve(role: string): AgentFactory {
    const factory = this.factories.get(role)
    if (!factory) {
      throw new Error(
        `REGISTRY_MISSING: no agent registered for role "${role}". ` +
        `Available roles: [${[...this.factories.keys()].join(', ')}]`
      )
    }
    return factory
  }

  has(role: string): boolean {
    return this.factories.has(role)
  }

  roles(): string[] {
    return [...this.factories.keys()]
  }
}
```

### 6.1 Agent Adapter Pattern

Existing agents (ArchitectAgent, CoderAgent, etc.) do not implement
`AgentCapability` directly. An adapter wraps each existing agent class
to conform to the interface without modifying the agent implementations.

```typescript
/**
 * Example: ArchitectAgentAdapter
 *
 * Wraps the existing ArchitectAgent to implement AgentCapability.
 * No changes to ArchitectAgent required.
 */
export class ArchitectAgentAdapter implements AgentCapability {
  private agent: ArchitectAgent

  constructor(deps: AgentFactoryDeps) {
    const model = resolveAgentModel('planning', deps.hotConfig.routing)
    this.agent = new ArchitectAgent({
      db: deps.db,
      apiKey: keyForModel(model, deps.env),
      dryRun: false,
      model,
      aliasOverrides: deps.hotConfig.aliases['BriefingScript'],
      contextPrompt: formatContextForPrompt(deps.agentContext),
    })
  }

  async execute(
    input: Record<string, unknown>,
    opts: AgentExecutionOpts,
  ): Promise<AgentResult> {
    const start = Date.now()
    const briefingScript = await this.agent.produceBriefingScript({
      signal: input.workGraph as Record<string, unknown>,
      ...(input.specContent ? { specContent: input.specContent as string } : {}),
    })
    return {
      output: briefingScript,
      tokenUsage: 0, // ArchitectAgent tracks internally
      durationMs: Date.now() - start,
    }
  }
}
```

### 6.2 Default Registry Population

```typescript
export function buildDefaultRegistry(): AgentRegistry {
  const registry = new AgentRegistry()

  registry.register({
    role: 'architect',
    create: (deps) => new ArchitectAgentAdapter(deps),
  })
  registry.register({
    role: 'semantic-critic',
    create: (deps) => new SemanticCriticAdapter(deps),
  })
  registry.register({
    role: 'code-critic',
    create: (deps) => new CodeCriticAdapter(deps),
  })
  registry.register({
    role: 'planner',
    create: (deps) => new PlannerAgentAdapter(deps),
  })
  registry.register({
    role: 'coder',
    create: (deps) => new CoderAgentAdapter(deps),
  })
  registry.register({
    role: 'tester',
    create: (deps) => new TesterAgentAdapter(deps),
  })
  registry.register({
    role: 'verifier',
    create: (deps) => new VerifierAgentAdapter(deps),
  })

  // Gate nodes are not agents -- they are deterministic functions.
  // Registered as pseudo-agents with no LLM invocation.
  registry.register({
    role: 'budget-check',
    create: () => new BudgetCheckNode(),
  })
  registry.register({
    role: 'compile',
    create: () => new CompileStubNode(),
  })
  registry.register({
    role: 'gate-1',
    create: () => new Gate1StubNode(),
  })

  return registry
}
```

---

## 7. Execution State

The execution state replaces `GraphState`. Where `GraphState` has
25+ synthesis-specific fields, `ConductorState` is generic: a keyed
map of node outputs plus execution metadata.

```typescript
/**
 * ConductorState — the accumulated state during graph execution.
 *
 * Unlike GraphState, this is not a typed struct with named fields
 * for plan/code/tests/verdict. Instead, each node's output is stored
 * under its declared output key. The ConductorDO does not know or
 * care what shape the outputs have.
 */
export interface ConductorState {
  /** WorkSpec ID. */
  workSpecId: string

  /** WorkSpec type. */
  workSpecType: WorkSpecType

  /**
   * Accumulated outputs from completed nodes.
   * Keys are node output field names. Values are whatever the
   * agent returned.
   */
  outputs: Record<string, unknown>

  /**
   * Initial context from the WorkSpec. Merged with outputs to
   * form node inputs.
   */
  context: Record<string, unknown>

  /**
   * Execution history: which nodes ran, in what order, with what
   * results. This replaces GraphState.roleHistory.
   */
  nodeHistory: NodeExecution[]

  /** Total token usage across all node executions. */
  tokenUsage: number

  /** Total estimated cost in USD. */
  estimatedCostUsd: number

  /** Current execution phase. */
  phase: 'initializing' | 'executing' | 'paused' | 'completed' | 'failed' | 'timed-out'

  /** Terminal result, if execution has completed. */
  result: ConductorResult | null

  /** Retry counts per node ID. */
  retryCounts: Record<string, number>

  /** Node IDs that have been completed. */
  completedNodes: Set<string>

  /** Node IDs that are currently executing (for parallel groups). */
  activeNodes: Set<string>

  /** Node IDs that failed terminally (exhausted retries). */
  failedNodes: Set<string>

  /** Timestamp of last state mutation. */
  lastUpdatedAt: string
}

export interface NodeExecution {
  nodeId: string
  agentRole: string
  startedAt: string
  completedAt: string
  durationMs: number
  tokenUsage: number
  status: 'success' | 'failure' | 'skipped' | 'timed-out'
  error?: string
  /** Size of input provided to the agent (for observability). */
  inputSizeBytes: number
  /** Size of output produced (for observability). */
  outputSizeBytes: number
}

export interface ConductorResult {
  /** Terminal status. */
  status: 'completed' | 'failed' | 'timed-out' | 'interrupted'

  /**
   * Final outputs: the subset of state.outputs that downstream
   * consumers need. For synthesis, this is the verdict. For
   * review, this is the review report. The topology defines
   * which nodes are "terminal" (no outgoing edges).
   */
  terminalOutputs: Record<string, unknown>

  /** Summary statistics. */
  stats: {
    totalNodes: number
    completedNodes: number
    failedNodes: number
    skippedNodes: number
    totalTokenUsage: number
    totalDurationMs: number
    estimatedCostUsd: number
    retryCount: number
  }

  /** Full execution trace for debugging. */
  nodeHistory: NodeExecution[]
}
```

---

## 8. Execution Engine

The ConductorDO's execution engine generalizes the `StateGraph` runner.
The existing `graph-runner.ts` is a simple sequential walker with
conditional edges. The ConductorDO engine adds:

1. **Parallel execution** via `Promise.all` for nodes in parallel groups
2. **Per-node retry** with configurable backoff
3. **Conditional edge evaluation** with safe expression parsing
4. **Approval gates** that pause execution and wait for external events
5. **Budget enforcement** checking token/cost limits before each node
6. **Timeout enforcement** per-node and per-graph

### 8.1 Algorithm

```
EXECUTE(workSpec, registry):
  1. Validate topology (section 5.1 rules)
  2. Initialize ConductorState from workSpec.context
  3. Set DO alarm for governance.timeoutMs
  4. Wrap execution in runFiber for crash recovery
  5. Build execution plan:
     a. Topological sort of nodes
     b. Identify parallel groups
     c. Compute execution layers (nodes with same depth)
  6. For each layer:
     a. For each node in layer:
        i.   Check budget (tokens, cost)
        ii.  Check if node requires approval -> pause if yes
        iii. Collect inputs from state.outputs + state.context
        iv.  Resolve agent from registry
        v.   Execute agent with timeout
        vi.  On success: store output in state.outputs, record in nodeHistory
        vii. On failure:
             - If retries remaining: increment retryCount, backoff, retry
             - If node.optional: store null output, continue
             - If node is required and retries exhausted: fail execution
     b. If parallel group: execute nodes via Promise.all
     c. After layer completes: evaluate conditional edges for next layer
     d. Persist state checkpoint to DO storage
  7. After all layers complete:
     a. Collect terminal outputs (nodes with no outgoing edges)
     b. Build ConductorResult
     c. Publish result to resultQueue if specified
     d. Delete alarm, mark completed
     e. Return result
```

### 8.2 Condition Evaluator

Conditional edges use a safe expression evaluator. No `eval()`. No
arbitrary code execution. The evaluator supports:

```typescript
/**
 * Evaluate a topology condition against the execution state.
 *
 * Supported operators: ===, !==, >, <, >=, <=
 * Supported value types: string, number, boolean, null
 * Supported path format: dot-separated field access
 *
 * Examples:
 *   "semanticReview.alignment !== 'miscast'"
 *   "verdict.decision === 'pass'"
 *   "verdict.confidence >= 0.7"
 *   "critique.passed === true"
 */
export function evaluateCondition(
  condition: string,
  state: Record<string, unknown>,
): boolean {
  const parsed = parseCondition(condition)
  // parsed = { path: string[], operator: string, value: unknown }

  const actual = resolvePath(state, parsed.path)

  switch (parsed.operator) {
    case '===': return actual === parsed.value
    case '!==': return actual !== parsed.value
    case '>':   return typeof actual === 'number' && actual > (parsed.value as number)
    case '<':   return typeof actual === 'number' && actual < (parsed.value as number)
    case '>=':  return typeof actual === 'number' && actual >= (parsed.value as number)
    case '<=':  return typeof actual === 'number' && actual <= (parsed.value as number)
    default:    return false
  }
}

function resolvePath(
  obj: Record<string, unknown>,
  path: string[],
): unknown {
  let current: unknown = obj
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
```

### 8.3 Parallel Execution

Nodes in the same parallel group execute via `Promise.allSettled`.
If any node fails, the others continue to completion (their outputs
may still be useful). Failed nodes are recorded in `failedNodes`.

```typescript
async function executeParallelGroup(
  nodeIds: string[],
  state: ConductorState,
  registry: AgentRegistry,
  deps: AgentFactoryDeps,
): Promise<ConductorState> {
  const promises = nodeIds.map(async (nodeId) => {
    const node = findNode(nodeId)
    return executeNode(node, state, registry, deps)
  })

  const results = await Promise.allSettled(promises)

  let updatedState = { ...state }
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const nodeId = nodeIds[i]
    if (result.status === 'fulfilled') {
      updatedState = mergeNodeResult(updatedState, nodeId, result.value)
    } else {
      updatedState = recordNodeFailure(updatedState, nodeId, result.reason)
    }
  }

  return updatedState
}
```

### 8.4 Approval Gates

When a node has `requiresApproval: true` and `governance.requiresApproval`
is true, execution pauses:

1. The ConductorDO persists current state to DO storage
2. It publishes a `conductor-approval-needed` event to the result queue
3. It sets a secondary alarm (approval timeout)
4. Execution resumes when the DO receives a POST to `/approve`

```typescript
// In the ConductorDO fetch handler:
if (url.pathname === '/approve' && request.method === 'POST') {
  const body = await request.json() as {
    nodeId: string
    approved: boolean
    reason?: string
  }

  if (!body.approved) {
    // Rejection: terminate execution at this node
    const state = await this.ctx.storage.get<ConductorState>('state')
    if (state) {
      state.result = {
        status: 'failed',
        terminalOutputs: state.outputs,
        stats: buildStats(state),
        nodeHistory: state.nodeHistory,
      }
      state.phase = 'failed'
      await this.ctx.storage.put('state', state)
    }
    return new Response(JSON.stringify({ status: 'rejected' }))
  }

  // Approval: resume execution from the paused node
  // The alarm handler or a direct call triggers continuation
  await this.ctx.storage.put('__approval_granted', body.nodeId)
  await this.resumeExecution()

  return new Response(JSON.stringify({ status: 'approved' }))
}
```

---

## 9. ConductorDO Class

```typescript
export interface ConductorEnv {
  // ArangoDB connection (same as CoordinatorEnv)
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string

  // Model provider credentials
  OFOX_API_KEY?: string
  CF_API_TOKEN?: string
  AI?: { run(model: string, input: Record<string, unknown>): Promise<Record<string, unknown>> }

  // Queue bindings
  CONDUCTOR_RESULTS?: { send(body: unknown): Promise<void> }

  // Sandbox binding (optional, for execution nodes)
  SANDBOX?: unknown
}

export class ConductorDO extends Agent<ConductorEnv> {
  private db: ArangoClient | null = null
  private registry: AgentRegistry | null = null

  // ── Initialization ──

  private getDb(): ArangoClient {
    if (!this.db) {
      this.db = createClientFromEnv(this.env)
      this.db.setValidator(validateArtifact)
    }
    return this.db
  }

  private getRegistry(): AgentRegistry {
    if (!this.registry) {
      this.registry = buildDefaultRegistry()
    }
    return this.registry
  }

  // ── HTTP Interface ──

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    switch (url.pathname) {
      case '/execute':
        if (request.method !== 'POST') break
        return this.handleExecute(request)

      case '/approve':
        if (request.method !== 'POST') break
        return this.handleApprove(request)

      case '/status':
        return this.handleStatus()

      case '/cancel':
        if (request.method !== 'POST') break
        return this.handleCancel()
    }

    return new Response('Not found', { status: 404 })
  }

  // ── Execution ──

  private async handleExecute(request: Request): Promise<Response> {
    const workSpec = await request.json() as WorkSpec

    // Idempotency: if already completed, return cached result
    const cached = await this.ctx.storage.get<ConductorResult>('result')
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await this.execute(workSpec)

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async execute(workSpec: WorkSpec): Promise<ConductorResult> {
    // Resolve topology: inline or preset
    const topology = workSpec.topology ?? resolvePresetTopology(workSpec.type)
    if (!topology) {
      return {
        status: 'failed',
        terminalOutputs: {},
        stats: emptyStats(),
        nodeHistory: [],
      }
    }

    // Validate topology
    const validationErrors = validateTopology(topology, this.getRegistry())
    if (validationErrors.length > 0) {
      return {
        status: 'failed',
        terminalOutputs: { validationErrors },
        stats: emptyStats(),
        nodeHistory: [],
      }
    }

    // Initialize state
    const state: ConductorState = {
      workSpecId: workSpec.id,
      workSpecType: workSpec.type,
      outputs: {},
      context: workSpec.context,
      nodeHistory: [],
      tokenUsage: 0,
      estimatedCostUsd: 0,
      phase: 'initializing',
      result: null,
      retryCounts: {},
      completedNodes: new Set(),
      activeNodes: new Set(),
      failedNodes: new Set(),
      lastUpdatedAt: new Date().toISOString(),
    }

    // Set wall-clock alarm
    await this.ctx.storage.put('__completed', false)
    await this.ctx.storage.setAlarm(Date.now() + workSpec.governance.timeoutMs)

    // Execute in fiber for crash recovery
    return this.runFiber(`conductor-${workSpec.id}`, async (fiberCtx) => {
      const deps = await this.buildAgentDeps()

      const engine = new ConductorEngine({
        topology,
        registry: this.getRegistry(),
        deps,
        governance: workSpec.governance,
        onCheckpoint: async (s) => {
          await this.ctx.storage.put('state', s)
          fiberCtx.stash({ workSpecId: workSpec.id, state: s })
        },
        onNodeStart: (nodeId, agentRole) => {
          console.log(`[Conductor] ${workSpec.id}: ${nodeId} (${agentRole}) starting`)
        },
        onNodeComplete: (nodeId, agentRole, durationMs) => {
          console.log(`[Conductor] ${workSpec.id}: ${nodeId} (${agentRole}) completed in ${durationMs}ms`)
        },
      })

      let finalState: ConductorState
      try {
        finalState = await engine.run(state)
      } catch (err) {
        finalState = {
          ...state,
          phase: 'failed',
          result: {
            status: 'failed',
            terminalOutputs: {},
            stats: buildStats(state),
            nodeHistory: state.nodeHistory,
          },
        }
        finalState.result!.terminalOutputs.__error =
          err instanceof Error ? err.message : String(err)
      }

      // Build final result
      const result = finalState.result ?? {
        status: 'completed' as const,
        terminalOutputs: collectTerminalOutputs(topology, finalState),
        stats: buildStats(finalState),
        nodeHistory: finalState.nodeHistory,
      }

      // Persist
      await this.ctx.storage.put('result', result)
      await this.ctx.storage.put('__completed', true)
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.delete('state')

      // Notify via queue
      await this.publishResult(workSpec, result)

      // Write telemetry
      await this.persistTelemetry(workSpec, result)

      return result
    })
  }

  // ── Alarm (wall-clock timeout) ──

  override async alarm(): Promise<void> {
    const completed = await this.ctx.storage.get<boolean>('__completed')
    if (completed) return

    const state = await this.ctx.storage.get<ConductorState>('state')
    const result: ConductorResult = {
      status: 'timed-out',
      terminalOutputs: state?.outputs ?? {},
      stats: state ? buildStats(state) : emptyStats(),
      nodeHistory: state?.nodeHistory ?? [],
    }

    await this.ctx.storage.put('result', result)
    await this.ctx.storage.put('__completed', true)

    const workSpecId = state?.workSpecId ?? 'unknown'
    console.warn(`[Conductor] ${workSpecId}: wall-clock timeout`)

    // Notify via queue
    if (this.env.CONDUCTOR_RESULTS) {
      await this.env.CONDUCTOR_RESULTS.send({
        type: 'conductor-result',
        workSpecId,
        result,
      }).catch(() => {})
    }
  }

  // ── Fiber Recovery ──

  override async onFiberRecovered(ctx: FiberRecoveryContext): Promise<void> {
    const snapshot = ctx.snapshot as {
      workSpecId?: string
      state?: ConductorState
    } | null

    const workSpecId = snapshot?.workSpecId ?? ctx.name.replace('conductor-', '')
    console.warn(
      `[Conductor] Fiber "${ctx.name}" recovered after eviction. ` +
      `WorkSpec=${workSpecId}, age=${Date.now() - ctx.createdAt}ms`
    )

    if (snapshot?.state && snapshot.state.phase === 'executing') {
      const result: ConductorResult = {
        status: 'interrupted',
        terminalOutputs: snapshot.state.outputs,
        stats: buildStats(snapshot.state),
        nodeHistory: snapshot.state.nodeHistory,
      }

      await this.ctx.storage.put('result', result)
      await this.ctx.storage.put('__completed', true)

      if (this.env.CONDUCTOR_RESULTS) {
        await this.env.CONDUCTOR_RESULTS.send({
          type: 'conductor-result',
          workSpecId,
          result,
        }).catch(() => {})
      }
    }
  }

  // ── Status ──

  private async handleStatus(): Promise<Response> {
    const result = await this.ctx.storage.get<ConductorResult>('result')
    if (result) {
      return new Response(JSON.stringify({ phase: 'completed', result }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const state = await this.ctx.storage.get<ConductorState>('state')
    if (state) {
      return new Response(JSON.stringify({
        phase: state.phase,
        completedNodes: [...state.completedNodes],
        activeNodes: [...state.activeNodes],
        failedNodes: [...state.failedNodes],
        tokenUsage: state.tokenUsage,
        nodeHistory: state.nodeHistory,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ phase: 'idle' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Cancel ──

  private async handleCancel(): Promise<Response> {
    const completed = await this.ctx.storage.get<boolean>('__completed')
    if (completed) {
      return new Response(JSON.stringify({ status: 'already-completed' }))
    }

    const state = await this.ctx.storage.get<ConductorState>('state')
    const result: ConductorResult = {
      status: 'interrupted',
      terminalOutputs: state?.outputs ?? {},
      stats: state ? buildStats(state) : emptyStats(),
      nodeHistory: state?.nodeHistory ?? [],
    }

    await this.ctx.storage.put('result', result)
    await this.ctx.storage.put('__completed', true)
    await this.ctx.storage.deleteAlarm()

    return new Response(JSON.stringify({ status: 'cancelled', result }))
  }

  // ── Helpers ──

  private async buildAgentDeps(): Promise<AgentFactoryDeps> {
    const db = this.getDb()
    await seedHotConfig(db).catch(() => {})
    const configLoader = new HotConfigLoader(db)
    const hotConfig = await configLoader.get()
    const agentContext = await prefetchAgentContext(db)

    return { db, env: this.env, hotConfig, agentContext }
  }

  private async publishResult(
    workSpec: WorkSpec,
    result: ConductorResult,
  ): Promise<void> {
    if (!this.env.CONDUCTOR_RESULTS) return
    try {
      await this.env.CONDUCTOR_RESULTS.send({
        type: 'conductor-result',
        workSpecId: workSpec.id,
        workSpecType: workSpec.type,
        workflowId: workSpec.workflowId ?? null,
        result,
      })
    } catch (err) {
      console.error(
        `[Conductor] Result queue publish failed: ` +
        `${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  private async persistTelemetry(
    workSpec: WorkSpec,
    result: ConductorResult,
  ): Promise<void> {
    const db = this.getDb()

    // ORL telemetry
    await db.save('orl_telemetry', {
      schemaName: `_conductor_${workSpec.type}`,
      success: result.status === 'completed',
      failureMode: result.status !== 'completed' ? result.status : null,
      tier: 0,
      repairAttempts: result.stats.retryCount,
      coercions: [],
      timestamp: new Date().toISOString(),
      totalNodes: result.stats.totalNodes,
      completedNodes: result.stats.completedNodes,
      failedNodes: result.stats.failedNodes,
      totalTokenUsage: result.stats.totalTokenUsage,
      totalDurationMs: result.stats.totalDurationMs,
      estimatedCostUsd: result.stats.estimatedCostUsd,
    }).catch(() => {})

    // Episodic memory
    await db.save('memory_episodic', {
      _key: `ep-conductor-${workSpec.id}`,
      action: `conductor-${result.status}`,
      functionId: workSpec.id,
      detail: {
        type: workSpec.type,
        status: result.status,
        totalNodes: result.stats.totalNodes,
        completedNodes: result.stats.completedNodes,
        tokenUsage: result.stats.totalTokenUsage,
        durationMs: result.stats.totalDurationMs,
      },
      timestamp: new Date().toISOString(),
      pain_score: result.status === 'failed' ? 8 : result.status === 'completed' ? 1 : 5,
      importance: 7,
    }).catch(() => {})
  }
}
```

---

## 10. Preset Topologies

Named topologies for common workflow types. Each preset is a function
that returns a `GraphTopology`. The ConductorDO resolves presets when
`workSpec.topology` is null.

### 10.1 Synthesis Preset

This is the 1:1 mapping of the existing SynthesisCoordinator's vertical-slicing
topology. Phase 1 runs in the ConductorDO. Phase 2 (per-atom dispatch)
is handled by the existing AtomExecutor DOs.

```typescript
export function synthesisPlanningTopology(): GraphTopology {
  return {
    entryPoint: 'budget-check',
    nodes: [
      {
        id: 'budget-check',
        agentRole: 'budget-check',
        inputs: ['tokenUsage', 'maxTokens', 'repairCount', 'maxRepairs'],
        output: '__budget_result',
      },
      {
        id: 'architect',
        agentRole: 'architect',
        inputs: ['workGraph', 'specContent'],
        output: 'briefingScript',
      },
      {
        id: 'semantic-critic',
        agentRole: 'semantic-critic',
        inputs: ['workGraph', 'specContent'],
        output: 'semanticReview',
        optional: true,
      },
      {
        id: 'compile',
        agentRole: 'compile',
        inputs: ['workGraph'],
        output: 'compiledPrd',
      },
      {
        id: 'gate-1',
        agentRole: 'gate-1',
        inputs: ['workGraph', 'compiledPrd'],
        output: 'gate1Report',
      },
      {
        id: 'planner',
        agentRole: 'planner',
        inputs: ['workGraph', 'briefingScript', 'specContent'],
        output: 'plan',
      },
    ],
    edges: [
      { from: 'budget-check', to: 'architect', type: 'conditional', condition: "__budget_result.passed === true" },
      { from: 'architect', to: 'semantic-critic', type: 'sequential' },
      { from: 'semantic-critic', to: 'compile', type: 'conditional', condition: "semanticReview.alignment !== 'miscast'" },
      { from: 'compile', to: 'gate-1', type: 'sequential' },
      { from: 'gate-1', to: 'planner', type: 'sequential' },
    ],
  }
}
```

### 10.2 Review Preset

A lightweight topology for code or design review.

```typescript
export function reviewTopology(): GraphTopology {
  return {
    entryPoint: 'reviewer',
    nodes: [
      {
        id: 'reviewer',
        agentRole: 'architect',
        inputs: ['artifact', 'reviewCriteria'],
        output: 'review',
        contextPromptFragment: 'You are reviewing an artifact for quality, correctness, and alignment with Factory standards.',
      },
      {
        id: 'critic',
        agentRole: 'semantic-critic',
        inputs: ['artifact', 'review'],
        output: 'critique',
      },
      {
        id: 'scorer',
        agentRole: 'verifier',
        inputs: ['artifact', 'review', 'critique'],
        output: 'verdict',
      },
    ],
    edges: [
      { from: 'reviewer', to: 'critic', type: 'sequential' },
      { from: 'critic', to: 'scorer', type: 'sequential' },
    ],
  }
}
```

### 10.3 Diagnostic Preset

For GovernorAgent diagnostic sub-tasks (Phase 3 of GovernorAgent evolution).

```typescript
export function diagnosticTopology(): GraphTopology {
  return {
    entryPoint: 'observer',
    nodes: [
      {
        id: 'observer',
        agentRole: 'diagnostician',
        inputs: ['telemetry', 'anomalyDescription'],
        output: 'observations',
      },
      {
        id: 'analyst',
        agentRole: 'architect',
        inputs: ['observations', 'telemetry'],
        output: 'analysis',
        contextPromptFragment: 'You are diagnosing an operational anomaly. Focus on root cause identification.',
      },
      {
        id: 'recommender',
        agentRole: 'planner',
        inputs: ['analysis', 'observations'],
        output: 'recommendation',
        contextPromptFragment: 'Based on the diagnosis, recommend specific corrective actions.',
      },
    ],
    edges: [
      { from: 'observer', to: 'analyst', type: 'sequential' },
      { from: 'analyst', to: 'recommender', type: 'sequential' },
    ],
  }
}
```

### 10.4 Evaluation Preset

For evaluation harness runs (testing prompt changes, model changes).

```typescript
export function evaluationTopology(): GraphTopology {
  return {
    entryPoint: 'generator',
    nodes: [
      {
        id: 'generator',
        agentRole: 'coder',
        inputs: ['evalSpec', 'testCases'],
        output: 'generatedOutputs',
        contextPromptFragment: 'Generate outputs for each test case according to the evaluation spec.',
      },
      {
        id: 'evaluator-a',
        agentRole: 'code-critic',
        inputs: ['generatedOutputs', 'evalSpec'],
        output: 'evaluationA',
      },
      {
        id: 'evaluator-b',
        agentRole: 'semantic-critic',
        inputs: ['generatedOutputs', 'evalSpec'],
        output: 'evaluationB',
      },
      {
        id: 'scorer',
        agentRole: 'verifier',
        inputs: ['evaluationA', 'evaluationB', 'evalSpec'],
        output: 'evalResult',
      },
    ],
    edges: [
      { from: 'generator', to: 'evaluator-a', type: 'sequential' },
      { from: 'generator', to: 'evaluator-b', type: 'sequential' },
      { from: 'evaluator-a', to: 'scorer', type: 'sequential' },
      { from: 'evaluator-b', to: 'scorer', type: 'sequential' },
    ],
    parallelGroups: [['evaluator-a', 'evaluator-b']],
  }
}
```

---

## 11. How the GovernorAgent Feeds the ConductorDO

The GovernorAgent (DESIGN-GOVERNOR-AGENT.md) reads signals, makes triage
decisions, and creates WorkSpecs for the ConductorDO when multi-agent
orchestration is needed.

```
GovernorAgent (Cron every 15 minutes)
  |
  |-- 1. Prefetch context (8 AQL queries)
  |
  |-- 2. LLM assessment -> GovernanceCycleResult
  |
  |-- 3. For each decision:
  |     |
  |     |-- action: 'trigger_pipeline'
  |     |     Validate auto-trigger criteria (deterministic gate)
  |     |     Create pipeline via Workflow (existing path)
  |     |
  |     |-- action: 'diagnose_failure' [NEW]
  |     |     Build a diagnostic WorkSpec
  |     |     Dispatch to ConductorDO via CONDUCTOR_QUEUE
  |     |     ConductorDO runs diagnostic topology
  |     |     Result written to orientation_assessments
  |     |
  |     |-- action: 'evaluate_change' [FUTURE]
  |     |     Build an evaluation WorkSpec
  |     |     Dispatch to ConductorDO
  |     |     ConductorDO runs evaluation topology
  |     |     Result informs next governance decision
  |
  v
ConductorDO (invoked per WorkSpec)
  |
  |-- Resolves topology (preset or inline)
  |-- Resolves agents from registry
  |-- Executes graph with retries, timeouts, checkpoints
  |-- Publishes result to CONDUCTOR_RESULTS queue
  |
  v
Queue Consumer (in ff-pipeline index.ts)
  |
  |-- Reads ConductorResult
  |-- Routes to appropriate handler:
  |     synthesis -> existing workflow notification path
  |     diagnostic -> save to orientation_assessments
  |     evaluation -> save to orl_telemetry
  |-- Acks message
```

### 11.1 WorkSpec Construction Example

```typescript
// In GovernorAgent.execute(), when decision.action === 'diagnose_failure':
const workSpec: WorkSpec = {
  id: `diag-${decision.target}-${Date.now()}`,
  label: `Diagnostic: ${decision.reason}`,
  type: 'diagnostic',
  intent: decision.reason,
  topology: null, // use preset
  context: {
    telemetry: relevantTelemetryEntries,
    anomalyDescription: decision.reason,
    evidenceKeys: decision.evidence,
  },
  governance: {
    maxTokens: 50_000,
    maxRetriesPerNode: 1,
    timeoutMs: 120_000,
    maxSteps: 10,
    requiresApproval: false,
    approvalAuthority: 'auto',
  },
  sourceRefs: decision.evidence,
  resultQueue: 'conductor-results',
}
```

---

## 12. State Management and Crash Recovery

### 12.1 State Checkpoints

The ConductorDO writes state to DO storage after every node completion.
This is the crash recovery mechanism. If the DO is evicted:

1. `onFiberRecovered` fires
2. The stashed state is read from the fiber
3. The ConductorDO marks execution as interrupted
4. The result is published via queue
5. The caller can retry with the same WorkSpec ID (idempotency)

### 12.2 Serialization Constraints

`ConductorState.completedNodes`, `activeNodes`, and `failedNodes` are
`Set<string>` in memory but must be serialized as `string[]` for DO
storage. The engine converts on read/write.

```typescript
function serializeState(state: ConductorState): Record<string, unknown> {
  return {
    ...state,
    completedNodes: [...state.completedNodes],
    activeNodes: [...state.activeNodes],
    failedNodes: [...state.failedNodes],
  }
}

function deserializeState(raw: Record<string, unknown>): ConductorState {
  return {
    ...raw,
    completedNodes: new Set(raw.completedNodes as string[]),
    activeNodes: new Set(raw.activeNodes as string[]),
    failedNodes: new Set(raw.failedNodes as string[]),
  } as ConductorState
}
```

### 12.3 Idempotency

The ConductorDO is idempotent per WorkSpec ID. If `/execute` is called
with a WorkSpec whose ID matches a completed execution, the cached
result is returned immediately. This prevents duplicate executions when
queue messages are retried.

### 12.4 Storage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `state` | `ConductorState` | In-progress execution state |
| `result` | `ConductorResult` | Completed execution result |
| `__completed` | `boolean` | Guard for alarm handler |
| `__approval_granted` | `string` | Node ID that was approved |
| `__workSpecId` | `string` | For alarm handler context |

---

## 13. Observability

### 13.1 ORL Telemetry

Every ConductorDO execution writes to `orl_telemetry` with schema name
`_conductor_{type}` (e.g., `_conductor_synthesis`, `_conductor_diagnostic`).

Fields:
- `success`: boolean
- `failureMode`: null | 'failed' | 'timed-out' | 'interrupted'
- `totalNodes`: number
- `completedNodes`: number
- `failedNodes`: number
- `totalTokenUsage`: number
- `totalDurationMs`: number
- `estimatedCostUsd`: number
- `retryCount`: number (sum of all per-node retries)

### 13.2 Node-Level Telemetry

Each `NodeExecution` in the result's `nodeHistory` contains:
- Node ID and agent role
- Start/complete timestamps
- Duration in milliseconds
- Token usage
- Success/failure status
- Error message (on failure)
- Input/output sizes in bytes

### 13.3 Episodic Memory

Every execution writes to `memory_episodic` with action
`conductor-{status}`, enabling the MemoryCuratorAgent to learn from
orchestration patterns across all workflow types.

### 13.4 GovernorAgent Queries

The GovernorAgent can observe ConductorDO health via existing AQL patterns:

```aql
-- ConductorDO execution outcomes (7-day)
FOR t IN orl_telemetry
  FILTER t.schemaName LIKE '_conductor_%'
  FILTER t.timestamp >= DATE_SUBTRACT(DATE_NOW(), 7, 'day')
  COLLECT type = SUBSTRING(t.schemaName, 11) // strip '_conductor_'
  AGGREGATE
    success = SUM(t.success ? 1 : 0),
    fail = SUM(t.success ? 0 : 1),
    avg_duration = AVG(t.totalDurationMs),
    avg_tokens = AVG(t.totalTokenUsage)
  RETURN { type, success, fail, avg_duration, avg_tokens }
```

---

## 14. How SynthesisCoordinator Becomes a WorkSpec

The migration path from SynthesisCoordinator to ConductorDO begins with
demonstrating behavioral equivalence. Here is the exact mapping.

### 14.1 Current SynthesisCoordinator Flow

```
POST /synthesize { workGraph, dryRun, specContent }
  |
  v
Phase 1 (serial graph):
  budget-check -> architect -> semantic-critic -> compile -> gate-1 -> planner
  |
  v
Phase 2 (parallel dispatch via queue):
  topologicalSort(atoms) -> dispatch layer 0 to SYNTHESIS_QUEUE
  |
  v
Return SynthesisResult with verdict: 'dispatched'
```

### 14.2 Equivalent ConductorDO WorkSpec

```typescript
const synthesisWorkSpec: WorkSpec = {
  id: `synth-${workGraphId}`,
  label: `Synthesis: ${workGraph.title}`,
  type: 'synthesis',
  intent: 'Execute Phase 1 synthesis planning pipeline',
  topology: synthesisPlanningTopology(), // preset from section 10.1
  context: {
    workGraph,
    specContent: specContent ?? null,
    tokenUsage: 0,
    maxTokens: 150_000,
    repairCount: 0,
    maxRepairs: 5,
  },
  governance: {
    maxTokens: 150_000,
    maxRetriesPerNode: 2,
    timeoutMs: Math.max(900_000, 900_000 + atomCount * 30_000),
    maxSteps: 20,
    requiresApproval: false,
    approvalAuthority: 'auto',
  },
  sourceRefs: [workGraphId],
  resultQueue: 'synthesis-results',
  workflowId,
}
```

### 14.3 What Changes for Phase 2

Phase 2 (atom dispatch) does NOT move into the ConductorDO. Atom dispatch
uses the existing `SYNTHESIS_QUEUE` + `AtomExecutor` DO pattern. The
ConductorDO's synthesis preset produces a plan as its terminal output.
The queue consumer reads the plan from the ConductorResult and dispatches
atoms using the existing `completion-ledger` + `layer-dispatch` pattern.

This preserves the event-driven, non-blocking Phase 2 architecture that
was specifically designed to work around CF's DO-to-DO fetch restrictions.

### 14.4 Behavioral Equivalence Checklist

| Behavior | SynthesisCoordinator | ConductorDO + Synthesis Preset |
|----------|---------------------|-------------------------------|
| Input | WorkGraph via POST /synthesize | WorkSpec via POST /execute |
| Topology | buildSynthesisGraph() with verticalSlicing=true | synthesisPlanningTopology() preset |
| Agent resolution | Direct imports | AgentRegistry with adapters |
| State shape | GraphState (25+ typed fields) | ConductorState.outputs (generic map) |
| Crash recovery | runFiber + onFiberRecovered | runFiber + onFiberRecovered (same pattern) |
| Wall-clock timeout | DO alarm | DO alarm (same pattern) |
| Conditional routing | semantic-critic miscast -> END | Condition: "semanticReview.alignment !== 'miscast'" |
| Budget check | Inline node in graph | budget-check pseudo-agent in registry |
| Result notification | SYNTHESIS_RESULTS queue | CONDUCTOR_RESULTS queue |
| Telemetry | orl_telemetry, memory_episodic, execution_artifacts | orl_telemetry, memory_episodic (same collections) |
| Idempotency | Check persisted GraphState verdict | Check cached ConductorResult |
| Phase 2 dispatch | Inline in coordinator.ts | External: queue consumer reads ConductorResult.plan, dispatches atoms |

---

## 15. Risk Assessment

### Risk 1: Over-Generalization Makes Debugging Harder

**What can go wrong?** The SynthesisCoordinator has typed state with
named fields (plan, code, tests, verdict). The ConductorDO has a generic
`outputs` map. When debugging a failed synthesis, you have to know which
output key corresponds to which pipeline stage.

**Likelihood:** HIGH (generalization always trades debuggability for flexibility).

**Impact:** MEDIUM. Developers must learn the topology's output key naming
convention instead of reading typed field names.

**Mitigation:**
1. Preset topologies use the same output key names as the current GraphState
   fields (briefingScript, semanticReview, plan, etc.)
2. Node-level telemetry in nodeHistory shows which agent ran for which node
3. The ConductorDO's /status endpoint returns structured execution state
4. ConductorResult includes full nodeHistory trace

**Residual risk:** LOW. The preset topologies maintain naming continuity.
Custom topologies can use any names but are authored by the topology
designer, who controls the naming.

### Risk 2: Infinite Loops in Conditional Edges

**What can go wrong?** A topology with conditional edges that form a
cycle (e.g., verifier -> budget-check -> planner -> coder -> verifier)
could loop indefinitely if the termination condition is never met.

**Likelihood:** MEDIUM (the synthesis topology has this pattern today:
verifier routes back to budget-check on patch/resample).

**Impact:** HIGH. Runaway execution burns tokens and wall-clock time.

**Mitigation:**
1. `governance.maxSteps` limits total node executions (default 20)
2. `governance.timeoutMs` sets a wall-clock ceiling
3. `governance.maxTokens` sets a token ceiling
4. DO alarm fires at timeoutMs regardless of graph state
5. Topology validation detects cycles and warns (but does not block,
   because repair loops are intentional cycles with termination conditions)

**Residual risk:** LOW. Triple-layered protection (steps, time, tokens).

### Risk 3: Agent Registry Missing a Role

**What can go wrong?** A topology references an `agentRole` that has no
registered factory.

**Likelihood:** LOW for preset topologies (they use known roles). MEDIUM
for custom topologies.

**Impact:** LOW. Caught at validation time before execution begins.

**Mitigation:** Topology validation (section 5.1) checks every node's
agentRole against the registry. Fails fast with `TOPOLOGY_MISSING_AGENT`.

**Residual risk:** NEGLIGIBLE.

### Risk 4: State Corruption on DO Eviction

**What can go wrong?** The DO is evicted between a node completing and
the state checkpoint being written.

**Likelihood:** LOW (Cloudflare DO eviction is rare during active I/O).

**Impact:** MEDIUM. The completed node's output is lost. On fiber recovery,
the execution is marked interrupted, not corrupted.

**Mitigation:**
1. State checkpoints after every node completion (same as SynthesisCoordinator)
2. Fiber stash provides a secondary recovery path
3. Idempotency: caller can retry with the same WorkSpec ID
4. Atomic writes: each checkpoint is a single `ctx.storage.put`

**Residual risk:** LOW. Same risk profile as the existing SynthesisCoordinator,
which has been running in production.

### Risk 5: Adapter Overhead

**What can go wrong?** Wrapping existing agents in AgentCapability adapters
adds indirection. If the adapter mishandles input/output translation,
agents receive wrong inputs.

**Likelihood:** MEDIUM during initial implementation.

**Impact:** HIGH. Wrong inputs produce wrong outputs.

**Mitigation:**
1. Phase 1 runs the synthesis preset with full test coverage against the
   existing SynthesisCoordinator's behavior
2. Adapters are thin wrappers (10-20 lines each), easy to audit
3. Integration tests compare ConductorDO output to SynthesisCoordinator
   output for identical inputs (dry-run mode)

**Residual risk:** LOW after Phase 1 validation.

### Risk 6: Topology Condition Injection

**What can go wrong?** Condition strings in topology edges are evaluated
against state. If conditions are user-supplied and the evaluator has
vulnerabilities, this could be exploited.

**Likelihood:** LOW. Topologies are authored by Factory agents and
developers, not external users.

**Impact:** LOW. The condition evaluator (section 8.2) is a safe parser
with no `eval()`, no code execution, and only comparisons against
primitive values.

**Mitigation:** The evaluator supports only dot-path access and comparison
operators. No function calls, no property assignment, no prototype access.

**Residual risk:** NEGLIGIBLE.

### Risk 7: Cost Overrun from Parallel Groups

**What can go wrong?** Large parallel groups (e.g., 10+ nodes) all invoke
LLM agents simultaneously, spiking token usage and cost.

**Likelihood:** LOW for preset topologies. MEDIUM for custom topologies.

**Impact:** MEDIUM. Cost is linear in node count.

**Mitigation:**
1. `governance.maxTokens` enforced before each node execution
2. `governance.maxCostUsd` optional ceiling
3. Parallel groups are opt-in (must be explicitly declared in topology)
4. Budget-check pseudo-agent can be placed before parallel groups

**Residual risk:** LOW.

---

## 16. Migration Path

### Phase 1: ConductorDO with Synthesis Preset (Replaces SynthesisCoordinator)

**Scope:**
- Implement ConductorDO, AgentRegistry, ConductorEngine
- Implement agent adapters for all 6 existing agents + 3 pseudo-agents
- Implement synthesis planning preset topology
- Full test coverage: dry-run behavioral equivalence with SynthesisCoordinator
- Wire ConductorDO in wrangler.jsonc as a new DO class
- Wire queue consumer to route synthesis WorkSpecs to ConductorDO
- SynthesisCoordinator remains deployed in parallel (shadow mode)

**Acceptance criteria:**
- ConductorDO produces identical outputs to SynthesisCoordinator for the same WorkGraph inputs (dry-run)
- ConductorDO crash recovery works (fiber eviction test)
- ConductorDO wall-clock timeout works (alarm test)
- ORL telemetry entries are written with correct schema names

**Duration estimate:** 2-3 days.

### Phase 2: Additional Preset Topologies

**Scope:**
- Implement review topology
- Implement diagnostic topology
- Implement evaluation topology
- Register new agent roles (diagnostician, evaluator)
- Wire GovernorAgent to dispatch diagnostic WorkSpecs to ConductorDO

**Acceptance criteria:**
- Each preset topology passes dry-run tests
- GovernorAgent can dispatch and receive results for diagnostic workflows
- ORL telemetry distinguishes topology types

**Duration estimate:** 2-3 days.

### Phase 3: Dynamic Topology Construction

**Scope:**
- GovernorAgent constructs custom topologies based on signal characteristics
- Topology templates with variable substitution
- Runtime topology validation before dispatch

**Acceptance criteria:**
- GovernorAgent produces valid custom topologies for novel signal types
- Topology validation catches all invalid topologies
- ConductorDO executes dynamically-constructed topologies correctly

**Duration estimate:** 3-5 days.

### Phase 4: Self-Modifying Topologies

**Scope:**
- Orientation Agents propose topology changes as MetaArtifacts
- ConductorDO supports topology versioning
- A/B testing of topology variants
- Topology performance metrics feed back into topology selection

**Acceptance criteria:**
- Topology changes are governed by PromptPact constraints
- A/B test results are recorded in ORL telemetry
- The GovernorAgent selects topologies based on historical performance

**Duration estimate:** 5-8 days (requires careful governance design).

---

## 17. File Structure

```
workers/ff-pipeline/src/conductor/
  conductor-do.ts          -- ConductorDO class (extends Agent)
  conductor-engine.ts      -- Graph execution engine
  conductor-state.ts       -- ConductorState, ConductorResult types
  conductor-types.ts       -- WorkSpec, GraphTopology, GovernanceConfig types
  agent-registry.ts        -- AgentRegistry class
  agent-adapters.ts        -- Adapters wrapping existing agents
  condition-evaluator.ts   -- Safe condition expression parser
  topology-validator.ts    -- Topology validation rules
  topology-presets.ts      -- Named preset topologies
  __tests__/
    conductor-do.test.ts
    conductor-engine.test.ts
    condition-evaluator.test.ts
    topology-validator.test.ts
    topology-presets.test.ts
    behavioral-equivalence.test.ts  -- ConductorDO vs SynthesisCoordinator
```

The existing `coordinator/` directory remains untouched until Phase 1
is validated. Migration is additive, not destructive.

---

## 18. Wiring Changes

### 18.1 wrangler.jsonc

```jsonc
{
  "durable_objects": {
    "bindings": [
      // Existing
      { "name": "SYNTHESIS_COORDINATOR", "class_name": "SynthesisCoordinator" },
      { "name": "ATOM_EXECUTOR", "class_name": "AtomExecutor" },
      // New
      { "name": "CONDUCTOR", "class_name": "ConductorDO" }
    ]
  },
  "queues": {
    "consumers": [
      // Existing consumers...
      // New
      { "queue": "conductor-results", "max_batch_size": 1 }
    ],
    "producers": [
      // Existing producers...
      // New
      { "queue": "conductor-results", "binding": "CONDUCTOR_RESULTS" }
    ]
  }
}
```

### 18.2 index.ts Exports

```typescript
// Add to existing exports:
export { ConductorDO } from './conductor/conductor-do'
```

### 18.3 Queue Consumer

```typescript
// In the queue handler, add a case for conductor-results:
if (batch.queue === 'conductor-results') {
  for (const msg of batch.messages) {
    const payload = msg.body as {
      type: 'conductor-result'
      workSpecId: string
      workSpecType: string
      workflowId: string | null
      result: ConductorResult
    }

    // Route based on workSpec type
    switch (payload.workSpecType) {
      case 'synthesis':
        // Forward to existing synthesis result handling
        if (payload.workflowId) {
          const workflow = await env.FACTORY_PIPELINE.get(payload.workflowId)
          await workflow.sendEvent({
            type: 'synthesis-result',
            result: payload.result,
          })
        }
        break

      case 'diagnostic':
        // Save diagnostic results to orientation_assessments
        await db.save('orientation_assessments', {
          type: 'conductor_diagnostic',
          workSpecId: payload.workSpecId,
          result: payload.result,
          createdAt: new Date().toISOString(),
        })
        break

      case 'evaluation':
        // Save evaluation results to orl_telemetry
        await db.save('orl_telemetry', {
          schemaName: '_conductor_eval',
          ...payload.result.stats,
          timestamp: new Date().toISOString(),
        })
        break
    }

    msg.ack()
  }
}
```

---

## 19. Ontology Classification

```
ConductorDO

  ontology_type: OrchestrationRuntime (new class — not an OrientationAgent)

  relationship_to_ontology:
    - Executes workflows defined as GraphTopology instances
    - Produces TelemetryObservation (orl_telemetry entries)
    - Produces FactoryMemory (memory_episodic entries)
    - Consumes Signal indirectly (via GovernorAgent -> WorkSpec)
    - Does NOT produce OrientationAssessment (agents within the topology may)
    - Does NOT produce MetaArtifact (it is a runtime, not an interpreter)

  relationship_to_agents:
    - Contains: any agent registered in AgentRegistry
    - Invoked by: GovernorAgent, FactoryPipeline Workflow, HTTP API
    - Observes: nothing directly (it executes, it does not observe)
    - Produces: ConductorResult (new artifact type)

  autonomy_level: L1_Execute
    - The ConductorDO does not make decisions
    - It executes the topology it is given
    - Agent nodes within the topology operate at their own autonomy levels
    - The ConductorDO enforces governance constraints but does not interpret them

  decision_algebra: N/A (conductor does not make decisions; it runs a DAG)
```

---

## 20. Decision Algebra Alignment (Design-Level)

The decision to build the ConductorDO, mapped to the Ontology's Decision Algebra:

```
D = <I, C, P, E, A, X, O, J, T>

I (Intent)     = Generalize multi-agent orchestration so new workflow types
                 do not require new Durable Object classes
C (Context)    = SynthesisCoordinator (working reference implementation),
                 GovernorAgent (needs orchestration for diagnostics),
                 Orientation Ontology (agent taxonomy)
P (Policy)     = Event-driven default, TDD mandatory, Architect reviews
                 everything, 3-strikes rule
E (Evidence)   = SynthesisCoordinator has 6 hardcoded agent imports,
                 25+ hardcoded state fields, 3 topology modes controlled
                 by boolean flags. Adding a 4th workflow type would require
                 a 4th boolean flag or a new DO class.
A (Authority)  = Architect Agent (design), pending Wes's gate
X (Action)     = ConductorDO design with AgentRegistry, WorkSpec, GraphTopology
O (Outcome)    = Single DO class handles synthesis, review, diagnostic,
                 evaluation, and custom workflows via parameterized topologies
J (Justification) = The existing pattern works but does not scale to N
                 workflow types. The Factory's evolution path (GovernorAgent
                 Phase 3, self-modifying topologies) requires a general
                 orchestration runtime.
T (Time)       = 2026-04-29, bootstrap phase, pre-implementation design
```

---

## Appendix A: SynthesisCoordinator Decomposition

What moves into the ConductorDO and what stays:

| SynthesisCoordinator Element | ConductorDO Element | Notes |
|-------|--------|-------|
| `class SynthesisCoordinator extends Agent` | `class ConductorDO extends Agent` | New class, same base |
| `fetch()` handler: POST /synthesize | POST /execute | Same pattern, different schema |
| `alarm()` handler | `alarm()` handler | Identical pattern |
| `onFiberRecovered()` | `onFiberRecovered()` | Identical pattern |
| `synthesize()` method | `execute()` method | Generalized |
| `buildSynthesisGraph()` | `synthesisPlanningTopology()` preset | Declarative instead of imperative |
| Direct agent imports (6 agents) | AgentRegistry resolution | Decoupled |
| `GraphState` (25+ fields) | `ConductorState.outputs` (generic map) | Generalized |
| `SynthesisResult` | `ConductorResult` | Generalized |
| Phase 2 atom dispatch (inline) | External (queue consumer) | Moved out of DO |
| `persistSynthesisResult()` | `persistTelemetry()` | Generalized |
| `notifyCallback()` via SYNTHESIS_RESULTS | `publishResult()` via CONDUCTOR_RESULTS | Same pattern, different queue |
| `dryRunModelBridge()` | Agent adapters handle dryRun | Moved into agents |
| `buildSandboxDeps()` | Agent adapters handle sandbox | Moved into agents |
| Hot config loading | Passed to AgentFactoryDeps | Shared initialization |
| Context prefetch | Passed to AgentFactoryDeps | Shared initialization |
| CRP auto-generation | Post-execution hook in queue consumer | Moved out of DO |

---

## Appendix B: ConductorEngine Pseudocode

```typescript
export class ConductorEngine {
  constructor(private opts: {
    topology: GraphTopology
    registry: AgentRegistry
    deps: AgentFactoryDeps
    governance: GovernanceConfig
    onCheckpoint: (state: ConductorState) => Promise<void>
    onNodeStart?: (nodeId: string, agentRole: string) => void
    onNodeComplete?: (nodeId: string, agentRole: string, durationMs: number) => void
  }) {}

  async run(initialState: ConductorState): Promise<ConductorState> {
    let state = { ...initialState, phase: 'executing' as const }
    let steps = 0

    // Build execution plan
    const layers = this.computeLayers()
    const nodeMap = new Map(this.opts.topology.nodes.map(n => [n.id, n]))

    for (const layer of layers) {
      // Check termination conditions
      if (steps >= this.opts.governance.maxSteps) {
        state.phase = 'failed'
        state.result = {
          status: 'failed',
          terminalOutputs: state.outputs,
          stats: buildStats(state),
          nodeHistory: state.nodeHistory,
        }
        break
      }

      if (state.tokenUsage >= this.opts.governance.maxTokens) {
        state.phase = 'failed'
        state.result = {
          status: 'failed',
          terminalOutputs: state.outputs,
          stats: buildStats(state),
          nodeHistory: state.nodeHistory,
        }
        break
      }

      // Filter layer nodes: only execute nodes whose incoming edges are satisfied
      const executableNodes = layer.filter(nodeId => {
        const incomingEdges = this.opts.topology.edges.filter(e => e.to === nodeId)
        return incomingEdges.every(edge => {
          if (edge.type === 'sequential') {
            return state.completedNodes.has(edge.from)
          }
          if (edge.type === 'conditional') {
            return state.completedNodes.has(edge.from) &&
              evaluateCondition(edge.condition!, state.outputs)
          }
          return false
        })
      })

      // Check if any nodes in this layer are in a parallel group
      const parallelGroup = this.opts.topology.parallelGroups?.find(
        group => executableNodes.some(id => group.includes(id))
      )

      if (parallelGroup) {
        // Parallel execution
        const parallelNodes = executableNodes.filter(id => parallelGroup.includes(id))
        const serialNodes = executableNodes.filter(id => !parallelGroup.includes(id))

        // Execute parallel group
        if (parallelNodes.length > 0) {
          state = await this.executeParallel(parallelNodes, state, nodeMap)
          steps += parallelNodes.length
        }

        // Execute serial nodes
        for (const nodeId of serialNodes) {
          state = await this.executeNode(nodeId, state, nodeMap)
          steps++
          await this.opts.onCheckpoint(state)
        }
      } else {
        // Serial execution
        for (const nodeId of executableNodes) {
          state = await this.executeNode(nodeId, state, nodeMap)
          steps++
          await this.opts.onCheckpoint(state)
        }
      }
    }

    // Collect terminal outputs
    if (!state.result) {
      state.phase = 'completed'
      state.result = {
        status: 'completed',
        terminalOutputs: collectTerminalOutputs(this.opts.topology, state),
        stats: buildStats(state),
        nodeHistory: state.nodeHistory,
      }
    }

    return state
  }

  private async executeNode(
    nodeId: string,
    state: ConductorState,
    nodeMap: Map<string, TopologyNode>,
  ): Promise<ConductorState> {
    const node = nodeMap.get(nodeId)!
    const factory = this.opts.registry.resolve(node.agentRole)
    const agent = factory.create(this.opts.deps)

    this.opts.onNodeStart?.(nodeId, node.agentRole)

    // Collect inputs
    const input: Record<string, unknown> = {}
    for (const key of node.inputs) {
      input[key] = state.outputs[key] ?? state.context[key]
    }

    const retryPolicy = node.retryPolicy ?? {
      maxAttempts: this.opts.governance.maxRetriesPerNode,
      backoff: 'none' as const,
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= retryPolicy.maxAttempts; attempt++) {
      try {
        // Backoff on retry
        if (attempt > 0 && retryPolicy.backoff !== 'none') {
          const baseMs = retryPolicy.backoffBaseMs ?? 1000
          const delayMs = retryPolicy.backoff === 'linear'
            ? baseMs * attempt
            : baseMs * Math.pow(2, attempt - 1)
          // Note: setTimeout in DOs is unreliable (frozen during I/O suspension).
          // Use a simple busy-wait or accept that backoff may be shorter than
          // specified. In practice, the LLM call itself provides sufficient
          // inter-retry delay.
        }

        const result = await agent.execute(input, {
          dryRun: false, // WorkSpec-level dryRun would be in governance
          contextPrompt: node.contextPromptFragment,
          timeoutMs: node.timeoutMs,
        })

        // Success
        const execution: NodeExecution = {
          nodeId,
          agentRole: node.agentRole,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: result.durationMs,
          tokenUsage: result.tokenUsage,
          status: 'success',
          inputSizeBytes: JSON.stringify(input).length,
          outputSizeBytes: JSON.stringify(result.output).length,
        }

        this.opts.onNodeComplete?.(nodeId, node.agentRole, result.durationMs)

        return {
          ...state,
          outputs: { ...state.outputs, [node.output]: result.output },
          nodeHistory: [...state.nodeHistory, execution],
          tokenUsage: state.tokenUsage + result.tokenUsage,
          completedNodes: new Set([...state.completedNodes, nodeId]),
          retryCounts: {
            ...state.retryCounts,
            [nodeId]: attempt,
          },
          lastUpdatedAt: new Date().toISOString(),
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        state = {
          ...state,
          retryCounts: { ...state.retryCounts, [nodeId]: attempt },
        }
      }
    }

    // All retries exhausted
    if (node.optional) {
      // Optional node: record as skipped, continue
      const execution: NodeExecution = {
        nodeId,
        agentRole: node.agentRole,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        tokenUsage: 0,
        status: 'skipped',
        error: lastError?.message,
        inputSizeBytes: 0,
        outputSizeBytes: 0,
      }

      return {
        ...state,
        outputs: { ...state.outputs, [node.output]: null },
        nodeHistory: [...state.nodeHistory, execution],
        completedNodes: new Set([...state.completedNodes, nodeId]),
        lastUpdatedAt: new Date().toISOString(),
      }
    }

    // Required node failed: terminate execution
    const execution: NodeExecution = {
      nodeId,
      agentRole: node.agentRole,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      tokenUsage: 0,
      status: 'failure',
      error: lastError?.message,
      inputSizeBytes: 0,
      outputSizeBytes: 0,
    }

    return {
      ...state,
      nodeHistory: [...state.nodeHistory, execution],
      failedNodes: new Set([...state.failedNodes, nodeId]),
      phase: 'failed',
      result: {
        status: 'failed',
        terminalOutputs: {
          ...state.outputs,
          __failedNode: nodeId,
          __error: lastError?.message,
        },
        stats: buildStats(state),
        nodeHistory: [...state.nodeHistory, execution],
      },
      lastUpdatedAt: new Date().toISOString(),
    }
  }
}
```

---

## Appendix C: Test Plan

### Unit Tests

| Test | File | What It Validates |
|------|------|-------------------|
| Condition evaluator: === | condition-evaluator.test.ts | String, number, boolean equality |
| Condition evaluator: !== | condition-evaluator.test.ts | Inequality |
| Condition evaluator: >, <, >=, <= | condition-evaluator.test.ts | Numeric comparisons |
| Condition evaluator: nested paths | condition-evaluator.test.ts | Deep property access |
| Condition evaluator: missing paths | condition-evaluator.test.ts | Returns false for undefined |
| Topology validator: valid topology | topology-validator.test.ts | Passes validation |
| Topology validator: cycle detection | topology-validator.test.ts | Detects and reports cycles |
| Topology validator: orphan nodes | topology-validator.test.ts | Detects unreachable nodes |
| Topology validator: missing agents | topology-validator.test.ts | Checks registry |
| Topology validator: parallel group conflict | topology-validator.test.ts | Detects edges within parallel groups |
| AgentRegistry: register + resolve | agent-registry.test.ts | Basic registration and resolution |
| AgentRegistry: duplicate role | agent-registry.test.ts | Throws on duplicate |
| AgentRegistry: missing role | agent-registry.test.ts | Throws with available roles list |

### Integration Tests

| Test | File | What It Validates |
|------|------|-------------------|
| Synthesis preset: dry-run | behavioral-equivalence.test.ts | ConductorDO produces same outputs as SynthesisCoordinator for identical WorkGraph |
| Review preset: dry-run | conductor-engine.test.ts | 3-node review topology runs to completion |
| Diagnostic preset: dry-run | conductor-engine.test.ts | 3-node diagnostic topology runs to completion |
| Parallel execution: evaluation | conductor-engine.test.ts | Two evaluators run concurrently |
| Retry: node failure + recovery | conductor-engine.test.ts | Failed node retries and succeeds |
| Retry: node exhaustion | conductor-engine.test.ts | Failed node exhausts retries, optional=true skips |
| Retry: required node exhaustion | conductor-engine.test.ts | Failed required node terminates execution |
| Budget enforcement | conductor-engine.test.ts | Execution halts when token budget exceeded |
| Step limit | conductor-engine.test.ts | Execution halts at maxSteps |
| Conditional edge: true | conductor-engine.test.ts | Edge traversed when condition true |
| Conditional edge: false | conductor-engine.test.ts | Edge not traversed, execution terminates |
| Crash recovery | conductor-do.test.ts | Fiber recovery produces interrupted result |
| Idempotency | conductor-do.test.ts | Second call returns cached result |
| Wall-clock timeout | conductor-do.test.ts | Alarm fires, timed-out result produced |

---

## Appendix D: Relationship Diagram

```
                    +-----------+
                    |   Wes     |
                    | (Architect)|
                    +-----+-----+
                          |
                    architecture gates,
                    strategic direction
                          |
                    +-----+-----+
                    |   TIAGO   |
                    | (Governor |
                    |  in Chief)|
                    +-----+-----+
                          |
              +-----------+-----------+
              |                       |
       direct session            cron + queue
       (development,             triggers
        deep reasoning)               |
              |                +------+------+
              |                | GovernorAgent|
              |                | (24/7 Ops)  |
              |                +------+------+
              |                       |
              |              WorkSpec dispatch
              |                       |
              |                +------+------+
              |                | ConductorDO |
              |                | (Orchestrator)|
              |                +------+------+
              |                       |
              |           +-----------+-----------+
              |           |           |           |
              |       +---+---+   +---+---+   +---+---+
              |       |Architect|  |Planner |  |Critic  |
              |       |Agent   |  |Agent   |  |Agent   |
              |       +-------+   +-------+   +-------+
              |
    +---------+----------+
    |         |          |
+---+---+ +--+---+ +----+----+
|Coder  | |Tester| |Verifier |
|Agent  | |Agent | |Agent    |
+-------+ +------+ +---------+
     |
     v
+---------+
|AtomExec |  (existing, unchanged)
|   DOs   |
+---------+
```

---

*This design was produced by the Architect Agent. All structural decisions
trace to the existing SynthesisCoordinator implementation, GovernorAgent
design, and Orientation Ontology. No speculative architecture. Every
claim references existing code or established patterns.*
