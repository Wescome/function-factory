/**
 * CriticAgent -- real agent with tools for semantic review and code review.
 *
 * Phase 0 spike: validates gdk-agent agentLoop for critic passes.
 * Uses arango_query tool to read specs, mentor rules, and context
 * from the knowledge graph before producing reviews.
 */

import { agentLoop } from '@weops/gdk-agent'
import type { AgentTool } from '@weops/gdk-agent'
import { Type, type Model, type AssistantMessage, type Message, type UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import { buildArangoTool } from './architect-agent'
import { resolveAgentModel } from './resolve-model'
import { coerceToString, coerceToArray, coerceToNumber, coerceToBoolean } from './coerce'
import { createWorkersAIStreamFn, type AIBinding } from './workers-ai-stream'

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

export interface CriticAgentOpts {
  db: ArangoClient
  apiKey: string
  dryRun?: boolean
  /** Override model for testing (e.g. faux provider) */
  model?: Model<any>
  /** Workers AI binding — when present, uses CF binding instead of HTTP */
  ai?: AIBinding
}

// ── System Prompts ──────────────────────────────────────────

const SEMANTIC_REVIEW_SYSTEM = `You are the Semantic Review critic in the Function Factory synthesis pipeline.

Your job: compare a PRD against the original specification/signal and assess alignment.

You have the arango_query tool. USE IT to ground your review in real Factory context:

1. Query the original signal or spec that produced this PRD:
   FOR s IN specs_functions LIMIT 5 RETURN { key: s._key, name: s.name, domain: s.domain }

2. Query relevant decisions for context:
   FOR d IN memory_semantic FILTER d.type == 'decision' RETURN { key: d._key, decision: d.decision }

3. Query lessons about past misalignments:
   FOR l IN memory_semantic FILTER l.type == 'lesson' RETURN { key: l._key, lesson: l.lesson }

Make at least one tool call before producing your review. Do not hallucinate context.

When ready, respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "alignment": "aligned" | "miscast" | "uncertain",
  "confidence": 0.0 to 1.0,
  "citations": ["spec section or reference"],
  "rationale": "explanation of assessment",
  "timestamp": "ISO 8601 timestamp"
}`

const CODE_REVIEW_SYSTEM = `You are the Code Review critic in the Function Factory synthesis pipeline.

Your job: review code against the plan, work graph, and mentor rules.

You have the arango_query tool. USE IT to ground your review:

1. Query active MentorScript rules:
   FOR r IN mentorscript_rules FILTER r.status == 'active' RETURN { ruleId: r._key, rule: r.rule }

2. Query architectural decisions relevant to the code:
   FOR d IN memory_semantic FILTER d.type == 'decision' RETURN { key: d._key, decision: d.decision }

3. Query lessons about past code issues:
   FOR l IN memory_semantic FILTER l.type == 'lesson' RETURN { key: l._key, lesson: l.lesson, pain: l.pain_score }

Make at least one tool call before producing your review. Do not hallucinate context.

When ready, respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "passed": true/false,
  "issues": [
    { "severity": "critical" | "major" | "minor", "description": "...", "file": "optional", "line": 0 }
  ],
  "mentorRuleCompliance": [
    { "ruleId": "...", "compliant": true/false }
  ],
  "overallAssessment": "summary of the review"
}`

// ── Model factory ───────────────────────────────────────────


// ── JSON extraction ─────────────────────────────────────────

function extractAndParseJSON(text: string): unknown {
  const trimmed = text.trim()

  // Try direct parse first
  try { return JSON.parse(trimmed) } catch { /* continue */ }

  // Strip markdown fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch { /* continue */ }
  }

  // Find first { and last }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)) } catch { /* continue */ }
  }

  throw new Error(`CriticAgent: could not extract JSON from response: ${trimmed.slice(0, 200)}`)
}

// ── CriticAgent class ───────────────────────────────────────

