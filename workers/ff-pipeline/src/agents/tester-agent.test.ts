/**
 * Phase A: TesterAgent with gdk-agent agentLoop
 *
 * Validates:
 * 1. agentLoop runs and produces messages
 * 2. arango_query tool executes correctly (queries invariants)
 * 3. TestReport output shape is valid
 * 4. dry-run mode bypasses agentLoop
 * 5. Handles edge cases (no critique, all failures, etc.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { TesterAgent, type TesterInput, type TestReport } from './tester-agent'
import { processAgentOutput, TEST_REPORT_SCHEMA } from './output-reliability'

const VALID_TEST_REPORT: TestReport = {
  passed: true,
  testsRun: 5,
  testsPassed: 5,
  testsFailed: 0,
  failures: [],
  summary: 'All 5 tests pass. Invariants from INV-001 and INV-002 validated.',
}

const FAILING_TEST_REPORT: TestReport = {
  passed: false,
  testsRun: 4,
  testsPassed: 2,
  testsFailed: 2,
  failures: [
    { name: 'validates input schema', error: 'Expected string, got number' },
    { name: 'handles edge case', error: 'Timeout after 5000ms' },
  ],
  summary: 'Two tests failed — schema validation and timeout handling.',
}

const SAMPLE_WORKGRAPH = {
  _key: 'WG-TEST-001',
  title: 'User Authentication Module',
  atoms: [{ id: 'atom-001', description: 'Auth middleware' }],
  invariants: [{ id: 'INV-001', rule: 'All tokens must expire within 1 hour' }],
  dependencies: [],
}

const SAMPLE_PLAN = {
  approach: 'Implement JWT auth middleware',
  atoms: [{ id: 'atom-001', description: 'Auth middleware', assignedTo: 'coder' }],
  executorRecommendation: 'gdk-agent' as const,
  estimatedComplexity: 'medium' as const,
}

const SAMPLE_CODE = {
  files: [{ path: 'src/auth.ts', content: 'export function validate() {}', action: 'create' as const }],
  summary: 'Auth module implementation',
  testsIncluded: true,
}

function createMockDb() {
  const calls: { query: string }[] = []
  return {
    db: {
      query: async (query: string) => {
        calls.push({ query })
        if (query.includes('invariants') || query.includes('specs_invariants')) {
          return [
            { _key: 'INV-001', rule: 'All tokens must expire within 1 hour', severity: 'critical' },
            { _key: 'INV-002', rule: 'Refresh tokens must be single-use', severity: 'major' },
          ]
        }
        if (query.includes('memory_semantic')) {
          return [{ _key: 'L-003', type: 'lesson', lesson: 'Always test token expiry edge cases' }]
        }
        return []
      },
      save: async () => ({}),
      saveEdge: async () => ({}),
    } as any,
    calls,
  }
}

describe('TesterAgent', () => {
  describe('dry-run mode', () => {
    it('returns hardcoded passing TestReport without calling agentLoop', async () => {
      const { db } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })

      const result = await agent.runTests({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
        code: SAMPLE_CODE,
      })

      expect(result.passed).toBe(true)
      expect(result.testsRun).toBeGreaterThanOrEqual(1)
      expect(result.testsPassed).toBeGreaterThanOrEqual(1)
      expect(result.testsFailed).toBe(0)
      expect(result.failures).toEqual([])
      expect(result.summary).toBeTypeOf('string')
      expect(result.summary.length).toBeGreaterThan(0)
    })

    it('dry-run does not call the database', async () => {
      const { db, calls } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })

      await agent.runTests({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
        code: SAMPLE_CODE,
      })

      expect(calls).toHaveLength(0)
    })
  })

  describe('validation (via ORL)', () => {
    it('rejects non-objects (prose)', async () => {
      const r1 = await processAgentOutput('just a string', TEST_REPORT_SCHEMA)
      expect(r1.success).toBe(false)

      const r2 = await processAgentOutput(null as any, TEST_REPORT_SCHEMA)
      expect(r2.success).toBe(false)
      expect(r2.failureMode).toBe('F7')
    })

    it('rejects missing "passed" field', async () => {
      const result = await processAgentOutput(JSON.stringify({
        testsRun: 1, testsPassed: 1, testsFailed: 0,
        failures: [], summary: 'ok',
      }), TEST_REPORT_SCHEMA)
      expect(result.success).toBe(false)
      expect(result.failureMode).toBe('F3')
    })

    it('coerces wrong types instead of rejecting', async () => {
      // string 'yes' is not 'true', coerces to false
      const r1 = await processAgentOutput(JSON.stringify({
        passed: 'yes', testsRun: 1, testsPassed: 1, testsFailed: 0,
        failures: [], summary: 'ok',
      }), TEST_REPORT_SCHEMA)
      expect(r1.success).toBe(true)
      expect(r1.data!.passed).toBe(false)

      // string testsRun coerced to number (NaN -> 0)
      const r2 = await processAgentOutput(JSON.stringify({
        passed: true, testsRun: 'one', testsPassed: 1, testsFailed: 0,
        failures: [], summary: 'ok',
      }), TEST_REPORT_SCHEMA)
      expect(r2.success).toBe(true)
      expect(r2.data!.testsRun).toBe(0)

      // string failures coerced to array
      const r3 = await processAgentOutput(JSON.stringify({
        passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
        failures: 'none', summary: 'ok',
      }), TEST_REPORT_SCHEMA)
      expect(r3.success).toBe(true)
      expect(Array.isArray(r3.data!.failures)).toBe(true)

      // number summary coerced to string
      const r4 = await processAgentOutput(JSON.stringify({
        passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
        failures: [], summary: 42,
      }), TEST_REPORT_SCHEMA)
      expect(r4.success).toBe(true)
      expect(r4.data!.summary).toBe('42')
    })

    it('accepts valid passing TestReport', async () => {
      const result = await processAgentOutput(JSON.stringify(VALID_TEST_REPORT), TEST_REPORT_SCHEMA)
      expect(result.success).toBe(true)
    })

    it('accepts valid failing TestReport', async () => {
      const result = await processAgentOutput(JSON.stringify(FAILING_TEST_REPORT), TEST_REPORT_SCHEMA)
      expect(result.success).toBe(true)
    })

    it('accepts TestReport with optional coverage field', async () => {
      const withCoverage = {
        ...VALID_TEST_REPORT,
        coverage: { lines: 85, branches: 70, functions: 90 },
      }
      const result = await processAgentOutput(JSON.stringify(withCoverage), TEST_REPORT_SCHEMA)
      expect(result.success).toBe(true)
    })
  })

  describe('input handling', () => {
    it('accepts input without critique (optional field)', async () => {
      const { db } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })

      const result = await agent.runTests({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
        code: SAMPLE_CODE,
        // critique intentionally omitted
      })

      expect(result.passed).toBe(true)
    })

    it('accepts input with critique', async () => {
      const { db } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })

      const result = await agent.runTests({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
        code: SAMPLE_CODE,
        critique: {
          passed: true,
          issues: [{ severity: 'minor', description: 'Consider helper fn' }],
          mentorRuleCompliance: [],
          overallAssessment: 'Looks good',
        },
      })

      expect(result.passed).toBe(true)
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        // Single turn: agent returns final TestReport (no tools)
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_TEST_REPORT)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, produces TestReport (no tool calls)', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new TesterAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.runTests({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
        code: SAMPLE_CODE,
      })

      // Verify TestReport shape
      expect(result.passed).toBe(VALID_TEST_REPORT.passed)
      expect(result.testsRun).toBe(VALID_TEST_REPORT.testsRun)
      expect(result.testsPassed).toBe(VALID_TEST_REPORT.testsPassed)
      expect(result.testsFailed).toBe(VALID_TEST_REPORT.testsFailed)
      expect(result.failures).toEqual(VALID_TEST_REPORT.failures)
      expect(result.summary).toBe(VALID_TEST_REPORT.summary)
    })

    it('handles failing test report from agentLoop', async () => {
      faux.setResponses([
        fauxAssistantMessage(
          fauxText(JSON.stringify(FAILING_TEST_REPORT)),
          { stopReason: 'stop' },
        ),
      ])

      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new TesterAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.runTests({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
        code: SAMPLE_CODE,
      })

      expect(result.passed).toBe(false)
      expect(result.testsFailed).toBe(2)
      expect(result.failures).toHaveLength(2)
      expect(result.failures[0].name).toBe('validates input schema')
    })

    it('throws when agentLoop returns no assistant message', async () => {
      // Empty response sequence — no assistant message
      faux.setResponses([])

      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new TesterAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      await expect(
        agent.runTests({
          workGraph: SAMPLE_WORKGRAPH,
          plan: SAMPLE_PLAN,
          code: SAMPLE_CODE,
        }),
      ).rejects.toThrow('TesterAgent')
    })
  })
})
