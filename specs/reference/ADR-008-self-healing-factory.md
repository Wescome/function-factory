# ADR-008: The Self-Healing Factory

## Status

Proposed -- requires architect review (v2: expanded from ORL-only to full Factory scope)

## Date

2026-04-28 (v2, supersedes 2026-04-27 v1)

## Lineage

ADR-007 (Output Reliability Layer), ADR-005 (Vertical Slicing Execution
Engine), factory-ontology.ttl (Domains 1-7), factory-shapes.ttl (constraints
C1-C16), output-reliability-extension.ttl (Domains 8-9, failure modes F1-F7,
behavioral laws BL1-BL7), pipeline.ts (7-stage Workflow), coordinator.ts
(SynthesisCoordinator), crp.ts (CRP auto-generation), lifecycle.ts
(lifecycle state machine)

### v2 Change Notice

v1 (2026-04-27) scoped self-healing to Output Reliability Layer telemetry
only -- F1-F7 failure modes, alias tables, model routing. The principal
corrected: the Factory's purpose IS to build and heal itself. The Governor
Agent monitors EVERYTHING. v2 expands to all 7 monitoring domains: pipeline
health, gate effectiveness, agent quality, model reliability, infrastructure
health, ontology compliance, and self-referential metrics.

---

## 1. Decision

The Function Factory is a closed-loop compiler that builds itself. Every
runtime degradation -- pipeline stage failures, gate rejection patterns,
agent output quality, model reliability, infrastructure faults, ontology
violations, and the self-healing loop's own effectiveness -- becomes a Signal
that enters the Factory's own Stages 1-7. The Factory synthesizes its own
fixes and deploys them through hot-reloadable configuration stored in
ArangoDB.

This ADR defines the complete self-healing architecture:

1. **Seven monitoring domains** covering every subsystem the Factory operates
2. **Telemetry event stores** with structured schemas per domain
3. **A deterministic Signal Generator** with pattern detectors per domain
4. **Three meta-agents** (Governor, Architect, SystemsEngineer) that process
   self-healing signals through the existing pipeline
5. **Hot-reloadable configuration** so fixes deploy without Worker redeployment
6. **Confidence-gated deployment** that routes fixes by risk level
7. **Bootstrap paradox resolution** proving the loop is stable even when the
   pipeline itself is degraded

The Factory does not require human intervention for configuration-level
reliability issues. It observes its own failures, synthesizes fixes,
validates them against the ontology, and deploys them -- with
confidence-gated escalation to the architect when uncertainty exceeds
thresholds.

---

## 2. The Fundamental Constraint

The self-healing loop uses the same pipeline it is trying to fix. This is
not a paradox to avoid -- it is a constraint to design around. The
resolution has three parts:

1. **The telemetry-to-signal path is deterministic.** No LLM calls. Pattern
   matching on structured event data produces structured Signals. If the
   pipeline is completely broken, this path still runs.

2. **The fixes are configuration, not code.** Alias tables, routing configs,
   agent prompts, compiler prompts, SHACL constraints, and MentorScript rules
   live in ArangoDB. Updating them is a database write, not a code deployment.
   The Factory loads configuration at call time. No Worker redeployment
   needed.

3. **The escalation path is always open.** If the pipeline cannot synthesize
   a fix (because the pipeline itself is the thing that is broken), the
   Governor creates a CRP for human intervention. The CRP mechanism is
   non-blocking and does not depend on the synthesis pipeline.

The worst case is not infinite recursion. The worst case is a CRP that says
"the pipeline is broken and cannot fix itself -- here is the diagnostic
data." That is the correct worst case for a self-healing system.

---

## 3. The Seven Monitoring Domains

The Governor Agent monitors seven domains. Each domain has its own event
store, pattern detectors, and fix types. Together they cover every subsystem
of the Factory.

### Domain M1: Pipeline Health

**What it observes:** The 7-stage Workflow (pipeline.ts) end-to-end.

**Events stored in:** `pipeline_health_events`

```typescript
interface PipelineHealthEvent {
  _key: string
  timestamp: string
  workflowInstanceId: string
  signalId: string

  // Stage-level metrics
  stageTimings: {
    stage: string          // 'ingest-signal', 'synthesize-pressure', etc.
    startedAt: string
    completedAt: string
    durationMs: number
    success: boolean
    error?: string
  }[]

  // End-to-end
  totalDurationMs: number
  finalStatus: string      // 'synthesis-passed', 'gate-1-failed', 'rejected', etc.
  stageReached: number     // 1-7 (how far did it get?)
}
```

**Pattern detectors:**

| ID | Pattern | Threshold | Signal produced |
|----|---------|-----------|-----------------|
| PH-1 | Stage 1-4 LLM call failure rate | > 30% over 24h for any stage | "Stage {N} LLM reliability degraded" |
| PH-2 | Stage 5 compiler producing malformed WorkGraphs | > 50% fail Gate 1 over 7d | "Compiler pass quality degraded" |
| PH-3 | Stage 6 synthesis completion rate drop | < 50% pass over 7d | "Synthesis success rate below threshold" |
| PH-4 | End-to-end pipeline latency p95 spike | > 2x rolling 7d median | "Pipeline latency regression" |
| PH-5 | Pipeline not reaching Stage 6 | > 60% of runs stop before Stage 5 over 7d | "Pipeline throughput collapse -- most runs die in spec chain" |

**Write point:** At the end of `FactoryPipeline.run()`, before returning
the final result. The event capture is a non-blocking ArangoDB write.

### Domain M2: Gate Effectiveness

**What it observes:** Gate 1 (compile coverage), Gate 2 (simulation
coverage, when implemented), Gate 3 (assurance, when implemented).

**Events stored in:** `gate_effectiveness_events`

```typescript
interface GateEffectivenessEvent {
  _key: string
  timestamp: string
  gateId: 'gate-1' | 'gate-2' | 'gate-3'
  workGraphId: string
  passed: boolean

  // Gate 1 detail
  checkResults?: {
    check: string         // 'atom-coverage', 'invariant-coverage', etc.
    passed: boolean
    score?: number
  }[]

  // Operational context
  atomCount?: number
  invariantCount?: number
  dependencyCount?: number
}
```

**Pattern detectors:**

| ID | Pattern | Threshold | Signal produced |
|----|---------|-----------|-----------------|
| GE-1 | Gate 1 rejection rate too high | > 60% over 7d | "Compiler output quality consistently fails Gate 1 -- investigate pass chain" |
| GE-2 | Gate 1 rejection rate too low | < 5% over 30d with > 10 runs | "Gate 1 may be too permissive -- review check thresholds" |
| GE-3 | Specific Gate 1 check fails disproportionately | One check fails on > 80% of rejections | "Gate 1 check '{check}' is the dominant failure mode" |
| GE-4 | Gate 1 passes WorkGraphs that later fail synthesis | Correlation: G1 pass -> synthesis fail > 40% | "Gate 1 passing structurally valid but semantically bad WorkGraphs (see C9)" |

**Write point:** Inside the `gate-1` step in `pipeline.ts` and in the
`ff-gates` Worker's `evaluateGate1` response handler.

### Domain M3: Agent Quality

**What it observes:** All 6 agent roles (Architect, Planner, Coder, Critic,
Tester, Verifier) plus the 3 meta-agents.

**Events stored in:** `agent_quality_events`

