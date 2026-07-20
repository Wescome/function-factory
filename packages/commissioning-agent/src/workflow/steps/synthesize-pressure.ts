/**
 * Step 2 — synthesize-pressure
 *
 * Given an ElucidationContent and CommissioningSignal, invokes the planner
 * agent to identify the force the signal exerts on the system and produces a
 * fully-validated PressureArtifact.
 *
 * SPEC-FF-CA-REWRITE-001 §Step 2 — synthesize-pressure
 * CA-INV-002: Schema-validated input → schema-validated output.
 * CA-INV-005: LLM call goes through the Agent passed in (buildPlannerAgent).
 */

import type { Agent } from '@mastra/core/agent'
import {
  type CommissioningSignal,
  type PressureArtifact,
  PressureArtifactSchema,
} from '../../schemas.js'
import type { ElucidationContent } from './fetch-elucidation.js'
import { WorkflowStepError } from './fetch-elucidation.js'

// ── Step implementation ───────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a Pressure Synthesizer. Given a signal, identify and name the force it ' +
  'exerts on the system. A Pressure is the interpreted meaning of the signal — what it ' +
  'demands, not the data itself. Respond with JSON only.'

/**
 * Synthesize a PressureArtifact from an elucidation and commissioning signal.
 *
 * The agent receives the elucidation data and signal provenance fields as a
 * JSON user message. LLM output is parsed, enriched with a stable id and
 * required provenance fields, then validated against PressureArtifactSchema.
 *
 * @param elucidation  The ElucidationContent retrieved by step 1.
 * @param signal       The originating CommissioningSignal.
 * @param agent        The Mastra Agent instance from buildPlannerAgent('planner', env).
 * @returns            A fully validated PressureArtifact ready for ArtifactGraphDO upsert.
 * @throws WorkflowStepError  When the agent response cannot be parsed or fails schema validation.
 */
export async function synthesizePressureStep(
  elucidation: ElucidationContent,
  signal: CommissioningSignal,
  agent: Agent,
): Promise<PressureArtifact> {
  const userMessage = JSON.stringify({
    elucidation: elucidation.data,
    dispositionEventId: signal.dispositionEventId,
    orgId: signal.orgId,
  })

  const result = await agent.generate(userMessage, {
    instructions: SYSTEM_PROMPT,
  })

  const rawText: string = typeof result.text === 'string' ? result.text.trim() : ''

  // Strip markdown code fences if the model wrapped the JSON.
  const jsonText = rawText.startsWith('```')
    ? rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    : rawText

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new WorkflowStepError(
      'pressure-synthesis-failed',
      `Agent response was not valid JSON: ${jsonText.slice(0, 200)}`,
    )
  }

  // Extract JSON from result if wrapped in an object with a nested JSON string.
  // Handles models that return { "json": "{...}" } shapes.
  const baseObj: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}

  // Overlay deterministic fields — always correct regardless of LLM output.
  const id = `PRS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  const candidate: Record<string, unknown> = {
    ...baseObj,
    id,
    kind: 'pressure' as const,
    sourceSignalId: signal.dispositionEventId,
    orgId: signal.orgId,
    sessionId: signal.sessionId,
  }

  try {
    return PressureArtifactSchema.parse(candidate)
  } catch (err) {
    throw new WorkflowStepError(
      'pressure-synthesis-failed',
      err instanceof Error ? err.message : String(err),
    )
  }
}
