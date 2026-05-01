/**
 * GovernorAgent — Autonomous Operational Governor for Function Factory.
 *
 * Replaces TIAGO (Claude Code on Wes's laptop) as the Factory's 24/7
 * operational decision-maker. Runs inside Cloudflare on a cron schedule
 * (every 15 minutes), not on a human machine.
 *
 * Architecture: Plan-and-Execute pattern where:
 *   - Planner = LLM (produces GovernanceCycleResult)
 *   - Executor = deterministic code (validates against criteria, executes safe actions)
 *   - The executor can REJECT planner decisions (governance safety property)
 *
 * The Governor intentionally avoids ReAct and tool-calling patterns.
 * The LLM serves as an assessment engine, not an execution engine.
 * Context is pre-fetched (all 8 AQL queries run before the LLM call).
 * Actions are post-validated (deterministic criteria checks after the LLM call).
 * This prevents prompt injection or hallucination from triggering real-world
 * side effects.
 *
 * @see specs/reference/DESIGN-GOVERNOR-AGENT.md
 * @see specs/reference/GOVERNOR-PROMPT-ENGINEERING-REVIEW.md
 */

import { agentLoop } from '@weops/gdk-agent'
import type { Model, AssistantMessage, Message, UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import { resolveAgentModel } from './resolve-model'
import { processAgentOutput, extractAssistantText, buildTelemetryEntry, type OutputSchema } from './output-reliability'
import type { PipelineEnv } from '../types'

// ── Types ─────────────────────────────────────────────────────────

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
  target: string
  reason: string
  evidence: string[]
  risk_level: 'safe' | 'moderate' | 'high'
  executed: boolean
  execution_result?: string
}

export interface GovernanceAssessment {
  situation_frame: string
  operational_health: 'healthy' | 'degraded' | 'critical'
  top_risks: string[]
  top_opportunities: string[]
  trend: 'improving' | 'stable' | 'degrading'
  evidence_summary: string
}

export interface EscalationEntry {
  issue: string
  severity: 'critical' | 'high'
  evidence: string[]
  recommended_action: string
  escalation_target: 'github_issue' | 'high_priority_signal'
}

export interface MetricsSnapshot {
  pending_signal_count: number
  active_pipeline_count: number
  completed_last_24h: number
  failed_last_24h: number
  orl_success_rate_7day: number
  avg_repair_count_7day: number
  stale_signal_count: number
  feedback_loop_depth_max: number
}

export interface GovernanceCycleResult {
  cycle_id: string
  timestamp: string
  decisions: GovernanceDecision[]
  assessment: GovernanceAssessment
  escalations: EscalationEntry[]
  metrics_snapshot: MetricsSnapshot
}

export interface GovernorContext {
  orl_telemetry: Record<string, unknown>[]
  pending_signals: Record<string, unknown>[]
  active_pipelines: Record<string, unknown>[]
  recent_feedback: Record<string, unknown>[]
  memory_curated: Record<string, unknown>[]
  orientation_assessments: Record<string, unknown>[]
  completion_ledgers: Record<string, unknown>[]
  hot_config: Record<string, unknown>[]
}

// ── Rate Limits ──────────────────────────────────────────────────

const MAX_PIPELINES_PER_CYCLE = 5
const MAX_APPROVALS_PER_CYCLE = 3

// ── Safe-approve subtypes ────────────────────────────────────────

const SAFE_APPROVE_SUBTYPES = new Set([
  'synthesis:atom-failed',
  'synthesis:orl-degradation',
])

// ── ORL Schema ───────────────────────────────────────────────────

