/**
 * VerifierAgent tests — mirrors architect-agent.test.ts pattern.
 *
 * Validates:
 * 1. dry-run mode returns auto-pass Verdict without calling agentLoop
 * 2. Verdict shape validation rejects invalid inputs
 * 3. agentLoop integration with faux provider runs tool, produces Verdict
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { VerifierAgent, type VerifierInput } from './verifier-agent'
import type { Verdict } from '../coordinator/state'

const VALID_VERDICT: Verdict = {
  decision: 'pass',
  confidence: 0.95,
  reason: 'All invariants covered, tests pass, lineage verified',
}

const SAMPLE_VERIFIER_INPUT: VerifierInput = {
  workGraph: {
    _key: 'WG-TEST-001',
    title: 'User Authentication Module',
    atoms: [{ id: 'atom-001', description: 'Auth middleware' }],
    invariants: [{ id: 'INV-001', description: 'Tokens must expire within 24h' }],
    dependencies: [],
  },
  plan: {
    approach: 'Implement JWT middleware with refresh token rotation',
    atoms: [{ id: 'atom-001', description: 'Auth middleware', assignedTo: 'coder' }],
    executorRecommendation: 'gdk-agent' as const,
    estimatedComplexity: 'medium' as const,
  },
  code: {
    files: [{ path: 'src/auth.ts', content: '// auth impl', action: 'create' as const }],
    summary: 'JWT auth middleware',
    testsIncluded: true,
  },
  critique: {
    passed: true,
    issues: [],
    mentorRuleCompliance: [{ ruleId: 'MR-001', compliant: true }],
    overallAssessment: 'Code is clean and well-structured',
  },
  tests: {
    passed: true,
    testsRun: 5,
    testsPassed: 5,
    testsFailed: 0,
    failures: [],
    summary: 'All tests pass',
  },
  repairCount: 0,
  maxRepairs: 5,
  tokenUsage: 10000,
  maxTokens: 150000,
}

function createMockDb() {
  const calls: { query: string }[] = []
  return {
    db: {
      query: async (query: string) => {
        calls.push({ query })
        if (query.includes('specs_functions')) {
          return [{ _key: 'FN-001', name: 'auth-fn', lineage: ['PRS-001', 'BC-001'] }]
        }
        if (query.includes('memory_semantic')) {
          return [{ _key: 'INV-001', type: 'invariant', description: 'Token expiry enforced' }]
        }
        return []
      },
      save: async () => ({}),
      saveEdge: async () => ({}),
    } as any,
    calls,
  }
}

describe('VerifierAgent', () => {
  describe('dry-run mode', () => {
    it('returns auto-pass Verdict without calling agentLoop', async () => {
      const { db } = createMockDb()
      const agent = new VerifierAgent({ db, apiKey: 'test-key', dryRun: true })

      const result = await agent.verify(SAMPLE_VERIFIER_INPUT)

      expect(result.decision).toBe('pass')
      expect(result.confidence).toBe(1.0)
      expect(result.reason).toBe('Dry-run — auto-pass')
    })
  })

  describe('validation', () => {
    it('rejects missing required fields', () => {
      const { db } = createMockDb()
      const agent = new VerifierAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateVerdict.bind(agent)

      expect(() => validate({
        confidence: 0.9, reason: 'ok',
      })).toThrow('missing required field "decision"')

      expect(() => validate({
        decision: 'pass', reason: 'ok',
      })).toThrow('missing required field "confidence"')

      expect(() => validate({
        decision: 'pass', confidence: 0.9,
      })).toThrow('missing required field "reason"')
    })

    it('coerces invalid decision to "interrupt"', () => {
      const { db } = createMockDb()
      const agent = new VerifierAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateVerdict.bind(agent)

      const obj = { decision: 'approve', confidence: 0.9, reason: 'ok' }
      expect(() => validate(obj)).not.toThrow()
      expect(obj.decision).toBe('interrupt')
    })

    it('coerces non-numeric confidence to 0', () => {
      const { db } = createMockDb()
      const agent = new VerifierAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateVerdict.bind(agent)

      const obj = { decision: 'pass', confidence: 'high', reason: 'ok' } as any
      expect(() => validate(obj)).not.toThrow()
      // 'high' -> NaN -> 0, which is in range [0,1]
      expect(obj.confidence).toBe(0)
    })

    it('clamps confidence out of range to 0.5', () => {
      const { db } = createMockDb()
      const agent = new VerifierAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateVerdict.bind(agent)

      const obj1 = { decision: 'pass', confidence: 1.5, reason: 'ok' }
      expect(() => validate(obj1)).not.toThrow()
      expect(obj1.confidence).toBe(0.5)

      const obj2 = { decision: 'pass', confidence: -0.1, reason: 'ok' }
      expect(() => validate(obj2)).not.toThrow()
      expect(obj2.confidence).toBe(0.5)
    })

    it('coerces non-string reason to string', () => {
      const { db } = createMockDb()
      const agent = new VerifierAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateVerdict.bind(agent)

      const obj = { decision: 'pass', confidence: 0.9, reason: 42 } as any
      expect(() => validate(obj)).not.toThrow()
      expect(obj.reason).toBe('42')
    })

    it('rejects non-objects', () => {
      const { db } = createMockDb()
      const agent = new VerifierAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateVerdict.bind(agent)

      expect(() => validate('string')).toThrow('not an object')
      expect(() => validate(null)).toThrow('not an object')
    })

    it('accepts valid Verdict with all decisions', () => {
      const { db } = createMockDb()
      const agent = new VerifierAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateVerdict.bind(agent)

      for (const decision of ['pass', 'fail', 'patch', 'resample', 'interrupt'] as const) {
        expect(() => validate({
          decision, confidence: 0.9, reason: `Testing ${decision}`,
        })).not.toThrow()
      }
    })

    it('accepts valid Verdict with optional notes', () => {
      const { db } = createMockDb()
      const agent = new VerifierAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateVerdict.bind(agent)

      expect(() => validate({
        decision: 'patch', confidence: 0.7, reason: 'fixable',
        notes: 'Fix the error handling in auth.ts',
      })).not.toThrow()
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        // Turn 1: agent calls arango_query to check lineage
        fauxAssistantMessage(
          fauxToolCall('arango_query', {
            query: 'FOR f IN specs_functions FILTER f._key == "WG-TEST-001" RETURN f',
          }),
          { stopReason: 'toolUse' },
        ),
        // Turn 2: agent returns final Verdict
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_VERDICT)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, calls tool, produces Verdict', async () => {
      const { db, calls } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new VerifierAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.verify(SAMPLE_VERIFIER_INPUT)

      // Verify tool was called
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0].query).toContain('specs_functions')

      // Verify Verdict shape
      expect(result.decision).toBe(VALID_VERDICT.decision)
      expect(result.confidence).toBe(VALID_VERDICT.confidence)
      expect(result.reason).toBe(VALID_VERDICT.reason)
    })

    it('preserves optional notes field from model response', async () => {
      const verdictWithNotes: Verdict = {
        decision: 'patch',
        confidence: 0.7,
        reason: 'Missing error handling',
        notes: 'Add try-catch to auth middleware',
      }

      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall('arango_query', {
            query: 'FOR f IN specs_functions RETURN f',
          }),
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage(
          fauxText(JSON.stringify(verdictWithNotes)),
          { stopReason: 'stop' },
        ),
      ])

      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new VerifierAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.verify(SAMPLE_VERIFIER_INPUT)

      expect(result.decision).toBe('patch')
      expect(result.notes).toBe('Add try-catch to auth middleware')
    })
  })
})
