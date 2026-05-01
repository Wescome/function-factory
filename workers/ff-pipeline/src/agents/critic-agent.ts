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
import { processAgentOutput, extractAssistantText, buildTelemetryEntry, SEMANTIC_REVIEW_SCHEMA, CRITIQUE_REPORT_SCHEMA } from './output-reliability'

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
  /** Override model for code review (e.g. faux provider) */
  model?: Model<any>
  /** Override model + key for semantic review (defaults to semantic_review route) */
  semanticReviewModel?: Model<any>
  semanticReviewApiKey?: string
  /** ADR-008: Hot-reloadable alias overrides for SemanticReview schema */
  semanticReviewAliasOverrides?: Record<string, string[]>
  /** ADR-008: Hot-reloadable alias overrides for CritiqueReport schema */
  codeReviewAliasOverrides?: Record<string, string[]>
  /** Pre-fetched Factory knowledge graph context (injected into user message) */
  contextPrompt?: string
}

// ── System Prompts ──────────────────────────────────────────

const SEMANTIC_REVIEW_SYSTEM = `You are the SemanticReviewer in the Function Factory synthesis pipeline.

Your purpose: assess whether a PRD covers the original specification.

Process this request in order:
1. Read the PRD summary — understand the title, acceptance criteria, and atoms
2. Read the specification — understand the original requirements
3. Compare coverage — map each spec requirement to PRD acceptance criteria
4. Produce the SemanticReview JSON

Alignment criteria:
- "aligned": the PRD's acceptance criteria cover ALL requirements from the specification. Title reframing is acceptable. Minor wording changes are acceptable. The substance must match.
- "miscast": the PRD addresses a DIFFERENT topic than the specification, OR fabricates requirements not in the spec.
- "uncertain": some requirements covered, others missing.

Bias toward "aligned" when acceptance criteria substantively cover the spec, even if the title or framing differs.

Your response is a JSON object:
{"alignment":"aligned","confidence":0.9,"citations":["Req 1 covered by AC1"],"rationale":"All requirements covered.","timestamp":"2026-04-29T00:00:00Z"}`

const CODE_REVIEW_SYSTEM = `You are the CodeReviewer in the Function Factory synthesis pipeline.

Your purpose: review code against the plan, work graph, and mentor rules. Reference only decisions, lessons, and rules from the provided Factory Knowledge Graph context.

Process this request in order:
1. Read the code artifacts — understand what was produced
2. Check against plan and workGraph — verify the code implements the specification
3. Check mentor rules — verify compliance with active rules
4. Produce the CritiqueReport JSON

Your response is a JSON object:
{
  "passed": true,
  "issues": [
    { "severity": "critical", "description": "...", "file": "optional", "line": 0 }
  ],
  "mentorRuleCompliance": [
    { "ruleId": "...", "compliant": true }
  ],
  "overallAssessment": "summary of the review"
}`

// ── Helpers ─────────────────────────────────────────────────

function summarizePrdForReview(prd: Record<string, unknown>): string {
  const parts: string[] = []
  if (prd.title) parts.push(`Title: ${prd.title}`)
  if (prd.description) parts.push(`Description: ${prd.description}`)
  const ac = prd.acceptanceCriteria ?? prd.acceptance_criteria ?? prd.successCriteria
  if (Array.isArray(ac)) parts.push(`Acceptance Criteria:\n${ac.map((c: unknown, i: number) => `  ${i + 1}. ${c}`).join('\n')}`)
  if (prd.atoms && Array.isArray(prd.atoms)) {
    const atomTitles = (prd.atoms as Record<string, unknown>[]).map((a) => a.title ?? a.id).filter(Boolean)
    if (atomTitles.length > 0) parts.push(`Atoms: ${atomTitles.join(', ')}`)
  }
  return parts.length > 0 ? parts.join('\n') : JSON.stringify(prd).slice(0, 500)
}

// ── CriticAgent class ───────────────────────────────────────

export class CriticAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>
  private semanticReviewModel?: Model<any>
  private semanticReviewApiKey?: string
  private semanticReviewAliasOverrides?: Record<string, string[]>
  private codeReviewAliasOverrides?: Record<string, string[]>
  private contextPrompt?: string

  constructor(opts: CriticAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.semanticReviewModel = opts.semanticReviewModel
    this.semanticReviewApiKey = opts.semanticReviewApiKey
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
    const model = this.semanticReviewModel ?? resolveAgentModel('semantic_review')
    const apiKey = this.semanticReviewApiKey ?? this.apiKey

    // BL1 mitigation: only send the fields the semantic reviewer needs.
    // Sending the full PRD/WorkGraph causes the model to echo the input
    // back as a function-call structure, exceeding the output token budget.
    const prdSummary = summarizePrdForReview(input.prd)
    const userParts: string[] = [`PRD summary:\n${prdSummary}`]
    if (input.specContent) {
      userParts.push(`\nSpecification:\n${input.specContent}`)
    }
    userParts.push('\nProduce a SemanticReview. Start your response with {"alignment":')

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
        getApiKey: async () => apiKey,
        maxTokens: 4096,
        onPayload: (payload: unknown) => ({
          ...(payload as Record<string, unknown>),
          response_format: { type: 'json_object' },
        }),
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

    const rawText = extractAssistantText(lastAssistant.content as any)
    if (!rawText) {
      const blockTypes = lastAssistant.content.map(c => c.type).join(',')
      throw new Error(`CriticAgent.semanticReview: empty response (blocks: ${blockTypes || 'none'}, stopReason: ${lastAssistant.stopReason})`)
    }

    const result = await processAgentOutput(rawText, SEMANTIC_REVIEW_SCHEMA, {
      aliasOverrides: this.semanticReviewAliasOverrides,
    })

    // ORL telemetry — fire-and-forget, never blocks agent response
    try {
      const telemetry = buildTelemetryEntry(result, 'SemanticReview')
      await this.db.save('orl_telemetry', telemetry).catch(() => {})
    } catch { /* telemetry is best-effort */ }

    if (!result.success) {
      throw new Error(`CriticAgent.semanticReview: ${result.failureMode}: could not produce valid SemanticReview. Response: ${result.rawResponse.slice(0, 500)}`)
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
    const model = this.modelOverride ?? resolveAgentModel('critic')

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
    }

    userParts.push('\nProduce a CritiqueReport. Start your response with {"passed":')

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
        onPayload: (payload: unknown) => ({
          ...(payload as Record<string, unknown>),
          response_format: { type: 'json_object' },
        }),
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

    const rawText = extractAssistantText(lastAssistant.content as any)
    if (!rawText) {
      const blockTypes = lastAssistant.content.map(c => c.type).join(',')
      throw new Error(`CriticAgent.codeReview: empty response (blocks: ${blockTypes || 'none'}, stopReason: ${lastAssistant.stopReason})`)
    }

    const result = await processAgentOutput(rawText, CRITIQUE_REPORT_SCHEMA, {
      aliasOverrides: this.codeReviewAliasOverrides,
    })

    // ORL telemetry — fire-and-forget, never blocks agent response
    try {
      const telemetry = buildTelemetryEntry(result, 'CritiqueReport')
      await this.db.save('orl_telemetry', telemetry).catch(() => {})
    } catch { /* telemetry is best-effort */ }

    if (!result.success) {
      throw new Error(`CriticAgent.codeReview: ${result.failureMode}: could not produce valid CritiqueReport`)
    }
    return result.data!
  }

  // Validators now handled by ORL via schemas (output-reliability.ts)
}
