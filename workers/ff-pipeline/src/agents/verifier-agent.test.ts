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
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { VerifierAgent, type VerifierInput } from './verifier-agent'
import { processAgentOutput, VERDICT_SCHEMA } from './output-reliability'
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

  describe('validation (via ORL)', () => {
    it('rejects missing required fields', async () => {
      const r1 = await processAgentOutput(JSON.stringify({
        confidence: 0.9, reason: 'ok',
      }), VERDICT_SCHEMA)
      expect(r1.success).toBe(false)
      expect(r1.failureMode).toBe('F3')

      const r2 = await processAgentOutput(JSON.stringify({
        decision: 'pass', reason: 'ok',
      }), VERDICT_SCHEMA)
      expect(r2.success).toBe(false)

      const r3 = await processAgentOutput(JSON.stringify({
        decision: 'pass', confidence: 0.9,
      }), VERDICT_SCHEMA)
      expect(r3.success).toBe(false)
    })

    it('coerces invalid decision to "interrupt"', async () => {
      const result = await processAgentOutput(JSON.stringify({
        decision: 'approve', confidence: 0.9, reason: 'ok',
      }), VERDICT_SCHEMA)
      expect(result.success).toBe(true)
      expect(result.data!.decision).toBe('interrupt')
    })

    it('coerces non-numeric confidence to 0', async () => {
      const result = await processAgentOutput(JSON.stringify({
        decision: 'pass', confidence: 'high', reason: 'ok',
      }), VERDICT_SCHEMA)
      expect(result.success).toBe(true)
      // 'high' -> NaN -> 0, which is in range [0,1]
      expect(result.data!.confidence).toBe(0)
    })

    it('clamps confidence out of range to 0.5', async () => {
      const r1 = await processAgentOutput(JSON.stringify({
        decision: 'pass', confidence: 1.5, reason: 'ok',
      }), VERDICT_SCHEMA)
      expect(r1.success).toBe(true)
      expect(r1.data!.confidence).toBe(0.5)

      const r2 = await processAgentOutput(JSON.stringify({
        decision: 'pass', confidence: -0.1, reason: 'ok',
      }), VERDICT_SCHEMA)
      expect(r2.success).toBe(true)
      expect(r2.data!.confidence).toBe(0.5)
    })

    it('coerces non-string reason to string', async () => {
      const result = await processAgentOutput(JSON.stringify({
        decision: 'pass', confidence: 0.9, reason: 42,
      }), VERDICT_SCHEMA)
      expect(result.success).toBe(true)
      expect(result.data!.reason).toBe('42')
    })

    it('rejects non-objects (prose)', async () => {
      const r1 = await processAgentOutput('just a string', VERDICT_SCHEMA)
      expect(r1.success).toBe(false)

      const r2 = await processAgentOutput(null as any, VERDICT_SCHEMA)
      expect(r2.success).toBe(false)
      expect(r2.failureMode).toBe('F7')
    })

    it('accepts valid Verdict with all decisions', async () => {
      for (const decision of ['pass', 'fail', 'patch', 'resample', 'interrupt'] as const) {
        const result = await processAgentOutput(JSON.stringify({
          decision, confidence: 0.9, reason: `Testing ${decision}`,
        }), VERDICT_SCHEMA)
        expect(result.success).toBe(true)
      }
    })

    it('accepts valid Verdict with optional notes', async () => {
      const result = await processAgentOutput(JSON.stringify({
        decision: 'patch', confidence: 0.7, reason: 'fixable',
        notes: 'Fix the error handling in auth.ts',
      }), VERDICT_SCHEMA)
      expect(result.success).toBe(true)
      expect(result.data!.notes).toBe('Fix the error handling in auth.ts')
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        // Single turn: agent returns final Verdict (no tools)
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_VERDICT)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, produces Verdict (no tool calls)', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new VerifierAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.verify(SAMPLE_VERIFIER_INPUT)

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
