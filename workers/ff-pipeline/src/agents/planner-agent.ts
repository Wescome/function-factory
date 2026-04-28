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
import { buildArangoTool } from './architect-agent'
import { resolveAgentModel } from './resolve-model'
import type { Plan } from '../coordinator/state'
import { createWorkersAIStreamFn, type AIBinding } from './workers-ai-stream'
import { processAgentOutput, PLAN_SCHEMA } from './output-reliability'

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
  /** Workers AI binding — when present, uses CF binding instead of HTTP */
  ai?: AIBinding
  /** ADR-008: Hot-reloadable alias overrides for Plan schema */
  aliasOverrides?: Record<string, string[]>
}

const SYSTEM_PROMPT = `You are the Planner agent in the Function Factory synthesis pipeline.

Your job: produce a Plan that decomposes a WorkGraph specification into concrete implementation steps for the Coder agent.

You have the arango_query tool. USE IT to ground your plan in real Factory context:

1. Query existing functions to understand what already exists:
   FOR f IN specs_functions LIMIT 10 RETURN { key: f._key, name: f.name, domain: f.domain }

2. Query invariants that must be preserved:
   FOR i IN specs_invariants LIMIT 10 RETURN { key: i._key, description: i.description }

3. Query dependencies between functions:
   FOR e IN specs_dependencies LIMIT 10 RETURN { from: e._from, to: e._to, type: e.type }

4. Query architectural decisions for context:
   FOR d IN memory_semantic FILTER d.type == 'decision' RETURN { key: d._key, decision: d.decision }

Make at least one tool call before producing your plan. Do not hallucinate context about existing code.

Your plan guides the Coder. Be specific about:
- Which atoms to implement first (dependency order)
- Implementation approach for each atom
- Which executor is appropriate (gdk-agent for in-process V8, sandbox for filesystem/bash/git, container-openhands for browser automation)
- Estimated complexity

When ready, respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "approach": "High-level strategy description",
  "atoms": [
    { "id": "atom-id", "description": "What to implement and how", "assignedTo": "coder" }
  ],
  "executorRecommendation": "gdk-agent | sandbox | container-openhands",
  "estimatedComplexity": "low | medium | high"
}`

// Required fields now defined in PLAN_SCHEMA (output-reliability.ts)


export class PlannerAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride?: Model<any>
  private ai?: AIBinding
  private aliasOverrides?: Record<string, string[]>

  constructor(opts: PlannerAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
    this.ai = opts.ai
    this.aliasOverrides = opts.aliasOverrides
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

    const tools: AgentTool[] = [buildArangoTool(this.db)]
    const model = this.modelOverride ?? resolveAgentModel('planner', this.apiKey)

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

    const userMessage: UserMessage = {
      role: 'user',
      content: userParts.join('\n'),
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
      throw new Error('PlannerAgent: no assistant response from agent loop')
    }

    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`PlannerAgent: agent loop failed: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const textBlock = lastAssistant.content.find(c => c.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('PlannerAgent: final response has no text content')
    }

    const result = await processAgentOutput(textBlock.text, PLAN_SCHEMA, {
      aliasOverrides: this.aliasOverrides,
    })
    if (!result.success) {
      throw new Error(`PlannerAgent: ${result.failureMode}: could not produce valid Plan`)
    }
    return result.data!
  }
}