```typescript
interface AgentQualityEvent {
  _key: string
  timestamp: string
  agentRole: string        // 'architect', 'coder', 'critic', etc.
  model: string            // which model was used
  workGraphId: string
  atomId?: string

  // Output quality
  success: boolean
  failureMode?: string     // ORL F1-F7 if applicable
  coercionCount: number    // how many fields needed type coercion
  repairCount: number      // how many re-prompts needed
  confidenceScore?: number // agent's self-reported confidence

  // Tool usage
  toolCallCount: number
  toolCallErrors: number
  toolCallErrorDetails?: string[]

  // Token economics
  inputTokens: number
  outputTokens: number
  totalTokens: number
  durationMs: number
}
```

**Pattern detectors:**

| ID | Pattern | Threshold | Signal produced |
|----|---------|-----------|-----------------|
| AQ-1 | ORL failure mode concentration per agent | > 50% of failures are same F-code for an agent over 7d | "Agent '{agent}' consistently hits failure mode {F-code}" |
| AQ-2 | Tool call error rate per agent | > 20% tool calls fail over 24h | "Agent '{agent}' tool calls failing -- check arango_query permissions or query syntax" |
| AQ-3 | Agent output coercion rate | > 70% of outputs need coercion for an (agent, model) pair | "Model '{model}' for agent '{agent}' needs persistent coercion -- consider tier downgrade" |
| AQ-4 | Agent reasoning quality (Critic accuracy) | Critic passes code that fails tests > 40% over 7d | "Critic semantic review accuracy degraded" |
| AQ-5 | Agent token usage spike | p95 token usage > 2x rolling 7d median for agent | "Agent '{agent}' token consumption spiking -- check prompt inflation or context blowup" |

**Write point:** Inside each agent's `processAgentOutput` callback and
after each `agentLoop` session completes in the coordinator.

### Domain M4: Model Reliability

**What it observes:** Per-model success rates, latency, cost, and CEF data
points across all agent roles. Extends v1's ORL-specific model monitoring to
cover every model call.

**Events stored in:** `output_reliability_events` (existing from v1,
extended schema)

```typescript
interface ORLEvent {
  _key: string
  timestamp: string
  model: string
  provider: string         // workers-ai, ofox, google, etc.
  agent: string
  schema: string           // which ORL schema
  workGraphId: string
  atomId: string | null

  // Outcome
  success: boolean
  failureMode: string | null  // F1-F7 or null

  // Pipeline details
  parseTier: number | null
  coercions: string[]
  repairAttempts: number
  repairSucceeded: boolean

  // F3 diagnostic
  missingFields: string[]
  presentFields: string[]

  // Context (from v1)
  rawResponsePreview: string
  contextUtilization: number | null
  estimatedOutputTokens: number | null

  // v2 additions: cost and latency
  latencyMs: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number    // computed from model's per-token rate
}
```

**Pattern detectors:**

| ID | Pattern | Threshold | Signal produced |
|----|---------|-----------|-----------------|
| MR-1 | Per-model success rate drop | < 50% over rolling 24h | "Model '{model}' success rate collapsed to {rate}" |
| MR-2 | Per-model latency spike | p95 > 3x rolling 7d median | "Model '{model}' latency regression" |
| MR-3 | Per-model cost anomaly | Daily cost > 3x rolling 7d average | "Model '{model}' cost spike -- possible prompt inflation" |
| MR-4 | F7 (null response) cluster on model | >= 3 in 24h | "Model '{model}' returning null -- remove from routing" |
| MR-5 | F3 (wrong field names) with consistent alias pair | >= 3 in 24h, same (missing, present) pair | "Add alias {present} -> {missing} for schema '{schema}'" |
| MR-6 | Context utilization consistently high for agent | > 0.8 on > 50% of calls, rolling 24h | "Agent '{agent}' context pressure -- BL1 degradation risk" |
| MR-7 | Repair attempt exhaustion | > 50% of calls need repair for (model, schema) | "Model '{model}' on schema '{schema}' needs persistent re-prompting" |

**Write point:** The `onEvent` callback in `processAgentOutput` (same as v1).

### Domain M5: Infrastructure Health

**What it observes:** CF Queues, Durable Objects, ArangoDB, Workers AI
binding, R2, and the Workers themselves.

**Events stored in:** `infrastructure_health_events`

```typescript
interface InfrastructureHealthEvent {
  _key: string
  timestamp: string
  component: string        // 'synthesis-queue', 'coordinator-do', 'arangodb', etc.
  eventType: string        // 'queue-depth', 'do-eviction', 'db-latency', 'binding-error'

  // Queue metrics
  queueDepth?: number
  messagesProcessed?: number
  dlqCount?: number        // dead letter queue count

  // DO metrics
  doEviction?: boolean
  fiberRecoveryTriggered?: boolean
  alarmFired?: boolean

  // ArangoDB metrics
  dbLatencyMs?: number
  dbQueryCount?: number
  dbErrorCount?: number
  dbErrorDetails?: string[]

  // Workers AI metrics
  aiBindingAvailable?: boolean
  aiRateLimited?: boolean
  aiLatencyMs?: number

  // General
  error?: string
  severity: 'info' | 'warning' | 'error' | 'critical'
}
```

**Pattern detectors:**

| ID | Pattern | Threshold | Signal produced |
|----|---------|-----------|-----------------|
| IH-1 | Queue depth growing (backpressure) | > 50 messages pending > 15 min | "Queue '{queue}' backpressure -- consumers not keeping up" |
| IH-2 | DO eviction rate | > 3 evictions in 1h | "SynthesisCoordinator DO eviction rate high -- check memory pressure" |
| IH-3 | ArangoDB connectivity | > 3 errors in 5 min | "ArangoDB unreachable -- all pipeline writes failing" |
| IH-4 | ArangoDB query latency | p95 > 2s over 1h | "ArangoDB query latency degraded" |
| IH-5 | Workers AI binding unavailable | > 3 binding errors in 1h | "Workers AI binding unavailable -- switch to external models" |
| IH-6 | Workers AI rate limit | > 10 rate-limit errors in 1h | "Workers AI rate-limited -- throttle internal model usage" |
| IH-7 | Alarm-based timeout fires | > 2 alarm timeouts in 24h | "Synthesis repeatedly timing out -- check atom complexity or model latency" |

**Write point:** Throughout the codebase:
- Queue events: in the `queue()` handler in `index.ts`
- DO events: in `SynthesisCoordinator` alarm/fiber recovery hooks
- ArangoDB events: in `@factory/arango-client` error handler
- Workers AI events: in the model bridge layer

### Domain M6: Ontology Compliance

**What it observes:** SHACL constraint violations (C1-C16+), artifact
validation results, lineage completeness, CRP backlog, MentorScript rule
freshness.

**Events stored in:** `ontology_compliance_events`

```typescript
interface OntologyComplianceEvent {
  _key: string
  timestamp: string
  constraintId: string     // 'C1', 'C2', ..., 'C25'
  constraintName: string   // 'Lineage Completeness', etc.
  artifactId: string
  collection: string       // which ArangoDB collection
  severity: 'violation' | 'warning' | 'info'
  passed: boolean
  details: string
}
```

**Pattern detectors:**

