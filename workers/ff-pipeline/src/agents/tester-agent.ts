/**
 * TesterAgent — real agent with tools that produces TestReports.
 *
 * Phase A: converts the callModel tester path to a gdk-agent agentLoop session.
 * Uses arango_query tool to read invariants and test patterns from the
 * knowledge graph before producing test results.
 *
 * Follows the ArchitectAgent pattern (Phase 0 spike).
 */

import { agentLoop } from '@weops/gdk-agent'
import type { AgentTool } from '@weops/gdk-agent'
import { Type, type Model, type AssistantMessage, type Message, type UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import type { CritiqueReport, Plan, CodeArtifact } from '../coordinator/state'
import { buildArangoTool } from './architect-agent'

// Re-export TestReport from state so consumers can import from tester-agent
export type { TestReport } from '../coordinator/state'
import type { TestReport } from '../coordinator/state'

export interface TesterInput {
  workGraph: Record<string, unknown>
  plan: Plan | Record<string, unknown>
  code: CodeArtifact | Record<string, unknown>
  critique?: CritiqueReport | Record<string, unknown>
}

export interface TesterAgentOpts {
  db: ArangoClient
  apiKey: string
  dryRun?: boolean
  /** Override model for testing (e.g. faux provider) */
  model?: Model<any>
}

const SYSTEM_PROMPT = `You are the Tester agent in the Function Factory synthesis pipeline.

Your job: evaluate the code produced by the Coder against the WorkGraph specification, the Plan, and any invariants stored in the knowledge graph. Produce a TestReport.

You have the arango_query tool. USE IT to ground your testing in real Factory context:

1. Query active invariants for this domain:
   FOR inv IN specs_invariants FILTER inv.status == "active" RETURN { key: inv._key, rule: inv.rule, severity: inv.severity }

2. Query test patterns from past synthesis runs:
   FOR t IN execution_artifacts FILTER t.type == "test_report" LIMIT 5 RETURN { key: t._key, content: t.content }

3. Query lessons about testing failures:
   FOR l IN memory_semantic FILTER l.type == "lesson" AND CONTAINS(LOWER(l.lesson), "test") RETURN { key: l._key, lesson: l.lesson }

Make at least one tool call to query invariants before producing your report. Do not hallucinate test results.

Evaluate:
1. Does the code satisfy the invariants from the knowledge graph?
2. Does the code implement what the WorkGraph specifies?
3. Are edge cases handled (null inputs, timeouts, error paths)?
4. If a Critique was provided, are the flagged issues addressed?

When ready, respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "passed": true | false,
  "testsRun": <number>,
  "testsPassed": <number>,
  "testsFailed": <number>,
  "failures": [
    { "name": "test name", "error": "what failed" }
  ],
  "summary": "Assessment of test quality, invariant coverage, and overall readiness"
}`

function createOfoxModel(apiKey: string): Model<'openai-completions'> {
  return {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro via ofox.ai',
    api: 'openai-completions' as const,
    provider: 'deepseek',
    baseUrl: 'https://api.ofox.ai/v1',
    reasoning: false,
    input: ['text'] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  }
}

export class TesterAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>

  constructor(opts: TesterAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
  }

  async runTests(input: TesterInput): Promise<TestReport> {
    if (this.dryRun) {
      return {
        passed: true,
        testsRun: 1,
        testsPassed: 1,
        testsFailed: 0,
        failures: [],
        summary: 'Dry-run — all tests pass',
      }
    }

    const tools: AgentTool[] = [buildArangoTool(this.db)]
    const model = this.modelOverride ?? createOfoxModel(this.apiKey)

    const userParts: string[] = [
      `WorkGraph specification:\n${JSON.stringify(input.workGraph, null, 2)}`,
      `\nPlan:\n${JSON.stringify(input.plan, null, 2)}`,
      `\nCode artifacts:\n${JSON.stringify(input.code, null, 2)}`,
    ]

    if (input.critique) {
      userParts.push(`\nCode critique (from Critic):\n${JSON.stringify(input.critique, null, 2)}`)
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
      AbortSignal.timeout(300_000),
    )

    const messages = await stream.result()

    const lastAssistant = [...messages].reverse().find(
      (m): m is AssistantMessage => m.role === 'assistant',
    )
    if (!lastAssistant) {
      throw new Error('TesterAgent: no assistant response from agent loop')
    }

    // Check for error
    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`TesterAgent: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const textBlock = lastAssistant.content.find(c => c.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('TesterAgent: final response has no text content')
    }

    const parsed = extractAndParseJSON(textBlock.text)
    this.validateTestReport(parsed)
    return parsed as TestReport
  }

  private validateTestReport(obj: unknown): asserts obj is TestReport {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('TesterAgent: model response is not an object')
    }
    const record = obj as Record<string, unknown>

    if (typeof record.passed !== 'boolean') {
      throw new Error('TesterAgent: "passed" must be a boolean')
    }
    if (typeof record.testsRun !== 'number') {
      throw new Error('TesterAgent: "testsRun" must be a number')
    }
    if (typeof record.testsPassed !== 'number') {
      throw new Error('TesterAgent: "testsPassed" must be a number')
    }
    if (typeof record.testsFailed !== 'number') {
      throw new Error('TesterAgent: "testsFailed" must be a number')
    }
    if (!Array.isArray(record.failures)) {
      throw new Error('TesterAgent: "failures" must be an array')
    }
    if (typeof record.summary !== 'string') {
      throw new Error('TesterAgent: "summary" must be a string')
    }
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

  throw new Error(`TesterAgent: could not extract JSON from response: ${trimmed.slice(0, 200)}`)
}
