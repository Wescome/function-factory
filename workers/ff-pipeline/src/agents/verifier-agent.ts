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
import { buildArangoTool } from './architect-agent'
import { resolveAgentModel } from './resolve-model'
import { coerceToString, coerceToNumber } from './coerce'
import { createWorkersAIStreamFn, type AIBinding } from './workers-ai-stream'

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
  /** Workers AI binding — when present, uses CF binding instead of HTTP */
  ai?: AIBinding
}

const VALID_DECISIONS: VerdictDecision[] = ['pass', 'fail', 'patch', 'resample', 'interrupt']

const SYSTEM_PROMPT = `You are the Verifier agent in the Function Factory synthesis pipeline.

Your job: make the FINAL decision on whether a synthesized Function is ready.

You have the arango_query tool. USE IT to ground your verdict in real Factory context:

1. Query existing lineage for this WorkGraph:
   FOR f IN specs_functions FILTER f._key == "<workGraphId>" RETURN { key: f._key, name: f.name, lineage: f.source_refs }

2. Query invariants that must be covered:
   FOR inv IN specs_invariants RETURN { key: inv._key, description: inv.description, detector: inv.detector }

3. Query past synthesis attempts for this function:
   FOR ep IN memory_episodic FILTER ep.functionId == "<workGraphId>" SORT ep.timestamp DESC LIMIT 5 RETURN { action: ep.action, verdict: ep.detail.verdict, timestamp: ep.timestamp }

4. Query active mentor rules the code must comply with:
   FOR r IN mentorscript_rules FILTER r.status == 'active' RETURN { ruleId: r._key, rule: r.rule }

Make at least one tool call before producing your verdict. Do not hallucinate context.

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
  private ai?: AIBinding

  constructor(opts: VerifierAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.ai = opts.ai
  }

  async verify(input: VerifierInput): Promise<Verdict> {
    if (this.dryRun) {
      return {
        decision: 'pass',
        confidence: 1.0,
        reason: 'Dry-run — auto-pass',
      }
    }

    const tools: AgentTool[] = [buildArangoTool(this.db)]
    const model = this.modelOverride ?? resolveAgentModel('verifier', this.apiKey)

    const userMessage: UserMessage = {
      role: 'user',
      content: this.buildUserMessage(input),
      timestamp: Date.now(),
    }

    const streamFn = this.ai ? createWorkersAIStreamFn(this.ai) : undefined

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
      streamFn,
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

    const parsed = extractAndParseJSON(textBlock.text)
    this.validateVerdict(parsed)

    // Build clean Verdict, preserving optional notes
    const verdict: Verdict = {
      decision: (parsed as Record<string, unknown>).decision as VerdictDecision,
      confidence: (parsed as Record<string, unknown>).confidence as number,
      reason: (parsed as Record<string, unknown>).reason as string,
    }
    if (typeof (parsed as Record<string, unknown>).notes === 'string') {
      verdict.notes = (parsed as Record<string, unknown>).notes as string
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

  private validateVerdict(obj: unknown): asserts obj is Verdict {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('VerifierAgent: model response is not an object')
    }
    const record = obj as Record<string, unknown>

    if (!('decision' in record)) {
      throw new Error('VerifierAgent: missing required field "decision"')
    }
    if (!('confidence' in record)) {
      throw new Error('VerifierAgent: missing required field "confidence"')
    }
    if (!('reason' in record)) {
      throw new Error('VerifierAgent: missing required field "reason"')
    }

    record.decision = coerceToString(record.decision)
    if (!VALID_DECISIONS.includes(record.decision as VerdictDecision)) {
      record.decision = 'interrupt'
    }
    record.confidence = coerceToNumber(record.confidence)
    if (record.confidence < 0 || record.confidence > 1) record.confidence = 0.5
    record.reason = coerceToString(record.reason)
    if ('notes' in record && record.notes !== undefined) record.notes = coerceToString(record.notes)
  }
}

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

  throw new Error(`VerifierAgent: could not extract JSON from response: ${trimmed.slice(0, 200)}`)
}
