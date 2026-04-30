/**
 * PlannerAgent — real agent with tools that produces Plans.
 *
 * Follows the ArchitectAgent pattern: uses gdk-agent agentLoop with
 * arango_query tool to ground planning decisions in real Factory context
 * (existing functions, invariants, dependencies) before producing a plan.
 */

import { agentLoop } from '@weops/gdk-agent'
import type { AgentTool } from '@weops/gdk-agent'
import type { Model, AssistantMessage, Message, UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import { resolveAgentModel } from './resolve-model'
import type { Plan } from '../coordinator/state'
import { processAgentOutput, extractAssistantText, buildTelemetryEntry, PLAN_SCHEMA } from './output-reliability'

export interface PlannerInput {
  workGraph: Record<string, unknown>
  briefingScript: Record<string, unknown>
  specContent?: string
  repairNotes?: string
  previousPlan?: Plan
  resampleReason?: string
  /** v4.1: when present, only plan for these atoms (others are unchanged) */
  failedAtomIds?: string[]
}

export interface PlannerAgentOpts {
  db: ArangoClient
  apiKey: string
  dryRun?: boolean
  /** Override model for testing (e.g. faux provider) */
  model?: Model<any>
  /** ADR-008: Hot-reloadable alias overrides for Plan schema */
  aliasOverrides?: Record<string, string[]>
  /** Pre-fetched Factory knowledge graph context (injected into user message) */
  contextPrompt?: string
}

const SYSTEM_PROMPT = `You are the Planner agent. You produce Plans.

A Plan is a JSON object with exactly 4 fields. Here is an example:

{"approach":"Implement endpoints first, then add middleware","atoms":[{"id":"atom-001","description":"Create route handler","assignedTo":"coder"},{"id":"atom-002","description":"Add middleware","assignedTo":"coder"}],"executorRecommendation":"gdk-agent","estimatedComplexity":"low"}

Produce a Plan for the WorkGraph in the user message. Output ONLY the JSON object.`

// Required fields now defined in PLAN_SCHEMA (output-reliability.ts)


export class PlannerAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>
  private aliasOverrides?: Record<string, string[]>
  private contextPrompt?: string

  constructor(opts: PlannerAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.aliasOverrides = opts.aliasOverrides
    this.contextPrompt = opts.contextPrompt
  }

  async producePlan(input: PlannerInput): Promise<Plan> {
    if (this.dryRun) {
      return {
        approach: 'Dry-run implementation plan',
        atoms: [{ id: 'atom-001', description: 'Stub implementation', assignedTo: 'coder' }],
        executorRecommendation: 'gdk-agent',
        estimatedComplexity: 'low',
      }
    }

    const tools: AgentTool[] = []  // No tools — context is pre-fetched
    const model = this.modelOverride ?? resolveAgentModel('planner')

    const userParts: string[] = [
      `WorkGraph specification:\n${JSON.stringify(input.workGraph, null, 2)}`,
      `\nBriefing from Architect:\n${JSON.stringify(input.briefingScript, null, 2)}`,
    ]

    if (input.specContent) {
      userParts.push(`\nOriginal specification content:\n${input.specContent}`)
    }

    if (input.repairNotes) {
      userParts.push(`\n--- REPAIR CYCLE ---`)
      userParts.push(`Repair notes from Verifier: ${input.repairNotes}`)
      if (input.previousPlan) {
        userParts.push(`Previous plan that needs fixing:\n${JSON.stringify(input.previousPlan, null, 2)}`)
      }
    }

    if (input.resampleReason) {
      userParts.push(`\n--- RESAMPLE ---`)
      userParts.push(`The previous approach failed. Reason: ${input.resampleReason}`)
      userParts.push(`You MUST choose a fundamentally different approach.`)
    }

    if (this.contextPrompt) {
      userParts.push(`\n${this.contextPrompt}`)
    }

    userParts.push('\nProduce a Plan for this WorkGraph.')

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
      throw new Error('PlannerAgent: no assistant response from agent loop')
    }

    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`PlannerAgent: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const rawText = extractAssistantText(lastAssistant.content as any)
    if (!rawText) {
      const blockTypes = lastAssistant.content.map(c => c.type).join(',')
      throw new Error(`PlannerAgent: empty response (blocks: ${blockTypes || 'none'}, stopReason: ${lastAssistant.stopReason})`)
    }

    const result = await processAgentOutput(rawText, PLAN_SCHEMA, {
      aliasOverrides: this.aliasOverrides,
    })

    // ORL telemetry — fire-and-forget, never blocks agent response
    try {
      const telemetry = buildTelemetryEntry(result, 'Plan')
      await this.db.save('orl_telemetry', telemetry).catch(() => {})
    } catch { /* telemetry is best-effort */ }

    if (!result.success) {
      throw new Error(`PlannerAgent: ${result.failureMode}: could not produce valid Plan. Response: ${result.rawResponse.slice(0, 500)}`)
    }
    return result.data!
  }
}