| ID | Pattern | Threshold | Signal produced |
|----|---------|-----------|-----------------|
| OC-1 | Artifact validation violation rate | > 10% of persists fail validation over 24h | "Artifact validation failure rate elevated -- most violated: {constraint}" |
| OC-2 | Lineage completeness (C1) violations | Any C1 violation | "Lineage break detected on artifact {id} in {collection}" |
| OC-3 | CRP backlog age | > 5 pending CRPs older than 48h | "CRP backlog growing -- {count} CRPs pending > 48h" |
| OC-4 | MentorScript rule freshness | Rules not updated in 30 days with active pipeline use | "MentorScript rules stale -- no updates in {days} days" |
| OC-5 | specContent propagation (C2) breaks | Any C2 violation | "specContent lost in derivation chain at {stage}" |
| OC-6 | Unreviewed artifacts (C6) accumulating | > 5 unreviewed WorkGraphs or CodeArtifacts in 7d | "Review backlog: {count} artifacts without reviewedBy" |

**Write point:** In `@factory/artifact-validator` on every `validateArtifact`
call, and in lifecycle.ts on state transitions.

### Domain M7: Self-Referential Metrics

**What it observes:** The self-healing loop itself. This is the meta-loop
that prevents the self-healing system from silently degrading.

**Events stored in:** `self_healing_metrics`

```typescript
interface SelfHealingMetric {
  _key: string
  timestamp: string
  metricType: string       // 'signal-generated', 'fix-proposed', 'fix-deployed', etc.

  // Signal generation
  signalCount?: number     // how many signals in this Cron cycle
  patternsChecked?: number // how many pattern detectors ran
  patternsMatched?: number

  // Fix lifecycle
  fixType?: string
  confidence?: number
  deploymentPath?: string  // 'auto', 'human-approved', 'rejected'
  deployedSuccessfully?: boolean

  // Effectiveness
  targetMetricBefore?: number  // the metric the fix was targeting
  targetMetricAfter?: number   // the metric 24h after fix deployed
  fixEffective?: boolean       // did the metric improve?
}
```

**Pattern detectors:**

| ID | Pattern | Threshold | Signal produced |
|----|---------|-----------|-----------------|
| SM-1 | Zero signals generated in 7 days with active pipeline | 7 days of silence | "Self-healing signal generation has gone silent -- check Cron trigger" |
| SM-2 | Fix deployment failure rate | > 50% of proposed fixes rejected or errored over 30d | "Self-healing fix quality degraded -- fixes not passing validation" |
| SM-3 | Fix effectiveness rate | < 30% of deployed fixes improve target metric over 30d | "Self-healing fixes not effective -- review pattern-to-fix logic" |
| SM-4 | Self-healing pipeline consuming disproportionate capacity | > 30% of pipeline runs are self-healing over 7d | "Self-healing dominating pipeline capacity -- possible signal flood" |

**Write point:** In the Signal Generator after each Cron cycle, and in
the self-healing deployment function after each fix.

---

## 4. The Three Meta-Agents

Three agent roles operate the self-healing loop. They run inside the
existing pipeline infrastructure as regular synthesis roles, using the same
agent design document pattern and the same ORL pipeline. They are not
special -- they are Functions that the Factory has synthesized for itself.

### 4.1 Governor Agent -- The Operational Brain

**JTBD:** When the Factory pipeline is running, I want to continuously
monitor failure patterns across all 7 domains, so systemic reliability
issues are surfaced as Pressures before they cascade into human-visible
failures.

**Trigger:** CF Cron Trigger (every 5 minutes) or event-triggered when the
Signal Generator produces a self-healing Signal.

**Queries all 7 telemetry stores:**

```aql
// M1: Pipeline health — completion rate over 7 days
FOR e IN pipeline_health_events
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 7, 'days')
  COLLECT status = e.finalStatus
  WITH COUNT INTO cnt
  RETURN { status, count: cnt }
```

```aql
// M2: Gate effectiveness — rejection distribution
FOR e IN gate_effectiveness_events
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 7, 'days')
  FILTER e.gateId == 'gate-1'
  COLLECT passed = e.passed
  WITH COUNT INTO cnt
  RETURN { passed, count: cnt }
```

```aql
// M3: Agent quality — failure mode distribution per agent
FOR e IN agent_quality_events
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 7, 'days')
  FILTER e.success == false
  COLLECT agent = e.agentRole, failureMode = e.failureMode
  WITH COUNT INTO cnt
  SORT cnt DESC
  RETURN { agent, failureMode, count: cnt }
```

```aql
// M4: Model reliability — per-model success rate
FOR e IN output_reliability_events
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 24, 'hours')
  COLLECT model = e.model
  AGGREGATE total = COUNT(1), successes = SUM(e.success ? 1 : 0)
  LET rate = successes / total
  RETURN { model, successRate: rate, total }
```

```aql
// M5: Infrastructure health — recent errors
FOR e IN infrastructure_health_events
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 1, 'hours')
  FILTER e.severity IN ['error', 'critical']
  SORT e.timestamp DESC
  LIMIT 20
  RETURN { component: e.component, eventType: e.eventType, error: e.error }
```

```aql
// M6: Ontology compliance — violation rate
FOR e IN ontology_compliance_events
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 24, 'hours')
  COLLECT passed = e.passed
  WITH COUNT INTO cnt
  RETURN { passed, count: cnt }
```

```aql
// M7: Self-referential — fix effectiveness
FOR e IN self_healing_metrics
  FILTER e.metricType == 'fix-deployed'
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 30, 'days')
  COLLECT effective = e.fixEffective
  WITH COUNT INTO cnt
  RETURN { effective, count: cnt }
```

**Produces:** Pressures with `type: 'reliability'` and `category` drawn
from the 7 monitoring domains.

**Determines urgency:**

| Urgency | Criteria | Example |
|---------|----------|---------|
| Immediate | Infrastructure down, pipeline completely broken | ArangoDB unreachable, all synthesis timing out |
| High | Systemic degradation across multiple runs | Model success rate < 30%, Gate 1 rejection > 60% |
| Routine | Trend detected, not yet impacting throughput | Latency creeping up, coercion rate increasing |
| Informational | Data point for calibration | Self-healing fix deployed, effectiveness pending |

**Design document:**

```typescript
{
  _key: 'governor',
  context: {
    tools: [{ name: 'arango_query', description: 'Query all 7 telemetry stores', aqlExamples: [...] }],
    memoryAccess: [
      'pipeline_health_events', 'gate_effectiveness_events',
      'agent_quality_events', 'output_reliability_events',
      'infrastructure_health_events', 'ontology_compliance_events',
      'self_healing_metrics', 'consultation_requests', 'specs_signals',
    ],
    environment: 'v8-isolate',
    permissions: ['read'],
    platform: {
      host: 'worker',
      hostClass: 'Worker fetch handler',
      runtime: 'gdk-agent-agentloop',
      executorDefault: 'gdk-agent',
    },
  },
  intent: {
    jtbd: 'When the Factory pipeline is running, I want to monitor failure ' +
          'patterns across all 7 monitoring domains and surface reliability ' +
          'issues as Pressures, so systemic problems are addressed before ' +
          'they cascade into human-visible failures.',
    produces: 'Pressure',
    outputShape: {
      title: 'string -- pressure title',
      severity: '"immediate" | "high" | "routine" | "informational"',
      domain: '"M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7"',
      pattern: 'string -- the detected failure pattern',
      evidence: 'string[] -- specific event keys or aggregated statistics',
      proposedAction: 'string -- what the Factory should do about it',
      affectedComponents: 'string[] -- which pipeline stages, agents, or models',
    },
    successCriteria: [
      'Pressure references specific telemetry events or aggregated statistics',
      'Proposed action is actionable by the Architect agent',
      'Severity reflects actual impact on pipeline throughput',
      'Domain tag correctly identifies which monitoring domain detected the issue',
    ],
  },
  engineering: {
    modelRoute: { provider: 'google', model: 'gemini-3.1-pro-preview' },
    taskKind: 'planning',
    timeoutMs: 60_000,
    maxTokens: 2048,
    maxTurns: 3,
  },
}
```

