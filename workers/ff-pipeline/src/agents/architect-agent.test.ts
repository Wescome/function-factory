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
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { ArchitectAgent, buildArangoTool, type BriefingScript } from './architect-agent'
import { processAgentOutput, BRIEFING_SCRIPT_SCHEMA } from './output-reliability'

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

  describe('validation (via ORL)', () => {
    it('rejects missing required fields', async () => {
      const result = await processAgentOutput(JSON.stringify({
        successCriteria: [], architecturalContext: '', strategicAdvice: '',
        knownGotchas: [], validationLoop: '',
      }), BRIEFING_SCRIPT_SCHEMA)
      expect(result.success).toBe(false)
      expect(result.failureMode).toBe('F3')
    })

    it('coerces wrong types instead of rejecting', async () => {
      // number goal is coerced to string
      const result1 = await processAgentOutput(JSON.stringify({
        goal: 123, successCriteria: [], architecturalContext: '', strategicAdvice: '',
        knownGotchas: [], validationLoop: '',
      }), BRIEFING_SCRIPT_SCHEMA)
      expect(result1.success).toBe(true)
      expect(result1.data!.goal).toBe('123')

      // string successCriteria is coerced to array
      const result2 = await processAgentOutput(JSON.stringify({
        goal: 'ok', successCriteria: 'not-array', architecturalContext: '',
        strategicAdvice: '', knownGotchas: [], validationLoop: '',
      }), BRIEFING_SCRIPT_SCHEMA)
      expect(result2.success).toBe(true)
      expect(Array.isArray(result2.data!.successCriteria)).toBe(true)
    })

    it('rejects non-objects (prose)', async () => {
      const result = await processAgentOutput('just a string', BRIEFING_SCRIPT_SCHEMA)
      expect(result.success).toBe(false)

      const result2 = await processAgentOutput(null as any, BRIEFING_SCRIPT_SCHEMA)
      expect(result2.success).toBe(false)
      expect(result2.failureMode).toBe('F7')
    })

    it('accepts valid BriefingScript', async () => {
      const result = await processAgentOutput(JSON.stringify(VALID_BRIEFING), BRIEFING_SCRIPT_SCHEMA)
      expect(result.success).toBe(true)
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
        // Single turn: agent returns final BriefingScript (no tools)
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_BRIEFING)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, produces BriefingScript (no tool calls)', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new ArchitectAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.produceBriefingScript({ signal: SAMPLE_WORKGRAPH })

      // Verify BriefingScript shape
      expect(result.goal).toBe(VALID_BRIEFING.goal)
      expect(result.successCriteria).toEqual(VALID_BRIEFING.successCriteria)
      expect(result.architecturalContext).toBe(VALID_BRIEFING.architecturalContext)
      expect(result.strategicAdvice).toBe(VALID_BRIEFING.strategicAdvice)
      expect(result.knownGotchas).toEqual(VALID_BRIEFING.knownGotchas)
      expect(result.validationLoop).toBe(VALID_BRIEFING.validationLoop)
    })

    it('includes contextPrompt in user message when provided', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new ArchitectAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
        contextPrompt: '## Factory Knowledge Graph Context\n- [D-012] Use JWT',
      })

      const result = await agent.produceBriefingScript({ signal: SAMPLE_WORKGRAPH })

      // Agent should still produce valid output with context injected
      expect(result.goal).toBe(VALID_BRIEFING.goal)
    })
  })
})