export class CriticAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>
  private ai?: AIBinding

  constructor(opts: CriticAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.ai = opts.ai
  }

  // ── Semantic Review ─────────────────────────────────────

  async semanticReview(input: SemanticReviewInput): Promise<SemanticReviewResult> {
    if (this.dryRun) {
      return {
        alignment: 'aligned',
        confidence: 1.0,
        citations: [],
        rationale: 'Dry-run -- auto-aligned',
        timestamp: new Date().toISOString(),
      }
    }

    const tools: AgentTool[] = [buildArangoTool(this.db)]
    const model = this.modelOverride ?? resolveAgentModel('semantic_review', this.apiKey)

    const userParts: string[] = [`PRD:\n${JSON.stringify(input.prd, null, 2)}`]
    if (input.specContent) {
      userParts.push(`\nSpecification:\n${input.specContent}`)
    }

    const userMessage: UserMessage = {
      role: 'user',
      content: userParts.join('\n'),
      timestamp: Date.now(),
    }

    const streamFn = this.ai ? createWorkersAIStreamFn(this.ai) : undefined

    const stream = agentLoop(
      [userMessage],
      { systemPrompt: SEMANTIC_REVIEW_SYSTEM, messages: [], tools },
      {
        model,
        convertToLlm: (msgs) => msgs as Message[],
        getApiKey: async () => this.apiKey,
        maxTokens: 4096,
      },
      AbortSignal.timeout(600_000),
      streamFn,
    )

    const messages = await stream.result()

    const lastAssistant = [...messages].reverse().find(
      (m): m is AssistantMessage => m.role === 'assistant',
    )
    if (!lastAssistant) {
      throw new Error('CriticAgent.semanticReview: no assistant response from agent loop')
    }

    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`CriticAgent.semanticReview: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const textBlock = lastAssistant.content.find(c => c.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('CriticAgent.semanticReview: final response has no text content')
    }

    const parsed = extractAndParseJSON(textBlock.text)
    this.validateSemanticReview(parsed)
    return parsed as SemanticReviewResult
  }

  // ── Code Review ─────────────────────────────────────────

  async codeReview(input: CodeReviewInput): Promise<CritiqueReport> {
    if (this.dryRun) {
      return {
        passed: true,
        issues: [],
        mentorRuleCompliance: [],
        overallAssessment: 'Dry-run -- no issues found',
      }
    }

    const tools: AgentTool[] = [buildArangoTool(this.db)]
    const model = this.modelOverride ?? resolveAgentModel('critic', this.apiKey)

    const userParts: string[] = [
      `Code artifacts:\n${JSON.stringify(input.code, null, 2)}`,
      `\nPlan:\n${JSON.stringify(input.plan, null, 2)}`,
      `\nWork graph:\n${JSON.stringify(input.workGraph, null, 2)}`,
    ]

    if (input.mentorRules && input.mentorRules.length > 0) {
      userParts.push(`\nMentor rules:\n${input.mentorRules.map((r) => `- ${r}`).join('\n')}`)
    }

    const userMessage: UserMessage = {
      role: 'user',
      content: userParts.join('\n'),
      timestamp: Date.now(),
    }

    const streamFn = this.ai ? createWorkersAIStreamFn(this.ai) : undefined

    const stream = agentLoop(
      [userMessage],
      { systemPrompt: CODE_REVIEW_SYSTEM, messages: [], tools },
      {
        model,
        convertToLlm: (msgs) => msgs as Message[],
        getApiKey: async () => this.apiKey,
        maxTokens: 4096,
      },
      AbortSignal.timeout(600_000),
      streamFn,
    )

    const messages = await stream.result()

    const lastAssistant = [...messages].reverse().find(
      (m): m is AssistantMessage => m.role === 'assistant',
    )
    if (!lastAssistant) {
      throw new Error('CriticAgent.codeReview: no assistant response from agent loop')
    }

    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`CriticAgent.codeReview: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const textBlock = lastAssistant.content.find(c => c.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('CriticAgent.codeReview: final response has no text content')
    }

    const parsed = extractAndParseJSON(textBlock.text)
    this.validateCritiqueReport(parsed)
    return parsed as CritiqueReport
  }

  // ── Validators ──────────────────────────────────────────

  private validateSemanticReview(obj: unknown): asserts obj is SemanticReviewResult {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('CriticAgent.semanticReview: response is not an object')
    }

    const r = obj as Record<string, unknown>

    r.alignment = coerceToString(r.alignment)
    if (!['aligned', 'miscast', 'uncertain'].includes(r.alignment as string)) r.alignment = 'uncertain'
    r.confidence = coerceToNumber(r.confidence)
    if (r.confidence < 0 || r.confidence > 1) r.confidence = 0.5
    r.citations = coerceToArray(r.citations)
    r.rationale = coerceToString(r.rationale)
    r.timestamp = coerceToString(r.timestamp) || new Date().toISOString()
  }

  private validateCritiqueReport(obj: unknown): asserts obj is CritiqueReport {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('CriticAgent.codeReview: response is not an object')
    }

    const r = obj as Record<string, unknown>

    r.passed = coerceToBoolean(r.passed)
    r.issues = coerceToArray(r.issues)
    for (const issue of r.issues as Record<string, unknown>[]) {
      issue.severity = coerceToString(issue.severity)
      if (!['critical', 'major', 'minor'].includes(issue.severity as string)) issue.severity = 'minor'
      issue.description = coerceToString(issue.description)
    }
    r.mentorRuleCompliance = coerceToArray(r.mentorRuleCompliance)
    r.overallAssessment = coerceToString(r.overallAssessment)
  }
}
