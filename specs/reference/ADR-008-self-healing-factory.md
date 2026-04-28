# ADR-008: The Self-Healing Factory

## Status

Proposed -- requires architect review

## Date

2026-04-27

## Lineage

ADR-007 (Output Reliability Layer), ADR-005 (Vertical Slicing Execution
Engine), output-reliability-extension.ttl (failure modes F1-F7, behavioral
laws BL1-BL7, model capability ontology), factory-ontology.ttl (Domain 4:
Execution & Synthesis), CRP auto-generation (crp.ts), lifecycle state machine
(lifecycle.ts), agent design documents (designs.ts), pipeline Workflow
(pipeline.ts)

---

## 1. Decision

Close the loop. The Function Factory's purpose is to build itself. Every
runtime failure -- ORL failure modes, Gate rejections, timeout interrupts,
model routing mismatches -- becomes a Signal that enters the Factory's own
Stages 1-7. The Factory synthesizes its own fixes and deploys them through
hot-reloadable configuration stored in ArangoDB.

This ADR defines the architecture for autonomous failure recovery: the
telemetry-to-signal loop, the meta-agents that process self-healing signals,
the confidence-gated deployment pipeline, the hot-reloadable configuration
surface, and the bootstrap paradox resolution.

The Factory does not require human intervention for runtime reliability
issues. It observes its own failures, synthesizes fixes, validates them
against the ontology, and deploys them -- with confidence-gated escalation
to the architect when uncertainty exceeds thresholds.

---

## 2. The Fundamental Constraint

The self-healing loop uses the same pipeline it is trying to fix. This is
not a paradox to avoid -- it is a constraint to design around. The resolution
has three parts:

1. **The telemetry-to-signal path is deterministic.** No LLM calls. Pattern
   matching on structured event data produces structured Signals. If the
   pipeline is completely broken, this path still runs.

2. **The fixes are configuration, not code.** Alias tables, routing configs,
   and agent prompts live in ArangoDB. Updating them is a database write,
   not a code deployment. The ORL loads configuration at call time. No
   Worker redeployment needed.

3. **The escalation path is always open.** If the pipeline cannot synthesize
   a fix (because the pipeline itself is the thing that is broken), the
   Governor creates a CRP for human intervention. The CRP mechanism is
   non-blocking and does not depend on the synthesis pipeline.

The worst case is not infinite recursion. The worst case is a CRP that says
"the pipeline is broken and cannot fix itself -- here is the diagnostic
data." That is the correct worst case for a self-healing system.

---

## 3. Architecture: Five Components

### 3.1 Component 1: Telemetry Event Store

Every ORL invocation writes a structured event to ArangoDB
`output_reliability_events`. This is the raw observability surface.

**Event schema:**

```typescript
interface ORLEvent {
  _key: string                  // auto-generated
  timestamp: string             // ISO 8601
  model: string                 // which model produced the response
  provider: string              // workers-ai, ofox, anthropic, etc.
  agent: string                 // which agent role (architect, coder, etc.)
  schema: string                // which ORL schema (BriefingScript, Verdict, etc.)
  workGraphId: string           // which synthesis run
  atomId: string | null         // which atom (null for Phase 1 agents)

  // Outcome
  success: boolean              // final ORL result
  failureMode: string | null    // F1-F7 or null (success)

  // Pipeline details
  parseTier: number | null      // which extractJSON tier succeeded (1-5)
  coercions: string[]           // which fields were coerced
  repairAttempts: number        // how many re-prompts
  repairSucceeded: boolean      // did repair fix it

  // F3 diagnostic (wrong field names)
  missingFields: string[]       // which required fields were absent
  presentFields: string[]       // which fields WERE present (for alias learning)

  // Context
  rawResponsePreview: string    // first 500 chars
  contextUtilization: number | null  // estimated input/context ratio (BL1)
  estimatedOutputTokens: number | null // output budget usage (BL7)
}
```

**Write point:** The `processAgentOutput` function in `output-reliability.ts`
currently returns `ORLResult<T>`. The telemetry hook is a callback injected
via a new `onEvent` field in the options parameter:

```typescript
// In processAgentOutput opts:
onEvent?: (event: ORLEvent) => void | Promise<void>
```

The callback is non-blocking. If the ArangoDB write fails, the ORL event
is logged to console and dropped. Telemetry must never halt the pipeline.

**Volume estimate:** At current scale (1-5 synthesis runs per day, 6-10
agent calls per run), this produces 10-50 events per day. At 10x scale,
500 events per day. ArangoDB handles this trivially.

### 3.2 Component 2: Signal Generator

A deterministic process that reads `output_reliability_events`, detects
patterns, and produces Signals. No LLM calls. Pattern matching only.

**Trigger:** CF Cron Trigger, every 5 minutes.

**Pattern detectors:**

