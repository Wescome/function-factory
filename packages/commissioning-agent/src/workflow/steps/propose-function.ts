/**
 * Step 4 — propose-function
 *
 * Given a CapabilityArtifact, runs a structured LLM pass via the Mastra
 * planner agent and produces a fully-validated FunctionProposal.
 *
 * CA-INV-002: schema-validated output
 * CA-INV-005: all LLM calls via agent parameter (buildPlannerAgent)
 * SPEC-FF-CA-REWRITE-001 §Step 4
 */

import type { Agent } from '@mastra/core/agent'
import {
  type CapabilityArtifact,
  type FunctionProposal,
  FunctionProposalSchema,
} from '../../schemas.js'
import { WorkflowStepError } from './fetch-elucidation.js'

// ── proposeFunctionStep ───────────────────────────────────────────────────────

/**
 * Propose one concrete Factory function that delivers a given Capability.
 *
 * Deterministic fields (id, sourceCapabilityId, orgId, sessionId) are
 * overlaid after generation so the LLM cannot produce invalid IDs.
 * The gate `successCriteria.length === 0` is checked explicitly before the
 * Zod parse so the error code is unambiguous.
 *
 * @param capability  Validated CapabilityArtifact from step 3
 * @param agent       Mastra PlannerAgent instance (from buildPlannerAgent)
 * @returns           Zod-validated FunctionProposal
 * @throws WorkflowStepError('no-success-criteria', ...) when the list is empty
 * @throws WorkflowStepError('invalid-function-proposal', ...) on schema failure
 */
export async function proposeFunctionStep(
  capability: CapabilityArtifact,
  agent: Agent,
): Promise<FunctionProposal> {
  const systemPrompt =
    'You are a Function Proposer. Given a Capability, propose one concrete Factory function ' +
    'that delivers it. Include testable success criteria. Respond with JSON only.'

  const userMessage = JSON.stringify(capability)

  const result = await agent.generate(
    [{ role: 'user' as const, content: userMessage }],
    { instructions: systemPrompt },
  )

  const rawText: string = typeof result.text === 'string' ? result.text.trim() : ''

  // Strip markdown code fences if the model wrapped the JSON
  const jsonText = rawText.startsWith('```')
    ? rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    : rawText

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new WorkflowStepError(
      'invalid-function-proposal',
      `LLM response was not valid JSON: ${jsonText.slice(0, 200)}`,
    )
  }

  // Overlay deterministic fields — always correct regardless of LLM output
  const fpId = `FP-${crypto.randomUUID().toUpperCase()}`

  const candidate = Object.assign({}, parsed as Record<string, unknown>, {
    id: fpId,
    kind: 'function-proposal' as const,
    sourceCapabilityId: capability.id,
    orgId: capability.orgId,
    sessionId: capability.sessionId,
  })

  const rec = candidate as Record<string, unknown>

  // Explicit gate — surface as a named error before Zod runs
  const criteria = rec['successCriteria']
  if (!Array.isArray(criteria) || (criteria as unknown[]).length === 0) {
    throw new WorkflowStepError(
      'no-success-criteria',
      `FunctionProposal for capability ${capability.id} must include at least one success criterion`,
    )
  }

  // Zod parse — throws ZodError (caught by workflow runner) if shape is wrong
  let proposal: FunctionProposal
  try {
    proposal = FunctionProposalSchema.parse(candidate)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new WorkflowStepError('invalid-function-proposal', message)
  }

  return proposal
}