### 4.2 Architect Agent (Existing, Extended)

The existing Architect agent already produces BriefingScripts for synthesis
runs. For self-healing signals, it operates in a second mode.

**JTBD (self-healing mode):** When a self-healing Pressure arrives from
any of the 7 monitoring domains, I want to read the failure events, current
configuration, and relevant ontology constraints, then produce a WorkGraph
with fix atoms, so the Factory can synthesize and deploy the fix.

**Produces:** WorkGraph (type: 'self-healing-fix')

**Fix atom types (expanded from v1):**

| Fix type | Applies to domains | Atom description | Deployment target |
|----------|-------------------|-----------------|-------------------|
| Alias addition | M3, M4 | Add field alias to ORL schema config | `orl_config` |
| Routing change | M4 | Modify model routing for agent/task | `model_routing` |
| Tier downgrade | M4 | Lower model reliability tier | `model_capabilities` |
| Prompt adjustment | M3, M4 | Modify agent system prompt | `agent_designs` |
| Context reduction | M3 | Adjust context scoping for agent | `agent_designs` |
| Compiler prompt tweak | M1, M2 | Adjust compilation pass prompt | `compiler_config` |
| SHACL threshold adjustment | M2, M6 | Modify gate check threshold | `ontology_constraints` |
| MentorScript rule update | M3, M6 | Add/modify operational rule | `mentorscript_rules` |
| Queue configuration | M5 | Adjust queue retry/DLQ settings | `queue_config` |
| Cron frequency adjustment | M7 | Change signal generator frequency | `cron_config` |

The Architect reads the current configuration from ArangoDB before proposing
changes. It diffs the current state against the desired state.

### 4.3 SystemsEngineer Agent (New)

**JTBD:** When a proposed self-healing fix is ready, I want to validate it
against the ontology constraints, verify it does not regress other models or
agents, and estimate blast radius, so only safe fixes reach production.

**Produces:** CoverageReport (type: 'self-healing-validation')

**Validation checks:**

1. **Ontology compliance:** Does the proposed change satisfy SHACL shapes?
   (e.g., does a routing change still assign at least one model to each
   agent role?)

2. **Regression analysis:** Does the proposed alias not collide with an
   existing canonical field name? Does the routing change not remove the
   only model assigned to a critical agent? Does the MentorScript rule
   contradict existing rules?

3. **CEF compatibility:** Does the proposed model tier change align with
   observed CEF data? (Query `output_reliability_events` for the model's
   actual success rate.)

4. **Blast radius estimation:** How many active synthesis pipelines will be
   affected? (Query active Workflow instances.)

5. **Behavioral law compliance:** Does the fix respect BL1-BL7? (e.g., a
   prompt adjustment must not increase instruction count beyond the BL2
   instruction competition threshold.)

**Design document:**

```typescript
{
  _key: 'systems-engineer',
  context: {
    tools: [
      { name: 'arango_query', description: 'Query Factory KG + telemetry', aqlExamples: [...] },
      { name: 'ontology_query', description: 'Query SHACL shapes', aqlExamples: [] },
    ],
    memoryAccess: [
      'output_reliability_events', 'model_routing', 'model_capabilities',
      'orl_config', 'agent_designs', 'compiler_config', 'ontology_constraints',
      'mentorscript_rules', 'specs_workgraphs',
    ],
    environment: 'v8-isolate',
    permissions: ['read'],
    platform: {
      host: 'coordinator-do',
      hostClass: 'SynthesisCoordinator extends Agent (agents SDK)',
      runtime: 'gdk-agent-agentloop',
      executorDefault: 'gdk-agent',
    },
  },
  intent: {
    jtbd: 'When a self-healing fix is proposed, I want to validate it against ' +
          'ontology constraints, behavioral laws, and regression analysis, so only ' +
          'safe configuration changes reach production.',
    produces: 'CoverageReport',
    outputShape: {
      passed: 'boolean',
      ontologyCompliance: '{ constraintId, shape, result, message }[]',
      behavioralLawCompliance: '{ law, result, message }[]',
      regressionRisks: '{ component, risk, severity }[]',
      blastRadius: 'number -- estimated affected pipelines',
      recommendation: '"deploy" | "review" | "reject"',
    },
    successCriteria: [
      'Every SHACL shape relevant to the change is checked',
      'Behavioral laws BL1-BL7 evaluated for prompt/context changes',
      'Regression analysis covers all agents that use the affected model/config',
      'Blast radius computed from actual active pipeline count',
    ],
  },
  engineering: {
    modelRoute: { provider: 'google', model: 'gemini-3.1-pro-preview' },
    taskKind: 'validation',
    timeoutMs: 120_000,
    maxTokens: 4096,
    maxTurns: 5,
  },
}
```

---

## 5. Hot-Reloadable Configuration

For the self-healing loop to work without Worker redeployment, all
configuration that the self-healing loop can modify must live in ArangoDB
and be loaded at call time.

### 5.1 Configuration Surfaces

| Surface | ArangoDB collection | Loaded by | When loaded |
|---------|-------------------|-----------|-------------|
| Field alias tables | `orl_config` | `processAgentOutput` | Every ORL call |
| Model routing | `model_routing` | `resolveModel` | Every agent dispatch |
| Agent prompts | `agent_designs` | `loadAgentDesign` | Every agent session start |
| Model capabilities | `model_capabilities` | Signal Generator | Every Cron run |
| Reliability tiers | `model_capabilities` | `resolveModel` | Every agent dispatch |
| Compiler prompts | `compiler_config` | `compilePRD` | Every compile pass |
| SHACL constraints | `ontology_constraints` | `artifact-validator` | Every validation call |
| MentorScript rules | `mentorscript_rules` | Agent sessions | Every session start |
| Queue settings | `queue_config` | Queue consumer | Every queue batch |
| Cron settings | `cron_config` | Scheduled handler | Every Cron invocation |

### 5.2 The Overlay Pattern

The self-healing loop modifies ArangoDB configuration. The hardcoded
defaults in source code are the safety floor. The ArangoDB config is an
overlay, not a replacement. If the overlay is corrupted, the system degrades
to pre-ADR-008 behavior -- not to broken behavior.

```typescript
// Load alias overrides from ArangoDB, merge with hardcoded defaults
async function loadORLConfig(
  db: ArangoClient,
  schemaName: string,
): Promise<Partial<OutputSchema<any>>> {
  try {
    const config = await db.queryOne<{ fieldAliases?: Record<string, string[]> }>(
      `FOR c IN orl_config FILTER c._key == @name RETURN c`,
      { name: schemaName },
    )
    if (!config) return {}
    return { fieldAliases: config.fieldAliases }
  } catch {
    return {}  // Fallback to hardcoded defaults
  }
}
```

### 5.3 Caching

