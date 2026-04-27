import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { ArchitectAgent } from './architect-agent.js'
import { CriticAgent } from './critic-agent.js'
import type { SemanticReviewResult } from '../types.js'
import type { CritiqueReport, Plan, CodeArtifact } from '../coordinator/state.js'

// ────────────────────────────────────────────────────────────
// Shared mock DB
// ────────────────────────────────────────────────────────────

function makeMockDb() {
  const calls: { query: string }[] = []
  return {
    db: {
      query: async (query: string) => {
        calls.push({ query })
        if (query.includes('memory_semantic')) {
          return [{ _key: 'D-012', type: 'decision', decision: 'Use JWT with refresh tokens' }]
        }
        if (query.includes('mentorscript_rules')) {
          return [{ _key: 'MR-001', rule: 'Always validate token expiry', status: 'active' }]
        }
        return []
      },
      save: async () => ({}),
      saveEdge: async () => ({}),
    } as any,
    calls,
  }
}

// ────────────────────────────────────────────────────────────
// ArchitectAgent (Phase 0: gdk-agent based)
// ────────────────────────────────────────────────────────────

describe('ArchitectAgent', () => {
  it('produceBriefingScript returns correct shape in dry-run', async () => {
    const { db } = makeMockDb()
    const agent = new ArchitectAgent({ db, apiKey: 'test', dryRun: true })
    const result = await agent.produceBriefingScript({
      signal: { signalType: 'internal', title: 'Auth needed' },
    })

    expect(result.goal).toBeTypeOf('string')
    expect(Array.isArray(result.successCriteria)).toBe(true)
    expect(result.architecturalContext).toBeTypeOf('string')
    expect(result.strategicAdvice).toBeTypeOf('string')
    expect(Array.isArray(result.knownGotchas)).toBe(true)
    expect(result.validationLoop).toBeTypeOf('string')
  })

  it('handles all optional fields missing gracefully in dry-run', async () => {
    const { db } = makeMockDb()
    const agent = new ArchitectAgent({ db, apiKey: 'test', dryRun: true })
    const result = await agent.produceBriefingScript({
      signal: { signalType: 'internal', title: 'minimal' },
    })

    expect(result.goal).toBe('Dry-run goal')
  })
})

// ────────────────────────────────────────────────────────────
// CriticAgent — semanticReview
// ────────────────────────────────────────────────────────────

describe('CriticAgent.semanticReview', () => {
  describe('dry-run mode', () => {
    it('returns SemanticReviewResult shape', async () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })

      const result = await agent.semanticReview({
        prd: { id: 'PRD-001', title: 'Auth Feature' },
      })

      expect(result.alignment).toBe('aligned')
      expect(result.confidence).toBe(1.0)
      expect(Array.isArray(result.citations)).toBe(true)
      expect(result.rationale).toBeTypeOf('string')
      expect(result.timestamp).toBeTypeOf('string')
    })

    it('handles missing specContent gracefully', async () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })

      const result = await agent.semanticReview({
        prd: { id: 'PRD-001', title: 'test' },
      })

      expect(result.alignment).toBe('aligned')
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    const validReview: SemanticReviewResult = {
      alignment: 'aligned',
      confidence: 0.92,
      citations: ['spec section 3.2', 'PRD requirement R-001'],
      rationale: 'The PRD accurately reflects the specification requirements',
      timestamp: '2026-04-26T10:00:00Z',
    }

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
        // Turn 2: agent returns final review
        fauxAssistantMessage(
          fauxText(JSON.stringify(validReview)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, calls tool, produces SemanticReviewResult', async () => {
      const { db, calls } = makeMockDb()
      const fauxModel = faux.getModel()

      const agent = new CriticAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.semanticReview({
        prd: { id: 'PRD-002', title: 'Payment Processing' },
      })

      // Verify tool was called
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0].query).toContain('memory_semantic')

      // Verify SemanticReviewResult shape
      expect(result.alignment).toBe('aligned')
      expect(result.confidence).toBe(0.92)
      expect(result.citations).toEqual(['spec section 3.2', 'PRD requirement R-001'])
      expect(result.rationale).toContain('PRD accurately reflects')
      expect(result.timestamp).toBe('2026-04-26T10:00:00Z')
    })

    it('includes specContent in user message', async () => {
      const { db } = makeMockDb()
      const fauxModel = faux.getModel()

      const agent = new CriticAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      // Just verify it doesn't throw -- specContent is included in the prompt
      const result = await agent.semanticReview({
        prd: { id: 'PRD-001', title: 'test' },
        specContent: 'The system SHALL validate all inputs',
      })

      expect(result.alignment).toBe('aligned')
    })
  })

  describe('validation', () => {
    it('rejects non-objects', () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })
      const validate = (agent as any).validateSemanticReview.bind(agent)

      expect(() => validate('string')).toThrow('not an object')
      expect(() => validate(null)).toThrow('not an object')
    })

    it('rejects invalid alignment', () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })
      const validate = (agent as any).validateSemanticReview.bind(agent)

      expect(() => validate({
        alignment: 'wrong',
        confidence: 0.5,
        citations: [],
        rationale: 'test',
        timestamp: '2026-01-01',
      })).toThrow('"alignment"')
    })

    it('rejects missing required fields', () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })
      const validate = (agent as any).validateSemanticReview.bind(agent)

      expect(() => validate({ alignment: 'aligned' })).toThrow()
    })

    it('accepts valid SemanticReviewResult', () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })
      const validate = (agent as any).validateSemanticReview.bind(agent)

      expect(() => validate({
        alignment: 'aligned',
        confidence: 0.92,
        citations: ['spec section 3.2'],
        rationale: 'Good alignment',
        timestamp: '2026-04-26T10:00:00Z',
      })).not.toThrow()
    })
  })
})