| ID | Pattern | Threshold | Signal produced |
|----|---------|-----------|-----------------|
| SG-1 | F3 (wrong field names) with same (missing, present) pair | >= 3 occurrences in 24h | "Add alias {present} -> {missing} for {schema}" |
| SG-2 | F7 (null response) on a specific model | >= 3 occurrences in 24h | "Remove {model} from routing for {agent}" |
| SG-3 | Model success rate below 50% | rolling 24h window | "Downgrade {model} reliability tier from {current} to {lower}" |
| SG-4 | Repair attempts > 1 on > 50% of calls for a (model, schema) pair | rolling 24h window | "Investigate prompt/schema mismatch for {model} on {schema}" |
| SG-5 | Gate rejection rate > 30% for a specific WorkGraph pattern | rolling 7 days | "Review compilation pass quality for {pattern}" |
| SG-6 | Context utilization > 0.8 on > 50% of calls for an agent | rolling 24h window | "Reduce context for {agent} -- BL1 degradation risk" |
| SG-7 | Atom retry exhaustion > 50% for a specific atom type | rolling 7 days | "Review atom decomposition quality for {type}" |

**AQL queries (executed by Cron handler):**

```aql
// SG-1: F3 alias candidates
FOR e IN output_reliability_events
  FILTER e.failureMode == 'F3'
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 24, 'hours')
  COLLECT schema = e.schema, missing = e.missingFields, present = e.presentFields
  WITH COUNT INTO cnt
  FILTER cnt >= 3
  RETURN { schema, missing, present, count: cnt }
```

```aql
// SG-2: F7 model failures
FOR e IN output_reliability_events
  FILTER e.failureMode == 'F7'
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 24, 'hours')
  COLLECT model = e.model
  WITH COUNT INTO cnt
  FILTER cnt >= 3
  RETURN { model, count: cnt }
```

```aql
// SG-3: Model success rate
FOR e IN output_reliability_events
  FILTER e.timestamp > DATE_SUBTRACT(DATE_NOW(), 24, 'hours')
  COLLECT model = e.model
  AGGREGATE total = COUNT(1), successes = SUM(e.success ? 1 : 0)
  LET rate = successes / total
  FILTER rate < 0.5
  RETURN { model, successRate: rate, total, successes }
```

**Signal output:** Each detected pattern produces a Signal document in
`specs_signals`, conforming to the existing Signal schema. The Signal's
`type` field is `'self-healing'` and its `source_refs` array contains the
`_key` values of the ORL events that triggered it.

**Deduplication:** Before creating a Signal, the generator checks whether
an identical self-healing Signal (same pattern ID, same parameters) already
exists in `pending` or `in_progress` state within the last 24 hours. If so,
it increments the existing Signal's `occurrence_count` instead of creating
a duplicate. This prevents signal flooding during sustained failure modes.

### 3.3 Component 3: Meta-Agents

Three agent roles run inside the pipeline as regular synthesis roles, using
the same agent design document pattern (designs.ts) and the same ORL
pipeline. They are not special -- they are Functions that the Factory has
synthesized for itself.

#### Governor Agent

**JTBD:** When the Factory pipeline is running, I want to continuously
monitor failure patterns, gate rejection rates, and pending CRPs, so
systemic reliability issues are surfaced as Pressures before they cascade
into human-visible failures.

**Produces:** Pressures (type: 'reliability')

**Queries:**
- `output_reliability_events` for failure patterns (last 24h)
- `gate_status` for Gate rejection rates (last 7d)
- `consultation_requests` for pending CRP count and age
- `completion_ledger` data from recent atom executions

**Trigger:** Not part of the regular synthesis pipeline. Runs on its own
schedule via CF Cron Trigger (every 15 minutes) or on-demand when the Signal
Generator produces a self-healing Signal.

**Design document:**

```typescript
{
  _key: 'governor',
  context: {
    tools: [{ name: 'arango_query', description: 'Query Factory KG', aqlExamples: [...] }],
    memoryAccess: ['output_reliability_events', 'gate_status', 'consultation_requests',
                   'completion_ledgers', 'specs_signals'],
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
    jtbd: 'When the Factory pipeline is running, I want to monitor failure patterns ' +
          'and surface reliability issues as Pressures, so systemic problems are addressed ' +
          'before they cascade.',
    produces: 'Pressure',
    outputShape: {
      title: 'string -- pressure title',
      severity: '"critical" | "high" | "medium" | "low"',
      pattern: 'string -- the detected failure pattern',
      evidence: 'string[] -- specific event keys or aggregated statistics',
      proposedAction: 'string -- what the Factory should do about it',
    },
    successCriteria: [
      'Pressure references specific ORL events or gate reports',
      'Proposed action is actionable by the Architect agent',
      'Severity reflects actual impact on pipeline throughput',
    ],
  },
  engineering: {
    modelRoute: { provider: 'google', model: 'gemini-3.1-pro-preview' },
    taskKind: 'planning',
    timeoutMs: 60_000,
    maxTokens: 2048,
    maxTurns: 3,
    // ...
  },
}
```

#### Architect Agent (existing, extended)

The existing Architect agent already produces BriefingScripts for synthesis
runs. For self-healing signals, it operates in a second mode:

**JTBD (self-healing mode):** When a self-healing Pressure about ORL
failures arrives, I want to read the failure events and current
configuration, then produce a WorkGraph with fix atoms, so the Factory can
synthesize and deploy the fix.

**Produces:** WorkGraph (type: 'self-healing-fix')

**Fix atom types:**