At current scale (10-50 calls/day), per-call ArangoDB reads are negligible.
At 10x scale, add a 60-second in-memory TTL cache per Worker isolate.
Configuration changes take effect within 60 seconds -- acceptable for
reliability fixes.

### 5.4 Deployment Function

The deployment step is deterministic. No LLM call. The validated fix atoms
are written to the appropriate ArangoDB collections:

```typescript
async function deployConfigFix(
  db: ArangoClient,
  fixAtoms: ConfigFixAtom[],
): Promise<{ deployed: string[]; errors: string[] }> {
  const deployed: string[] = []
  const errors: string[] = []

  for (const atom of fixAtoms) {
    try {
      switch (atom.type) {
        case 'alias-addition':
          await upsertAliases(db, atom.schema, atom.canonicalField, atom.newAliases)
          deployed.push(`alias: ${atom.newAliases.join(',')} -> ${atom.canonicalField} on ${atom.schema}`)
          break
        case 'routing-change':
          await db.update('model_routing', atom.agentRole, {
            modelRoute: atom.newRoute,
            updatedAt: new Date().toISOString(),
            updatedBy: 'self-healing-pipeline',
          })
          deployed.push(`routing: ${atom.agentRole} -> ${atom.newRoute.model}`)
          break
        case 'tier-downgrade':
          await db.update('model_capabilities', atom.model, {
            reliabilityTier: atom.newTier,
            updatedAt: new Date().toISOString(),
            updatedBy: 'self-healing-pipeline',
          })
          deployed.push(`tier: ${atom.model} -> ${atom.newTier}`)
          break
        case 'prompt-adjustment':
          await db.update('agent_designs', atom.agentRole, {
            'prompts.system': atom.newSystemPrompt,
            updatedAt: new Date().toISOString(),
            version: atom.newVersion,
          })
          deployed.push(`prompt: ${atom.agentRole} system prompt updated`)
          break
        case 'compiler-prompt-tweak':
          await db.update('compiler_config', atom.passName, {
            prompt: atom.newPrompt,
            updatedAt: new Date().toISOString(),
            updatedBy: 'self-healing-pipeline',
          })
          deployed.push(`compiler: ${atom.passName} prompt updated`)
          break
        case 'shacl-threshold-adjustment':
          await db.update('ontology_constraints', atom.constraintId, {
            threshold: atom.newThreshold,
            updatedAt: new Date().toISOString(),
            updatedBy: 'self-healing-pipeline',
          })
          deployed.push(`constraint: ${atom.constraintId} threshold -> ${atom.newThreshold}`)
          break
        case 'mentorscript-rule-update':
          await db.save('mentorscript_rules', {
            _key: atom.ruleId,
            rule: atom.rule,
            status: 'active',
            source: 'self-healing-pipeline',
            createdAt: new Date().toISOString(),
          })
          deployed.push(`mentorscript: rule ${atom.ruleId} updated`)
          break
      }
    } catch (err) {
      errors.push(`${atom.type}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { deployed, errors }
}
```

---

## 6. Confidence Gating

Not all self-healing fixes should auto-deploy. The confidence gate
determines the deployment path based on the SystemsEngineer's validation,
the fix type, and the evidence strength.

### 6.1 Confidence Tiers

| Tier | Confidence | Fix types | Deployment path |
|------|-----------|-----------|-----------------|
| High | >= 0.9 | Alias addition, model tier downgrade, routing weight adjustment | Auto-deploy. CRP for audit trail, non-blocking. |
| Medium | 0.7 - 0.9 | Prompt modification, compiler prompt tweak, new SHACL threshold, new MentorScript rule | CRP created. Auto-approve after 1 hour if no human review. |
| Low | < 0.7 | Architecture change, multi-agent prompt rewrite, new agent role, queue/cron reconfiguration | CRP escalation to Wes. Requires human approval. 7-day timeout. |

### 6.2 Confidence Computation

```typescript
function computeFixConfidence(
  fixType: string,
  engineerReport: CoverageReport,
  eventCount: number,
  patternConsistency: number,
): number {
  const typeBase: Record<string, number> = {
    'alias-addition': 0.95,
    'tier-downgrade': 0.90,
    'routing-change': 0.80,
    'prompt-adjustment': 0.60,
    'compiler-prompt-tweak': 0.55,
    'shacl-threshold-adjustment': 0.65,
    'mentorscript-rule-update': 0.70,
    'queue-configuration': 0.50,
    'cron-frequency-adjustment': 0.50,
  }
  const base = typeBase[fixType] ?? 0.5

  // Evidence strength
  const evidenceBonus = Math.min(eventCount / 10, 0.1)
  const consistencyBonus = patternConsistency * 0.05

  // Engineer validation
  const engineerPenalty = engineerReport.passed ? 0 : -0.3
  const regressionPenalty = (engineerReport.regressionRisks?.length ?? 0) * -0.05
  const blLawPenalty = (engineerReport.behavioralLawCompliance ?? [])
    .filter(c => !c.result).length * -0.1

  return Math.max(0, Math.min(1,
    base + evidenceBonus + consistencyBonus +
    engineerPenalty + regressionPenalty + blLawPenalty
  ))
}
```

### 6.3 Audit Trail

Every self-healing deployment creates a record in `self_healing_deployments`:

```typescript
interface SelfHealingDeployment {
  _key: string
  signalId: string
  domain: string             // 'M1' | 'M2' | ... | 'M7'
  fixType: string
  confidence: number
  deploymentPath: 'auto' | 'human-approved' | 'auto-approved-timeout' | 'rejected'
  configChanges: ConfigFixAtom[]
  engineerReportKey: string
  deployedAt: string
  deployedBy: 'self-healing-pipeline' | string
  effectivenessCheckAt?: string  // 24h later, did it help?
  effective?: boolean
}
```

---

## 7. The Self-Healing Workflow

The self-healing pipeline reuses the existing `FactoryPipeline` Workflow
with a `mode: 'self-healing'` branch. This is the same pipeline, not a
separate system. The Factory eats its own cooking.

```
Telemetry events  -->  7 ArangoDB event stores
  |
  | (CF Cron Trigger: every 5 min)
  v
Signal Generator (deterministic AQL pattern matching)
  |
  | (on pattern match)
  v
Signal (type: 'self-healing', domain: 'M1'-'M7')
  |
  | (enqueue to pipeline)
  v
FactoryPipeline (mode: 'self-healing')
  |
  +-- S1: Ingest Signal
  |
  +-- S2: Governor synthesizes Pressure
  |     (queries all 7 telemetry stores)
  |
  +-- S3: Map to Capability
  |     (likely existing: 'self-repair-{domain}')
  |
  +-- S4: Architect proposes fix
  |     (WorkGraph with config-change atoms)
  |
  +-- Confidence Gate
  |     >= 0.9: auto-approve
  |     0.7-0.9: CRP, auto-approve after 1h
  |     < 0.7: CRP escalation to Wes
  |
  +-- S5: Compile WorkGraph (compile passes apply)
  |
  +-- G1: Coverage check
  |
  +-- S6: SystemsEngineer validates
  |     (ontology + BL1-BL7 + regression + blast radius)
  |
  +-- Deploy: config write to ArangoDB
  |
  v
Next call reads updated config (hot reload)
  |
  v
