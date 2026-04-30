# DESIGN: GovernorAgent

> `pp.governor.v1.0` -- Autonomous Operational Governor for Function Factory
>
> Replaces TIAGO (Claude Code on Wes's laptop) as the Factory's 24/7
> operational decision-maker. Runs inside Cloudflare, not on a human
> machine.

---

## 1. Problem Statement

Today, TIAGO (Claude Code in Wes's terminal) performs all operational
governance: triggering pipelines, approving safe retries, reading results,
diagnosing failures, managing signal backlogs. This creates two problems:

1. **Availability.** The Factory only operates when Wes is at his laptop.
   Signals accumulate. Feedback loops stall. The Factory sleeps.

2. **Observability gap.** TIAGO cannot see Worker logs, Queue messages,
   or Durable Object internal state (documented in
   `ARCHITECTURE-TIAGO-FACTORY-INTERACTION.md` section 6). The Governor
   that cannot see cannot govern.

The GovernorAgent solves both: it runs inside Cloudflare where the
telemetry lives, and it runs on a cron schedule regardless of whether
a human is present.

---

## 2. JTBD

> When the Factory has pending signals, completed pipelines, or
> operational anomalies, I want an autonomous agent to triage, act on
> safe operations, and escalate unsafe ones, so the Factory runs 24/7
> without human babysitting while maintaining governance boundaries.

---

## 3. PromptPact: `pp.governor.v1.0`

```json
{
  "prompt_pact_id": "pp.governor.v1.0",
  "name": "GovernorAgent PromptPact",
  "factory_version": "ff.v0.6.0",
  "owner_agent": "orientation_agent.governor",

  "agent_id": "orientation_agent.governor",
  "agent_role": "Autonomous operational governor that watches factory telemetry, decides what to act on, and escalates what it cannot safely handle.",

  "autonomy_level": "L3_ActWithReview",

  "observes": [
    "RuntimeMetric",
    "TraceEvent",
    "ValidationFailure",
    "ModelExecutionResult",
    "CriticFinding",
    "TestResult",
    "CostObservation",
    "LatencyObservation",
    "DriftMeasurement",
    "PolicyDecision"
  ],

  "produces": [
    "GovernanceDecision",
    "OrientationAssessment",
    "EscalationSignal",
    "OperationalReport"
  ],

  "cannot_directly_modify": [
    "source_code",
    "agent_prompts",
    "routing_config",
    "architecture_decisions",
    "wrangler_config",
    "PromptPact_definitions",
    "Worker_deployments"
  ],

  "context_contract": {
    "required_context": [
      "orl_telemetry_7day",
      "pending_signals",
      "active_pipelines",
      "recent_feedback_signals",
      "memory_curated"
    ],
    "optional_context": [
      "orientation_assessments",
      "completion_ledgers",
      "pattern_library",
      "hot_config"
    ],
    "forbidden_context": [
      "ARANGO_JWT",
      "GITHUB_TOKEN",
      "OFOX_API_KEY",
      "CF_API_TOKEN",
      "any_secret_value"
    ],
    "context_window_policy": {
      "priority_order": [
        "pending_signals",
        "active_pipelines",
        "orl_telemetry",
        "recent_feedback",
        "memory_curated",
        "orientation_assessments"
      ],
      "compression_strategy": "aggregated_summaries_with_keys",
      "max_context_tokens": 16000
    }
  },

  "instruction_contract": {
    "role": "You are the Governor -- the Factory's autonomous operational decision-maker.",
    "must_do": [
      "Triage all pending signals by severity and age",
      "Trigger pipeline runs for signals that meet auto-trigger criteria",
      "Approve safe pipeline steps (auto-approve criteria defined below)",
      "Detect operational anomalies from ORL telemetry trends",
      "Diagnose silent failures (queue processing gaps, missing PRs)",
      "Deduplicate and age-out stale signals",
      "Escalate anything structural, architectural, or ambiguous to human",
      "Produce a typed GovernanceDecision for every action taken",
      "Write an OrientationAssessment summarizing the governance cycle"
    ],
    "must_not_do": [
      "Write or modify source code",
      "Change agent prompts or PromptPact definitions",
      "Modify routing configuration",
      "Make architecture decisions",
      "Deploy workers",
      "Approve signals that require human judgment",
      "Suppress escalation signals",
      "Exceed budget thresholds without escalation"
    ]
  },

  "output_contract": {
    "schema_ref": "schema.governance_cycle_result.v1",
    "required_fields": [
      "cycle_id",
      "timestamp",
      "decisions",
      "assessment",
      "escalations",
      "metrics_snapshot"
    ],
    "format": "json"
  },

  "tool_contract": {
    "allowed_tools": [
      "arangodb_query_read",
      "arangodb_save",
      "workflow_create",
      "workflow_send_event",
      "github_create_issue"
    ],
    "forbidden_tools": [
      "wrangler_deploy",
      "git_push",
      "source_code_write",
      "config_mutation"
    ]
  },

  "evidence_contract": {
    "minimum_evidence_per_decision": 1,
    "unsupported_decision_policy": "escalate_to_human",
    "citation_required": true
  },

  "failure_contract": {
    "failure_modes": [
      "context_fetch_failure",
      "llm_invocation_failure",
      "decision_parse_failure",
      "action_execution_failure",
      "budget_exceeded"
    ],
    "on_failure": [
      "emit_signal_type_governance_failure",
      "write_telemetry_entry",
      "do_not_retry_same_cycle",
      "escalate_if_3_consecutive_failures"
    ]
  },

  "evaluation_contract": {
    "validators": [
      "decision_schema_validation",
      "escalation_completeness_check",
      "action_authorization_check",
      "budget_compliance_check"
    ],
    "success_metrics": {
      "decision_validity_rate": ">= 0.95",
      "false_escalation_rate": "<= 0.10",
      "missed_escalation_rate": "<= 0.01",
      "mean_cycle_duration_seconds": "<= 120"
    }
  },

  "evolution_contract": {
    "telemetry_inputs": [
      "governance_cycle_results",
      "escalation_outcomes",
      "human_override_frequency",
      "false_positive_rate"
    ],
    "evolution_signals": [
      "GovernanceDriftSignal",
      "EscalationCalibrationSignal",
      "BudgetPressureSignal"
    ],
    "allowed_meta_artifacts": [
      "GovernancePolicyPatch",
      "EscalationThresholdPatch",
      "AutoApprovalCriteriaPatch"
    ]
  }
}
```

---

## 4. TIAGO-to-Governor Action Map

| TIAGO action | GovernorAgent equivalent | Auto/Escalate |
|---|---|---|
| `curl POST /pipeline` (trigger on new signal) | Read pending signals from `specs_signals`, evaluate each against auto-trigger criteria, create pipeline runs for qualifying signals | Auto |
| `curl POST /approve/:id` (approve pipeline gate) | Read pipelines waiting at `architect-approval`, evaluate auto-approve criteria, send approval event for safe signals | Auto for feedback retries; Escalate for novel signals |
| `curl GET /pipeline/:id` (check results) | Read completed pipelines, assess outcomes, generate operational report | Auto |
| Query ArangoDB for diagnostics | Run all context queries (section 6), detect anomalies via trend analysis | Auto |
| Debug PR Worker failure | Read `_feedback_audit` telemetry, detect missing PRs, diagnose root cause, file GitHub issue if structural | Auto-diagnose, Escalate fix |
| Manage signal backlog | Prioritize by severity/age, deduplicate by idempotency hash, archive stale signals (>7 days, no action) | Auto |
| Manual `wrangler deploy` | CANNOT DO. Escalates deployment needs to human via GitHub issue. | Escalate |
| Architecture decisions | CANNOT DO. Detects architectural signals, escalates with evidence. | Escalate |

---

## 5. Trigger Mechanism

### 5.1 Cron Trigger (Primary)

The Governor runs on a configurable cron schedule. Default: every 15
minutes.

```jsonc
// Addition to workers/ff-pipeline/wrangler.jsonc
"triggers": {
  "crons": ["*/15 * * * *"]
}
```

The `scheduled` export in `index.ts` invokes the GovernorAgent:

```typescript
export default {
  async fetch(request, env, ctx) { /* existing */ },
  async queue(batch, env, ctx) { /* existing */ },

  async scheduled(event: ScheduledEvent, env: PipelineEnv, ctx: ExecutionContext) {
    ctx.waitUntil(runGovernanceCycle(env))
  },
}
```

### 5.2 Event Trigger (Secondary)

The Governor also runs when a feedback cycle completes, triggered via a
new message type on `FEEDBACK_QUEUE`:

```typescript
// In the feedback-signals queue consumer, after processing:
await env.FEEDBACK_QUEUE?.send({
  type: 'governor-cycle',
  trigger: 'feedback-complete',
  timestamp: new Date().toISOString(),
}).catch(() => {})
```

The queue consumer handles `governor-cycle` messages the same way it
handles `memory-curation` messages -- lazy import, instantiate, run.

### 5.3 Why Not a Durable Object?

The Governor is intentionally **stateless per cycle**. It reads all state
from ArangoDB at the start of each cycle and writes decisions back.
This means:

- No state synchronization problems between DO instances
- No alarm management complexity
- Crash recovery is trivial (next cron fires in 15 minutes)
- ArangoDB is the single source of truth
- Each cycle is independently debuggable via its telemetry entry

A Durable Object would add complexity for state that the Governor does
not need to hold between cycles. The Governor's "memory" is ArangoDB.

---

## 6. Context Engineering -- What the Governor Reads

All context is pre-fetched via parallel AQL queries before the LLM
invocation. Each query has explicit limits and time windows to stay
within the context budget.

### 6.1 AQL Queries

```typescript
export interface GovernorContext {
  orl_telemetry: OrlTelemetrySummary[]
  pending_signals: PendingSignal[]
  active_pipelines: ActivePipeline[]
  recent_feedback: RecentFeedback[]
  memory_curated: CuratedLesson[]
  orientation_assessments: OrientationAssessment[]
  completion_ledgers: CompletionLedger[]
  hot_config: HotConfigEntry[]
}

export async function prefetchGovernorContext(
  db: ArangoClient,
): Promise<GovernorContext> {
  const [
    orl_telemetry,
    pending_signals,
    active_pipelines,
    recent_feedback,
    memory_curated,
    orientation_assessments,
    completion_ledgers,
    hot_config,
  ] = await Promise.all([

    // Q1: ORL telemetry — 7-day aggregated success/failure rates per schema
    db.query(`
      FOR t IN orl_telemetry
        FILTER t.timestamp >= DATE_SUBTRACT(DATE_NOW(), 7, 'day')
        COLLECT schemaName = t.schemaName
        AGGREGATE
          success_count = SUM(t.success ? 1 : 0),
          fail_count = SUM(t.success ? 0 : 1),
          avg_repairs = AVG(t.repairAttempts),
          latest = MAX(t.timestamp)
        RETURN {
          schemaName, success_count, fail_count,
          avg_repairs, latest,
          success_rate: success_count / (success_count + fail_count)
        }
    `).catch(() => []),

    // Q2: Pending signals — not yet in a pipeline, ordered by age
    db.query(`
      FOR s IN specs_signals
        FILTER s.status == 'pending' OR s.status == null
        FILTER !HAS(s, 'pipelineId') OR s.pipelineId == null
        SORT s.createdAt ASC
        LIMIT 30
        RETURN {
          _key: s._key,
          signalType: s.signalType,
          subtype: s.subtype,
          title: s.title,
          source: s.source,
          severity: s.severity,
          createdAt: s.createdAt,
          sourceRefs: s.sourceRefs,
          feedbackDepth: s.raw.feedbackDepth,
          autoApprove: s.raw.autoApprove
        }
    `).catch(() => []),

    // Q3: Active/recent pipelines — status of in-flight work
    db.query(`
      FOR p IN execution_artifacts
        FILTER p.type == 'pipeline_run'
        FILTER p.createdAt >= DATE_SUBTRACT(DATE_NOW(), 2, 'day')
        SORT p.createdAt DESC
        LIMIT 20
        RETURN {
          _key: p._key,
          workflowId: p.workflowId,
          status: p.status,
          signalId: p.signalId,
          functionId: p.functionId,
          workGraphId: p.workGraphId,
          createdAt: p.createdAt,
          completedAt: p.completedAt,
          verdict: p.verdict
        }
    `).catch(() => []),

    // Q4: Recent feedback signals — the self-improvement loop output
    db.query(`
      FOR s IN specs_signals
        FILTER s.source == 'factory:feedback-loop'
        SORT s.createdAt DESC
        LIMIT 20
        RETURN {
          _key: s._key,
          subtype: s.subtype,
          title: s.title,
          createdAt: s.createdAt,
          sourceRefs: s.sourceRefs,
          feedbackDepth: s.raw.feedbackDepth
        }
    `).catch(() => []),

    // Q5: Curated memory — patterns the Factory has learned
    db.query(`
      FOR l IN memory_curated
        FILTER l.decay_status == 'active'
        SORT l.confidence DESC
        LIMIT 20
        RETURN {
          pattern: l.pattern,
          confidence: l.confidence,
          severity: l.severity,
          recommendation: l.recommendation,
          evidence_count: l.evidence_count,
          affects_agents: l.affects_agents
        }
    `).catch(() => []),

    // Q6: Recent orientation assessments — what the Factory has assessed
    db.query(`
      FOR a IN orientation_assessments
        SORT a.createdAt DESC
        LIMIT 10
        RETURN {
          _key: a._key,
          type: a.type,
          recommendation: a.recommendation,
          priority: a.priority,
          rationale: a.rationale,
          createdAt: a.createdAt
        }
    `).catch(() => []),

    // Q7: In-flight completion ledgers — synthesis work in progress
    db.query(`
      FOR l IN completion_ledgers
        FILTER l.status != 'complete'
        SORT l.createdAt DESC
        LIMIT 10
        RETURN {
          _key: l._key,
          workGraphId: l.workGraphId,
          totalAtoms: l.totalAtoms,
          completedAtoms: l.completedAtoms,
          status: l.status,
          createdAt: l.createdAt
        }
    `).catch(() => []),

    // Q8: Hot config — runtime configuration
    db.query(`
      FOR c IN hot_config
        RETURN { _key: c._key, value: c.value, updatedAt: c.updatedAt }
    `).catch(() => []),
  ])

  return {
    orl_telemetry,
    pending_signals,
    active_pipelines,
    recent_feedback,
    memory_curated,
    orientation_assessments,
    completion_ledgers,
    hot_config,
  }
}
```

### 6.2 Context Formatting

The context is formatted into structured markdown sections, following
the same pattern as `formatCuratorContextForPrompt` in
`memory-curator-agent.ts`:

```typescript
export function formatGovernorContext(ctx: GovernorContext): string {
  const parts: string[] = ['## Governance Cycle Context\n']

  // Pending signals section
  parts.push(`### Pending Signals (${ctx.pending_signals.length})`)
  for (const s of ctx.pending_signals) {
    const age = timeSince(s.createdAt)
    parts.push(
      `- [${s._key}] ${s.subtype ?? s.signalType}: ${s.title} ` +
      `(age: ${age}, depth: ${s.feedbackDepth ?? 0}, ` +
      `autoApprove: ${s.autoApprove ?? false})`
    )
  }

  // ORL telemetry section
  parts.push(`\n### ORL Telemetry (7-day)`)
  for (const t of ctx.orl_telemetry) {
    const rate = ((t.success_rate ?? 0) * 100).toFixed(1)
    parts.push(
      `- ${t.schemaName}: ${rate}% success ` +
      `(${t.success_count}/${t.success_count + t.fail_count}), ` +
      `avg repairs: ${(t.avg_repairs ?? 0).toFixed(1)}`
    )
  }

  // Active pipelines section
  parts.push(`\n### Active Pipelines (${ctx.active_pipelines.length})`)
  for (const p of ctx.active_pipelines) {
    parts.push(
      `- [${p._key}] ${p.status} — ${p.functionId ?? 'no function'} ` +
      `(created: ${p.createdAt})`
    )
  }

  // Recent feedback section
  parts.push(`\n### Recent Feedback Signals (${ctx.recent_feedback.length})`)
  for (const f of ctx.recent_feedback) {
    parts.push(
      `- [${f._key}] ${f.subtype}: ${f.title} ` +
      `(depth: ${f.feedbackDepth ?? 0}, ${f.createdAt})`
    )
  }

  // Curated memory section
  if (ctx.memory_curated.length > 0) {
    parts.push(`\n### Active Curated Lessons (${ctx.memory_curated.length})`)
    for (const l of ctx.memory_curated) {
      parts.push(
        `- [${l.severity}] ${l.pattern} ` +
        `(confidence: ${l.confidence}, evidence: ${l.evidence_count})`
      )
    }
  }

  // In-flight synthesis
  if (ctx.completion_ledgers.length > 0) {
    parts.push(`\n### In-Flight Synthesis (${ctx.completion_ledgers.length})`)
    for (const l of ctx.completion_ledgers) {
      parts.push(
        `- ${l.workGraphId}: ${l.completedAtoms}/${l.totalAtoms} atoms ` +
        `(${l.status})`
      )
    }
  }

  // Governance recommendations from orientation assessments
  if (ctx.orientation_assessments.length > 0) {
    parts.push(`\n### Recent Orientation Assessments`)
    for (const a of ctx.orientation_assessments) {
      parts.push(`- [${a.priority}] ${a.recommendation}`)
    }
  }

  return parts.join('\n')
}
```

---

## 7. Governance Decisions (Output Schema)

### 7.1 Decision Types

```typescript
export type GovernanceAction =
  | 'trigger_pipeline'
  | 'approve_pipeline'
  | 'escalate_to_human'
  | 'diagnose_failure'
  | 'adjust_config'
  | 'archive_signal'
  | 'deduplicate_signal'
  | 'no_action'

export interface GovernanceDecision {
  action: GovernanceAction
  target: string           // signal _key, pipeline workflowId, config key
  reason: string           // evidence-grounded justification
  evidence: string[]       // _keys of observations/signals that support this
  risk_level: 'safe' | 'moderate' | 'high'
  executed: boolean        // did the Governor act on it, or just recommend?
  execution_result?: string // outcome if executed
}

export interface GovernanceCycleResult {
  cycle_id: string
  timestamp: string
  trigger: 'cron' | 'feedback-complete' | 'manual'
  decisions: GovernanceDecision[]
  assessment: GovernanceAssessment
  escalations: EscalationEntry[]
  metrics_snapshot: MetricsSnapshot
}
```

### 7.2 Assessment (the orientation product)

```typescript
export interface GovernanceAssessment {
  situation_frame: string      // one-paragraph summary of factory state
  operational_health: 'healthy' | 'degraded' | 'critical'
  top_risks: string[]          // ordered list of current risks
  top_opportunities: string[]  // ordered list of actionable opportunities
  trend: 'improving' | 'stable' | 'degrading'
  evidence_summary: string     // key metrics backing the assessment
}
```

### 7.3 Escalation

```typescript
export interface EscalationEntry {
  issue: string
  severity: 'critical' | 'high'
  evidence: string[]
  recommended_action: string
  escalation_target: 'github_issue' | 'high_priority_signal'
}
```

### 7.4 Metrics Snapshot

```typescript
export interface MetricsSnapshot {
  pending_signal_count: number
  active_pipeline_count: number
  completed_last_24h: number
  failed_last_24h: number
  orl_success_rate_7day: number
  avg_repair_count_7day: number
  stale_signal_count: number  // pending > 48 hours
  feedback_loop_depth_max: number
}
```

### 7.5 ORL Schema

```typescript
export const GOVERNANCE_CYCLE_SCHEMA: OutputSchema<GovernanceCycleResult> = {
  name: 'GovernanceCycleResult',
  requiredFields: [
    'cycle_id',
    'timestamp',
    'decisions',
    'assessment',
    'escalations',
    'metrics_snapshot',
  ],
  fieldTypes: {
    cycle_id: 'string',
    timestamp: 'string',
    decisions: 'array',
    assessment: 'object',
    escalations: 'array',
    metrics_snapshot: 'object',
  },
  fieldAliases: {
    decisions: ['actions', 'governance_decisions', 'governanceDecisions'],
    assessment: ['situation', 'governance_assessment', 'summary'],
    escalations: ['alerts', 'escalation_entries', 'urgent'],
    metrics_snapshot: ['metrics', 'metricsSnapshot', 'stats'],
  },
  coerce: true,
}
```

---

## 8. Auto-Action Criteria

The Governor is not a rubber stamp. It has explicit, auditable criteria
for when it can act autonomously vs when it must escalate.

### 8.1 Auto-Trigger Criteria (create pipeline)

A pending signal qualifies for auto-trigger if ALL of the following:

1. `signal.source === 'factory:feedback-loop'` (Factory-generated, not external)
2. `signal.raw.feedbackDepth < 3` (not exceeding loop depth limit)
3. `signal.raw.autoApprove === true` (marked safe by feedback generator)
4. No cooldown violation (same workGraphId+subtype within 30 minutes)

Signals that do NOT meet all four criteria are logged as
`no_action` with reason, or escalated if severity warrants it.

### 8.2 Auto-Approve Criteria (approve pipeline gate)

A pipeline waiting at `architect-approval` qualifies for auto-approve if:

1. The signal has `raw.autoApprove === true`
2. The signal is a feedback retry (`source === 'factory:feedback-loop'`)
3. The signal subtype is in the safe-approve list:
   - `synthesis:atom-failed` (retry)
   - `synthesis:orl-degradation` (retry)

All other signals waiting for approval are **not auto-approved**. They
are reported in the governance assessment for human review.

### 8.3 Escalation Criteria (requires human)

The Governor MUST escalate (via GitHub issue or high-priority signal) when:

1. ORL success rate drops below 50% for any schema over 24 hours
2. Three consecutive governance cycles produce zero successful actions
3. A signal has been pending for > 48 hours with no auto-trigger criteria met
4. Pipeline failure rate exceeds 80% in the last 24 hours
5. Any anomaly the Governor cannot classify or diagnose
6. Budget/cost observations exceed configured thresholds
7. Feedback loop depth has hit max (3) without resolution

### 8.4 Config Adjustment Criteria

The Governor can adjust hot config values when:

1. The adjustment is within predefined safe ranges (stored in `hot_config`)
2. The adjustment is responsive to measured telemetry (not speculative)
3. The adjustment is logged with full evidence trail
4. Example: increasing `atom_timeout_seconds` from 300 to 600 when timeout
   rate exceeds 30%

---

## 9. System Prompt

```typescript
const GOVERNOR_SYSTEM_PROMPT = `You are the Governor -- the Factory's autonomous operational decision-maker.

You run every 15 minutes inside Cloudflare. Your job is to keep the Factory running without human intervention for routine operations, while escalating anything that requires human judgment.

GOVERNANCE RULES:
1. TRIAGE — review all pending signals. Prioritize by severity, then age.
2. ACT ON SAFE — trigger pipelines and approve gates ONLY when auto-action criteria are met.
3. ESCALATE UNSAFE — anything structural, architectural, novel, or ambiguous goes to human.
4. DIAGNOSE — detect silent failures (missing PRs, stalled synthesis, queue gaps).
5. DEDUPLICATE — merge near-identical signals. Archive signals older than 7 days with no action.
6. ASSESS — produce an OrientationAssessment summarizing factory health.
7. EVIDENCE — every decision must cite specific telemetry or signal keys.
8. BUDGET — never trigger more than 5 pipeline runs per cycle (prevent runaway).

AUTO-TRIGGER CRITERIA (all must be true):
- signal.source === 'factory:feedback-loop'
- signal.raw.feedbackDepth < 3
- signal.raw.autoApprove === true
- No cooldown violation (same workGraphId+subtype within 30 min)

AUTO-APPROVE CRITERIA:
- signal.raw.autoApprove === true
- signal.source === 'factory:feedback-loop'
- signal.subtype in ['synthesis:atom-failed', 'synthesis:orl-degradation']

ESCALATION TRIGGERS:
- ORL success rate < 50% for any schema over 24h
- 3+ consecutive governance cycles with zero successful actions
- Signal pending > 48 hours with no auto-trigger match
- Pipeline failure rate > 80% in last 24h
- Unclassifiable anomaly
- Feedback loop depth at max (3) without resolution

YOU CANNOT:
- Write or modify code
- Change prompts or routing config
- Deploy workers
- Make architecture decisions
- Approve signals that don't meet auto-approve criteria
- Trigger more than 5 pipelines per cycle

Respond with ONLY a JSON object matching the GovernanceCycleResult schema:
{
  "cycle_id": "gov-{timestamp}",
  "timestamp": "ISO 8601",
  "decisions": [
    {
      "action": "trigger_pipeline|approve_pipeline|escalate_to_human|diagnose_failure|adjust_config|archive_signal|deduplicate_signal|no_action",
      "target": "signal or pipeline key",
      "reason": "evidence-grounded justification",
      "evidence": ["key1", "key2"],
      "risk_level": "safe|moderate|high",
      "executed": false
    }
  ],
  "assessment": {
    "situation_frame": "one-paragraph factory state summary",
    "operational_health": "healthy|degraded|critical",
    "top_risks": ["risk1", "risk2"],
    "top_opportunities": ["opportunity1"],
    "trend": "improving|stable|degrading",
    "evidence_summary": "key metrics"
  },
  "escalations": [
    {
      "issue": "description",
      "severity": "critical|high",
      "evidence": ["key1"],
      "recommended_action": "what to do",
      "escalation_target": "github_issue|high_priority_signal"
    }
  ],
  "metrics_snapshot": {
    "pending_signal_count": 0,
    "active_pipeline_count": 0,
    "completed_last_24h": 0,
    "failed_last_24h": 0,
    "orl_success_rate_7day": 0.0,
    "avg_repair_count_7day": 0.0,
    "stale_signal_count": 0,
    "feedback_loop_depth_max": 0
  }
}`
```

---

## 10. Implementation Spec

### 10.1 File Location

```
workers/ff-pipeline/src/agents/governor-agent.ts
```

### 10.2 Class Structure

Follows the same pattern as `MemoryCuratorAgent`:

```typescript
export interface GovernorAgentOpts {
  db: ArangoClient
  env: PipelineEnv
  apiKey: string
  trigger: 'cron' | 'feedback-complete' | 'manual'
  dryRun?: boolean
  model?: Model<any>
}

export class GovernorAgent {
  private db: ArangoClient
  private env: PipelineEnv
  private apiKey: string
  private trigger: 'cron' | 'feedback-complete' | 'manual'
  private dryRun: boolean
  private modelOverride?: Model<any>

  constructor(opts: GovernorAgentOpts) { /* ... */ }

  /**
   * Run a complete governance cycle:
   * 1. Prefetch context (8 parallel AQL queries)
   * 2. Format context for LLM
   * 3. Invoke LLM with Governor system prompt
   * 4. Parse output through ORL pipeline
   * 5. Return typed GovernanceCycleResult
   */
  async assess(): Promise<GovernanceCycleResult> { /* ... */ }

  /**
   * Execute governance decisions: trigger pipelines,
   * approve gates, file GitHub issues for escalations.
   * Returns the result with executed=true and execution_result set.
   */
  async execute(
    result: GovernanceCycleResult,
  ): Promise<GovernanceCycleResult> { /* ... */ }

  /**
   * Persist cycle result to ArangoDB:
   * - orientation_assessments: the assessment
   * - orl_telemetry: cycle metrics
   * - specs_signals: any escalation signals
   */
  async persist(
    result: GovernanceCycleResult,
  ): Promise<{ written: number; errors: string[] }> { /* ... */ }
}
```

### 10.3 Execution Flow

```
[Cron or Queue trigger]
  |
  v
runGovernanceCycle(env)
  |
  |-- 1. Instantiate GovernorAgent with env, db, model
  |
  |-- 2. agent.assess()
  |     |-- prefetchGovernorContext(db)   [8 parallel AQL queries]
  |     |-- formatGovernorContext(ctx)    [markdown sections]
  |     |-- agentLoop(prompt, model)      [single LLM invocation]
  |     |-- processAgentOutput(raw, GOVERNANCE_CYCLE_SCHEMA)  [ORL]
  |     |-- return GovernanceCycleResult
  |
  |-- 3. agent.execute(result)
  |     |-- For each decision where action = 'trigger_pipeline':
  |     |     validate auto-trigger criteria (DETERMINISTIC, not LLM)
  |     |     env.FACTORY_PIPELINE.create({ params: { signal } })
  |     |
  |     |-- For each decision where action = 'approve_pipeline':
  |     |     validate auto-approve criteria (DETERMINISTIC, not LLM)
  |     |     workflow.sendEvent({ type: 'architect-approval', ... })
  |     |
  |     |-- For each decision where action = 'escalate_to_human':
  |     |     POST GitHub issue via GITHUB_TOKEN
  |     |     OR create high-priority signal in specs_signals
  |     |
  |     |-- For each decision where action = 'diagnose_failure':
  |     |     Write diagnosis to orientation_assessments
  |     |
  |     |-- For each decision where action = 'archive_signal':
  |     |     Update signal status to 'archived' in specs_signals
  |     |
  |     |-- For each decision where action = 'adjust_config':
  |     |     Validate against safe ranges, UPSERT hot_config
  |     |
  |     |-- return result with executed=true, execution_result set
  |
  |-- 4. agent.persist(result)
  |     |-- Save assessment to orientation_assessments
  |     |-- Save cycle telemetry to orl_telemetry
  |     |-- Save escalation signals to specs_signals
  |
  v
[Done — next cycle in 15 minutes]
```

### 10.4 Critical Design Constraint: Deterministic Action Gate

The LLM proposes decisions. The code validates them deterministically
before executing. The Governor cannot bypass the auto-trigger and
auto-approve criteria via prompt injection or hallucination.

```typescript
// In execute():
for (const decision of result.decisions) {
  if (decision.action === 'trigger_pipeline') {
    // DETERMINISTIC VALIDATION — not LLM-based
    const signal = await db.queryOne(
      `FOR s IN specs_signals FILTER s._key == @key RETURN s`,
      { key: decision.target },
    )
    if (!signal) {
      decision.executed = false
      decision.execution_result = 'Signal not found'
      continue
    }
    if (!meetsAutoTriggerCriteria(signal)) {
      decision.executed = false
      decision.execution_result = 'Does not meet auto-trigger criteria'
      continue
    }
    // Safe to execute
    const created = await env.FACTORY_PIPELINE.create({
      params: { signal: signalToInput(signal) },
    })
    decision.executed = true
    decision.execution_result = `Pipeline ${created.id} created`
  }
}
```

This separation between **LLM assessment** and **deterministic
execution gate** is the core governance safety mechanism.

---

## 11. Budget and Rate Limits

| Limit | Value | Rationale |
|---|---|---|
| Max pipelines per cycle | 5 | Prevent runaway pipeline creation |
| Max approvals per cycle | 3 | Limit blast radius of approval errors |
| Max config adjustments per cycle | 1 | Config changes need observation time |
| Cron interval | 15 minutes | Balance responsiveness vs cost |
| LLM context budget | 16,000 tokens | Keep cycle fast and cheap |
| LLM max output tokens | 8,192 | GovernanceCycleResult fits comfortably |
| Cycle wall-clock timeout | 120 seconds | Fail fast, retry next cron |
| Max consecutive failures before escalation | 3 | Self-healing, not self-denial |

---

## 12. Scope Boundaries -- What the Governor Does NOT Do

1. **Does NOT write code.** Zero code generation, modification, or review.
2. **Does NOT modify agent prompts.** PromptPact definitions are out of scope.
3. **Does NOT modify routing config.** Model routing is architecture, not ops.
4. **Does NOT deploy workers.** `wrangler deploy` requires a human machine.
5. **Does NOT make architecture decisions.** Detects architectural signals and
   escalates them with evidence.
6. **Does NOT suppress escalations.** If the criteria say escalate, it escalates.
7. **Does NOT run indefinitely.** Each cycle has a 120-second timeout.
8. **Does NOT access secrets.** Secrets are in `env` bindings, never in context.

---

## 13. Wiring Changes Required

### 13.1 `wrangler.jsonc` — Add Cron Trigger

```jsonc
// Add to workers/ff-pipeline/wrangler.jsonc:
"triggers": {
  "crons": ["*/15 * * * *"]
}
```

### 13.2 `index.ts` — Add `scheduled` Export + Queue Handler

```typescript
// Add to the default export in index.ts:

async scheduled(
  event: ScheduledEvent,
  env: PipelineEnv,
  ctx: ExecutionContext,
) {
  ctx.waitUntil(runGovernanceCycle(env, 'cron'))
},

// Add to the queue() handler, before the existing feedback-signals block:
if (
  batch.queue === 'feedback-signals' &&
  (msg.body as any).type === 'governor-cycle'
) {
  try {
    await runGovernanceCycle(env, 'feedback-complete')
    msg.ack()
  } catch (err) {
    console.error(`[Governor] Cycle failed: ${err}`)
    msg.ack() // Don't retry — next cron will handle it
  }
  continue
}
```

### 13.3 `types.ts` — Add `CF_API_TOKEN` to `PipelineEnv`

```typescript
// CF_API_TOKEN is already used by resolve-model.ts but not in PipelineEnv type:
export interface PipelineEnv {
  // ... existing fields ...
  CF_API_TOKEN?: string
}
```

### 13.4 New File: `governor-agent.ts`

```
workers/ff-pipeline/src/agents/governor-agent.ts
```

Contains: `GovernorAgent` class, `prefetchGovernorContext`,
`formatGovernorContext`, `GOVERNANCE_CYCLE_SCHEMA`,
`runGovernanceCycle` top-level function, all types.

### 13.5 New File: `governor-criteria.ts` (optional, can be inline)

```
workers/ff-pipeline/src/agents/governor-criteria.ts
```

Contains: `meetsAutoTriggerCriteria`, `meetsAutoApproveCriteria`,
`meetsEscalationCriteria`, `isWithinSafeConfigRange` -- all pure
deterministic functions with no LLM dependency.

---

## 14. Telemetry and Observability

Every governance cycle writes to ArangoDB so TIAGO (and future
dashboards) can observe Governor behavior:

### 14.1 Cycle Telemetry (`orl_telemetry`)

```typescript
await db.save('orl_telemetry', {
  schemaName: '_governance_cycle',
  success: true,
  failureMode: null,
  tier: 0,
  repairAttempts: result.repairAttempts ?? 0,
  coercions: [],
  timestamp: new Date().toISOString(),
  // Governor-specific fields:
  trigger: trigger,
  decisionCount: result.decisions.length,
  executedCount: result.decisions.filter(d => d.executed).length,
  escalationCount: result.escalations.length,
  operationalHealth: result.assessment.operational_health,
  pendingSignalCount: result.metrics_snapshot.pending_signal_count,
  cycleDurationMs: elapsed,
})
```

### 14.2 Assessment Record (`orientation_assessments`)

```typescript
await db.save('orientation_assessments', {
  type: 'governance_cycle',
  cycle_id: result.cycle_id,
  assessment: result.assessment,
  decisions_summary: result.decisions.map(d => ({
    action: d.action,
    target: d.target,
    executed: d.executed,
  })),
  escalations: result.escalations,
  metrics: result.metrics_snapshot,
  createdAt: new Date().toISOString(),
})
```

### 14.3 Queryable via Gateway

TIAGO can observe Governor behavior via the existing gateway routes:

```bash
# See recent governance cycles
curl https://ff-gateway.koales.workers.dev/specs/orl_telemetry/_governance_cycle

# See governance assessments
curl https://ff-gateway.koales.workers.dev/specs/orientation_assessments/governance_cycle
```

---

## 15. Evolution Path

### Phase 1: Cron-Only Governor (this design)

- Runs every 15 minutes on cron
- Single LLM call per cycle
- Deterministic action gates
- Escalates via GitHub issues
- All state in ArangoDB

### Phase 2: Real-Time Event Governor

- Also triggers on queue events (feedback-complete, synthesis-complete)
- Lower latency for time-sensitive decisions
- Same deterministic gates

### Phase 3: Multi-Agent Governor

- Governor delegates diagnostic sub-tasks to specialized agents
- DriftDiagnosisAgent for trend analysis
- ContractHealthAgent for schema validation trends
- Governor remains the decision authority

### Phase 4: Self-Tuning Governor

- Governor adjusts its own auto-trigger/approve thresholds
- Based on human override frequency (if humans approve what Governor
  would have approved, widen the criteria)
- Threshold changes are Meta-Artifacts with rollback conditions

---

## 16. Risk Assessment

| Risk | Mitigation |
|---|---|
| Runaway pipeline creation (LLM hallucination) | Deterministic auto-trigger gate + max 5 per cycle |
| False approvals | Deterministic auto-approve criteria, not LLM judgment |
| Missed escalation | Criteria are hard-coded; LLM supplements but cannot override |
| Context query failure (ArangoDB down) | All queries catch errors and return empty arrays; Governor runs with partial context |
| LLM invocation failure | Caught and logged; cycle produces a "no decisions" result; next cron retries |
| Cost overrun | Each cycle is one LLM call (~16K input, ~4K output); at 96 calls/day this is negligible |
| State corruption | Governor is stateless; reads from ArangoDB, writes decisions back; no state to corrupt |
| Self-referential loop | Governor never creates signals about its own cycles; Governor telemetry uses separate schema |

---

## 17. Decision Algebra Mapping

Following section 9 of the Orientation Ontology:

```
D = <I, C, P, E, A, X, O, J, T>

I (Intent)     = Keep the Factory running autonomously within governance bounds
C (Context)    = GovernorContext (8 AQL queries)
P (Policy)     = Auto-trigger criteria, auto-approve criteria, escalation criteria
E (Evidence)   = ORL telemetry, pending signals, pipeline results, curated memory
A (Authority)  = L3_ActWithReview (act on safe, escalate on unsafe)
X (Action)     = GovernanceDecision[] (trigger, approve, escalate, diagnose, archive)
O (Outcome)    = GovernanceCycleResult with executed decisions
J (Justification) = GovernanceAssessment (situation frame, health, risks)
T (Time)       = 15-minute cron windows, 7-day telemetry lookback
```

---

## 18. Ontology Classification

```
orientation_agent.governor

  type: EvolutionGovernorAgent (Ontology section 5, agent #9)

  observes:
    RuntimeMetric, TraceEvent, ValidationFailure,
    ModelExecutionResult, CriticFinding, TestResult,
    CostObservation, LatencyObservation, DriftMeasurement

  produces:
    GovernanceDecision (GovernanceCaseFile subtype)
    OrientationAssessment
    EscalationSignal (GovernanceViolationSignal subtype)
    OperationalReport (FactoryMemoryUpdate subtype)

  cannot_directly_modify:
    production_factory (code, config, prompts, deployments)

  autonomy_level: L3_ActWithReview
    - L1 would be observe-only (too passive)
    - L2 would be propose-only (does not solve the 24/7 problem)
    - L3 can act within deterministic safety bounds
    - L4 (full autonomy) is explicitly rejected — humans remain in the loop
```

---

## Appendix A: Relationship to Existing Agents

```
GovernorAgent
  reads output of --> MemoryCuratorAgent (curated lessons)
  reads output of --> FeedbackGenerator (feedback signals)
  triggers       --> FactoryPipeline (new runs)
  approves       --> FactoryPipeline (waiting gates)
  escalates to   --> Human (via GitHub issues)

  does NOT interact with:
    ArchitectAgent, CriticAgent, CoderAgent, TesterAgent, VerifierAgent,
    PlannerAgent, SynthesisCoordinator, AtomExecutor
    (these are pipeline-internal agents; Governor operates above them)
```

---

## Appendix B: Comparison with MemoryCuratorAgent

| Aspect | MemoryCuratorAgent | GovernorAgent |
|---|---|---|
| Ontology type | MemoryCuratorAgent (section 11, #8) | EvolutionGovernorAgent (section 11, #9) |
| Autonomy | L2_Propose (curates, does not act) | L3_ActWithReview (acts within bounds) |
| Trigger | Queue message (memory-curation) | Cron (*/15) + queue (governor-cycle) |
| Context queries | 4 parallel AQL | 8 parallel AQL |
| Output | MemoryCurationResult | GovernanceCycleResult |
| Side effects | Writes to memory_curated, pattern_library | Triggers pipelines, approves gates, files issues |
| Action gate | None (write-only) | Deterministic criteria validation |
| State | Stateless (reads from ArangoDB) | Stateless (reads from ArangoDB) |
| LLM model | Same as other agents (task-routing) | Same as other agents (task-routing) |
| Max cycle time | Unbounded (async) | 120 seconds (hard timeout) |
