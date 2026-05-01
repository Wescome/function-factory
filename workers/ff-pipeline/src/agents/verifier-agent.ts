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
import { processAgentOutput, extractAssistantText, buildTelemetryEntry, VERDICT_SCHEMA } from './output-reliability'

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
  /** ADR-008: Hot-reloadable alias overrides for Verdict schema */
  aliasOverrides?: Record<string, string[]>
  /** Pre-fetched Factory knowledge graph context (injected into user message) */
  contextPrompt?: string
}

// Decision enum validation now in VERDICT_SCHEMA (output-reliability.ts)

const SYSTEM_PROMPT = `You are the Verifier in the Function Factory synthesis pipeline.

Your purpose: make the FINAL decision on whether a synthesized Function is ready. Reference only decisions, lessons, invariants, and rules from the provided Factory Knowledge Graph context.

Process this request in order:
1. Read the synthesis artifacts — workGraph, plan, code, critique, and test results
2. Check the Factory Knowledge Graph context — ground your verdict in real data
3. Apply the decision criteria — match evidence to the correct verdict category
4. Produce the Verdict JSON

DECISION CRITERIA:
- "pass"      — code meets spec, tests pass, critique is clean, lineage is traceable. Ship it.
- "patch"     — fixable issues found. Provide specific repair notes for the CodeProducer.
- "resample"  — approach is fundamentally wrong. Restart from PlanProducer.
- "interrupt" — budget exhausted or ambiguous spec. Needs Architect input.
- "fail"      — unfixable within budget. Stop.

Bias toward "pass" when issues are minor.
Bias toward "patch" when issues are fixable.
Only "fail" when the approach is fundamentally broken AND budget is low.

Your response is a JSON object:
{
  "decision": "pass",
  "confidence": 0.9,
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
    const model = this.modelOverride ?? resolveAgentModel('verifier')

    const userParts: string[] = [this.buildUserMessage(input)]
    if (this.contextPrompt) {
      userParts.push(`\n${this.contextPrompt}`)
    }
    userParts.push('\nProduce a Verdict. Start your response with {"decision":')

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
      throw new Error('VerifierAgent: no assistant response from agent loop')
    }

    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`VerifierAgent: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const rawText = extractAssistantText(lastAssistant.content as any)
    if (!rawText) {
      const blockTypes = lastAssistant.content.map(c => c.type).join(',')
      throw new Error(`VerifierAgent: empty response (blocks: ${blockTypes || 'none'}, stopReason: ${lastAssistant.stopReason})`)
    }

    const result = await processAgentOutput(rawText, VERDICT_SCHEMA, {
      aliasOverrides: this.aliasOverrides,
    })

    // ORL telemetry — fire-and-forget, never blocks agent response
    try {
      const telemetry = buildTelemetryEntry(result, 'Verdict')
      await this.db.save('orl_telemetry', telemetry).catch(() => {})
    } catch { /* telemetry is best-effort */ }

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
