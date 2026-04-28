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
import { Type, type Model, type AssistantMessage, type Message, type UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import type { CodeArtifact, Plan, CritiqueReport } from '../coordinator/state'
import { buildArangoTool } from './architect-agent'

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
}

const SYSTEM_PROMPT = `You are the Coder agent in the Function Factory synthesis pipeline.

Your job: produce a CodeArtifact — a set of file changes that implement the Plan against the WorkGraph specification.

You have the arango_query tool. USE IT to ground your implementation in real Factory context:

1. Query existing implementations for patterns:
   FOR f IN specs_functions LIMIT 5 RETURN { key: f._key, name: f.name, domain: f.domain }

2. Query invariants that must be respected:
   FOR inv IN specs_invariants FILTER inv.status == 'active' RETURN { id: inv._key, condition: inv.condition }

3. Query execution artifacts for similar past code:
   FOR ea IN execution_artifacts FILTER ea.type == 'code' LIMIT 3 RETURN { key: ea._key, functionRunId: ea.functionRunId }

4. Query mentor rules for coding standards:
   FOR r IN mentorscript_rules FILTER r.status == 'active' RETURN { ruleId: r._key, rule: r.rule }

Make at least one tool call before producing your code. Do not hallucinate patterns or imports.

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

const CODE_ARTIFACT_REQUIRED_FIELDS: (keyof CodeArtifact)[] = [
  'files', 'summary', 'testsIncluded',
]

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

export class CoderAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>

  constructor(opts: CoderAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
  }

  async produceCode(input: CoderInput): Promise<CodeArtifact> {
    if (this.dryRun) {
      return {
        files: [{ path: 'src/stub.ts', content: '// dry-run stub', action: 'create' }],
        summary: 'Dry-run code output',
        testsIncluded: false,
      }
    }

    const tools: AgentTool[] = [buildArangoTool(this.db)]
    const model = this.modelOverride ?? createOfoxModel(this.apiKey)

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

    const parsed = extractAndParseJSON(textBlock.text)
    this.validateCodeArtifact(parsed)
    return parsed as CodeArtifact
  }

  private validateCodeArtifact(obj: unknown): asserts obj is CodeArtifact {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('CoderAgent: model response is not an object')
    }
    const record = obj as Record<string, unknown>
    for (const field of CODE_ARTIFACT_REQUIRED_FIELDS) {
      if (!(field in record)) {
        throw new Error(`CoderAgent: missing required field "${field}"`)
      }
    }
    if (!Array.isArray(record.files)) {
      throw new Error('CoderAgent: "files" must be an array')
    }
    for (const file of record.files as Record<string, unknown>[]) {
      if (typeof file.path !== 'string') {
        throw new Error('CoderAgent: file entry "path" must be a string')
      }
      if (typeof file.content !== 'string') {
        throw new Error('CoderAgent: file entry "content" must be a string')
      }
      if (!['create', 'modify', 'delete'].includes(file.action as string)) {
        throw new Error('CoderAgent: file entry "action" must be "create", "modify", or "delete"')
      }
    }
    if (typeof record.summary !== 'string') {
      throw new Error('CoderAgent: "summary" must be a string')
    }
    if (typeof record.testsIncluded !== 'boolean') {
      throw new Error('CoderAgent: "testsIncluded" must be a boolean')
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

  throw new Error(`CoderAgent: could not extract JSON from response: ${trimmed.slice(0, 200)}`)
}
