/**
 * CriticAgent -- real agent with tools for semantic review and code review.
 *
 * Phase 0 spike: validates gdk-agent agentLoop for critic passes.
 * Uses arango_query tool to read specs, mentor rules, and context
 * from the knowledge graph before producing reviews.
 */

import { agentLoop } from '@weops/gdk-agent'
import type { AgentTool } from '@weops/gdk-agent'
import type { Model, AssistantMessage, Message, UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import { resolveAgentModel } from './resolve-model'
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
  /** @deprecated Workers AI binding — no longer used (context is pre-fetched) */
  ai?: unknown
  /** ADR-008: Hot-reloadable alias overrides for SemanticReview schema */
  semanticReviewAliasOverrides?: Record<string, string[]>
  /** ADR-008: Hot-reloadable alias overrides for CritiqueReport schema */
  codeReviewAliasOverrides?: Record<string, string[]>
  /** Pre-fetched Factory knowledge graph context (injected into user message) */
  contextPrompt?: string
}

// ── System Prompts ──────────────────────────────────────────

const SEMANTIC_REVIEW_SYSTEM = `You are the Semantic Review critic in the Function Factory synthesis pipeline.

Your job: compare a PRD against the original specification/signal and assess alignment.

Use the Factory Knowledge Graph context provided in the user message to ground your review. Do not hallucinate context — only reference decisions, lessons, and functions from the provided context.

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

Use the Factory Knowledge Graph context provided in the user message to ground your review. Do not hallucinate context — only reference decisions, lessons, and rules from the provided context.

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
  private semanticReviewAliasOverrides?: Record<string, string[]>
  private codeReviewAliasOverrides?: Record<string, string[]>
  private contextPrompt?: string

  constructor(opts: CriticAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.semanticReviewAliasOverrides = opts.semanticReviewAliasOverrides
    this.codeReviewAliasOverrides = opts.codeReviewAliasOverrides
    this.contextPrompt = opts.contextPrompt
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

    const tools: AgentTool[] = []  // No tools — context is pre-fetched
    const model = this.modelOverride ?? resolveAgentModel('semantic_review', this.apiKey)

    const userParts: string[] = [`PRD:\n${JSON.stringify(input.prd, null, 2)}`]
    if (input.specContent) {
      userParts.push(`\nSpecification:\n${input.specContent}`)
    }
    // Semantic review: skip pre-fetched context — only needs PRD + specContent for alignment check.
    // Full context would exceed context window and cause F2 truncation (BL1).
    userParts.push('\nRespond with ONLY a JSON object: { "alignment", "confidence", "citations", "rationale", "timestamp" }. No tool calls.')

    const userMessage: UserMessage = {
      role: 'user',
      content: userParts.join('\n'),
      timestamp: Date.now(),
    }

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

    const tools: AgentTool[] = []  // No tools — context is pre-fetched
    const model = this.modelOverride ?? resolveAgentModel('critic', this.apiKey)

    const userParts: string[] = [
      `Code artifacts:\n${JSON.stringify(input.code, null, 2)}`,
      `\nPlan:\n${JSON.stringify(input.plan, null, 2)}`,
      `\nWork graph:\n${JSON.stringify(input.workGraph, null, 2)}`,
    ]

    if (input.mentorRules && input.mentorRules.length > 0) {
      userParts.push(`\nMentor rules:\n${input.mentorRules.map((r) => `- ${r}`).join('\n')}`)
    }

    if (this.contextPrompt) {
      userParts.push(`\n${this.contextPrompt}`)
    userParts.push('\nRespond with ONLY a JSON object matching the schema in the system prompt. No tool calls, no function calls, no explanation.')    }

    const userMessage: UserMessage = {
      role: 'user',
      content: userParts.join('\n'),
      timestamp: Date.now(),
    }

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