export const GOVERNOR_ASSESSMENT_SCHEMA: OutputSchema<GovernanceCycleResult> = {
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

// ── Deterministic Criteria ───────────────────────────────────────

/**
 * Deterministic auto-trigger criteria — NOT LLM-based.
 * All four criteria must be true.
 */
export function meetsAutoTriggerCriteria(signal: Record<string, unknown>): boolean {
  if (signal.source !== 'factory:feedback-loop') return false
  const raw = signal.raw as Record<string, unknown> | undefined
  if (!raw) return false
  if (typeof raw.feedbackDepth !== 'number' || raw.feedbackDepth >= 3) return false
  if (raw.autoApprove !== true) return false
  return true
}

/**
 * Deterministic auto-approve criteria — NOT LLM-based.
 * Signal must be feedback-loop, autoApprove true, and safe subtype.
 */
export function meetsAutoApproveCriteria(signal: Record<string, unknown>): boolean {
  if (signal.source !== 'factory:feedback-loop') return false
  const raw = signal.raw as Record<string, unknown> | undefined
  if (!raw || raw.autoApprove !== true) return false
  if (!SAFE_APPROVE_SUBTYPES.has(signal.subtype as string)) return false
  return true
}

// ── Context Prefetch ─────────────────────────────────────────────

/**
 * Pre-fetch governance context from ArangoDB via 8 parallel queries.
 * Never throws — all queries catch errors and return empty arrays.
 */
export async function prefetchGovernorContext(db: ArangoClient): Promise<GovernorContext> {
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
    db.query<Record<string, unknown>>(
      `FOR t IN orl_telemetry
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
        }`,
    ).catch(() => [] as Record<string, unknown>[]),

    // Q2: Pending signals — not yet in a pipeline, ordered by age
    db.query<Record<string, unknown>>(
      `FOR s IN specs_signals
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
        }`,
    ).catch(() => [] as Record<string, unknown>[]),

    // Q3: Active/recent pipelines — status of in-flight work
    db.query<Record<string, unknown>>(
      `FOR p IN execution_artifacts
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
        }`,
    ).catch(() => [] as Record<string, unknown>[]),

    // Q4: Recent feedback signals — the self-improvement loop output
    db.query<Record<string, unknown>>(
      `FOR s IN specs_signals
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
        }`,
    ).catch(() => [] as Record<string, unknown>[]),

    // Q5: Curated memory — patterns the Factory has learned
    db.query<Record<string, unknown>>(
      `FOR l IN memory_curated
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
        }`,
    ).catch(() => [] as Record<string, unknown>[]),

    // Q6: Recent orientation assessments — previous governance cycle context
    db.query<Record<string, unknown>>(
      `FOR a IN orientation_assessments
        SORT a.createdAt DESC
        LIMIT 10
        RETURN {
          _key: a._key,
          type: a.type,
          recommendation: a.recommendation,
          priority: a.priority,
          rationale: a.rationale,
          createdAt: a.createdAt
        }`,
    ).catch(() => [] as Record<string, unknown>[]),

    // Q7: In-flight completion ledgers — synthesis work in progress
    db.query<Record<string, unknown>>(
      `FOR l IN completion_ledgers
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
        }`,
    ).catch(() => [] as Record<string, unknown>[]),

    // Q8: Hot config — runtime configuration
    db.query<Record<string, unknown>>(
      `FOR c IN hot_config
        RETURN { _key: c._key, value: c.value, updatedAt: c.updatedAt }`,
    ).catch(() => [] as Record<string, unknown>[]),
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

// ── Context Formatter ────────────────────────────────────────────

/**
 * Compute human-readable time delta from ISO timestamp.
 */
function timeSince(isoTimestamp: string): string {
  const diff = Date.now() - new Date(isoTimestamp).getTime()
  if (diff < 0) return 'future'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

/**
 * Format governance context into structured markdown sections for the LLM prompt.
 */
export function formatGovernorContextForPrompt(ctx: GovernorContext): string {
  const parts: string[] = ['## Governance Cycle Context\n']

  // Pending signals section
  parts.push(`### Pending Signals (${ctx.pending_signals.length})`)
  for (const s of ctx.pending_signals) {
    const age = s.createdAt ? timeSince(s.createdAt as string) : 'unknown'
    parts.push(
      `- [${s._key}] ${s.subtype ?? s.signalType}: ${s.title} ` +
      `(age: ${age}, depth: ${s.feedbackDepth ?? 0}, ` +
      `autoApprove: ${s.autoApprove ?? false})`,
    )
  }

  // ORL telemetry section
  parts.push(`\n### ORL Telemetry (7-day)`)
  for (const t of ctx.orl_telemetry) {
    const rate = (((t.success_rate as number) ?? 0) * 100).toFixed(1)
    parts.push(
      `- ${t.schemaName}: ${rate}% success ` +
      `(${t.success_count}/${(t.success_count as number) + (t.fail_count as number)}), ` +
      `avg repairs: ${((t.avg_repairs as number) ?? 0).toFixed(1)}`,
    )
  }

  // Active pipelines section
  parts.push(`\n### Active Pipelines (${ctx.active_pipelines.length})`)
  for (const p of ctx.active_pipelines) {
    parts.push(
      `- [${p._key}] ${p.status} — ${p.functionId ?? 'no function'} ` +
      `(created: ${p.createdAt})`,
    )
  }

  // Recent feedback section
  parts.push(`\n### Recent Feedback Signals (${ctx.recent_feedback.length})`)
  for (const f of ctx.recent_feedback) {
    parts.push(
      `- [${f._key}] ${f.subtype}: ${f.title} ` +
      `(depth: ${f.feedbackDepth ?? 0}, ${f.createdAt})`,
    )
  }

  // Curated memory section
  if (ctx.memory_curated.length > 0) {
    parts.push(`\n### Active Curated Lessons (${ctx.memory_curated.length})`)
    for (const l of ctx.memory_curated) {
      parts.push(
        `- [${l.severity}] ${l.pattern} ` +
        `(confidence: ${l.confidence}, evidence: ${l.evidence_count})`,
      )
    }
  }

  // In-flight synthesis
  if (ctx.completion_ledgers.length > 0) {
    parts.push(`\n### In-Flight Synthesis (${ctx.completion_ledgers.length})`)
    for (const l of ctx.completion_ledgers) {
      parts.push(
        `- ${l.workGraphId}: ${l.completedAtoms}/${l.totalAtoms} atoms ` +
        `(${l.status})`,
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

// ── System Prompt (with all 10 Phase 1 prompt engineering improvements) ──

const GOVERNOR_SYSTEM_PROMPT = `You are the Governor -- the Factory's autonomous operational decision-maker.

You think like a seasoned operations manager at a 24/7 manufacturing plant. Your default disposition is CONSERVATIVE: when uncertain, do not act -- escalate. You never confuse "I can classify this" with "I should act on this." You treat every governance cycle as an audit: read the data, match against criteria, produce typed decisions. You do not speculate. You do not infer intent. You cite evidence or you escalate.

You run every 15 minutes inside Cloudflare. Your job: keep the Factory running without human intervention for routine operations. Escalate anything requiring human judgment.

---

DECISION CLASSIFICATION (evaluate in this order, first match wins):

1. AUTO-TRIGGER: signal.source === 'factory:feedback-loop' AND feedbackDepth < 3 AND autoApprove === true AND no cooldown violation (same workGraphId+subtype within 30 min)
   -> action: "trigger_pipeline"

2. AUTO-APPROVE: pipeline waiting at architect-approval AND signal.autoApprove === true AND signal.source === 'factory:feedback-loop' AND subtype in ['synthesis:atom-failed', 'synthesis:orl-degradation']
   -> action: "approve_pipeline"

3. STALE: signal pending > 7 days, no auto-trigger match
   -> action: "archive_signal"

4. DUPLICATE: same workGraphId+subtype as another pending signal within 30 min
   -> action: "deduplicate_signal"

5. ESCALATION-REQUIRED: any escalation trigger met (see below)
   -> action: "escalate_to_human"

6. DIAGNOSABLE: failure pattern detectable from telemetry, below escalation threshold
   -> action: "diagnose_failure"

7. CONFIG-RESPONSIVE: measurable drift addressable by hot_config within safe range
   -> action: "adjust_config"

8. NONE OF THE ABOVE:
   -> action: "no_action"

ESCALATION TRIGGERS (any one sufficient):
- ORL success rate < 50% for any schema over 24h
- 3+ consecutive governance cycles with zero successful actions
- Signal pending > 48 hours with no auto-trigger match
- Pipeline failure rate > 80% in last 24h
- Unclassifiable anomaly
- Feedback loop depth at max (3) without resolution

HARD CONSTRAINTS -- YOU CANNOT:
- Write or modify code
- Change prompts or routing config
- Deploy workers
- Make architecture decisions
- Approve signals that don't meet auto-approve criteria
- Trigger more than 5 pipelines per cycle

---

REASONING PROCESS (follow in order):

Step 1 -- METRICS: Count pending signals, active pipelines, 24h completions, 24h failures, stale signals, max feedback depth from the data above.

Step 2 -- CLASSIFY SIGNALS: For each pending signal, walk through the classification list above. Record which criteria are met/unmet.

Step 3 -- CLASSIFY PIPELINES: For each pipeline at architect-approval, check auto-approve criteria.

Step 4 -- DETECT ANOMALIES: Scan ORL telemetry for escalation triggers. Check for degradation trends (>20pp drop in 7 days).

Step 5 -- DETECT SILENT FAILURES: Signals >48h with no pipeline. Pipelines >24h with no completion. Feedback loops at depth 3.

Step 6 -- PRODUCE DECISIONS: One decision per signal/pipeline/anomaly. Cite evidence keys.

Step 7 -- ASSESS: Write situation_frame, determine operational_health and trend.

Step 8 -- SELF-CHECK:
  a. Every trigger_pipeline target exists in pending signals.
  b. Every approve_pipeline target exists in active pipelines.
  c. Every evidence key exists in the context data above.
  d. metrics_snapshot matches actual counts from Step 1.
  e. No missed escalation triggers.
  f. No more than 5 trigger_pipeline decisions.
  Fix any violations before output.

---

EXAMPLES:

Signal SIG-2847, subtype "synthesis:atom-failed", source "factory:feedback-loop", depth 1, autoApprove true, age 22min, no cooldown:
{"action":"trigger_pipeline","target":"SIG-2847","reason":"Meets all auto-trigger criteria: feedback-loop source, depth 1 < 3, autoApprove true, no cooldown.","evidence":["SIG-2847"],"risk_level":"safe","executed":false}

ORL schema "GovernanceCycleResult" at 42% success/24h (was 89% yesterday):
{"action":"escalate_to_human","target":"GovernanceCycleResult","reason":"ORL success 42% < 50% threshold over 24h. 5/6 recent cycles failed. Structural issue.","evidence":["orl_GovernanceCycleResult"],"risk_level":"high","executed":false}

Signal SIG-3021, subtype "architecture:drift", source "factory:orientation-agent", autoApprove false, age 4h:
{"action":"no_action","target":"SIG-3021","reason":"Source not feedback-loop, autoApprove false. Age 4h < 48h escalation threshold. Re-evaluate next cycle.","evidence":["SIG-3021"],"risk_level":"moderate","executed":false}

---

CRITICAL: Your reasoning is INTERNAL. Do NOT output your thinking steps. Your ONLY output is one JSON object. No markdown fences. No commentary. No "Let me analyze..." text. Start your response with {"cycle_id":

Required fields:
- cycle_id: "gov-{ISO8601}"
- timestamp: ISO 8601
- decisions: array of {action, target, reason, evidence, risk_level, executed}
- assessment: {situation_frame, operational_health, top_risks, top_opportunities, trend, evidence_summary}
- escalations: array of {issue, severity, evidence, recommended_action, escalation_target}
- metrics_snapshot: {pending_signal_count, active_pipeline_count, completed_last_24h, failed_last_24h, orl_success_rate_7day, avg_repair_count_7day, stale_signal_count, feedback_loop_depth_max}`

// ── Agent Class ──────────────────────────────────────────────────

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

  constructor(opts: GovernorAgentOpts) {
    this.db = opts.db
    this.env = opts.env
    this.apiKey = opts.apiKey
    this.trigger = opts.trigger
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
  }

  /**
   * Run the assessment cycle: prefetch context, invoke LLM, parse output.
   * Returns a typed GovernanceCycleResult with executed=false on all decisions.
   */
  async assess(): Promise<GovernanceCycleResult> {
    const now = new Date().toISOString()

    if (this.dryRun) {
      return {
        cycle_id: `gov-${now}`,
        timestamp: now,
        decisions: [],
        assessment: {
          situation_frame: 'Dry-run: no assessment performed',
          operational_health: 'healthy',
          top_risks: [],
          top_opportunities: [],
          trend: 'stable',
          evidence_summary: 'Dry-run mode — no data queried',
        },
        escalations: [],
        metrics_snapshot: {
          pending_signal_count: 0,
          active_pipeline_count: 0,
          completed_last_24h: 0,
          failed_last_24h: 0,
          orl_success_rate_7day: 0,
          avg_repair_count_7day: 0,
          stale_signal_count: 0,
          feedback_loop_depth_max: 0,
        },
      }
    }

    // Prefetch context from ArangoDB
    const ctx = await prefetchGovernorContext(this.db)
    const contextPrompt = formatGovernorContextForPrompt(ctx)

    const userContent = `${contextPrompt}\n\nPerform a governance cycle. Follow the reasoning process steps 1-8. Output only the final JSON.`

    const model = this.modelOverride ?? resolveAgentModel('governor')

    const stream = agentLoop(
      [{ role: 'user', content: userContent, timestamp: Date.now() } as UserMessage],
      { systemPrompt: GOVERNOR_SYSTEM_PROMPT, messages: [] },
      {
        model,
        convertToLlm: (msgs) => msgs as Message[],
        getApiKey: async () => this.apiKey,
        maxTokens: 32768,
        onPayload: (payload: unknown) => ({
          ...(payload as Record<string, unknown>),
          response_format: { type: 'json_object' },
        }),
      },
      AbortSignal.timeout(300_000),
    )

    const messages = await stream.result()
    const lastAssistant = [...messages].reverse().find((m): m is AssistantMessage => m.role === 'assistant')
    if (!lastAssistant) throw new Error('GovernorAgent: no assistant response')
    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`GovernorAgent: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const rawText = extractAssistantText(lastAssistant.content as any)
    if (!rawText) {
      const blockTypes = lastAssistant.content.map(c => c.type).join(',')
      throw new Error(`GovernorAgent: empty response (blocks: ${blockTypes || 'none'}, stopReason: ${lastAssistant.stopReason})`)
    }

    const result = await processAgentOutput(rawText, GOVERNOR_ASSESSMENT_SCHEMA)

    // ORL telemetry — fire-and-forget
    try {
      const telemetry = buildTelemetryEntry(result, 'GovernanceCycleResult')
      await this.db.save('orl_telemetry', telemetry).catch(() => {})
    } catch { /* telemetry is best-effort */ }

    if (!result.success) {
      throw new Error(`GovernorAgent: ${result.failureMode}: could not produce valid assessment. Response: ${result.rawResponse.slice(0, 500)}`)
    }

    return result.data!
  }

  /**
   * Execute governance decisions: trigger pipelines, approve gates,
   * file escalations. Returns the result with executed=true and
   * execution_result set on each processed decision.
   *
   * CRITICAL: Deterministic action gates validate each decision before
   * execution. The LLM cannot bypass auto-trigger/approve criteria.
   */
  async execute(assessment: GovernanceCycleResult): Promise<GovernanceCycleResult> {
    let triggeredPipelines = 0
    let approvedPipelines = 0

    for (const decision of assessment.decisions) {
      try {
        switch (decision.action) {
          case 'trigger_pipeline': {
            // Rate limit check
            if (triggeredPipelines >= MAX_PIPELINES_PER_CYCLE) {
              decision.executed = false
              decision.execution_result = 'Skipped: pipeline rate limit reached (max 5 per cycle)'
              break
            }

            // DETERMINISTIC VALIDATION — not LLM-based
            const signal = await this.db.queryOne?.<Record<string, unknown>>(
              `FOR s IN specs_signals FILTER s._key == @key RETURN s`,
              { key: decision.target },
            ) ?? null

            if (!signal) {
              decision.executed = false
              decision.execution_result = 'Signal not found'
              break
            }

            if (!meetsAutoTriggerCriteria(signal)) {
              decision.executed = false
              decision.execution_result = 'Does not meet auto-trigger criteria'
              break
            }

            // Safe to execute
            const created = await this.env.FACTORY_PIPELINE.create({
              params: {
                signal: {
                  signalType: (signal.signalType ?? 'internal') as any,
                  source: signal.source as string,
                  title: signal.title as string,
                  description: signal.description as string ?? signal.title as string,
                  subtype: signal.subtype as string,
                  raw: signal.raw as Record<string, unknown>,
                  sourceRefs: signal.sourceRefs as string[],
                },
              },
            })
            decision.executed = true
            decision.execution_result = `Pipeline ${created.id} created`
            triggeredPipelines++
            break
          }

          case 'approve_pipeline': {
            // Rate limit check
            if (approvedPipelines >= MAX_APPROVALS_PER_CYCLE) {
              decision.executed = false
              decision.execution_result = 'Skipped: approval rate limit reached (max 3 per cycle)'
              break
            }

            // Look up the pipeline to find its associated signal
            const pipeline = await this.db.queryOne?.<Record<string, unknown>>(
              `FOR p IN execution_artifacts FILTER p.workflowId == @wfId RETURN p`,
              { wfId: decision.target },
            ) ?? null

            if (!pipeline) {
              decision.executed = false
              decision.execution_result = 'Pipeline not found'
              break
            }

            // Look up the signal to validate auto-approve criteria
            const approveSignal = pipeline.signalId
              ? await this.db.queryOne?.<Record<string, unknown>>(
                  `FOR s IN specs_signals FILTER s._key == @key RETURN s`,
                  { key: pipeline.signalId },
                ) ?? null
              : null

            if (!approveSignal || !meetsAutoApproveCriteria(approveSignal)) {
              decision.executed = false
              decision.execution_result = 'Does not meet auto-approve criteria'
              break
            }

            // Safe to approve
            const workflow = await this.env.FACTORY_PIPELINE.get(decision.target)
            await workflow.sendEvent({
              type: 'architect-approval',
              payload: { approved: true, source: 'governor-agent' },
            })
            decision.executed = true
            decision.execution_result = `Pipeline ${decision.target} approved`
            approvedPipelines++
            break
          }

          case 'escalate_to_human': {
            // Write to escalations collection
            await this.db.save('escalations', {
              issue: decision.reason,
              target: decision.target,
              evidence: decision.evidence,
              risk_level: decision.risk_level,
              source: 'governor-agent',
              createdAt: new Date().toISOString(),
            })
            decision.executed = true
            decision.execution_result = 'Escalation recorded in ArangoDB'
            break
          }

          case 'diagnose_failure': {
            // Write diagnostic to orientation_assessments
            await this.db.save('orientation_assessments', {
              type: 'governor_diagnosis',
              target: decision.target,
              diagnosis: decision.reason,
              evidence: decision.evidence,
              risk_level: decision.risk_level,
              createdAt: new Date().toISOString(),
            })
            decision.executed = true
            decision.execution_result = 'Diagnosis written to orientation_assessments'
            break
          }

          case 'archive_signal': {
            await this.db.query(
              `FOR s IN specs_signals FILTER s._key == @key UPDATE s WITH { status: 'archived', archivedAt: @now, archivedBy: 'governor-agent' } IN specs_signals`,
              { key: decision.target, now: new Date().toISOString() },
            ).catch(() => {})
            decision.executed = true
            decision.execution_result = `Signal ${decision.target} archived`
            break
          }

          case 'deduplicate_signal': {
            await this.db.query(
              `FOR s IN specs_signals FILTER s._key == @key UPDATE s WITH { status: 'deduplicated', deduplicatedAt: @now, deduplicatedBy: 'governor-agent' } IN specs_signals`,
              { key: decision.target, now: new Date().toISOString() },
            ).catch(() => {})
            decision.executed = true
            decision.execution_result = `Signal ${decision.target} marked as duplicate`
            break
          }

          case 'no_action': {
            decision.executed = true
            decision.execution_result = 'No action required'
            break
          }

          case 'adjust_config': {
            // Config adjustments logged but not auto-executed in Phase 1
            decision.executed = false
            decision.execution_result = 'Config adjustments require manual review in Phase 1'
            break
          }

          default: {
            decision.executed = false
            decision.execution_result = `Unknown action: ${decision.action}`
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        decision.executed = false
        decision.execution_result = `Execution error: ${errorMessage}`
      }
    }

    return assessment
  }

  /**
   * Persist governance cycle result to ArangoDB:
   *   - orientation_assessments: the assessment summary
   *   - orl_telemetry: cycle metrics
   *   - specs_signals: any escalation signals (as high-priority signals)
   */
  async persist(result: GovernanceCycleResult): Promise<{ written: number; errors: string[] }> {
    let written = 0
    const errors: string[] = []

    // Write assessment to orientation_assessments
    try {
      await this.db.save('orientation_assessments', {
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
      written++
    } catch (err) {
      errors.push(`orientation_assessments: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Write cycle telemetry to orl_telemetry
    try {
      await this.db.save('orl_telemetry', {
        schemaName: '_governance_cycle',
        success: true,
        failureMode: null,
        tier: 0,
        repairAttempts: 0,
        coercions: [],
        timestamp: new Date().toISOString(),
        trigger: this.trigger,
        decisionCount: result.decisions.length,
        executedCount: result.decisions.filter(d => d.executed).length,
        escalationCount: result.escalations.length,
        operationalHealth: result.assessment.operational_health,
        pendingSignalCount: result.metrics_snapshot.pending_signal_count,
      })
      written++
    } catch (err) {
      errors.push(`orl_telemetry: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Write escalation signals as high-priority signals
    for (const escalation of result.escalations) {
      if (escalation.escalation_target === 'high_priority_signal') {
        try {
          await this.db.save('specs_signals', {
            signalType: 'internal',
            source: 'governor-agent',
            title: `[ESCALATION] ${escalation.issue}`,
            description: escalation.recommended_action,
            severity: escalation.severity,
            evidence: escalation.evidence,
            status: 'pending',
            createdAt: new Date().toISOString(),
          })
          written++
        } catch (err) {
          errors.push(`escalation_signal/${escalation.issue.slice(0, 40)}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    return { written, errors }
  }
}

// ── Top-Level Runner ─────────────────────────────────────────────

/**
 * Run a complete governance cycle. Used by both cron and queue triggers.
 */
export async function runGovernanceCycle(
  env: PipelineEnv,
  trigger: 'cron' | 'feedback-complete' | 'manual' = 'cron',
): Promise<void> {
  const { createClientFromEnv } = await import('@factory/arango-client')
  const { validateArtifact } = await import('@factory/artifact-validator')
  const { keyForModel, resolveAgentModel } = await import('./resolve-model.js')

  const db = createClientFromEnv(env)
  db.setValidator(validateArtifact)

  const model = resolveAgentModel('planning')

  const governor = new GovernorAgent({
    db,
    env,
    apiKey: keyForModel(model, env),
    trigger,
  })

  const startMs = Date.now()

  try {
    const assessment = await governor.assess()
    await governor.execute(assessment)
    await governor.persist(assessment)

    const elapsedMs = Date.now() - startMs
    console.log(
      `[Governor] Cycle complete in ${elapsedMs}ms: ` +
      `${assessment.decisions.length} decisions, ` +
      `${assessment.decisions.filter(d => d.executed).length} executed, ` +
      `${assessment.escalations.length} escalations, ` +
      `health: ${assessment.assessment.operational_health}`,
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    const elapsedMs = Date.now() - startMs
    console.error(`[Governor] Cycle failed after ${elapsedMs}ms: ${errorMessage}`)

    // Write failure telemetry
    try {
      await db.save('orl_telemetry', {
        schemaName: '_governance_cycle',
        success: false,
        failureMode: 'cycle_error',
        tier: 0,
        repairAttempts: 0,
        coercions: [],
        timestamp: new Date().toISOString(),
        trigger,
        error: errorMessage.slice(0, 500),
      }).catch(() => {})
    } catch { /* telemetry is best-effort */ }
  }
}
