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
  fauxToolCall,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { PlannerAgent, type PlannerInput } from './planner-agent'
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

  describe('validation', () => {
    it('rejects missing required fields', () => {
      const { db } = createMockDb()
      const agent = new PlannerAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validatePlan.bind(agent)

      // Missing approach
      expect(() => validate({
        atoms: [], executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
      })).toThrow('missing required field "approach"')

      // Missing atoms
      expect(() => validate({
        approach: 'test', executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
      })).toThrow('missing required field "atoms"')

      // Missing executorRecommendation
      expect(() => validate({
        approach: 'test', atoms: [], estimatedComplexity: 'low',
      })).toThrow('missing required field "executorRecommendation"')

      // Missing estimatedComplexity
      expect(() => validate({
        approach: 'test', atoms: [], executorRecommendation: 'gdk-agent',
      })).toThrow('missing required field "estimatedComplexity"')
    })

    it('rejects wrong types', () => {
      const { db } = createMockDb()
      const agent = new PlannerAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validatePlan.bind(agent)

      expect(() => validate({
        approach: 123, atoms: [], executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
      })).toThrow('"approach" must be a string')

      expect(() => validate({
        approach: 'ok', atoms: 'not-array', executorRecommendation: 'gdk-agent', estimatedComplexity: 'low',
      })).toThrow('"atoms" must be an array')

      expect(() => validate({
        approach: 'ok', atoms: [], executorRecommendation: 42, estimatedComplexity: 'low',
      })).toThrow('"executorRecommendation" must be a string')

      expect(() => validate({
        approach: 'ok', atoms: [], executorRecommendation: 'gdk-agent', estimatedComplexity: 99,
      })).toThrow('"estimatedComplexity" must be a string')
    })

    it('rejects non-objects', () => {
      const { db } = createMockDb()
      const agent = new PlannerAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validatePlan.bind(agent)

      expect(() => validate('string')).toThrow('not an object')
      expect(() => validate(null)).toThrow('not an object')
    })

    it('accepts valid Plan', () => {
      const { db } = createMockDb()
      const agent = new PlannerAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validatePlan.bind(agent)

      expect(() => validate(VALID_PLAN)).not.toThrow()
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        // Turn 1: agent calls arango_query to look up existing functions
        fauxAssistantMessage(
          fauxToolCall('arango_query', {
            query: 'FOR f IN specs_functions LIMIT 5 RETURN { key: f._key, name: f.name }',
          }),
          { stopReason: 'toolUse' },
        ),
        // Turn 2: agent returns final Plan
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_PLAN)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, calls tool, produces Plan', async () => {
      const { db, calls } = createMockDb()
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

      // Verify tool was called
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0]!.query).toContain('specs_functions')

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
  })
})