24h later: Governor checks effectiveness (M7)
```

**Key differences from regular pipeline:**

1. **No 7-day architect approval wait** -- replaced by confidence gate
2. **Governor for Stage 2** instead of default pressure synthesizer
3. **SystemsEngineer for validation** -- new role in the synthesis topology
4. **Config write for deployment** instead of code synthesis -- deterministic,
   no LLM call
5. **Effectiveness check** -- Governor re-queries after 24h to close the loop

---

## 8. The Signal Generator

The Signal Generator is a deterministic process. No LLM calls. It runs AQL
queries against the 7 telemetry stores, applies threshold rules, and
produces Signals.

### 8.1 Execution Model

**Trigger:** CF Cron Trigger, every 5 minutes.

**Implementation:** The Worker's `scheduled` event handler dispatches to the
signal generator:

```typescript
async scheduled(
  event: ScheduledEvent,
  env: PipelineEnv,
  ctx: ExecutionContext,
): Promise<void> {
  ctx.waitUntil(runSignalGenerator(env))
}
```

### 8.2 Pattern Detector Registry

All pattern detectors from all 7 domains are registered in a single array.
Each detector is a function that takes an ArangoDB client, runs one or more
AQL queries, and returns zero or more Signal candidates.

```typescript
interface PatternDetector {
  id: string                 // 'PH-1', 'MR-5', etc.
  domain: string             // 'M1' ... 'M7'
  description: string
  detect: (db: ArangoClient) => Promise<SignalCandidate[]>
}

