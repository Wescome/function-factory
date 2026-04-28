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
  fauxToolCall,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { TesterAgent, type TesterInput, type TestReport } from './tester-agent'

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

  describe('validation', () => {
    it('rejects non-objects', () => {
      const { db } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateTestReport.bind(agent)

      expect(() => validate('string')).toThrow('not an object')
      expect(() => validate(null)).toThrow('not an object')
    })

    it('coerces missing "passed" to false (default boolean)', () => {
      const { db } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateTestReport.bind(agent)

      const obj = {
        testsRun: 1, testsPassed: 1, testsFailed: 0,
        failures: [], summary: 'ok',
      } as Record<string, unknown>
      expect(() => validate(obj)).not.toThrow()
      expect(obj.passed).toBe(false)
    })

    it('coerces wrong types instead of rejecting', () => {
      const { db } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateTestReport.bind(agent)

      // string 'yes' is not 'true', coerces to false
      const obj1 = {
        passed: 'yes', testsRun: 1, testsPassed: 1, testsFailed: 0,
        failures: [], summary: 'ok',
      } as Record<string, unknown>
      expect(() => validate(obj1)).not.toThrow()
      expect(obj1.passed).toBe(false)

      // string testsRun coerced to number (NaN -> 0)
      const obj2 = {
        passed: true, testsRun: 'one', testsPassed: 1, testsFailed: 0,
        failures: [], summary: 'ok',
      } as Record<string, unknown>
      expect(() => validate(obj2)).not.toThrow()
      expect(obj2.testsRun).toBe(0)

      // string failures coerced to array
      const obj3 = {
        passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
        failures: 'none', summary: 'ok',
      } as Record<string, unknown>
      expect(() => validate(obj3)).not.toThrow()
      expect(Array.isArray(obj3.failures)).toBe(true)

      // number summary coerced to string
      const obj4 = {
        passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
        failures: [], summary: 42,
      } as Record<string, unknown>
      expect(() => validate(obj4)).not.toThrow()
      expect(obj4.summary).toBe('42')
    })

    it('accepts valid passing TestReport', () => {
      const { db } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateTestReport.bind(agent)

      expect(() => validate(VALID_TEST_REPORT)).not.toThrow()
    })

    it('accepts valid failing TestReport', () => {
      const { db } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateTestReport.bind(agent)

      expect(() => validate(FAILING_TEST_REPORT)).not.toThrow()
    })

    it('accepts TestReport with optional coverage field', () => {
      const { db } = createMockDb()
      const agent = new TesterAgent({ db, apiKey: 'test-key', dryRun: true })
      const validate = (agent as any).validateTestReport.bind(agent)

      const withCoverage = {
        ...VALID_TEST_REPORT,
        coverage: { lines: 85, branches: 70, functions: 90 },
      }
      expect(() => validate(withCoverage)).not.toThrow()
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
        // Turn 1: agent calls arango_query to look up invariants
        fauxAssistantMessage(
          fauxToolCall('arango_query', {
            query: 'FOR inv IN specs_invariants FILTER inv.status == "active" RETURN inv',
          }),
          { stopReason: 'toolUse' },
        ),
        // Turn 2: agent returns final TestReport
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_TEST_REPORT)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, calls tool, produces TestReport', async () => {
      const { db, calls } = createMockDb()
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

      // Verify tool was called (queried invariants)
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0].query).toContain('specs_invariants')

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
        // No tool call — agent goes straight to report
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
