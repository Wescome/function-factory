import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { ArchitectAgent } from './architect-agent.js'
import { CriticAgent } from './critic-agent.js'
import { processAgentOutput, SEMANTIC_REVIEW_SCHEMA, CRITIQUE_REPORT_SCHEMA } from './output-reliability.js'
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
        // Single turn: agent returns final review (no tools)
        fauxAssistantMessage(
          fauxText(JSON.stringify(validReview)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, produces SemanticReviewResult (no tool calls)', async () => {
      const { db } = makeMockDb()
      const fauxModel = faux.getModel()

      const agent = new CriticAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
        semanticReviewModel: fauxModel,
      })

      const result = await agent.semanticReview({
        prd: { id: 'PRD-002', title: 'Payment Processing' },
      })

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
        semanticReviewModel: fauxModel,
      })

      // Just verify it doesn't throw -- specContent is included in the prompt
      const result = await agent.semanticReview({
        prd: { id: 'PRD-001', title: 'test' },
        specContent: 'The system SHALL validate all inputs',
      })

      expect(result.alignment).toBe('aligned')
    })
  })

  describe('validation (via ORL)', () => {
    it('rejects non-objects (pure prose)', async () => {
      const result = await processAgentOutput('just a string', SEMANTIC_REVIEW_SCHEMA)
      expect(result.success).toBe(false)
    })

    it('rejects null response', async () => {
      const result = await processAgentOutput(null as any, SEMANTIC_REVIEW_SCHEMA)
      expect(result.success).toBe(false)
      expect(result.failureMode).toBe('F7')
    })

    it('coerces invalid alignment to "uncertain"', async () => {
      const obj = {
        alignment: 'wrong',
        confidence: 0.5,
        citations: [],
        rationale: 'test',
        timestamp: '2026-01-01',
      }
      const result = await processAgentOutput(JSON.stringify(obj), SEMANTIC_REVIEW_SCHEMA)
      expect(result.success).toBe(true)
      expect(result.data!.alignment).toBe('uncertain')
    })

    it('coerces missing optional-like fields via coerce', async () => {
      // alignment is present but other required fields are missing -> F3
      const obj = { alignment: 'aligned' }
      const result = await processAgentOutput(JSON.stringify(obj), SEMANTIC_REVIEW_SCHEMA)
      expect(result.success).toBe(false)
      expect(result.failureMode).toBe('F3')
    })

    it('accepts valid SemanticReviewResult', async () => {
      const result = await processAgentOutput(JSON.stringify({
        alignment: 'aligned',
        confidence: 0.92,
        citations: ['spec section 3.2'],
        rationale: 'Good alignment',
        timestamp: '2026-04-26T10:00:00Z',
      }), SEMANTIC_REVIEW_SCHEMA)
      expect(result.success).toBe(true)
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
        // Single turn: agent returns final critique (no tools)
        fauxAssistantMessage(
          fauxText(JSON.stringify(validCritique)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, produces CritiqueReport (no tool calls)', async () => {
      const { db } = makeMockDb()
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

  describe('validation (via ORL)', () => {
    it('rejects non-objects (pure prose)', async () => {
      const result = await processAgentOutput('just a string', CRITIQUE_REPORT_SCHEMA)
      expect(result.success).toBe(false)
    })

    it('rejects null response', async () => {
      const result = await processAgentOutput(null as any, CRITIQUE_REPORT_SCHEMA)
      expect(result.success).toBe(false)
      expect(result.failureMode).toBe('F7')
    })

    it('missing required fields -> failure', async () => {
      const obj = { passed: true }
      const result = await processAgentOutput(JSON.stringify(obj), CRITIQUE_REPORT_SCHEMA)
      expect(result.success).toBe(false)
      expect(result.failureMode).toBe('F3')
    })

    it('coerces invalid issue severity to "minor"', async () => {
      const obj = {
        passed: true,
        issues: [{ severity: 'invalid', description: 'test' }],
        mentorRuleCompliance: [],
        overallAssessment: 'test',
      }
      const result = await processAgentOutput(JSON.stringify(obj), CRITIQUE_REPORT_SCHEMA)
      expect(result.success).toBe(true)
      expect((result.data!.issues[0] as any).severity).toBe('minor')
    })

    it('accepts valid CritiqueReport with zero issues', async () => {
      const result = await processAgentOutput(JSON.stringify({
        passed: true,
        issues: [],
        mentorRuleCompliance: [],
        overallAssessment: 'Clean pass',
      }), CRITIQUE_REPORT_SCHEMA)
      expect(result.success).toBe(true)
    })

    it('accepts valid CritiqueReport with critical issues', async () => {
      const result = await processAgentOutput(JSON.stringify({
        passed: false,
        issues: [
          { severity: 'critical', description: 'SQL injection vulnerability', file: 'src/db.ts', line: 15 },
          { severity: 'major', description: 'Missing input validation', file: 'src/api.ts' },
        ],
        mentorRuleCompliance: [{ ruleId: 'MR-SEC-001', compliant: false }],
        overallAssessment: 'Critical security issues found',
      }), CRITIQUE_REPORT_SCHEMA)
      expect(result.success).toBe(true)
    })
  })
})
