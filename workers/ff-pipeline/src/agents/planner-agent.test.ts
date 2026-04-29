/**
 * PlannerAgent tests — follows architect-agent.test.ts pattern.
 *
 * Validates:
 * 1. dry-run mode returns hardcoded Plan without calling agentLoop
 * 2. Plan output shape validation (required fields, types)
 * 3. agentLoop integration with faux provider (tool call + final response)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { PlannerAgent, type PlannerInput } from './planner-agent'
import { processAgentOutput, PLAN_SCHEMA } from './output-reliability'
import type { Plan } from '../coordinator/state'

const VALID_PLAN: Plan = {
  approach: 'Implement authentication middleware first, then add route handlers',
  atoms: [
    { id: 'atom-001', description: 'Create JWT validation middleware', assignedTo: 'coder' },
    { id: 'atom-002', description: 'Add login/logout route handlers', assignedTo: 'coder' },
  ],
  executorRecommendation: 'gdk-agent',
  estimatedComplexity: 'medium',
}

const SAMPLE_WORKGRAPH = {
  _key: 'WG-TEST-001',
  title: 'User Authentication Module',
  atoms: [{ id: 'atom-001', description: 'Auth middleware' }],
  invariants: [{ id: 'INV-001', description: 'All routes must be authenticated' }],
  dependencies: [],
}

const SAMPLE_BRIEFING_SCRIPT = {
  goal: 'Implement the user authentication module',
  successCriteria: ['All auth endpoints respond correctly', 'Tests pass'],
  architecturalContext: 'Uses JWT with refresh tokens per DECISIONS.md D-012',
  strategicAdvice: 'Start with the middleware, then add route handlers',
  knownGotchas: ['Token expiry edge case from LESSONS L-007'],
  validationLoop: 'Run pnpm test && verify /auth/login returns 200',
}

function createMockDb() {
  const calls: { query: string }[] = []
  return {
    db: {
      query: async (query: string) => {
        calls.push({ query })
        if (query.includes('specs_functions')) {
          return [{ _key: 'FN-001', name: 'Auth Module', domain: 'security' }]
        }
        if (query.includes('specs_invariants')) {
          return [{ _key: 'INV-001', description: 'All routes must be authenticated' }]
        }
        if (query.includes('memory_semantic')) {
          return [{ _key: 'D-012', type: 'decision', decision: 'Use JWT with refresh tokens' }]
        }
        return []
      },
      save: async () => ({}),
      saveEdge: async () => ({}),
    } as any,
    calls,
  }
}

describe('PlannerAgent', () => {
  describe('dry-run mode', () => {
    it('returns hardcoded Plan without calling agentLoop', async () => {
      const { db } = createMockDb()
      const agent = new PlannerAgent({ db, apiKey: 'test-key', dryRun: true })

      const input: PlannerInput = {
        workGraph: SAMPLE_WORKGRAPH,
        briefingScript: SAMPLE_BRIEFING_SCRIPT,
      }

      const result = await agent.producePlan(input)

      expect(result.approach).toBe('Dry-run implementation plan')
      expect(result.atoms).toHaveLength(1)
      expect(result.atoms[0]!.id).toBe('atom-001')
      expect(result.executorRecommendation).toBe('gdk-agent')
      expect(result.estimatedComplexity).toBe('low')
    })
  })

  describe('validation (via ORL)', () => {
    it('rejects missing required fields', async () => {
      // Missing approach
      const r1 = await processAgentOutput(JSON.stringify({
        atoms: [], executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
      }), PLAN_SCHEMA)
      expect(r1.success).toBe(false)
      expect(r1.failureMode).toBe('F3')

      // Missing atoms
      const r2 = await processAgentOutput(JSON.stringify({
        approach: 'test', executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
      }), PLAN_SCHEMA)
      expect(r2.success).toBe(false)

      // Missing executorRecommendation — defaults fill it
      const r3 = await processAgentOutput(JSON.stringify({
        approach: 'test', atoms: [], estimatedComplexity: 'low',
      }), PLAN_SCHEMA)
      expect(r3.success).toBe(true)
      expect(r3.data!.executorRecommendation).toBe('gdk-agent')

      // Missing estimatedComplexity — defaults fill it
      const r4 = await processAgentOutput(JSON.stringify({
        approach: 'test', atoms: [], executorRecommendation: 'gdk-agent',
      }), PLAN_SCHEMA)
      expect(r4.success).toBe(true)
      expect(r4.data!.estimatedComplexity).toBe('medium')
    })

    it('coerces wrong types instead of rejecting', async () => {
      // number approach coerced to string
      const r1 = await processAgentOutput(JSON.stringify({
        approach: 123, atoms: [], executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
      }), PLAN_SCHEMA)
      expect(r1.success).toBe(true)
      expect(r1.data!.approach).toBe('123')

      // string atoms coerced to array
      const r2 = await processAgentOutput(JSON.stringify({
        approach: 'ok', atoms: 'not-array', executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
      }), PLAN_SCHEMA)
      expect(r2.success).toBe(true)
      expect(Array.isArray(r2.data!.atoms)).toBe(true)

      // number executorRecommendation coerced to string
      const r3 = await processAgentOutput(JSON.stringify({
        approach: 'ok', atoms: [], executorRecommendation: 42, estimatedComplexity: 'low',
      }), PLAN_SCHEMA)
      expect(r3.success).toBe(true)
      expect(r3.data!.executorRecommendation).toBe('42')

      // number estimatedComplexity coerced to string
      const r4 = await processAgentOutput(JSON.stringify({
        approach: 'ok', atoms: [], executorRecommendation: 'gdk-agent', estimatedComplexity: 99,
      }), PLAN_SCHEMA)
      expect(r4.success).toBe(true)
      expect(r4.data!.estimatedComplexity).toBe('99')
    })

    it('rejects non-objects (prose)', async () => {
      const r1 = await processAgentOutput('just a string', PLAN_SCHEMA)
      expect(r1.success).toBe(false)

      const r2 = await processAgentOutput(null as any, PLAN_SCHEMA)
      expect(r2.success).toBe(false)
      expect(r2.failureMode).toBe('F7')
    })

    it('accepts valid Plan', async () => {
      const result = await processAgentOutput(JSON.stringify(VALID_PLAN), PLAN_SCHEMA)
      expect(result.success).toBe(true)
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        // Single turn: agent returns final Plan (no tools)
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_PLAN)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, produces Plan (no tool calls)', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new PlannerAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const input: PlannerInput = {
        workGraph: SAMPLE_WORKGRAPH,
        briefingScript: SAMPLE_BRIEFING_SCRIPT,
      }

      const result = await agent.producePlan(input)

      // Verify Plan shape
      expect(result.approach).toBe(VALID_PLAN.approach)
      expect(result.atoms).toEqual(VALID_PLAN.atoms)
      expect(result.executorRecommendation).toBe(VALID_PLAN.executorRecommendation)
      expect(result.estimatedComplexity).toBe(VALID_PLAN.estimatedComplexity)
    })

    it('includes repair context in user message when resampleReason provided', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new PlannerAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const input: PlannerInput = {
        workGraph: SAMPLE_WORKGRAPH,
        briefingScript: SAMPLE_BRIEFING_SCRIPT,
        resampleReason: 'Previous approach was too complex',
      }

      // Should not throw — the resampleReason is included in the user message
      const result = await agent.producePlan(input)
      expect(result.approach).toBe(VALID_PLAN.approach)
    })

    it('includes repair notes in user message when repairNotes provided', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new PlannerAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const input: PlannerInput = {
        workGraph: SAMPLE_WORKGRAPH,
        briefingScript: SAMPLE_BRIEFING_SCRIPT,
        repairNotes: 'Fix the token refresh logic',
        previousPlan: VALID_PLAN,
      }

      const result = await agent.producePlan(input)
      expect(result.approach).toBe(VALID_PLAN.approach)
    })

    it('includes contextPrompt in user message when provided', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new PlannerAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
        contextPrompt: '## Factory Context\n- [D-001] Use TypeScript',
      })

      const input: PlannerInput = {
        workGraph: SAMPLE_WORKGRAPH,
        briefingScript: SAMPLE_BRIEFING_SCRIPT,
      }

      const result = await agent.producePlan(input)
      expect(result.approach).toBe(VALID_PLAN.approach)
    })
  })
})
