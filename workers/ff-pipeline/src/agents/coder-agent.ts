/**
 * CoderAgent — real agent with tools that produces CodeArtifacts.
 *
 * Phase A: converts callModel wrapper to gdk-agent agentLoop session.
 * Uses arango_query tool to look up existing code patterns, invariants,
 * and similar implementations before producing file changes.
 *
 * The sandbox execution path (executionRole) is Phase C and is NOT touched.
 */

import { agentLoop } from '@weops/gdk-agent'
import type { AgentTool } from '@weops/gdk-agent'
import type { Model, AssistantMessage, Message, UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import type { CodeArtifact, Plan, CritiqueReport } from '../coordinator/state'
import { resolveAgentModel } from './resolve-model'
import { processAgentOutput, CODE_ARTIFACT_SCHEMA } from './output-reliability'

export interface CoderInput {
  workGraph: Record<string, unknown>
  plan: Plan
  specContent?: string
  repairNotes?: string
  previousCode?: CodeArtifact
  critiqueIssues?: CritiqueReport['issues']
}

export interface CoderAgentOpts {
  db: ArangoClient
  apiKey: string
  dryRun?: boolean
  /** Override model for testing (e.g. faux provider) */
  model?: Model<any>
  /** @deprecated Workers AI binding — no longer used (context is pre-fetched) */
  ai?: unknown
  /** ADR-008: Hot-reloadable alias overrides for CodeArtifact schema */
  aliasOverrides?: Record<string, string[]>
  /** Pre-fetched Factory knowledge graph context (injected into user message) */
  contextPrompt?: string
}

const SYSTEM_PROMPT = `You are the Coder agent in the Function Factory synthesis pipeline.

Your job: produce a CodeArtifact — a set of file changes that implement the Plan against the WorkGraph specification.

Use the Factory Knowledge Graph context provided in the user message to ground your implementation. Do not hallucinate patterns or imports — only reference decisions, lessons, functions, and invariants from the provided context.

If this is a repair cycle (repairNotes provided), focus on fixing the specific issues noted.
Reuse existing patterns from the codebase. Follow the plan's atom ordering.

When ready, respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "files": [
    { "path": "src/example.ts", "content": "file content here", "action": "create | modify | delete" }
  ],
  "summary": "What was implemented and why",
  "testsIncluded": true | false
}

Each file entry must have: path (string), content (string), action ("create" | "modify" | "delete").`

// Required fields now defined in CODE_ARTIFACT_SCHEMA (output-reliability.ts)


export class CoderAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>
  private aliasOverrides?: Record<string, string[]>
  private contextPrompt?: string

  constructor(opts: CoderAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.aliasOverrides = opts.aliasOverrides
    this.contextPrompt = opts.contextPrompt
  }

  async produceCode(input: CoderInput): Promise<CodeArtifact> {
    if (this.dryRun) {
      return {
        files: [{ path: 'src/stub.ts', content: '// dry-run stub', action: 'create' }],
        summary: 'Dry-run code output',
        testsIncluded: false,
      }
    }

    const tools: AgentTool[] = []  // No tools — context is pre-fetched
    const model = this.modelOverride ?? resolveAgentModel('coder', this.apiKey)

    const userParts: string[] = [
      `Plan:\n${JSON.stringify(input.plan, null, 2)}`,
      `\nWorkGraph specification:\n${JSON.stringify(input.workGraph, null, 2)}`,
    ]

    if (input.specContent) {
      userParts.push(`\nOriginal specification content:\n${input.specContent}`)
    }

    if (input.repairNotes) {
      userParts.push(`\n--- REPAIR CYCLE ---`)
      userParts.push(`Repair notes from Verifier:\n${input.repairNotes}`)
    }

    if (input.previousCode) {
      userParts.push(`\nPrevious code (to fix, not rewrite from scratch):\n${JSON.stringify(input.previousCode, null, 2)}`)
    }

    if (input.critiqueIssues && input.critiqueIssues.length > 0) {
      userParts.push(`\nCritique issues to address:\n${JSON.stringify(input.critiqueIssues, null, 2)}`)
    }

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
      throw new Error('CoderAgent: no assistant response from agent loop')
    }

    // Check for error
    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`CoderAgent: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const textBlock = lastAssistant.content.find(c => c.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('CoderAgent: final response has no text content')
    }

    const result = await processAgentOutput(textBlock.text, CODE_ARTIFACT_SCHEMA, {
      aliasOverrides: this.aliasOverrides,
    })
    if (!result.success) {
      throw new Error(`CoderAgent: ${result.failureMode}: could not produce valid CodeArtifact`)
    }
    return result.data!
  }
}