interface SignalCandidate {
  patternId: string
  domain: string
  title: string
  evidence: string[]         // event _keys
  parameters: Record<string, unknown>  // pattern-specific params
  severity: 'immediate' | 'high' | 'routine' | 'informational'
}
```

### 8.3 Deduplication

Before creating a Signal, the generator checks whether an identical
self-healing Signal (same pattern ID, same parameters) already exists in
`pending` or `in_progress` state within the last 24 hours. If so, it
increments the existing Signal's `occurrence_count`. This prevents signal
flooding.

**Cap:** Maximum 20 active self-healing Signals at any time. If the cap is
reached, the generator creates a single meta-Signal: "Self-healing signal
cap reached -- too many concurrent issues."

---

## 9. CF Platform Mapping

| Concern | CF Primitive | Notes |
|---------|-------------|-------|
| 7 telemetry event stores | ArangoDB document collections | Write from Worker/DO via `@factory/arango-client` |
| Signal generation | CF Cron Trigger (every 5 min) | Runs in Worker `scheduled` handler |
| Self-healing pipeline | FactoryPipeline Workflow (existing) | Reused with `mode: 'self-healing'` branch |
| Governor agent | gdk-agent agentLoop in Worker | Runs outside DO -- lightweight, read-only |
| SystemsEngineer agent | gdk-agent agentLoop in Coordinator DO | Runs inside synthesis pipeline |
| Configuration deployment | ArangoDB upsert | Deterministic, no LLM call |
| Confidence-gated approval | `step.waitForEvent` (existing) | Same pattern as architect approval |
| CRP creation | `createCRP` (existing, crp.ts) | Non-blocking, same as regular pipeline |
| Audit trail | ArangoDB `self_healing_deployments` | Write after deployment |
| Hot-reload cache | Worker isolate in-memory (60s TTL) | Optional optimization at scale |

### 9.1 New ArangoDB Collections

| Collection | Type | Purpose |
|-----------|------|---------|
| `pipeline_health_events` | Document | M1 telemetry |
| `gate_effectiveness_events` | Document | M2 telemetry |
| `agent_quality_events` | Document | M3 telemetry |
| `output_reliability_events` | Document | M4 telemetry (exists from v1) |
| `infrastructure_health_events` | Document | M5 telemetry |
| `ontology_compliance_events` | Document | M6 telemetry |
| `self_healing_metrics` | Document | M7 telemetry |
| `orl_config` | Document | Runtime ORL config (aliases, etc.) |
| `model_routing` | Document | Runtime model routing overrides |
| `model_capabilities` | Document | Runtime model capability/tier data |
| `compiler_config` | Document | Runtime compiler pass prompts |
| `queue_config` | Document | Runtime queue settings |
| `cron_config` | Document | Runtime Cron frequency |
| `self_healing_deployments` | Document | Audit trail |

**Total new collections:** 13 (1 existing extended).

### 9.2 New CF Primitives

None. The self-healing loop uses existing Workers, Workflows, Queues, and
DOs. The only new infrastructure is ArangoDB collections.

---

## 10. The Bootstrap Paradox Resolution

The self-healing loop uses the same pipeline it is trying to fix. Six
properties prevent this from being a problem.

**Property 1: Separation of observation from action.**
Telemetry writes (event -> ArangoDB) are direct database calls. They do not
use the pipeline. If the pipeline is completely broken, telemetry still
flows across all 7 domains.

**Property 2: Separation of detection from synthesis.**
The Signal Generator is a Cron Trigger running deterministic AQL queries.
No LLM calls, no agent loop, no ORL. If every agent is returning garbage,
the Signal Generator still detects patterns across all 7 domains.

**Property 3: Fixes are configuration, not code.**
The deployment step is a database write. No Coder, Tester, or Verifier
agent needed. Validation (SystemsEngineer) requires one LLM call, but
deployment itself is deterministic.

**Property 4: The escalation path is independent.**
CRP creation uses `createCRP` (crp.ts) -- a direct ArangoDB write. If the
pipeline is so broken that even the Governor cannot produce a Pressure, the
Signal Generator can create a CRP directly as a fallback. The CRP path
never touches the synthesis pipeline.

**Property 5: Hardcoded defaults survive total config corruption.**
If ArangoDB configuration is corrupted, the hardcoded defaults in source
code still function. The ArangoDB config is an overlay. Corrupting the
overlay degrades to pre-ADR-008 behavior -- the same behavior the system
had before self-healing existed.

**Property 6: The meta-loop (M7) detects self-healing degradation.**
Domain M7 monitors the self-healing loop itself. If the loop stops
generating signals, stops deploying fixes, or deploys ineffective fixes,
M7 pattern detectors fire and escalate. The self-healing system cannot
silently degrade because it monitors itself.

**Failure mode resolution matrix:**

| Failure | Self-healable? | Resolution |
|---------|---------------|------------|
| ORL coercion needed (F3-F5) | Yes | Alias addition, auto-deploy (M4) |
| Model returning null (F7) | Yes | Routing change, medium confidence (M4) |
| Model success rate collapse | Yes | Tier downgrade + routing (M4) |
| Gate 1 rejection spike | Partially | Compiler prompt tweak (M2), medium confidence |
| Agent tool call errors | Partially | MentorScript update or prompt fix (M3) |
| Pipeline Workflow crash | No | CRP escalation. Code bug, not config. (M1) |
| ArangoDB unreachable | No | CRP escalation. If CRP write also fails: console.error (M5) |
| Queue backpressure | Partially | Queue config adjustment, low confidence (M5) |
| DO eviction storm | Partially | Signal escalation, CRP if sustained (M5) |
| Ontology violations accumulating | Partially | SHACL threshold or MentorScript (M6) |
| Self-healing loop silent | Detected by M7 | CRP escalation: "self-healing stopped working" |
| Self-healing loop ineffective | Detected by M7 | CRP escalation with effectiveness data |
| All models return garbage | Partially | Routing changes may help. Full collapse: CRP. (M4) |
| Bad self-healing fix deployed | Caught by SE | Regression check blocks. If missed: M7 effectiveness check |
| Signal flood | Capped | Max 20 active signals. Meta-signal if cap reached. (M7) |

---

## 11. Risk Analysis

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| SH-1 | Self-healing fix regresses working model/agent | Medium | High | SystemsEngineer validates against ontology, BL1-BL7, and CEF data. Regression check queries actual success rates. |
| SH-2 | Signal Generator produces too many Signals (noise) | Medium | Medium | Deduplication (24h window). Max 20 active signals. Same pattern increments count. |
| SH-3 | Auto-deployed alias collides with canonical field | Low | High | Alias addition checks against all canonical names in all schemas. Collision = reject. |
| SH-4 | Hot-reload cache serves stale config | Low | Low | 60s TTL. Fix takes max 60s to take effect. Acceptable. |
| SH-5 | ArangoDB write latency for telemetry slows pipeline | Low | Medium | All telemetry writes are fire-and-forget. No await in hot path. |
| SH-6 | Cron signal generator runs long (> 30s) | Low | Medium | AQL queries are indexed. 40+ queries on small collections. Profile at 10x. |
| SH-7 | Confidence computation miscalibrated | Medium | Medium | Conservative tiers. Only aliases auto-deploy initially. Calibrate after 50 deployments. |
| SH-8 | Self-healing consumes pipeline capacity | Low | Medium | Self-healing signals are low-volume (0-10/day). Cap at 20 concurrent. |
| SH-9 | Bootstrap paradox: pipeline fix needs pipeline | See S10 | See S10 | Six-property resolution. Observation, detection, deployment, escalation all pipeline-independent. |
| SH-10 | Telemetry volume at 100x scale overwhelms ArangoDB | Low | High | TTL indexes on all event collections (30-day retention). Archive to R2 monthly. |
| SH-11 | Seven telemetry stores add operational complexity | Medium | Medium | Seed script creates all collections. Standard AQL patterns. Single arango_query tool for agents. |
| SH-12 | Signal Generator false positives trigger unnecessary fixes | Medium | Medium | SystemsEngineer validation blocks bad fixes. Effectiveness check (M7) detects persistently ineffective patterns. Threshold tuning after 30 days. |
| SH-13 | Medium-confidence auto-approve (1h timeout) deploys risky fix | Low | High | SystemsEngineer must pass. Only applies to prompt/compiler tweaks with strong evidence. Disable auto-approve until calibrated. |

---

## 12. Implementation Plan

### Phase 1: Telemetry Foundation (1 session)

**Prerequisite:** ADR-007 ORL deployed (done).

1. Create all 7 telemetry collection schemas in seed script.
2. Add `onEvent` callback to `processAgentOutput` for M4 (extends v1).
3. Add pipeline health event emission at end of `FactoryPipeline.run()` (M1).
4. Add gate effectiveness event emission in `gate-1` step (M2).
5. Add agent quality event emission in coordinator agent calls (M3).
6. Add infrastructure health event hooks in arango-client, queue handler,
   and coordinator DO (M5).
7. Add ontology compliance events in artifact-validator (M6).
8. Deploy. Verify events appear in all 7 stores after a synthesis run.

**Evidence:** AQL queries return events in all 7 telemetry collections after
a single pipeline run.

### Phase 2: Signal Generator (1 session)

1. Add `scheduled` handler to `src/index.ts`.
2. Implement pattern detector registry with all detectors from M1-M7.
3. Start with highest-value detectors: MR-5 (F3 aliases), MR-4 (F7 null),
   MR-1 (success rate), PH-1 (stage failures), IH-3 (ArangoDB errors).
4. Add deduplication and signal cap logic.
5. Add `wrangler.jsonc` Cron Trigger (`*/5 * * * *`).
6. Deploy. Trigger deliberate F3 failures. Verify Signal generated.

**Evidence:** Self-healing Signal in `specs_signals` with
`type: 'self-healing'`, `domain: 'M4'`, and `source_refs` pointing to events.

### Phase 3: Hot-Reloadable Config (1 session)

1. Create configuration collections via seed script.
2. Implement `loadORLConfig` with overlay pattern.
3. Wire alias loading into agent ORL calls.
4. Implement `deployConfigFix` function for all fix atom types.
5. Test: manually insert alias into `orl_config`. Verify next ORL call uses
   it.

**Evidence:** ORL resolves a field alias from ArangoDB, not hardcoded.

### Phase 4: Meta-Agents (2 sessions)

**Session 1:**
1. Add Governor agent design document.
2. Add SystemsEngineer agent design document.
3. Implement Governor agent (query all 7 stores, produce Pressure).
4. Test: Governor reads synthetic events, produces structured Pressure with
   correct domain tag.

**Session 2:**
1. Implement SystemsEngineer agent (validate fix, check BL1-BL7, produce
   CoverageReport).
2. Implement confidence computation function.
3. Test: SE validates alias addition (pass) and routing change that removes
   only model for an agent (reject).

**Evidence:** Governor produces domain-tagged Pressure. SE produces
CoverageReport with behavioral law compliance.

### Phase 5: Pipeline Integration (1 session)

1. Add `mode: 'self-healing'` branch to `FactoryPipeline`.
2. Wire confidence gate.
3. Wire `deployConfigFix` as deployment step.
4. Create `self_healing_deployments` and `self_healing_metrics` collections.
5. End-to-end test: inject F3 failures -> Cron -> Signal -> Pipeline -> Fix
   -> Hot-reload -> Next call succeeds.

**Evidence:** Full closed loop without human intervention.

### Phase 6: Remaining Detectors and Calibration (ongoing)

1. Add remaining pattern detectors from all 7 domains.
2. Add M7 self-referential detectors.
3. Monitor confidence calibration over first 50 deployments.
4. Add effectiveness tracking (24h post-deploy metric check).
5. Tune thresholds based on false positive/negative rates.

### Phase 7: TTL Indexes and Archival (1 session)

1. Add TTL indexes on all event collections (30-day retention).
2. Implement monthly R2 archival for historical analysis.
3. Add dashboard AQL queries for self-healing visibility.

---

## 13. What This ADR Does NOT Do

1. **Code-level self-healing.** The loop fixes configuration: aliases,
   routing, tiers, prompts, constraints, rules. It does not write TypeScript.
   Code changes require human PRs. This boundary is deliberate: code changes
   have unbounded blast radius; configuration changes have bounded blast
   radius.

2. **Real-time streaming repair.** The loop operates on a 5-minute Cron
   cycle. Real-time repair is the ORL's job (ADR-007). The self-healing loop
   improves configuration so future calls need less repair.

3. **Cross-Factory healing.** Single Factory instance. Multi-Factory
   federation is a future concern.

4. **Model fine-tuning.** The loop adjusts routing and prompts, not model
   weights. Fine-tuning requires training infrastructure out of scope.

5. **Guaranteed SLA.** The loop reduces MTTR for config-level failures. The
   CRP escalation path ensures a human is always in the loop for failures
   the system cannot fix autonomously.

---

## 14. Success Criteria

| # | Criterion | Evidence |
|---|-----------|---------|
| SH-S1 | Events written to all 7 telemetry stores after every pipeline run | AQL queries return events with all required fields |
| SH-S2 | Signal Generator detects patterns across all domains | Self-healing Signals created with correct domain tags |
| SH-S3 | Auto-deployed alias is used by next ORL call | ORL resolves field using DB-sourced alias |
| SH-S4 | Confidence gate routes correctly | Auto for >=0.9, medium-CRP for 0.7-0.9, escalation for <0.7 |
| SH-S5 | SystemsEngineer blocks regressing fix | Routing change removing only model for agent is rejected |
| SH-S6 | SystemsEngineer checks behavioral laws | Prompt change violating BL2 instruction count is flagged |
| SH-S7 | Full closed loop completes | Failure -> Signal -> Pipeline -> Fix -> Hot-reload -> Success |
| SH-S8 | Bootstrap paradox does not manifest | Pipeline failure does not prevent telemetry/detection/CRP |
| SH-S9 | M7 detects self-healing degradation | When signal generation stops, meta-detector fires within 7d |
| SH-S10 | No regression in existing pipeline | All existing tests pass after integration |
| SH-S11 | Effectiveness tracking works | 24h post-deploy check records whether fix improved target metric |

---

## 15. Ontology Extension

This ADR requires extending the Factory ontology with Domain 10:

```turtle
# ── Domain 10: Self-Healing ──────────────────────────────────