| Fix type | Atom description | Deployment target |
|----------|-----------------|-------------------|
| Alias addition | Add field alias to ORL schema config | `orl_config` collection |
| Routing change | Modify model routing for agent/task | `model_routing` collection |
| Tier downgrade | Lower model reliability tier | `model_capabilities` collection |
| Prompt adjustment | Modify agent system prompt | `agent_designs` collection |
| Context reduction | Adjust context scoping for agent | `agent_designs` collection |

The Architect reads the current configuration from ArangoDB before proposing
changes. It does not operate in a vacuum -- it diffs the current state
against the desired state.

#### SystemsEngineer Agent (new)

**JTBD:** When a proposed self-healing fix is ready, I want to validate it
against the ontology constraints and verify it does not regress other
models or agents, so only safe fixes are deployed.

**Produces:** CoverageReport (type: 'self-healing-validation')

**Validation checks:**

1. **Ontology compliance:** Does the proposed change satisfy SHACL shapes in
   `factory-shapes.ttl`? (e.g., does a routing change still assign at least
   one model to each agent role?)
2. **Regression analysis:** Does the proposed alias not collide with an
   existing canonical field name? Does the routing change not remove the
   only model assigned to a critical agent?
3. **CEF compatibility:** Does the proposed model tier change align with
   observed CEF data? (Query `output_reliability_events` for the model's
   actual success rate.)
4. **Blast radius estimation:** How many active synthesis pipelines will be
   affected by this configuration change? (Query active Workflow instances.)

```typescript
{
  _key: 'systems-engineer',
  context: {
    tools: [
      { name: 'arango_query', description: 'Query Factory KG', aqlExamples: [...] },
      { name: 'ontology_query', description: 'Query ontology for SHACL shapes', aqlExamples: [] },
    ],
    memoryAccess: ['output_reliability_events', 'model_routing', 'model_capabilities',
                   'orl_config', 'agent_designs', 'specs_workgraphs'],
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
          'ontology constraints and verify it does not regress other agents, so only ' +
          'safe configuration changes reach production.',
    produces: 'CoverageReport',
    outputShape: {
      passed: 'boolean',
      ontologyCompliance: '{ shape, result }[]',
      regressionRisks: '{ model, agent, risk }[]',
      blastRadius: 'number -- estimated affected pipelines',
      recommendation: '"deploy" | "review" | "reject"',
    },
    successCriteria: [
      'Every SHACL shape relevant to the change is checked',
      'Regression analysis covers all agents that use the affected model',
      'Blast radius is computed from actual active pipeline count',
    ],
  },
  engineering: {
    modelRoute: { provider: 'google', model: 'gemini-3.1-pro-preview' },
    taskKind: 'validation',
    timeoutMs: 120_000,
    maxTokens: 4096,
    maxTurns: 5,
    // ...
  },
}
```

### 3.4 Component 4: The Self-Healing Workflow

The self-healing pipeline is a subset of the regular Factory pipeline,
reusing the same Workflow class with a `mode: 'self-healing'` parameter.

```
ORL failure event --> ArangoDB output_reliability_events
  |
  | (CF Cron Trigger: every 5 min)
  v
Signal Generator --> Signal (type: self-healing)
  |
  | (enqueue to SYNTHESIS_QUEUE)
  v
Pipeline Stage 1: Ingest Signal
  |
  v
Pipeline Stage 2: Governor synthesizes Pressure
  |
  v
Pipeline Stage 3: Map to Capability (likely existing: "self-repair")
  |
  v
Pipeline Stage 4: Architect proposes fix (WorkGraph with config-change atoms)
  |
  v
Confidence Gate (see Component 5)
  |
  +-- High (>0.9): auto-approve, skip waitForEvent
  +-- Medium (0.7-0.9): CRP for human review, waitForEvent
  +-- Low (<0.7): CRP escalation to Wes, waitForEvent
  |
  v
Pipeline Stage 5: Compile WorkGraph (compile passes apply)
  |
  v
Gate 1: Coverage check (deterministic, same as regular pipeline)
  |
  v
Pipeline Stage 6: SystemsEngineer validates fix
  |
  v
Gate 2: Regression check (SystemsEngineer CoverageReport must pass)
  |
  v
Deploy: Write configuration changes to ArangoDB
  |
  v
Hot reload: Next ORL call reads updated config from ArangoDB
```

**Key difference from regular pipeline:** Stage 6 for self-healing runs
are configuration writes, not code synthesis. The "Coder" equivalent is a
deterministic function that takes the validated fix atoms and writes them
to the appropriate ArangoDB collections. No LLM call needed for the
deployment step.

**Workflow implementation:**

The self-healing workflow reuses `FactoryPipeline` with a branching
condition. When `params.signal.type === 'self-healing'`, the pipeline:

1. Skips the 7-day architect approval wait (replaced by confidence gate)
2. Uses the Governor agent for Stage 2 instead of the default pressure
   synthesizer
3. Uses the SystemsEngineer agent for Stage 6 validation instead of the
   full synthesis coordinator
4. Deploys via ArangoDB config write instead of code artifact persistence

