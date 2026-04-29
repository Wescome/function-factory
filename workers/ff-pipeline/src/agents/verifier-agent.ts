/**
 * VerifierAgent — real agent with tools that produces Verdicts.
 *
 * Phase 0 spike: follows ArchitectAgent pattern. Uses gdk-agent agentLoop
 * with arango_query tool to verify lineage, check invariant coverage,
 * and confirm all gates passed before rendering a verdict.
 */

import { agentLoop } from '@weops/gdk-agent'
import type { AgentTool } from '@weops/gdk-agent'
import type { Model, AssistantMessage, Message, UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import type { Verdict, VerdictDecision, Plan, CodeArtifact, CritiqueReport, TestReport } from '../coordinator/state'
import { resolveAgentModel } from './resolve-model'
import { processAgentOutput, VERDICT_SCHEMA } from './output-reliability'

export interface VerifierInput {
  workGraph: Record<string, unknown>
  plan: Plan | null
  code: CodeArtifact | null
  critique: CritiqueReport | null
  tests: TestReport | null
  repairCount: number
  maxRepairs: number
  tokenUsage: number
  maxTokens: number
}

export interface VerifierAgentOpts {
  db: ArangoClient
  apiKey: string
  dryRun?: boolean
  /** Override model for testing (e.g. faux provider) */
  model?: Model<any>
  /** @deprecated Workers AI binding — no longer used (context is pre-fetched) */
  ai?: unknown
  /** ADR-008: Hot-reloadable alias overrides for Verdict schema */
  aliasOverrides?: Record<string, string[]>
  /** Pre-fetched Factory knowledge graph context (injected into user message) */
  contextPrompt?: string
}

// Decision enum validation now in VERDICT_SCHEMA (output-reliability.ts)

const SYSTEM_PROMPT = `You are the Verifier agent in the Function Factory synthesis pipeline.

Your job: make the FINAL decision on whether a synthesized Function is ready.

Use the Factory Knowledge Graph context provided in the user message to ground your verdict. Do not hallucinate context — only reference decisions, lessons, invariants, and rules from the provided context.

DECISION CRITERIA:
- "pass"      — code meets spec, tests pass, critique is clean, lineage is traceable. Ship it.
- "patch"     — fixable issues found. Provide specific repair notes for the Coder.
- "resample"  — approach is fundamentally wrong. Restart from Planner.
- "interrupt" — budget exhausted or ambiguous spec. Needs architect input.
- "fail"      — unfixable within budget. Stop.

Bias toward "pass" when issues are minor.
Bias toward "patch" when issues are fixable.
Only "fail" when the approach is fundamentally broken AND budget is low.

When ready, respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "decision": "pass | patch | resample | interrupt | fail",
  "confidence": 0.0-1.0,
  "reason": "Why this decision",
  "notes": "Specific repair guidance (if patch/resample, otherwise omit)"
}`


export class VerifierAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>
  private aliasOverrides?: Record<string, string[]>
  private contextPrompt?: string

  constructor(opts: VerifierAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.aliasOverrides = opts.aliasOverrides
    this.contextPrompt = opts.contextPrompt
  }

  async verify(input: VerifierInput): Promise<Verdict> {
    if (this.dryRun) {
      return {
        decision: 'pass',
        confidence: 1.0,
        reason: 'Dry-run — auto-pass',
      }
    }

    const tools: AgentTool[] = []  // No tools — context is pre-fetched
    const model = this.modelOverride ?? resolveAgentModel('verifier', this.apiKey)

    const userParts: string[] = [this.buildUserMessage(input)]
    if (this.contextPrompt) {
      userParts.push(`\n${this.contextPrompt}`)
    }

    const userMessage: UserMessage = {
      role: 'user',
      content: userParts.join('\n'),
      timestamp: Date.now(),
    }

    const stream = agentLoop(
      [userMessage],
      { systemPrompt: SYSTEM_PROMPT, messages: [], tools },
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
      throw new Error('VerifierAgent: no assistant response from agent loop')
    }

    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`VerifierAgent: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const textBlock = lastAssistant.content.find(c => c.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('VerifierAgent: final response has no text content')
    }

    const result = await processAgentOutput(textBlock.text, VERDICT_SCHEMA, {
      aliasOverrides: this.aliasOverrides,
    })
    if (!result.success) {
      throw new Error(`VerifierAgent: ${result.failureMode}: could not produce valid Verdict`)
    }

    // Build clean Verdict, preserving optional notes
    const data = result.data! as Record<string, unknown>
    const verdict: Verdict = {
      decision: data.decision as VerdictDecision,
      confidence: data.confidence as number,
      reason: data.reason as string,
    }
    if (typeof data.notes === 'string') {
      verdict.notes = data.notes as string
    }
    return verdict
  }

  private buildUserMessage(input: VerifierInput): string {
    return JSON.stringify({
      workGraph: input.workGraph,
      plan: input.plan,
      code: input.code ? { summary: input.code.summary, fileCount: input.code.files.length, testsIncluded: input.code.testsIncluded } : null,
      critique: input.critique ? { passed: input.critique.passed, issueCount: input.critique.issues.length, assessment: input.critique.overallAssessment } : null,
      tests: input.tests ? { passed: input.tests.passed, testsRun: input.tests.testsRun, testsPassed: input.tests.testsPassed, testsFailed: input.tests.testsFailed, summary: input.tests.summary } : null,
      repairCount: input.repairCount,
      maxRepairs: input.maxRepairs,
      tokenUsage: input.tokenUsage,
      maxTokens: input.maxTokens,
      budgetRemaining: `${Math.round(((input.maxTokens - input.tokenUsage) / input.maxTokens) * 100)}%`,
      repairsRemaining: input.maxRepairs - input.repairCount,
    }, null, 2)
  }

  // Validation now handled by ORL via VERDICT_SCHEMA (output-reliability.ts)
}
