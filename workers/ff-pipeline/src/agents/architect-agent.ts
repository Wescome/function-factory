/**
 * ArchitectAgent — produces BriefingScripts from WorkGraph specifications.
 *
 * Context is pre-fetched from ArangoDB and injected into the user message
 * (see context-prefetch.ts). No tool calls — single-turn LLM invocation.
 *
 * buildArangoTool is still exported for use by AtomExecutor and other
 * consumers that need direct AQL access.
 */

import { agentLoop } from '@weops/gdk-agent'
import type { AgentTool } from '@weops/gdk-agent'
import { Type, type Model, type AssistantMessage, type Message, type UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import { resolveAgentModel } from './resolve-model'
import { processAgentOutput, extractAssistantText, buildTelemetryEntry, BRIEFING_SCRIPT_SCHEMA } from './output-reliability'

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
  /** ADR-008: Hot-reloadable alias overrides for BriefingScript schema */
  aliasOverrides?: Record<string, string[]>
  /** Pre-fetched Factory knowledge graph context (injected into user message) */
  contextPrompt?: string
}

const SYSTEM_PROMPT = `You are the Architect agent. You produce BriefingScripts.

A BriefingScript is a JSON object with exactly 6 fields. Here is an example:

{"goal":"Implement user authentication","successCriteria":["Login endpoint returns JWT","Refresh token works"],"architecturalContext":"Uses existing Express middleware","strategicAdvice":"Start with the JWT library, then add routes","knownGotchas":["Token expiry edge case"],"validationLoop":"Run auth integration tests"}

Produce a BriefingScript for the WorkGraph. Maximum 100 words total. One short sentence per field.`

// Required fields now defined in BRIEFING_SCRIPT_SCHEMA (output-reliability.ts)


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
  private aliasOverrides?: Record<string, string[]>
  private contextPrompt?: string

  constructor(opts: ArchitectAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.aliasOverrides = opts.aliasOverrides
    this.contextPrompt = opts.contextPrompt
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

    const userParts: string[] = [`WorkGraph specification:\n${JSON.stringify(input.signal, null, 2)}`]
    if (input.specContent) {
      userParts.push(`\nOriginal specification content:\n${input.specContent}`)
    }
    if (this.contextPrompt) {
      userParts.push(`\n${this.contextPrompt}`)
    }
    userParts.push(`\nProduce a BriefingScript for this WorkGraph.`)

    const userContent = userParts.join('\n')

    const model = this.modelOverride ?? resolveAgentModel('planning')

    const stream = agentLoop(
      [{ role: 'user', content: userContent, timestamp: Date.now() } as UserMessage],
      { systemPrompt: SYSTEM_PROMPT, messages: [] },
      {
        model,
        convertToLlm: (msgs) => msgs as Message[],
        getApiKey: async () => this.apiKey,
        maxTokens: 8192,
        onPayload: (payload: unknown) => ({
          ...(payload as Record<string, unknown>),
          response_format: { type: 'json_object' },
        }),
      },
      AbortSignal.timeout(600_000),
    )
    const messages = await stream.result()
    const lastAssistant = [...messages].reverse().find((m): m is AssistantMessage => m.role === 'assistant')
    if (!lastAssistant) throw new Error('ArchitectAgent: no assistant response')
    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`ArchitectAgent: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }
    const rawText = extractAssistantText(lastAssistant.content as any)
    if (!rawText) {
      const blockTypes = lastAssistant.content.map(c => c.type).join(',')
      throw new Error(`ArchitectAgent: empty response (blocks: ${blockTypes || 'none'}, stopReason: ${lastAssistant.stopReason})`)
    }

    const result = await processAgentOutput(rawText, BRIEFING_SCRIPT_SCHEMA, {
      aliasOverrides: this.aliasOverrides,
    })

    // ORL telemetry — fire-and-forget, never blocks agent response
    try {
      const telemetry = buildTelemetryEntry(result, 'BriefingScript')
      await this.db.save('orl_telemetry', telemetry).catch(() => {})
    } catch { /* telemetry is best-effort */ }

    if (!result.success) {
      throw new Error(`ArchitectAgent: ${result.failureMode}: could not produce valid BriefingScript. Response: ${result.rawResponse.slice(0, 500)}`)
    }
    return result.data!
  }
}
