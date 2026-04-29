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
import type { Model, AssistantMessage, Message, UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import type { CritiqueReport, Plan, CodeArtifact } from '../coordinator/state'
import { resolveAgentModel } from './resolve-model'
import { processAgentOutput, TEST_REPORT_SCHEMA } from './output-reliability'

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
  /** @deprecated Workers AI binding — no longer used (context is pre-fetched) */
  ai?: unknown
  /** ADR-008: Hot-reloadable alias overrides for TestReport schema */
  aliasOverrides?: Record<string, string[]>
  /** Pre-fetched Factory knowledge graph context (injected into user message) */
  contextPrompt?: string
}

const SYSTEM_PROMPT = `You are the Tester agent in the Function Factory synthesis pipeline.

Your job: evaluate the code produced by the Coder against the WorkGraph specification, the Plan, and any invariants from the Factory context. Produce a TestReport.

Use the Factory Knowledge Graph context provided in the user message to ground your testing. Do not hallucinate test results — only reference invariants, lessons, and rules from the provided context.

Evaluate:
1. Does the code satisfy the invariants from the provided context?
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


export class TesterAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>
  private aliasOverrides?: Record<string, string[]>
  private contextPrompt?: string

  constructor(opts: TesterAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.aliasOverrides = opts.aliasOverrides
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

    const tools: AgentTool[] = []  // No tools — context is pre-fetched
    const model = this.modelOverride ?? resolveAgentModel('tester', this.apiKey)

    const userParts: string[] = [
      `WorkGraph specification:\n${JSON.stringify(input.workGraph, null, 2)}`,
      `\nPlan:\n${JSON.stringify(input.plan, null, 2)}`,
      `\nCode artifacts:\n${JSON.stringify(input.code, null, 2)}`,
    ]

    if (input.critique) {
      userParts.push(`\nCode critique (from Critic):\n${JSON.stringify(input.critique, null, 2)}`)
    }

    userParts.push('\nRespond with ONLY a JSON object matching the schema in the system prompt. No tool calls, no function calls, no explanation.')

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

    const result = await processAgentOutput(textBlock.text, TEST_REPORT_SCHEMA, {
      aliasOverrides: this.aliasOverrides,
    })
    if (!result.success) {
      throw new Error(`TesterAgent: ${result.failureMode}: could not produce valid TestReport`)
    }
    return result.data!
  }
}
