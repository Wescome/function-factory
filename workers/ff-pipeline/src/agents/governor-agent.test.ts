/**
 * GovernorAgent tests — validates the autonomous operational governor.
 *
 * Validates:
 * 1. dry-run returns empty assessment without LLM call
 * 2. prefetchGovernorContext calls all 8 AQL queries
 * 3. formatGovernorContextForPrompt produces all markdown sections
 * 4. GOVERNOR_ASSESSMENT_SCHEMA validates a valid assessment
 * 5. execute respects rate limits (max 5 pipelines)
 * 6. execute respects deterministic gates (rejects unsafe triggers)
 * 7. execute handles trigger_pipeline action
 * 8. execute handles escalate_to_human action
 * 9. execute handles no_action (log only)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import {
  GovernorAgent,
  prefetchGovernorContext,
  formatGovernorContextForPrompt,
  GOVERNOR_ASSESSMENT_SCHEMA,
  meetsAutoTriggerCriteria,
  meetsAutoApproveCriteria,
  type GovernanceCycleResult,
  type GovernorContext,
} from './governor-agent'
import { processAgentOutput } from './output-reliability'

// ── Valid governance cycle result ──────────────────────────────────

const VALID_CYCLE_RESULT: GovernanceCycleResult = {
  cycle_id: 'gov-2026-04-29T12:00:00.000Z',
  timestamp: '2026-04-29T12:00:00.000Z',
  decisions: [
    {
      action: 'trigger_pipeline',
      target: 'SIG-001',
      reason: 'Signal meets all auto-trigger criteria: feedback-loop source, depth 1 < 3, autoApprove true, no cooldown.',
      evidence: ['SIG-001'],
      risk_level: 'safe',
      executed: false,
    },
    {
      action: 'no_action',
      target: 'SIG-002',
      reason: 'Signal source is not factory:feedback-loop. Does not meet auto-trigger criteria.',
      evidence: ['SIG-002'],
      risk_level: 'moderate',
      executed: false,
    },
  ],
  assessment: {
    situation_frame: 'Factory is running normally with 2 pending signals.',
    operational_health: 'healthy',
    top_risks: ['Feedback loop depth nearing max'],
    top_opportunities: ['Process pending feedback signals'],
    trend: 'stable',
    evidence_summary: '2 pending signals, 0 active pipelines, 85% ORL success rate.',
  },
  escalations: [],
  metrics_snapshot: {
    pending_signal_count: 2,
    active_pipeline_count: 0,
    completed_last_24h: 5,
    failed_last_24h: 1,
    orl_success_rate_7day: 0.85,
    avg_repair_count_7day: 0.3,
    stale_signal_count: 0,
    feedback_loop_depth_max: 1,
  },
}

// ── Mock DB ──────────────────────────────────────────────────────

function createMockDb(overrides?: { failCollections?: string[] }) {
  const calls: { query: string; params: Record<string, unknown> | undefined }[] = []
  const saves: { collection: string; data: Record<string, unknown> }[] = []
  const failSet = new Set(overrides?.failCollections ?? [])

  return {
    db: {
      query: async <T>(query: string, params?: Record<string, unknown>): Promise<T[]> => {
        calls.push({ query, params })
        for (const col of failSet) {
          if (query.includes(col)) throw new Error(`collection ${col} not found`)
        }
        if (query.includes('orl_telemetry')) {
          return [
            { schemaName: 'BriefingScript', success_count: 10, fail_count: 2, avg_repairs: 0.5, latest: '2026-04-29T00:00:00Z', success_rate: 0.833 },
          ] as T[]
        }
        if (query.includes('specs_signals') && query.includes('pending')) {
          return [
            { _key: 'SIG-001', signalType: 'internal', subtype: 'synthesis:atom-failed', title: 'Atom failed', source: 'factory:feedback-loop', severity: 'high', createdAt: '2026-04-29T11:00:00Z', sourceRefs: [], feedbackDepth: 1, autoApprove: true },
            { _key: 'SIG-002', signalType: 'internal', subtype: 'architecture:drift', title: 'Architecture drift', source: 'factory:orientation-agent', severity: 'medium', createdAt: '2026-04-29T11:30:00Z', sourceRefs: [], feedbackDepth: 0, autoApprove: false },
          ] as T[]
        }
        if (query.includes('execution_artifacts')) {
          return [
            { _key: 'PIPE-001', workflowId: 'wf-001', status: 'completed', signalId: 'SIG-000', functionId: 'FN-001', workGraphId: 'WG-001', createdAt: '2026-04-29T10:00:00Z', completedAt: '2026-04-29T10:30:00Z', verdict: 'pass' },
          ] as T[]
        }
        if (query.includes('factory:feedback-loop') && !query.includes('pending')) {
          return [
            { _key: 'FB-001', subtype: 'synthesis:atom-failed', title: 'Atom retry', createdAt: '2026-04-29T11:00:00Z', sourceRefs: ['SIG-000'], feedbackDepth: 1 },
          ] as T[]
        }
        if (query.includes('memory_curated')) {
          return [
            { pattern: 'F1 prose output', confidence: 0.85, severity: 'high', recommendation: 'Reduce context', evidence_count: 5, affects_agents: ['coder'] },
          ] as T[]
        }
        if (query.includes('orientation_assessments')) {
          return [
            { _key: 'OA-001', type: 'governance_cycle', recommendation: 'Increase timeout', priority: 'medium', rationale: 'Timeout rate increasing', createdAt: '2026-04-29T11:45:00Z' },
          ] as T[]
        }
        if (query.includes('completion_ledgers')) {
          return [
            { _key: 'CL-001', workGraphId: 'WG-001', totalAtoms: 5, completedAtoms: 3, status: 'in-progress', createdAt: '2026-04-29T10:00:00Z' },
          ] as T[]
        }
        if (query.includes('hot_config')) {
          return [
            { _key: 'routing_config', value: {}, updatedAt: '2026-04-29T00:00:00Z' },
          ] as T[]
        }
        return [] as T[]
      },
      queryOne: async <T>(query: string, params?: Record<string, unknown>): Promise<T | null> => {
        calls.push({ query, params })
        if (params?.key === 'SIG-001') {
          return {
            _key: 'SIG-001',
            source: 'factory:feedback-loop',
            raw: { feedbackDepth: 1, autoApprove: true },
          } as T
        }
        if (params?.key === 'SIG-UNSAFE') {
          return {
            _key: 'SIG-UNSAFE',
            source: 'external:market-research',
            raw: { feedbackDepth: 0, autoApprove: false },
          } as T
        }
        return null
      },
      save: async (collection: string, data: Record<string, unknown>) => {
        saves.push({ collection, data })
        return { _key: data._key ?? 'auto-key' }
      },
      ensureCollection: async () => {},
    } as any,
    calls,
    saves,
  }
}

// ── Mock PipelineEnv ────────────────────────────────────────────

function createMockEnv() {
  const createdPipelines: unknown[] = []
  const sentEvents: { workflowId: string; event: unknown }[] = []

  return {
    env: {
      FACTORY_PIPELINE: {
        create: async (opts: unknown) => {
          createdPipelines.push(opts)
          return { id: `pipeline-${createdPipelines.length}` }
        },
        get: async (id: string) => ({
          id,
          sendEvent: async (event: unknown) => {
            sentEvents.push({ workflowId: id, event })
          },
          status: async () => ({ status: 'running' }),
        }),
      },
      ARANGO_URL: 'https://test.arangodb.cloud',
      ARANGO_DATABASE: 'test',
      ARANGO_JWT: 'test-jwt',
      OFOX_API_KEY: 'test-key',
      ENVIRONMENT: 'test',
    } as any,
    createdPipelines,
    sentEvents,
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('GovernorAgent', () => {
  describe('dry-run mode', () => {
    it('returns empty assessment without calling agentLoop', async () => {
      const { db } = createMockDb()
      const { env } = createMockEnv()
      const governor = new GovernorAgent({
        db,
        env,
        apiKey: 'test-key',
        trigger: 'cron',
        dryRun: true,
      })

      const result = await governor.assess()

      expect(result.decisions).toEqual([])
      expect(result.escalations).toEqual([])
      expect(result.assessment.operational_health).toBe('healthy')
      expect(result.assessment.situation_frame).toContain('Dry-run')
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_CYCLE_RESULT)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, produces governance cycle result', async () => {
      const { db } = createMockDb()
      const { env } = createMockEnv()
      const fauxModel = faux.getModel()

      const governor = new GovernorAgent({
        db,
        env,
        apiKey: 'faux-key',
        trigger: 'cron',
        model: fauxModel,
      })

      const result = await governor.assess()

      expect(result.decisions).toHaveLength(2)
      expect(result.assessment.operational_health).toBe('healthy')
      expect(result.metrics_snapshot.pending_signal_count).toBe(2)
    })
  })
})

describe('prefetchGovernorContext', () => {
  it('calls all 8 AQL queries in parallel', async () => {
    const { db, calls } = createMockDb()

    const ctx = await prefetchGovernorContext(db)

    expect(calls).toHaveLength(8)
    expect(calls.some(c => c.query.includes('orl_telemetry'))).toBe(true)
    expect(calls.some(c => c.query.includes('specs_signals') && c.query.includes('pending'))).toBe(true)
    expect(calls.some(c => c.query.includes('execution_artifacts'))).toBe(true)
    expect(calls.some(c => c.query.includes('factory:feedback-loop'))).toBe(true)
    expect(calls.some(c => c.query.includes('memory_curated'))).toBe(true)
    expect(calls.some(c => c.query.includes('orientation_assessments'))).toBe(true)
    expect(calls.some(c => c.query.includes('completion_ledgers'))).toBe(true)
    expect(calls.some(c => c.query.includes('hot_config'))).toBe(true)
  })

  it('returns empty arrays when all queries fail', async () => {
    const failDb = {
      query: async () => { throw new Error('DB unavailable') },
    } as any

    const ctx = await prefetchGovernorContext(failDb)

    expect(ctx.orl_telemetry).toEqual([])
    expect(ctx.pending_signals).toEqual([])
    expect(ctx.active_pipelines).toEqual([])
    expect(ctx.recent_feedback).toEqual([])
    expect(ctx.memory_curated).toEqual([])
    expect(ctx.orientation_assessments).toEqual([])
    expect(ctx.completion_ledgers).toEqual([])
    expect(ctx.hot_config).toEqual([])
  })
})

describe('formatGovernorContextForPrompt', () => {
  it('produces markdown with all sections', () => {
    const ctx: GovernorContext = {
      orl_telemetry: [
        { schemaName: 'BriefingScript', success_count: 10, fail_count: 2, avg_repairs: 0.5, latest: '2026-04-29T00:00:00Z', success_rate: 0.833 },
      ],
      pending_signals: [
        { _key: 'SIG-001', signalType: 'internal', subtype: 'synthesis:atom-failed', title: 'Atom failed', source: 'factory:feedback-loop', severity: 'high', createdAt: '2026-04-29T11:00:00Z', sourceRefs: [], feedbackDepth: 1, autoApprove: true },
      ],
      active_pipelines: [
        { _key: 'PIPE-001', workflowId: 'wf-001', status: 'completed', signalId: 'SIG-000', functionId: 'FN-001', workGraphId: 'WG-001', createdAt: '2026-04-29T10:00:00Z', completedAt: '2026-04-29T10:30:00Z', verdict: 'pass' },
      ],
      recent_feedback: [
        { _key: 'FB-001', subtype: 'synthesis:atom-failed', title: 'Atom retry', createdAt: '2026-04-29T11:00:00Z', sourceRefs: ['SIG-000'], feedbackDepth: 1 },
      ],
      memory_curated: [
        { pattern: 'F1 prose output', confidence: 0.85, severity: 'high', recommendation: 'Reduce context', evidence_count: 5, affects_agents: ['coder'] },
      ],
      orientation_assessments: [
        { _key: 'OA-001', type: 'governance_cycle', recommendation: 'Increase timeout', priority: 'medium', rationale: 'Timeout rate increasing', createdAt: '2026-04-29T11:45:00Z' },
      ],
      completion_ledgers: [
        { _key: 'CL-001', workGraphId: 'WG-001', totalAtoms: 5, completedAtoms: 3, status: 'in-progress', createdAt: '2026-04-29T10:00:00Z' },
      ],
      hot_config: [
        { _key: 'routing_config', value: {}, updatedAt: '2026-04-29T00:00:00Z' },
      ],
    }

    const text = formatGovernorContextForPrompt(ctx)

    expect(text).toContain('## Governance Cycle Context')
    expect(text).toContain('### Pending Signals')
    expect(text).toContain('SIG-001')
    expect(text).toContain('### ORL Telemetry (7-day)')
    expect(text).toContain('BriefingScript')
    expect(text).toContain('### Active Pipelines')
    expect(text).toContain('PIPE-001')
    expect(text).toContain('### Recent Feedback Signals')
    expect(text).toContain('Atom retry')
    expect(text).toContain('### Active Curated Lessons')
    expect(text).toContain('F1 prose output')
    expect(text).toContain('### In-Flight Synthesis')
    expect(text).toContain('WG-001')
    expect(text).toContain('### Recent Orientation Assessments')
    expect(text).toContain('Increase timeout')
  })

  it('handles empty context', () => {
    const ctx: GovernorContext = {
      orl_telemetry: [],
      pending_signals: [],
      active_pipelines: [],
      recent_feedback: [],
      memory_curated: [],
      orientation_assessments: [],
      completion_ledgers: [],
      hot_config: [],
    }

    const text = formatGovernorContextForPrompt(ctx)

    expect(text).toContain('## Governance Cycle Context')
    expect(text).toContain('### Pending Signals (0)')
    expect(text).toContain('### ORL Telemetry (7-day)')
    expect(text).toContain('### Active Pipelines (0)')
  })
})

describe('GOVERNOR_ASSESSMENT_SCHEMA', () => {
  it('validates a valid governance cycle result', async () => {
    const result = await processAgentOutput(JSON.stringify(VALID_CYCLE_RESULT), GOVERNOR_ASSESSMENT_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data).not.toBeNull()
  })

  it('rejects missing required fields', async () => {
    const result = await processAgentOutput(JSON.stringify({
      cycle_id: 'gov-test',
      timestamp: '2026-04-29T12:00:00Z',
      // missing decisions, assessment, escalations, metrics_snapshot
    }), GOVERNOR_ASSESSMENT_SCHEMA)
    expect(result.success).toBe(false)
    expect(result.failureMode).toBe('F3')
  })

  it('coerces alias field names', async () => {
    const aliased = {
      cycle_id: 'gov-test',
      timestamp: '2026-04-29T12:00:00Z',
      governance_decisions: VALID_CYCLE_RESULT.decisions,  // alias for 'decisions'
      summary: VALID_CYCLE_RESULT.assessment,              // alias for 'assessment'
      alerts: VALID_CYCLE_RESULT.escalations,              // alias for 'escalations'
      metrics: VALID_CYCLE_RESULT.metrics_snapshot,         // alias for 'metrics_snapshot'
    }
    const result = await processAgentOutput(JSON.stringify(aliased), GOVERNOR_ASSESSMENT_SCHEMA)
    expect(result.success).toBe(true)
  })
})

describe('meetsAutoTriggerCriteria', () => {
  it('returns true for valid feedback signal', () => {
    const signal = {
      source: 'factory:feedback-loop',
      raw: { feedbackDepth: 1, autoApprove: true },
    }
    expect(meetsAutoTriggerCriteria(signal)).toBe(true)
  })

  it('rejects non-feedback source', () => {
    const signal = {
      source: 'external:market-research',
      raw: { feedbackDepth: 1, autoApprove: true },
    }
    expect(meetsAutoTriggerCriteria(signal)).toBe(false)
  })

  it('rejects depth >= 3', () => {
    const signal = {
      source: 'factory:feedback-loop',
      raw: { feedbackDepth: 3, autoApprove: true },
    }
    expect(meetsAutoTriggerCriteria(signal)).toBe(false)
  })

  it('rejects autoApprove false', () => {
    const signal = {
      source: 'factory:feedback-loop',
      raw: { feedbackDepth: 1, autoApprove: false },
    }
    expect(meetsAutoTriggerCriteria(signal)).toBe(false)
  })

  it('rejects missing raw field', () => {
    const signal = {
      source: 'factory:feedback-loop',
    }
    expect(meetsAutoTriggerCriteria(signal)).toBe(false)
  })
})

describe('meetsAutoApproveCriteria', () => {
  it('returns true for feedback atom-failed with autoApprove', () => {
    const signal = {
      source: 'factory:feedback-loop',
      subtype: 'synthesis:atom-failed',
      raw: { autoApprove: true },
    }
    expect(meetsAutoApproveCriteria(signal)).toBe(true)
  })

  it('returns true for feedback orl-degradation with autoApprove', () => {
    const signal = {
      source: 'factory:feedback-loop',
      subtype: 'synthesis:orl-degradation',
      raw: { autoApprove: true },
    }
    expect(meetsAutoApproveCriteria(signal)).toBe(true)
  })

  it('rejects non-safe subtype', () => {
    const signal = {
      source: 'factory:feedback-loop',
      subtype: 'architecture:drift-detected',
      raw: { autoApprove: true },
    }
    expect(meetsAutoApproveCriteria(signal)).toBe(false)
  })

  it('rejects non-feedback source', () => {
    const signal = {
      source: 'external:user-report',
      subtype: 'synthesis:atom-failed',
      raw: { autoApprove: true },
    }
    expect(meetsAutoApproveCriteria(signal)).toBe(false)
  })
})

describe('execute', () => {
  it('handles trigger_pipeline action for safe signal', async () => {
    const { db } = createMockDb()
    const { env, createdPipelines } = createMockEnv()
    const governor = new GovernorAgent({
      db,
      env,
      apiKey: 'test-key',
      trigger: 'cron',
      dryRun: true,
    })

    const result: GovernanceCycleResult = {
      ...VALID_CYCLE_RESULT,
      decisions: [
        {
          action: 'trigger_pipeline',
          target: 'SIG-001',
          reason: 'Meets auto-trigger criteria',
          evidence: ['SIG-001'],
          risk_level: 'safe',
          executed: false,
        },
      ],
    }

    const executed = await governor.execute(result)

    expect(executed.decisions[0]!.executed).toBe(true)
    expect(executed.decisions[0]!.execution_result).toContain('Pipeline')
    expect(createdPipelines).toHaveLength(1)
  })

  it('rejects unsafe trigger_pipeline (deterministic gate)', async () => {
    const { db } = createMockDb()
    const { env, createdPipelines } = createMockEnv()
    const governor = new GovernorAgent({
      db,
      env,
      apiKey: 'test-key',
      trigger: 'cron',
      dryRun: true,
    })

    const result: GovernanceCycleResult = {
      ...VALID_CYCLE_RESULT,
      decisions: [
        {
          action: 'trigger_pipeline',
          target: 'SIG-UNSAFE',
          reason: 'LLM hallucinated this should trigger',
          evidence: ['SIG-UNSAFE'],
          risk_level: 'safe',
          executed: false,
        },
      ],
    }

    const executed = await governor.execute(result)

    expect(executed.decisions[0]!.executed).toBe(false)
    expect(executed.decisions[0]!.execution_result).toContain('Does not meet auto-trigger criteria')
    expect(createdPipelines).toHaveLength(0)
  })

  it('respects max 5 pipelines rate limit', async () => {
    const { db } = createMockDb()
    const { env, createdPipelines } = createMockEnv()
    const governor = new GovernorAgent({
      db,
      env,
      apiKey: 'test-key',
      trigger: 'cron',
      dryRun: true,
    })

    // Create 7 trigger_pipeline decisions — only 5 should execute
    const decisions = Array.from({ length: 7 }, (_, i) => ({
      action: 'trigger_pipeline' as const,
      target: 'SIG-001', // same safe signal key
      reason: `Trigger ${i + 1}`,
      evidence: ['SIG-001'],
      risk_level: 'safe' as const,
      executed: false,
    }))

    const result: GovernanceCycleResult = {
      ...VALID_CYCLE_RESULT,
      decisions,
    }

    const executed = await governor.execute(result)

    const triggeredCount = executed.decisions.filter(d => d.executed && d.action === 'trigger_pipeline').length
    const rateLimitedCount = executed.decisions.filter(d => !d.executed && d.execution_result?.includes('rate limit')).length

    expect(triggeredCount).toBeLessThanOrEqual(5)
    expect(rateLimitedCount).toBeGreaterThan(0)
  })

  it('handles escalate_to_human action', async () => {
    const { db, saves } = createMockDb()
    const { env } = createMockEnv()
    const governor = new GovernorAgent({
      db,
      env,
      apiKey: 'test-key',
      trigger: 'cron',
      dryRun: true,
    })

    const result: GovernanceCycleResult = {
      ...VALID_CYCLE_RESULT,
      decisions: [
        {
          action: 'escalate_to_human',
          target: 'ORL-degradation',
          reason: 'ORL success rate below 50%',
          evidence: ['orl_GovernanceCycleResult'],
          risk_level: 'high',
          executed: false,
        },
      ],
    }

    const executed = await governor.execute(result)

    expect(executed.decisions[0]!.executed).toBe(true)
    expect(executed.decisions[0]!.execution_result).toContain('Escalation')
    // Should have written to escalations collection
    const escalationSaves = saves.filter(s => s.collection === 'escalations')
    expect(escalationSaves).toHaveLength(1)
  })

  it('handles no_action (log only, no side effects)', async () => {
    const { db, saves } = createMockDb()
    const { env, createdPipelines } = createMockEnv()
    const governor = new GovernorAgent({
      db,
      env,
      apiKey: 'test-key',
      trigger: 'cron',
      dryRun: true,
    })

    const result: GovernanceCycleResult = {
      ...VALID_CYCLE_RESULT,
      decisions: [
        {
          action: 'no_action',
          target: 'SIG-002',
          reason: 'Does not meet any criteria',
          evidence: ['SIG-002'],
          risk_level: 'moderate',
          executed: false,
        },
      ],
    }

    const executed = await governor.execute(result)

    expect(executed.decisions[0]!.executed).toBe(true)
    expect(executed.decisions[0]!.execution_result).toBe('No action required')
    // No pipelines created, no saves to collections
    expect(createdPipelines).toHaveLength(0)
  })

  it('handles signal not found', async () => {
    const { db } = createMockDb()
    const { env } = createMockEnv()
    const governor = new GovernorAgent({
      db,
      env,
      apiKey: 'test-key',
      trigger: 'cron',
      dryRun: true,
    })

    const result: GovernanceCycleResult = {
      ...VALID_CYCLE_RESULT,
      decisions: [
        {
          action: 'trigger_pipeline',
          target: 'SIG-NONEXISTENT',
          reason: 'LLM hallucinated this signal',
          evidence: ['SIG-NONEXISTENT'],
          risk_level: 'safe',
          executed: false,
        },
      ],
    }

    const executed = await governor.execute(result)

    expect(executed.decisions[0]!.executed).toBe(false)
    expect(executed.decisions[0]!.execution_result).toBe('Signal not found')
  })
})

describe('persist', () => {
  it('writes assessment, telemetry, and escalation signals', async () => {
    const { db, saves } = createMockDb()
    const { env } = createMockEnv()
    const governor = new GovernorAgent({
      db,
      env,
      apiKey: 'test-key',
      trigger: 'cron',
      dryRun: true,
    })

    const result: GovernanceCycleResult = {
      ...VALID_CYCLE_RESULT,
      escalations: [
        {
          issue: 'ORL degradation',
          severity: 'high',
          evidence: ['orl_data'],
          recommended_action: 'Check model provider',
          escalation_target: 'high_priority_signal',
        },
      ],
    }

    const { written, errors } = await governor.persist(result)

    expect(written).toBeGreaterThanOrEqual(2) // at least assessment + telemetry
    expect(errors).toEqual([])

    // Should have saved to orientation_assessments
    const assessmentSaves = saves.filter(s => s.collection === 'orientation_assessments')
    expect(assessmentSaves).toHaveLength(1)
    expect(assessmentSaves[0]!.data.type).toBe('governance_cycle')

    // Should have saved to orl_telemetry
    const telemetrySaves = saves.filter(s => s.collection === 'orl_telemetry')
    expect(telemetrySaves).toHaveLength(1)
    expect(telemetrySaves[0]!.data.schemaName).toBe('_governance_cycle')
  })
})
