/**
 * Phase 0 spike test: ArchitectAgent with gdk-agent agentLoop
 *
 * Validates:
 * 1. agentLoop runs and produces messages
 * 2. arango_query tool executes correctly
 * 3. BriefingScript output shape is valid
 * 4. dry-run mode bypasses agentLoop
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { ArchitectAgent, buildArangoTool, type BriefingScript } from './architect-agent'

const VALID_BRIEFING: BriefingScript = {
  goal: 'Implement the user authentication module',
  successCriteria: ['All auth endpoints respond correctly', 'Tests pass'],
  architecturalContext: 'Uses JWT with refresh tokens per DECISIONS.md D-012',
  strategicAdvice: 'Start with the middleware, then add route handlers',
  knownGotchas: ['Token expiry edge case from LESSONS L-007'],
  validationLoop: 'Run pnpm test && verify /auth/login returns 200',
}

const SAMPLE_WORKGRAPH = {
  _key: 'WG-TEST-001',
  title: 'User Authentication Module',
  atoms: [{ id: 'atom-001', description: 'Auth middleware' }],
  invariants: [],
  dependencies: [],
}

function createMockDb() {
  const calls: { query: string }[] = []
  return {
    db: {
      query: async (query: string) => {
        calls.push({ query })
        if (query.includes('memory_semantic')) {
          return [{ _key: 'D-012', type: 'decision', decision: 'Use JWT with refresh tokens' }]
        }
        if (query.includes('mentorscript_rules')) {
          return [{ _key: 'MR-001', rule: 'Always validate token expiry' }]
        }
        return []
      },
      save: async () => ({}),
      saveEdge: async () => ({}),
    } as any,
    calls,
  }
}

describe('ArchitectAgent', () => {
  describe('dry-run mode', () => {
    it('returns hardcoded BriefingScript without calling agentLoop', async () => {
      const { db } = createMockDb()
      const agent = new ArchitectAgent({ db, apiKey: 'test-key', dryRun: true })

      const result = await agent.produceBriefingScript({ signal: SAMPLE_WORKGRAPH })

      expect(result.goal).toBe('Dry-run goal')
      expect(result.successCriteria).toEqual(['Dry-run criterion'])
      expect(result.architecturalContext).toBe('Dry-run context')
      expect(result.strategicAdvice).toBe('Dry-run advice')
      expect(result.knownGotchas).toEqual([])
      expect(result.validationLoop).toBe('Dry-run validation')
    })
  })

  describe('validation', () => {
    it('rejects missing required fields', () => {
      const { db } = createMockDb()
      const agent = new ArchitectAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateBriefingScript.bind(agent)

      expect(() => validate({
        successCriteria: [], architecturalContext: '', strategicAdvice: '',
        knownGotchas: [], validationLoop: '',
      })).toThrow('missing required field "goal"')
    })

    it('rejects wrong types', () => {
      const { db } = createMockDb()
      const agent = new ArchitectAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateBriefingScript.bind(agent)

      expect(() => validate({
        goal: 123, successCriteria: [], architecturalContext: '', strategicAdvice: '',
        knownGotchas: [], validationLoop: '',
      })).toThrow('"goal" must be a string')

      expect(() => validate({
        goal: 'ok', successCriteria: 'not-array', architecturalContext: '',
        strategicAdvice: '', knownGotchas: [], validationLoop: '',
      })).toThrow('"successCriteria" must be an array')
    })

    it('rejects non-objects', () => {
      const { db } = createMockDb()
      const agent = new ArchitectAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateBriefingScript.bind(agent)

      expect(() => validate('string')).toThrow('not an object')
      expect(() => validate(null)).toThrow('not an object')
    })

    it('accepts valid BriefingScript', () => {
      const { db } = createMockDb()
      const agent = new ArchitectAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateBriefingScript.bind(agent)

      expect(() => validate(VALID_BRIEFING)).not.toThrow()
    })
  })

  describe('arango_query tool', () => {
    it('returns query results as JSON text', async () => {
      const { db } = createMockDb()
      const tool = buildArangoTool(db)

      const result = await tool.execute(
        'call-1',
        { query: 'FOR d IN memory_semantic RETURN d' },
      )

      expect(result.content[0].type).toBe('text')
      const parsed = JSON.parse((result.content[0] as any).text)
      expect(parsed).toHaveLength(1)
      expect(parsed[0]._key).toBe('D-012')
      expect(result.details.rowCount).toBe(1)
    })

    it('returns error text on AQL failure', async () => {
      const failDb = {
        query: async () => { throw new Error('collection not found') },
      } as any
      const tool = buildArangoTool(failDb)

      const result = await tool.execute('call-2', { query: 'INVALID' })

      expect(result.content[0].type).toBe('text')
      expect((result.content[0] as any).text).toContain('AQL error')
      expect((result.content[0] as any).text).toContain('collection not found')
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        // Turn 1: agent calls arango_query
        fauxAssistantMessage(
          fauxToolCall('arango_query', {
            query: 'FOR d IN memory_semantic FILTER d.type == "decision" RETURN d',
          }),
          { stopReason: 'toolUse' },
        ),
        // Turn 2: agent returns final BriefingScript
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_BRIEFING)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, calls tool, produces BriefingScript', async () => {
      const { db, calls } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new ArchitectAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.produceBriefingScript({ signal: SAMPLE_WORKGRAPH })

      // Verify tool was called
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0].query).toContain('memory_semantic')

      // Verify BriefingScript shape
      expect(result.goal).toBe(VALID_BRIEFING.goal)
      expect(result.successCriteria).toEqual(VALID_BRIEFING.successCriteria)
      expect(result.architecturalContext).toBe(VALID_BRIEFING.architecturalContext)
      expect(result.strategicAdvice).toBe(VALID_BRIEFING.strategicAdvice)
      expect(result.knownGotchas).toEqual(VALID_BRIEFING.knownGotchas)
      expect(result.validationLoop).toBe(VALID_BRIEFING.validationLoop)
    })
  })
})
