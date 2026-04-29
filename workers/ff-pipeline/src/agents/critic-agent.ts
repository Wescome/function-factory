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
import { createWorkersAIStreamFn, createTextToolCallStreamFn, type AIBinding } from './workers-ai-stream'
import { processAgentOutput, SEMANTIC_REVIEW_SCHEMA, CRITIQUE_REPORT_SCHEMA } from './output-reliability'

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
  /** ADR-008: Hot-reloadable alias overrides for SemanticReview schema */
  semanticReviewAliasOverrides?: Record<string, string[]>
  /** ADR-008: Hot-reloadable alias overrides for CritiqueReport schema */
  codeReviewAliasOverrides?: Record<string, string[]>
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


// JSON extraction + validation now handled by ORL (output-reliability.ts)

// ── CriticAgent class ───────────────────────────────────────

export class CriticAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>
  private ai?: AIBinding
  private semanticReviewAliasOverrides?: Record<string, string[]>
  private codeReviewAliasOverrides?: Record<string, string[]>

  constructor(opts: CriticAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.ai = opts.ai
    this.semanticReviewAliasOverrides = opts.semanticReviewAliasOverrides
    this.codeReviewAliasOverrides = opts.codeReviewAliasOverrides
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

    const toolNames = tools.map(t => t.name); const streamFn = this.ai ? createWorkersAIStreamFn(this.ai) : createTextToolCallStreamFn(toolNames)

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

    const result = await processAgentOutput(textBlock.text, SEMANTIC_REVIEW_SCHEMA, {
      aliasOverrides: this.semanticReviewAliasOverrides,
    })
    if (!result.success) {
      throw new Error(`CriticAgent.semanticReview: ${result.failureMode}: could not produce valid SemanticReview`)
    }
    return result.data!
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

    const toolNames = tools.map(t => t.name); const streamFn = this.ai ? createWorkersAIStreamFn(this.ai) : createTextToolCallStreamFn(toolNames)

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

    const result = await processAgentOutput(textBlock.text, CRITIQUE_REPORT_SCHEMA, {
      aliasOverrides: this.codeReviewAliasOverrides,
    })
    if (!result.success) {
      throw new Error(`CriticAgent.codeReview: ${result.failureMode}: could not produce valid CritiqueReport`)
    }
    return result.data!
  }

  // Validators now handled by ORL via schemas (output-reliability.ts)
}