```typescript
// In pipeline.ts, after Stage 4:
if (params.signal.type === 'self-healing') {
  const confidence = proposal.confidence ?? 0.5

  if (confidence >= 0.9) {
    // Auto-approve: skip waitForEvent
  } else if (confidence >= 0.7) {
    // CRP: wait for human review with 24h timeout
    await createCRP(db, { ... })
    const approval = await step.waitForEvent('architect-approval', {
      type: 'architect-approval', timeout: '24 hours'
    })
    if (approval.payload?.decision !== 'approved') return { status: 'rejected' }
  } else {
    // Escalation: CRP with urgent flag, 7d timeout
    await createCRP(db, { ... })
    const approval = await step.waitForEvent('architect-approval', {
      type: 'architect-approval', timeout: '7 days'
    })
    if (approval.payload?.decision !== 'approved') return { status: 'rejected' }
  }
}
```

### 3.5 Component 5: Hot-Reloadable Configuration

For the self-healing loop to work without Worker redeployment, all
configuration that the self-healing loop can modify must live in ArangoDB
and be loaded at call time.

**Configuration surfaces:**

| Surface | ArangoDB collection | Loaded by | When loaded |
|---------|-------------------|-----------|-------------|
| Field alias tables | `orl_config` | `processAgentOutput` | Every ORL call |
| Model routing | `model_routing` | `resolveModel` | Every agent dispatch |
| Agent prompts | `agent_designs` | `loadAgentDesign` | Every agent session start |
| Model capabilities | `model_capabilities` | Signal Generator | Every Cron run |
| Reliability tiers | `model_capabilities` | `resolveModel` | Every agent dispatch |

**Current state vs target state:**

Currently, alias tables are hardcoded in `output-reliability.ts` as
`fieldAliases` properties on each schema constant (e.g.,
`BRIEFING_SCRIPT_SCHEMA.fieldAliases`). Agent prompts are hardcoded in
`designs.ts`. Model routing uses `resolve-model.ts` with a static mapping.

The self-healing loop requires these to be loadable from ArangoDB with a
fallback to the hardcoded defaults. The pattern:

```typescript
// Load alias overrides from ArangoDB, merge with hardcoded defaults
async function loadORLConfig(db: ArangoClient, schemaName: string): Promise<Partial<OutputSchema<any>>> {
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

// In agent call:
const dbOverrides = await loadORLConfig(db, 'BriefingScript')
const schema = {
  ...BRIEFING_SCRIPT_SCHEMA,
  fieldAliases: {
    ...BRIEFING_SCRIPT_SCHEMA.fieldAliases,
    ...dbOverrides.fieldAliases,  // DB overrides win
  },
}
const result = await processAgentOutput(raw, schema)
```

**Caching:** ArangoDB queries per ORL call adds latency. At current scale
(10-50 calls/day), this is negligible. At 10x scale, add a 60-second
in-memory TTL cache per Worker isolate. Configuration changes take effect
within 60 seconds -- acceptable for reliability fixes that are not
time-critical to the millisecond.

