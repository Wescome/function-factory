import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ArchitectAgent } from './architect-agent.js'
import { CriticAgent } from './critic-agent.js'
import type { SemanticReviewResult } from '../types.js'
import type { CritiqueReport, Plan, CodeArtifact } from '../coordinator/state.js'

// ────────────────────────────────────────────────────────────
// Shared mock for model calls
// ────────────────────────────────────────────────────────────

type ModelCaller = (taskKind: string, system: string, user: string) => Promise<string>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockCaller(response: Record<string, any>): ModelCaller {
  return vi.fn().mockResolvedValue(JSON.stringify(response))
}

// ────────────────────────────────────────────────────────────
// ArchitectAgent
// ────────────────────────────────────────────────────────────

describe('ArchitectAgent', () => {
  let agent: ArchitectAgent

  const validBriefing = {
    goal: 'Implement user authentication flow',
    successCriteria: ['All endpoints return 200', 'JWT tokens validated'],
    architecturalContext: 'Monolith with planned microservice extraction',
    strategicAdvice: 'Keep auth logic in a standalone module for future extraction',
    knownGotchas: ['Rate limiting not yet configured', 'Token refresh edge case'],
    validationLoop: 'Run integration tests then manual smoke test',
  }

  beforeEach(() => {
    agent = new ArchitectAgent({ callModel: makeMockCaller(validBriefing) })
  })

  it('produceBriefingScript returns correct shape', async () => {
    const result = await agent.produceBriefingScript({
      signal: { signalType: 'internal', title: 'Auth needed' },
    })

    expect(result).toEqual(validBriefing)
    expect(result.goal).toBeTypeOf('string')
    expect(Array.isArray(result.successCriteria)).toBe(true)
    expect(result.successCriteria.length).toBeGreaterThan(0)
    expect(result.architecturalContext).toBeTypeOf('string')
    expect(result.strategicAdvice).toBeTypeOf('string')
    expect(Array.isArray(result.knownGotchas)).toBe(true)
    expect(result.validationLoop).toBeTypeOf('string')
  })

  it('passes signal data to the model call', async () => {
    const mockCaller = makeMockCaller(validBriefing)
    agent = new ArchitectAgent({ callModel: mockCaller })

    await agent.produceBriefingScript({
      signal: { signalType: 'market', title: 'Competitor launched feature X' },
    })

    expect(mockCaller).toHaveBeenCalledOnce()
    const [taskKind, system, user] = (mockCaller as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(taskKind).toBe('architect')
    expect(system).toContain('architect')
    expect(user).toContain('Competitor launched feature X')
  })

  it('includes specContent in prompt when provided', async () => {
    const mockCaller = makeMockCaller(validBriefing)
    agent = new ArchitectAgent({ callModel: mockCaller })

    await agent.produceBriefingScript({
      signal: { signalType: 'internal', title: 'test' },
      specContent: 'The widget SHALL support CRUD operations',
    })

    const [, , user] = (mockCaller as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(user).toContain('CRUD operations')
  })

  it('includes memoryDigest in prompt when provided', async () => {
    const mockCaller = makeMockCaller(validBriefing)
    agent = new ArchitectAgent({ callModel: mockCaller })

    await agent.produceBriefingScript({
      signal: { signalType: 'internal', title: 'test' },
      memoryDigest: 'Previous attempt failed due to circular dependency',
    })

    const [, , user] = (mockCaller as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(user).toContain('circular dependency')
  })

  it('includes mentorRules in prompt when provided', async () => {
    const mockCaller = makeMockCaller(validBriefing)
    agent = new ArchitectAgent({ callModel: mockCaller })

    await agent.produceBriefingScript({
      signal: { signalType: 'internal', title: 'test' },
      mentorRules: ['Always use dependency injection', 'Prefer composition over inheritance'],
    })

    const [, , user] = (mockCaller as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(user).toContain('dependency injection')
    expect(user).toContain('composition over inheritance')
  })

  it('handles all optional fields missing gracefully', async () => {
    const result = await agent.produceBriefingScript({
      signal: { signalType: 'internal', title: 'minimal' },
    })

    expect(result).toEqual(validBriefing)
  })

  it('throws on invalid model response (not valid JSON)', async () => {
    const badCaller = vi.fn().mockResolvedValue('not json at all')
    agent = new ArchitectAgent({ callModel: badCaller })

    await expect(
      agent.produceBriefingScript({
        signal: { signalType: 'internal', title: 'test' },
      }),
    ).rejects.toThrow()
  })

  it('throws on model response missing required fields', async () => {
    const incompleteCaller = makeMockCaller({ goal: 'only goal' })
    agent = new ArchitectAgent({ callModel: incompleteCaller })

    await expect(
      agent.produceBriefingScript({
        signal: { signalType: 'internal', title: 'test' },
      }),
    ).rejects.toThrow()
  })
})

// ────────────────────────────────────────────────────────────
// CriticAgent — semanticReview
// ────────────────────────────────────────────────────────────

describe('CriticAgent.semanticReview', () => {
  let agent: CriticAgent

  const validReview: SemanticReviewResult = {
    alignment: 'aligned',
    confidence: 0.92,
    citations: ['spec section 3.2', 'PRD requirement R-001'],
    rationale: 'The PRD accurately reflects the specification requirements',
    timestamp: '2026-04-26T10:00:00Z',
  }

  beforeEach(() => {
    agent = new CriticAgent({ callModel: makeMockCaller(validReview) })
  })

  it('returns SemanticReviewResult shape', async () => {
    const result = await agent.semanticReview({
      prd: { id: 'PRD-001', title: 'Auth Feature' },
    })

    expect(result.alignment).toMatch(/^(aligned|miscast|uncertain)$/)
    expect(result.confidence).toBeTypeOf('number')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(Array.isArray(result.citations)).toBe(true)
    expect(result.rationale).toBeTypeOf('string')
    expect(result.timestamp).toBeTypeOf('string')
  })

  it('passes prd data to the model call', async () => {
    const mockCaller = makeMockCaller(validReview)
    agent = new CriticAgent({ callModel: mockCaller })

    await agent.semanticReview({
      prd: { id: 'PRD-002', title: 'Payment Processing' },
    })

    expect(mockCaller).toHaveBeenCalledOnce()
    const [taskKind, system, user] = (mockCaller as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(taskKind).toBe('critic')
    expect(system).toContain('semantic')
    expect(user).toContain('PRD-002')
  })

  it('includes specContent when provided', async () => {
    const mockCaller = makeMockCaller(validReview)
    agent = new CriticAgent({ callModel: mockCaller })

    await agent.semanticReview({
      prd: { id: 'PRD-001', title: 'test' },
      specContent: 'The system SHALL validate all inputs',
    })

    const [, , user] = (mockCaller as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(user).toContain('validate all inputs')
  })

  it('handles missing specContent gracefully', async () => {
    const result = await agent.semanticReview({
      prd: { id: 'PRD-001', title: 'test' },
    })

    expect(result).toEqual(validReview)
  })

  it('throws on invalid JSON from model', async () => {
    const badCaller = vi.fn().mockResolvedValue('garbage response')
    agent = new CriticAgent({ callModel: badCaller })

    await expect(
      agent.semanticReview({
        prd: { id: 'PRD-001', title: 'test' },
      }),
    ).rejects.toThrow()
  })

  it('throws on missing required fields in model response', async () => {
    const incompleteCaller = makeMockCaller({ alignment: 'aligned' })
    agent = new CriticAgent({ callModel: incompleteCaller })

    await expect(
      agent.semanticReview({
        prd: { id: 'PRD-001', title: 'test' },
      }),
    ).rejects.toThrow()
  })
})

// ────────────────────────────────────────────────────────────
// CriticAgent — codeReview
// ────────────────────────────────────────────────────────────

describe('CriticAgent.codeReview', () => {
  let agent: CriticAgent

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

  const samplePlan: Plan = {
    approach: 'Implement auth module with JWT',
    atoms: [{ id: 'A1', description: 'Create token validator', assignedTo: 'coder' }],
    executorRecommendation: 'pi-sdk',
    estimatedComplexity: 'medium',
  }

  const sampleCode: CodeArtifact = {
    files: [
      { path: 'src/auth.ts', content: 'export function validate() {}', action: 'create' },
    ],
    summary: 'Auth module implementation',
    testsIncluded: true,
  }

  beforeEach(() => {
    agent = new CriticAgent({ callModel: makeMockCaller(validCritique) })
  })

  it('returns CritiqueReport shape', async () => {
    const result = await agent.codeReview({
      code: sampleCode,
      plan: samplePlan,
      workGraph: { id: 'WG-001' },
    })

    expect(result.passed).toBeTypeOf('boolean')
    expect(Array.isArray(result.issues)).toBe(true)
    for (const issue of result.issues) {
      expect(issue.severity).toMatch(/^(critical|major|minor)$/)
      expect(issue.description).toBeTypeOf('string')
    }
    expect(Array.isArray(result.mentorRuleCompliance)).toBe(true)
    expect(result.overallAssessment).toBeTypeOf('string')
  })

  it('passes code and plan to the model call', async () => {
    const mockCaller = makeMockCaller(validCritique)
    agent = new CriticAgent({ callModel: mockCaller })

    await agent.codeReview({
      code: sampleCode,
      plan: samplePlan,
      workGraph: { id: 'WG-002' },
    })

    expect(mockCaller).toHaveBeenCalledOnce()
    const [taskKind, system, user] = (mockCaller as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(taskKind).toBe('critic')
    expect(system).toContain('code review')
    expect(user).toContain('auth.ts')
  })

  it('includes mentorRules when provided', async () => {
    const mockCaller = makeMockCaller(validCritique)
    agent = new CriticAgent({ callModel: mockCaller })

    await agent.codeReview({
      code: sampleCode,
      plan: samplePlan,
      workGraph: { id: 'WG-001' },
      mentorRules: ['No global state', 'All functions must be pure'],
    })

    const [, , user] = (mockCaller as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(user).toContain('No global state')
    expect(user).toContain('All functions must be pure')
  })

  it('handles missing mentorRules gracefully', async () => {
    const result = await agent.codeReview({
      code: sampleCode,
      plan: samplePlan,
      workGraph: { id: 'WG-001' },
    })

    expect(result).toEqual(validCritique)
  })

  it('throws on invalid JSON from model', async () => {
    const badCaller = vi.fn().mockResolvedValue('not json')
    agent = new CriticAgent({ callModel: badCaller })

    await expect(
      agent.codeReview({
        code: sampleCode,
        plan: samplePlan,
        workGraph: { id: 'WG-001' },
      }),
    ).rejects.toThrow()
  })

  it('throws on model response missing required fields', async () => {
    const incompleteCaller = makeMockCaller({ passed: true })
    agent = new CriticAgent({ callModel: incompleteCaller })

    await expect(
      agent.codeReview({
        code: sampleCode,
        plan: samplePlan,
        workGraph: { id: 'WG-001' },
      }),
    ).rejects.toThrow()
  })

  it('handles CritiqueReport with zero issues (clean pass)', async () => {
    const cleanReport: CritiqueReport = {
      passed: true,
      issues: [],
      mentorRuleCompliance: [],
      overallAssessment: 'Clean pass, no issues found',
    }
    agent = new CriticAgent({ callModel: makeMockCaller(cleanReport) })

    const result = await agent.codeReview({
      code: sampleCode,
      plan: samplePlan,
      workGraph: { id: 'WG-001' },
    })

    expect(result.passed).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('handles CritiqueReport with critical issues (failed)', async () => {
    const failedReport: CritiqueReport = {
      passed: false,
      issues: [
        { severity: 'critical', description: 'SQL injection vulnerability', file: 'src/db.ts', line: 15 },
        { severity: 'major', description: 'Missing input validation', file: 'src/api.ts' },
      ],
      mentorRuleCompliance: [
        { ruleId: 'MR-SEC-001', compliant: false },
      ],
      overallAssessment: 'Critical security issues found',
    }
    agent = new CriticAgent({ callModel: makeMockCaller(failedReport) })

    const result = await agent.codeReview({
      code: sampleCode,
      plan: samplePlan,
      workGraph: { id: 'WG-001' },
    })

    expect(result.passed).toBe(false)
    expect(result.issues).toHaveLength(2)
    expect(result.issues[0]!.severity).toBe('critical')
  })
})
