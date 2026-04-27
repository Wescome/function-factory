/**
 * ArchitectAgent — real agent with tools that produces BriefingScripts.
 *
 * Phase 0 spike: validates gdk-agent agentLoop in CF Workers V8 isolate.
 * Uses arango_query tool to read DECISIONS, LESSONS, MentorScript rules
 * from the knowledge graph before producing the briefing.
 */

import { agentLoop } from '@weops/gdk-agent'
import type { AgentTool } from '@weops/gdk-agent'
import { Type, type Model, type AssistantMessage, type Message, type UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'

export interface BriefingScript {
  goal: string
  successCriteria: string[]
  architecturalContext: string
  strategicAdvice: string
  knownGotchas: string[]
  validationLoop: string
}

export interface BriefingInput {
  signal: Record<string, unknown>
  specContent?: string
  memoryDigest?: string
  mentorRules?: string[]
}

export interface ArchitectAgentOpts {
  db: ArangoClient
  apiKey: string
  dryRun?: boolean
  /** Override model for testing (e.g. faux provider) */
  model?: Model<any>
}

const SYSTEM_PROMPT = `You are the Architect agent in the Function Factory synthesis pipeline.

Your job: produce a BriefingScript that guides downstream agents (Planner, Coder, Tester, Verifier) through synthesizing a Function from a WorkGraph specification.

You have the arango_query tool. USE IT to ground your briefing in real Factory context:

1. Query architectural decisions:
   FOR d IN memory_semantic FILTER d.type == 'decision' RETURN { key: d._key, decision: d.decision, rationale: d.rationale }

2. Query lessons from past failures:
   FOR l IN memory_semantic FILTER l.type == 'lesson' RETURN { key: l._key, lesson: l.lesson, pain: l.pain_score }

3. Query active MentorScript rules:
   FOR r IN mentorscript_rules FILTER r.status == 'active' RETURN { ruleId: r._key, rule: r.rule }

4. Query existing functions for context:
   FOR f IN specs_functions LIMIT 5 RETURN { key: f._key, name: f.name, domain: f.domain }

Make at least one tool call before producing your briefing. Do not hallucinate context.

When ready, respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "goal": "the primary objective for this synthesis",
  "successCriteria": ["measurable condition 1", "measurable condition 2"],
  "architecturalContext": "relevant background from decisions and codebase",
  "strategicAdvice": "high-level guidance for downstream agents",
  "knownGotchas": ["pitfall from lessons learned"],
  "validationLoop": "how to validate the outcome"
}`

const BRIEFING_REQUIRED_FIELDS: (keyof BriefingScript)[] = [
  'goal', 'successCriteria', 'architecturalContext',
  'strategicAdvice', 'knownGotchas', 'validationLoop',
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

export function buildArangoTool(db: ArangoClient): AgentTool {
  return {
    name: 'arango_query',
    label: 'Query ArangoDB',
    description: 'Run an AQL query against the Factory knowledge graph. Returns JSON array of results. Use for looking up decisions, lessons, mentor rules, existing functions, invariants, and lineage.',
    parameters: Type.Object({
      query: Type.String({ description: 'AQL query string' }),
    }),
    async execute(_toolCallId, params) {
      try {
        const results = await db.query(params.query)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
          details: { rowCount: results.length },
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `AQL error: ${msg}` }],
          details: { error: msg },
        }
      }
    },
  }
}

export class ArchitectAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>

  constructor(opts: ArchitectAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
  }

  async produceBriefingScript(input: BriefingInput): Promise<BriefingScript> {
    if (this.dryRun) {
      return {
        goal: 'Dry-run goal',
        successCriteria: ['Dry-run criterion'],
        architecturalContext: 'Dry-run context',
        strategicAdvice: 'Dry-run advice',
        knownGotchas: [],
        validationLoop: 'Dry-run validation',
      }
    }

    const tools: AgentTool[] = [buildArangoTool(this.db)]
    const model = this.modelOverride ?? createOfoxModel(this.apiKey)

    const userParts: string[] = [`WorkGraph specification:\n${JSON.stringify(input.signal, null, 2)}`]
    if (input.specContent) {
      userParts.push(`\nOriginal specification content:\n${input.specContent}`)
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
      AbortSignal.timeout(120_000),
    )

    const messages = await stream.result()

    const lastAssistant = [...messages].reverse().find(
      (m): m is AssistantMessage => m.role === 'assistant',
    )
    if (!lastAssistant) {
      throw new Error('ArchitectAgent: no assistant response from agent loop')
    }

    // Check for error
    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`ArchitectAgent: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const textBlock = lastAssistant.content.find(c => c.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('ArchitectAgent: final response has no text content')
    }

    const parsed = extractAndParseJSON(textBlock.text)
    this.validateBriefingScript(parsed)
    return parsed as BriefingScript
  }

  private validateBriefingScript(obj: unknown): asserts obj is BriefingScript {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('ArchitectAgent: model response is not an object')
    }
    const record = obj as Record<string, unknown>
    for (const field of BRIEFING_REQUIRED_FIELDS) {
      if (!(field in record)) {
        throw new Error(`ArchitectAgent: missing required field "${field}"`)
      }
    }
    if (typeof record.goal !== 'string') throw new Error('ArchitectAgent: "goal" must be a string')
    if (!Array.isArray(record.successCriteria)) throw new Error('ArchitectAgent: "successCriteria" must be an array')
    if (typeof record.architecturalContext !== 'string') throw new Error('ArchitectAgent: "architecturalContext" must be a string')
    if (typeof record.strategicAdvice !== 'string') throw new Error('ArchitectAgent: "strategicAdvice" must be a string')
    if (!Array.isArray(record.knownGotchas)) throw new Error('ArchitectAgent: "knownGotchas" must be an array')
    if (typeof record.validationLoop !== 'string') throw new Error('ArchitectAgent: "validationLoop" must be a string')
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

  throw new Error(`ArchitectAgent: could not extract JSON from response: ${trimmed.slice(0, 200)}`)
}