**Deployment function (deterministic, no LLM):**

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
        case 'alias-addition': {
          // Upsert into orl_config
          const existing = await db.queryOne<{ fieldAliases: Record<string, string[]> }>(
            `FOR c IN orl_config FILTER c._key == @schema RETURN c`,
            { schema: atom.schema },
          )
          const aliases = existing?.fieldAliases ?? {}
          const canonical = atom.canonicalField
          aliases[canonical] = [...new Set([...(aliases[canonical] ?? []), ...atom.newAliases])]
          await db.save('orl_config', { _key: atom.schema, fieldAliases: aliases })
          deployed.push(`alias: ${atom.newAliases.join(',')} -> ${canonical} on ${atom.schema}`)
          break
        }
        case 'routing-change': {
          await db.update('model_routing', atom.agentRole, {
            modelRoute: atom.newRoute,
            updatedAt: new Date().toISOString(),
            updatedBy: 'self-healing-pipeline',
          })
          deployed.push(`routing: ${atom.agentRole} -> ${atom.newRoute.model}`)
          break
        }
        case 'tier-downgrade': {
          await db.update('model_capabilities', atom.model, {
            reliabilityTier: atom.newTier,
            updatedAt: new Date().toISOString(),
            updatedBy: 'self-healing-pipeline',
          })
          deployed.push(`tier: ${atom.model} -> ${atom.newTier}`)
          break
        }
        case 'prompt-adjustment': {
          await db.update('agent_designs', atom.agentRole, {
            'prompts.system': atom.newSystemPrompt,
            updatedAt: new Date().toISOString(),
            version: atom.newVersion,
          })
          deployed.push(`prompt: ${atom.agentRole} system prompt updated`)
          break
        }
      }
    } catch (err) {
      errors.push(`${atom.type}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { deployed, errors }
}
```

### 3.6 Component 5: Confidence Gating

Not all self-healing fixes should auto-deploy. The confidence gate
determines the deployment path based on the SystemsEngineer's validation
and the fix type.

**Confidence tiers:**

| Tier | Confidence | Fix types | Deployment path |
|------|-----------|-----------|-----------------|
| High | >= 0.9 | Alias addition, model tier downgrade | Auto-deploy. No human approval. CRP created for audit trail but does not block. |
| Medium | 0.7 - 0.9 | Routing change, prompt modification | CRP created. Pipeline waits for human approval (24h timeout). Auto-reject on timeout. |
| Low | < 0.7 | Architecture change, multi-agent prompt rewrite | CRP escalation to Wes. Pipeline waits (7 day timeout). Auto-reject on timeout. |

**Confidence computation:**

The confidence is not a single number from one agent. It is computed from
multiple signals:

```typescript
function computeFixConfidence(
  fixType: string,
  engineerReport: CoverageReport,
  eventCount: number,        // how many ORL events triggered this
  patternConsistency: number, // how consistent the failure pattern is (0-1)
): number {
  // Base confidence from fix type
  const typeBase: Record<string, number> = {
    'alias-addition': 0.95,    // deterministic, low risk
    'tier-downgrade': 0.90,    // conservative, low risk
    'routing-change': 0.75,    // moderate risk
    'prompt-adjustment': 0.60, // high risk, unpredictable effects
  }
  const base = typeBase[fixType] ?? 0.5

  // Adjust for evidence strength
  const evidenceBonus = Math.min(eventCount / 10, 0.1) // max +0.1 for 10+ events
  const consistencyBonus = patternConsistency * 0.05    // max +0.05

  // Adjust for engineer validation
  const engineerPenalty = engineerReport.passed ? 0 : -0.3
  const regressionPenalty = engineerReport.regressionRisks.length * -0.05

  return Math.max(0, Math.min(1,
    base + evidenceBonus + consistencyBonus + engineerPenalty + regressionPenalty
  ))
}
```

**Audit trail:** Every self-healing deployment (including auto-deployed
ones) creates a record in `self_healing_deployments`:

```typescript
interface SelfHealingDeployment {
  _key: string
  signalId: string
  fixType: string
  confidence: number
  deploymentPath: 'auto' | 'human-approved' | 'rejected'
  configChanges: ConfigFixAtom[]
  engineerReport: string    // _key of CoverageReport
  deployedAt: string
  deployedBy: 'self-healing-pipeline' | string  // human name if approved
}
```

---

## 4. CF Platform Mapping

| Concern | CF Primitive | Notes |
|---------|-------------|-------|
| ORL event persistence | ArangoDB collection `output_reliability_events` | Write from Worker via `@factory/arango-client` |
| Signal generation | CF Cron Trigger (every 5 min) | Runs in Worker fetch handler on `scheduled` event |
| Self-healing pipeline | FactoryPipeline Workflow (existing) | Reused with `mode: 'self-healing'` branch |
| Governor agent | gdk-agent agentLoop in Worker | Runs outside DO -- lightweight, read-only |
| SystemsEngineer agent | gdk-agent agentLoop in Coordinator DO | Runs inside synthesis pipeline |
| Configuration deployment | ArangoDB upsert | Deterministic, no LLM call |
| Confidence-gated approval | `step.waitForEvent` (existing) | Same pattern as architect approval |
| CRP creation | `createCRP` (existing, crp.ts) | Non-blocking, same as regular pipeline |
| Audit trail | ArangoDB collection `self_healing_deployments` | Write after deployment |
| Hot-reload cache | Worker isolate in-memory (60s TTL) | Optional optimization at scale |

**New ArangoDB collections:**

| Collection | Type | Purpose |
|-----------|------|---------|
| `output_reliability_events` | Document | ORL telemetry events |
| `orl_config` | Document | Runtime ORL configuration (aliases, etc.) |
| `model_routing` | Document | Runtime model routing overrides |
| `model_capabilities` | Document | Runtime model capability/tier data |
| `self_healing_deployments` | Document | Audit trail for deployed fixes |

**New CF primitives:** None. The self-healing loop uses existing Workers,
Workflows, Queues, and DOs. The only new infrastructure is ArangoDB
collections.

**Cron Trigger configuration (wrangler.jsonc):**

```jsonc
{
  "triggers": {
    "crons": [
      "*/5 * * * *"   // Signal generator: every 5 minutes
    ]
  }
}
```

The Worker's `scheduled` event handler dispatches to the signal generator:

```typescript
async scheduled(event: ScheduledEvent, env: PipelineEnv, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runSignalGenerator(env))
}
```

---

## 5. Data Flow Diagram

```
                              ArangoDB
                     +---------------------------+
                     |  output_reliability_events |<----- ORL writes event
                     |  orl_config                |         on every call
                     |  model_routing             |
                     |  model_capabilities        |
                     |  agent_designs             |
                     |  self_healing_deployments  |
                     +---------------------------+
                          |              ^
                          | read         | write (deploy)
                          v              |
                   +------------------+  |
  Cron (5 min) --> | Signal Generator |  |
                   | (deterministic)  |  |
                   +--------+---------+  |
                            |            |
                   Signal   |            |
                            v            |
                   +------------------+  |
                   | FactoryPipeline  |  |
                   | (self-healing    |  |
                   |  mode)           |  |
                   |                  |  |
                   | S1: Ingest       |  |
                   | S2: Governor     |  |
                   | S3: Map Cap      |  |
                   | S4: Architect    |  |
                   |   fix proposal   |  |
                   | Confidence Gate  |  |
                   |   >0.9: auto     |  |
                   |   0.7-0.9: CRP   |  |
                   |   <0.7: escalate |  |
                   | S5: Compile      |  |
                   | G1: Coverage     |  |
                   | S6: SysEngineer  |  |
                   |   validates      |  |
                   | G2: Regression   |  |
                   | Deploy: config   |--+
                   |   write          |
                   +------------------+
                            |
                            v
                   Next ORL call reads
                   updated config from
                   ArangoDB (hot reload)
```

---

## 6. The Bootstrap Paradox Resolution

The self-healing loop uses the same pipeline it is trying to fix. Five
properties prevent this from being a problem:

**Property 1: Separation of observation from action.**
The telemetry write (ORL event -> ArangoDB) is a direct database call. It
does not use the pipeline. If the pipeline is completely broken, telemetry
still flows.

**Property 2: Separation of detection from synthesis.**
The Signal Generator is a Cron Trigger running deterministic AQL queries.
It does not use LLM calls, the agent loop, the ORL, or any part of the
synthesis pipeline. If every agent is returning garbage, the Signal
Generator still detects the pattern.

**Property 3: Fixes are configuration, not code.**
The deployment step is a database write. It does not require the Coder
agent, the Tester agent, or the Verifier agent. The validation (by
SystemsEngineer) requires one LLM call, but the deployment itself is
deterministic.

**Property 4: The escalation path is independent.**
CRP creation uses `createCRP` (crp.ts), which is a direct ArangoDB write.
If the pipeline is so broken that even the Governor cannot produce a
Pressure, the Signal Generator can create a CRP directly (without going
through the pipeline) as a fallback.

**Property 5: Hardcoded defaults survive total config corruption.**
If the ArangoDB configuration is corrupted (e.g., all aliases deleted, all
routing zeroed out), the hardcoded defaults in `output-reliability.ts` and
`designs.ts` and `resolve-model.ts` still function. The ArangoDB config is
an overlay, not a replacement. Corrupting the overlay degrades to the
original pre-self-healing behavior -- the same behavior the system had
before ADR-008.

**Failure modes and their resolutions:**

| Failure | Can self-heal? | Resolution |
|---------|---------------|------------|
| ORL coercion needed (F3-F5) | Yes | Alias addition, auto-deploy |
| Model returning null (F7) | Yes | Routing change, medium confidence |
| Model success rate collapse | Yes | Tier downgrade + routing, medium confidence |
| Pipeline Workflow crash | No | CRP escalation. Workflow crash = code bug, not config. |
| ArangoDB unreachable | No | CRP escalation (if CRP write also fails: console.error + alert) |
| All models return garbage | Partially | Signal Generator detects. Routing change may help. If all models fail, CRP escalation. |
| Self-healing loop produces bad fix | Caught by SystemsEngineer | Regression check blocks deployment. CRP if validation fails. |
| Self-healing loop infinite loop | Prevented by deduplication | Signal Generator deduplicates. Same pattern = increment count, not new Signal. |

---

## 7. Risk Analysis

| # | Risk | L | I | Mitigation |
|---|------|---|---|------------|
| SH-1 | Self-healing fix regresses a working model/agent | Medium | High | SystemsEngineer validates against ontology and CEF data. Regression check queries actual success rates before deploying. |
| SH-2 | Signal Generator produces too many Signals (noise) | Medium | Medium | Deduplication window (24h). Same pattern increments count, not new Signal. Max 10 active self-healing Signals at a time. |
| SH-3 | Auto-deployed alias collides with canonical field name | Low | High | Alias addition checks that the new alias does not match any existing canonical field name in ANY schema. Collision = reject. |
| SH-4 | Hot-reload cache serves stale config | Low | Low | 60s TTL. Worst case: fix takes 60s to take effect. Acceptable for reliability fixes. |
| SH-5 | ArangoDB write latency for telemetry events slows ORL | Low | Medium | Telemetry write is fire-and-forget (no await in hot path). If write fails, event is dropped. ORL latency unaffected. |
| SH-6 | Cron Trigger signal generator runs long (> 30s) | Low | Medium | AQL queries are indexed. 7 queries on small collections (< 1000 docs at current scale). Profile at 10x scale. |
| SH-7 | Confidence computation is miscalibrated | Medium | Medium | Confidence tiers are conservative. Alias additions (highest base) are genuinely low-risk. Prompt changes (lowest base) genuinely require human review. Calibrate based on first 50 deployments. |
| SH-8 | Self-healing pipeline consumes pipeline capacity | Low | Medium | Self-healing Signals are low-volume (0-5/day). Regular pipeline runs 1-5/day. Total capacity ~10/day is well within Workflow limits. |
| SH-9 | Bootstrap paradox: pipeline fix needs pipeline | See Section 6 | See Section 6 | Five-property resolution. Observation, detection, and deployment are all pipeline-independent. |

---

## 8. Implementation Plan

### Phase 1: Telemetry Foundation (1 session)

**Prerequisite:** ADR-007 Phase 1 complete (ORL deployed). Status: done.

1. Add `onEvent` callback to `processAgentOutput` options in
   `output-reliability.ts`.
2. Create `output_reliability_events` ArangoDB collection (via seed script).
3. Wire `onEvent` in each agent's `processAgentOutput` call to write events
   to ArangoDB.
4. Deploy. Verify events appear in ArangoDB after a synthesis run.

**Evidence:** AQL query returns ORL events after a CEF run.

### Phase 2: Signal Generator (1 session)

1. Add `scheduled` handler to `src/index.ts`.
2. Implement Signal Generator with SG-1 through SG-3 pattern detectors.
3. Add deduplication logic.
4. Add `wrangler.jsonc` Cron Trigger (`*/5 * * * *`).
5. Deploy. Run a CEF run that deliberately triggers F3 failures (wrong field
   names). Verify Signal generated after 3 occurrences.

**Evidence:** Self-healing Signal in `specs_signals` with
`type: 'self-healing'` and `source_refs` pointing to ORL events.

### Phase 3: Hot-Reloadable Config (1 session)

1. Create `orl_config`, `model_routing`, `model_capabilities` ArangoDB
   collections (via seed script).
2. Implement `loadORLConfig` with merge-with-defaults pattern.
3. Wire alias loading into agent ORL calls.
4. Implement `deployConfigFix` function.
5. Test: manually insert an alias into `orl_config`. Verify next ORL call
   uses it.

**Evidence:** ORL resolves a field alias that only exists in ArangoDB, not
in hardcoded defaults.

### Phase 4: Meta-Agents (2 sessions)

**Session 1:**
1. Add Governor agent design document to `designs.ts`.
2. Add SystemsEngineer agent design document to `designs.ts`.
3. Implement Governor agent (query ORL events, produce Pressure).
4. Test: Governor reads synthetic ORL events, produces structured Pressure.

**Session 2:**
1. Implement SystemsEngineer agent (validate fix, produce CoverageReport).
2. Implement confidence computation function.
3. Test: SystemsEngineer validates a proposed alias addition (should pass)
   and a proposed routing change that removes the only model for an agent
   (should fail).

**Evidence:** Governor produces Pressure from ORL events. SystemsEngineer
produces CoverageReport with pass/fail.

### Phase 5: Self-Healing Pipeline Integration (1 session)

1. Add `mode: 'self-healing'` branch to `FactoryPipeline`.
2. Wire confidence gate (auto-approve > 0.9, CRP 0.7-0.9, escalate < 0.7).
3. Wire `deployConfigFix` as the Stage 6 deployment step for self-healing
   mode.
4. Create `self_healing_deployments` collection.
5. End-to-end test: inject 3 F3 failures with same (missing, present) pair.
   Wait for Cron. Verify: Signal created -> Pipeline runs -> Alias deployed
   -> Next ORL call succeeds with the new alias.

**Evidence:** Full closed loop: failure -> signal -> pipeline -> fix ->
hot-reload -> success.

### Phase 6: Monitoring and Calibration (ongoing)

1. Add SG-4 through SG-7 pattern detectors.
2. Monitor confidence calibration over first 50 deployments.
3. Adjust thresholds based on false positive / false negative rates.
4. Add dashboard query: "Show me all self-healing deployments and their
   outcomes."

---

## 9. What This ADR Does NOT Do

1. **Code-level self-healing.** The self-healing loop fixes configuration
   (aliases, routing, tiers, prompts). It does not write TypeScript code,
   modify `output-reliability.ts`, or change the ORL pipeline logic. Code
   changes require human-authored PRs. This boundary is deliberate: code
   changes have unbounded blast radius; configuration changes have bounded
   blast radius.

2. **Real-time streaming repair.** The self-healing loop operates on a
   5-minute Cron cycle. It does not intercept and repair individual LLM
   calls in real time. Real-time repair is the ORL's job (ADR-007). The
   self-healing loop improves the ORL's configuration so future calls need
   less repair.

3. **Cross-Factory healing.** This ADR applies to a single Factory instance.
   Multi-Factory federation (where one Factory's learnings improve another
   Factory's configuration) is a future concern.

4. **Model fine-tuning.** The self-healing loop adjusts routing and prompts.
   It does not fine-tune models. Fine-tuning requires training infrastructure
   that is out of scope.

5. **Guaranteed SLA.** The self-healing loop reduces MTTR for configuration-
   level failures. It does not guarantee uptime or provide an SLA. The CRP
   escalation path ensures a human is always in the loop for failures the
   system cannot fix autonomously.

---

## 10. Success Criteria

| # | Criterion | Evidence |
|---|-----------|---------|
| SH-S1 | ORL events written to ArangoDB after every synthesis run | AQL query returns events with all required fields |
| SH-S2 | Signal Generator detects F3 alias pattern after 3 occurrences | Self-healing Signal created with correct source_refs |
| SH-S3 | Auto-deployed alias is used by next ORL call | ORL resolves field using DB-sourced alias, not hardcoded default |
| SH-S4 | Confidence gate routes correctly | Auto-deploy for >0.9, CRP for 0.7-0.9, escalation for <0.7 |
| SH-S5 | SystemsEngineer blocks regressing fix | Proposed routing change that removes only model for agent is rejected |
| SH-S6 | Full closed loop completes without human intervention | F3 failure -> Signal -> Pipeline -> Fix -> Hot-reload -> Success |
| SH-S7 | Bootstrap paradox does not manifest | Pipeline failure does not prevent telemetry, detection, or CRP creation |
| SH-S8 | No regression in existing pipeline | All existing tests pass after self-healing integration |

---

## 11. Ontology Extension

This ADR requires extending the Factory ontology
(`output-reliability-extension.ttl`) with:

```turtle
# ── Domain 10: Self-Healing ──────────────────────────────────

ff:SelfHealingSignal rdfs:subClassOf ff:ExternalSignal ;
    rdfs:comment "Signal generated by the Factory's own telemetry analysis.
    Not from external sources -- from internal failure pattern detection." .

ff:SelfHealingFix a owl:Class ;
    rdfs:comment "A configuration change proposed by the self-healing pipeline.
    Configuration, not code. Bounded blast radius." .

ff:AliasAddition rdfs:subClassOf ff:SelfHealingFix ;
    rdfs:comment "Add a field name alias to an ORL schema configuration." .

ff:RoutingChange rdfs:subClassOf ff:SelfHealingFix ;
    rdfs:comment "Modify model routing for a specific agent or task kind." .

ff:TierDowngrade rdfs:subClassOf ff:SelfHealingFix ;
    rdfs:comment "Lower a model's reliability tier based on observed failure rates." .

ff:PromptAdjustment rdfs:subClassOf ff:SelfHealingFix ;
    rdfs:comment "Modify an agent's system prompt to improve output reliability." .

ff:ConfidenceGate a owl:Class ;
    rdfs:comment "Decision point that routes self-healing fixes by confidence level.
    High: auto-deploy. Medium: CRP. Low: escalation." .

ff:selfHealingConfidence a owl:DatatypeProperty ;
    rdfs:domain ff:SelfHealingFix ;
    rdfs:range xsd:decimal ;
    rdfs:comment "Computed confidence for this fix (0.0-1.0)." .

ff:deploymentPath a owl:DatatypeProperty ;
    rdfs:domain ff:SelfHealingFix ;
    rdfs:range xsd:string ;
    rdfs:comment "'auto', 'human-approved', or 'rejected'." .
```

---

## 12. Decision Record

### 12.1 Alternatives Considered

**Alternative A: External monitoring service.**
Deploy a separate monitoring service (e.g., Grafana + alerting) that
watches ORL metrics and pages a human. Human manually deploys fixes.
Rejected: this is the status quo for most systems. The Factory's entire
purpose is to close this loop. External monitoring + human manual fix is
what the Factory exists to replace.

**Alternative B: Inline self-repair (no pipeline).**
When the ORL detects a pattern (e.g., same alias miss 3x), immediately
write the alias to ArangoDB without going through the pipeline.
Rejected: no validation, no audit trail, no confidence gating. A bad
alias could regress other schemas. The pipeline provides the validation
infrastructure that makes autonomous fixes safe.

**Alternative C: Model fine-tuning loop.**
Instead of fixing configuration around the model, fine-tune the model to
produce correct output. Rejected: we do not control the inference engine
(Workers AI is a black-box binding). Fine-tuning external models requires
training infrastructure. Configuration is the surface we control.

**Alternative D: Full code self-modification.**
Allow the self-healing pipeline to write TypeScript code (modify
`output-reliability.ts`, add new coercion logic, etc.).
Rejected: unbounded blast radius. Code changes can break the ORL itself,
which is the foundation the self-healing loop depends on. Configuration
changes have bounded blast radius (one alias, one routing rule, one prompt).
Code changes are human-reviewed PRs.

### 12.2 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Configuration, not code | Bounded blast radius. Code changes can break the self-healing infrastructure itself. |
| Pipeline reuse, not separate system | The Factory exists to run pipelines. Building a separate self-healing system is anti-pattern -- it would need its own reliability layer. |
| Deterministic signal generation | The detection layer must work even when the LLM layer is broken. AQL pattern matching is deterministic. |
| Confidence gating with conservative thresholds | Human trust is earned gradually. Start with only alias additions auto-deploying. Expand as confidence calibration improves. |
| ArangoDB for all hot-reloadable config | Single data layer. No Redis, no KV, no separate config store. ArangoDB is already the Factory's knowledge graph. |
| 5-minute Cron cycle, not real-time | Self-healing fixes configuration for future calls. It does not need to be real-time. 5 minutes is fast enough to catch patterns before they cascade. |
| CRP for medium/low confidence | Reuses existing CRP infrastructure (crp.ts). No new approval mechanism needed. |
| Hardcoded defaults as fallback | Total config corruption degrades to pre-ADR-008 behavior, not to broken behavior. The overlay pattern preserves the safety floor. |

---

## 13. References

- **ADR-007** -- Output Reliability Layer (2026-04-27)
- **ADR-005** -- Vertical Slicing Execution Engine (2026-04-27)
- **output-reliability-extension.ttl** -- Failure modes F1-F7, behavioral
  laws BL1-BL7, model capability ontology
- **factory-ontology.ttl** -- Function Factory Closed-World Model v1.0.0
- **crp.ts** -- CRP auto-generation (ontology constraint C7)
- **lifecycle.ts** -- Function lifecycle state machine (ontology constraint C14)
- **designs.ts** -- Agent design documents
- **pipeline.ts** -- FactoryPipeline Workflow
- **Instructor (jxnl/567-labs)** -- Structured LLM output with retry
- **Guardrails AI** -- Validation loop with observability