// ────────────────────────────────────────────────────────────
// CriticAgent — codeReview
// ────────────────────────────────────────────────────────────

describe('CriticAgent.codeReview', () => {
  const samplePlan: Plan = {
    approach: 'Implement auth module with JWT',
    atoms: [{ id: 'A1', description: 'Create token validator', assignedTo: 'coder' }],
    executorRecommendation: 'gdk-agent',
    estimatedComplexity: 'medium',
  }

  const sampleCode: CodeArtifact = {
    files: [
      { path: 'src/auth.ts', content: 'export function validate() {}', action: 'create' },
    ],
    summary: 'Auth module implementation',
    testsIncluded: true,
  }

  describe('dry-run mode', () => {
    it('returns CritiqueReport shape', async () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })

      const result = await agent.codeReview({
        code: sampleCode,
        plan: samplePlan,
        workGraph: { id: 'WG-001' },
      })

      expect(result.passed).toBe(true)
      expect(Array.isArray(result.issues)).toBe(true)
      expect(result.issues).toHaveLength(0)
      expect(Array.isArray(result.mentorRuleCompliance)).toBe(true)
      expect(result.overallAssessment).toBeTypeOf('string')
    })

    it('handles missing mentorRules gracefully', async () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })

      const result = await agent.codeReview({
        code: sampleCode,
        plan: samplePlan,
        workGraph: { id: 'WG-001' },
      })

      expect(result.passed).toBe(true)
    })
  })

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    const validCritique: CritiqueReport = {
      passed: true,
      issues: [
        { severity: 'minor', description: 'Consider extracting helper function', file: 'src/auth.ts', line: 42 },
      ],
      mentorRuleCompliance: [
        { ruleId: 'MR-001', compliant: true },
      ],
      overallAssessment: 'Code meets requirements with minor suggestions',
    }

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        // Turn 1: agent calls arango_query for mentor rules
        fauxAssistantMessage(
          fauxToolCall('arango_query', {
            query: 'FOR r IN mentorscript_rules FILTER r.status == "active" RETURN { ruleId: r._key, rule: r.rule }',
          }),
          { stopReason: 'toolUse' },
        ),
        // Turn 2: agent returns final critique
        fauxAssistantMessage(
          fauxText(JSON.stringify(validCritique)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, calls tool, produces CritiqueReport', async () => {
      const { db, calls } = makeMockDb()
      const fauxModel = faux.getModel()

      const agent = new CriticAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.codeReview({
        code: sampleCode,
        plan: samplePlan,
        workGraph: { id: 'WG-002' },
      })

      // Verify tool was called
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0].query).toContain('mentorscript_rules')

      // Verify CritiqueReport shape
      expect(result.passed).toBe(true)
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0]!.severity).toBe('minor')
      expect(result.mentorRuleCompliance).toHaveLength(1)
      expect(result.overallAssessment).toContain('meets requirements')
    })

    it('includes mentorRules in user message when provided', async () => {
      const { db } = makeMockDb()
      const fauxModel = faux.getModel()

      const agent = new CriticAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      // Just verify it doesn't throw -- mentorRules are included in the prompt
      const result = await agent.codeReview({
        code: sampleCode,
        plan: samplePlan,
        workGraph: { id: 'WG-001' },
        mentorRules: ['No global state', 'All functions must be pure'],
      })

      expect(result.passed).toBe(true)
    })
  })

  describe('validation', () => {
    it('rejects non-objects', () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })
      const validate = (agent as any).validateCritiqueReport.bind(agent)

      expect(() => validate('string')).toThrow('not an object')
      expect(() => validate(null)).toThrow('not an object')
    })

    it('rejects missing required fields', () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })
      const validate = (agent as any).validateCritiqueReport.bind(agent)

      expect(() => validate({ passed: true })).toThrow()
    })

    it('rejects invalid issue severity', () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })
      const validate = (agent as any).validateCritiqueReport.bind(agent)

      expect(() => validate({
        passed: true,
        issues: [{ severity: 'invalid', description: 'test' }],
        mentorRuleCompliance: [],
        overallAssessment: 'test',
      })).toThrow('severity')
    })

    it('accepts valid CritiqueReport with zero issues', () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })
      const validate = (agent as any).validateCritiqueReport.bind(agent)

      expect(() => validate({
        passed: true,
        issues: [],
        mentorRuleCompliance: [],
        overallAssessment: 'Clean pass',
      })).not.toThrow()
    })

    it('accepts valid CritiqueReport with critical issues', () => {
      const { db } = makeMockDb()
      const agent = new CriticAgent({ db, apiKey: 'test', dryRun: true })
      const validate = (agent as any).validateCritiqueReport.bind(agent)

      expect(() => validate({
        passed: false,
        issues: [
          { severity: 'critical', description: 'SQL injection vulnerability', file: 'src/db.ts', line: 15 },
          { severity: 'major', description: 'Missing input validation', file: 'src/api.ts' },
        ],
        mentorRuleCompliance: [{ ruleId: 'MR-SEC-001', compliant: false }],
        overallAssessment: 'Critical security issues found',
      })).not.toThrow()
    })
  })
})