ff:SelfHealingSignal rdfs:subClassOf ff:Signal ;
    rdfs:comment "Signal generated by the Factory's own telemetry analysis.
    From internal failure pattern detection across all 7 monitoring domains." .

ff:MonitoringDomain a owl:Class ;
    owl:oneOf ( ff:M1_PipelineHealth ff:M2_GateEffectiveness
                ff:M3_AgentQuality ff:M4_ModelReliability
                ff:M5_InfrastructureHealth ff:M6_OntologyCompliance
                ff:M7_SelfReferential ) .

ff:SelfHealingFix a owl:Class ;
    rdfs:comment "A configuration change proposed by the self-healing pipeline.
    Configuration, not code. Bounded blast radius." .

ff:AliasAddition rdfs:subClassOf ff:SelfHealingFix .
ff:RoutingChange rdfs:subClassOf ff:SelfHealingFix .
ff:TierDowngrade rdfs:subClassOf ff:SelfHealingFix .
ff:PromptAdjustment rdfs:subClassOf ff:SelfHealingFix .
ff:CompilerPromptTweak rdfs:subClassOf ff:SelfHealingFix .
ff:SHACLThresholdAdjustment rdfs:subClassOf ff:SelfHealingFix .
ff:MentorScriptRuleUpdate rdfs:subClassOf ff:SelfHealingFix .
ff:QueueConfiguration rdfs:subClassOf ff:SelfHealingFix .
ff:CronFrequencyAdjustment rdfs:subClassOf ff:SelfHealingFix .

ff:ConfidenceGate a owl:Class ;
    rdfs:comment "Decision point that routes self-healing fixes by confidence.
    High: auto-deploy. Medium: CRP+auto-approve. Low: escalation." .

ff:GovernorRole a ff:AgentRole ;
    rdfs:label "Governor Agent" ;
    ff:hasTools ff:ArangoQueryTool ;
    ff:hasPermission ff:ReadOnly ;
    ff:hasMemoryAccess ff:DecisionsMemory, ff:LessonsMemory, ff:EpisodicMemory ;
    ff:runsIn ff:V8Isolate .

ff:SystemsEngineerRole a ff:AgentRole ;
    rdfs:label "SystemsEngineer Agent" ;
    ff:hasTools ff:ArangoQueryTool ;
    ff:hasPermission ff:ReadOnly ;
    ff:hasMemoryAccess ff:DecisionsMemory, ff:LessonsMemory ;
    ff:runsIn ff:V8Isolate .

ff:monitoringDomain a owl:ObjectProperty ;
    rdfs:domain ff:SelfHealingSignal ;
    rdfs:range ff:MonitoringDomain .

ff:selfHealingConfidence a owl:DatatypeProperty ;
    rdfs:domain ff:SelfHealingFix ;
    rdfs:range xsd:decimal .

ff:deploymentPath a owl:DatatypeProperty ;
    rdfs:domain ff:SelfHealingFix ;
    rdfs:range xsd:string .

ff:fixEffective a owl:DatatypeProperty ;
    rdfs:domain ff:SelfHealingFix ;
    rdfs:range xsd:boolean .
```

---

## 16. Decision Record

### 16.1 Alternatives Considered

**Alternative A: External monitoring service.**
Deploy Grafana + alerting. Human manually deploys fixes. Rejected: this is
the status quo the Factory exists to replace.

**Alternative B: Inline self-repair (no pipeline).**
When patterns detected, immediately write fixes without validation.
Rejected: no regression check, no audit trail, no confidence gating.

**Alternative C: Model fine-tuning loop.**
Fine-tune models to produce correct output. Rejected: we do not control
the inference engine.

**Alternative D: Full code self-modification.**
Allow the loop to write TypeScript. Rejected: unbounded blast radius. Code
changes can break the infrastructure the self-healing loop depends on.

**Alternative E: Separate monitoring system per domain.**
Build independent monitoring for each of the 7 domains. Rejected: the
Factory already has a pipeline that processes Signals into Functions. Using
it for self-healing signals is the same architecture, not a new one. Seven
separate systems would be seven separate maintenance burdens.

### 16.2 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| 7 monitoring domains, not 1 | v1 covered only ORL. The Factory is more than its LLM calls. Pipeline health, gate effectiveness, infrastructure, and ontology compliance are equally important. |
| Configuration, not code | Bounded blast radius. Code changes can break self-healing infrastructure. |
| Pipeline reuse, not separate system | The Factory processes Signals into Functions. Self-healing signals are Signals. |
| Deterministic signal generation | Detection must work when LLM layer is broken. AQL is deterministic. |
| Conservative confidence thresholds | Trust earned gradually. Only aliases auto-deploy initially. |
| ArangoDB for all config | Single data layer. No Redis, no KV, no separate config store. |
| 5-minute Cron, not real-time | Configuration fixes do not need millisecond response time. |
| CRP for medium/low confidence | Reuses existing CRP infrastructure. |
| Hardcoded defaults as fallback | Config corruption degrades to pre-ADR-008, not to broken. |
| M7 self-referential monitoring | The self-healing system must not silently degrade. |
| Medium-confidence auto-approve (1h) | Reduces human interrupt burden for well-evidenced, moderate-risk fixes. Disable until calibrated. |

---

## 17. References

- **ADR-007** -- Output Reliability Layer (2026-04-27)
- **ADR-005** -- Vertical Slicing Execution Engine (2026-04-27)
- **factory-ontology.ttl** -- Function Factory Closed-World Model v1.0.0
  (Domains 1-7)
- **factory-shapes.ttl** -- SHACL constraints C1-C16
- **output-reliability-extension.ttl** -- Domains 8-9, failure modes F1-F7,
  behavioral laws BL1-BL7
- **pipeline.ts** -- FactoryPipeline Workflow (7-stage)
- **coordinator.ts** -- SynthesisCoordinator (synthesis graph runner)
- **crp.ts** -- CRP auto-generation (ontology constraint C7)
- **lifecycle.ts** -- Function lifecycle state machine (ontology constraint
  C14)
- **designs.ts** -- Agent design documents
- **Instructor (jxnl/567-labs)** -- Structured LLM output with retry
- **Guardrails AI** -- Validation loop with observability
