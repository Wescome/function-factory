/**
 * CriticAgent — reasoning agent for semantic review and code review.
 *
 * Plain TypeScript class (no Durable Object lifecycle needed).
 * Can be converted to extend Agent from 'agents' SDK when ready.
 */

import type { SemanticReviewResult } from '../types.js'
import type { CritiqueReport, Plan, CodeArtifact } from '../coordinator/state.js'

export interface SemanticReviewInput {
  prd: Record<string, unknown>
  specContent?: string
}

export interface CodeReviewInput {
  code: CodeArtifact
  plan: Plan
  workGraph: Record<string, unknown>
  mentorRules?: string[]
}

type ModelCaller = (taskKind: string, system: string, user: string) => Promise<string>

export interface CriticAgentOpts {
  callModel: ModelCaller
}

export class CriticAgent {
  private callModel: ModelCaller

  constructor(opts: CriticAgentOpts) {
    this.callModel = opts.callModel
  }

  // ── Semantic Review ─────────────────────────────────────

  async semanticReview(input: SemanticReviewInput): Promise<SemanticReviewResult> {
    const system = [
      'You are a semantic review critic for a synthesis pipeline.',
      'Compare the PRD against the specification and assess alignment.',
      'Respond with a JSON object containing exactly these fields:',
      '  alignment ("aligned" | "miscast" | "uncertain"): how well the PRD matches the spec',
      '  confidence (number 0-1): your confidence in the assessment',
      '  citations (string[]): specific spec sections supporting your assessment',
      '  rationale (string): explanation of your assessment',
      '  timestamp (string): ISO 8601 timestamp of this review',
      'Respond ONLY with valid JSON. No markdown, no explanation.',
    ].join('\n')

    const userParts: string[] = [
      `PRD: ${JSON.stringify(input.prd)}`,
    ]

    if (input.specContent) {
      userParts.push(`\nSpecification:\n${input.specContent}`)
    }

    const raw = await this.callModel('critic', system, userParts.join('\n'))

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`CriticAgent.semanticReview: model returned invalid JSON: ${raw.slice(0, 200)}`)
    }

    this.validateSemanticReview(parsed)
    return parsed as SemanticReviewResult
  }

  // ── Code Review ─────────────────────────────────────────

  async codeReview(input: CodeReviewInput): Promise<CritiqueReport> {
    const system = [
      'You are a code review critic for a synthesis pipeline.',
      'Review the code against the plan, work graph, and mentor rules.',
      'Respond with a JSON object containing exactly these fields:',
      '  passed (boolean): whether the code passes review',
      '  issues (array): list of issues, each with:',
      '    severity ("critical" | "major" | "minor")',
      '    description (string)',
      '    file (string, optional)',
      '    line (number, optional)',
      '  mentorRuleCompliance (array): list of rule checks, each with:',
      '    ruleId (string)',
      '    compliant (boolean)',
      '  overallAssessment (string): summary of the review',
      'Respond ONLY with valid JSON. No markdown, no explanation.',
    ].join('\n')

    const userParts: string[] = [
      `Code artifacts:\n${JSON.stringify(input.code)}`,
      `\nPlan:\n${JSON.stringify(input.plan)}`,
      `\nWork graph:\n${JSON.stringify(input.workGraph)}`,
    ]

    if (input.mentorRules && input.mentorRules.length > 0) {
      userParts.push(`\nMentor rules:\n${input.mentorRules.map((r) => `- ${r}`).join('\n')}`)
    }

    const raw = await this.callModel('critic', system, userParts.join('\n'))

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`CriticAgent.codeReview: model returned invalid JSON: ${raw.slice(0, 200)}`)
    }

    this.validateCritiqueReport(parsed)
    return parsed as CritiqueReport
  }

  // ── Validators ──────────────────────────────────────────

  private validateSemanticReview(obj: unknown): asserts obj is SemanticReviewResult {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('CriticAgent.semanticReview: response is not an object')
    }

    const r = obj as Record<string, unknown>

    if (!['aligned', 'miscast', 'uncertain'].includes(r.alignment as string)) {
      throw new Error('CriticAgent.semanticReview: "alignment" must be "aligned", "miscast", or "uncertain"')
    }
    if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
      throw new Error('CriticAgent.semanticReview: "confidence" must be a number between 0 and 1')
    }
    if (!Array.isArray(r.citations)) {
      throw new Error('CriticAgent.semanticReview: "citations" must be an array')
    }
    if (typeof r.rationale !== 'string') {
      throw new Error('CriticAgent.semanticReview: "rationale" must be a string')
    }
    if (typeof r.timestamp !== 'string') {
      throw new Error('CriticAgent.semanticReview: "timestamp" must be a string')
    }
  }

  private validateCritiqueReport(obj: unknown): asserts obj is CritiqueReport {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('CriticAgent.codeReview: response is not an object')
    }

    const r = obj as Record<string, unknown>

    if (typeof r.passed !== 'boolean') {
      throw new Error('CriticAgent.codeReview: "passed" must be a boolean')
    }
    if (!Array.isArray(r.issues)) {
      throw new Error('CriticAgent.codeReview: "issues" must be an array')
    }
    for (const issue of r.issues as Record<string, unknown>[]) {
      if (!['critical', 'major', 'minor'].includes(issue.severity as string)) {
        throw new Error('CriticAgent.codeReview: issue "severity" must be "critical", "major", or "minor"')
      }
      if (typeof issue.description !== 'string') {
        throw new Error('CriticAgent.codeReview: issue "description" must be a string')
      }
    }
    if (!Array.isArray(r.mentorRuleCompliance)) {
      throw new Error('CriticAgent.codeReview: "mentorRuleCompliance" must be an array')
    }
    if (typeof r.overallAssessment !== 'string') {
      throw new Error('CriticAgent.codeReview: "overallAssessment" must be a string')
    }
  }
}
