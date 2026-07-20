/**
 * Step 5 — compile-prd
 *
 * Given a FunctionProposal, runs a structured LLM pass via the Mastra planner
 * agent and produces a fully-validated IntentSpecification.
 *
 * CA-INV-002: schema-validated output
 * CA-INV-005: all LLM calls via agent parameter (buildPlannerAgent)
 * SPEC-FF-CA-REWRITE-001 §Step 5
 */

import { IntentSpecification } from '@factory/schemas'
import type { Agent } from '@mastra/core/agent'
import type { FunctionProposal, CommissioningSignal } from '../../schemas.js'
import { WorkflowStepError } from './fetch-elucidation.js'

// ── compilePrdStep ────────────────────────────────────────────────────────────

/**
 * Compile a FunctionProposal into an IntentSpecification.
 *
 * The agent is given a system prompt that constrains it to PRD-author
 * behaviour. All deterministic fields (id, sourceFunctionId,
 * sourceCapabilityId) are filled in after generation so the LLM cannot
 * produce invalid IDs.
 *
 * @param proposal  Validated FunctionProposal from step 4
 * @param signal    CommissioningSignal for orgId / repoId context
 * @param agent     Mastra PlannerAgent instance (from buildPlannerAgent)
 * @returns         Zod-validated IntentSpecification
 * @throws WorkflowStepError('invalid-intent-specification', ...) on schema failure
 */
export async function compilePrdStep(
  proposal: FunctionProposal,
  signal: CommissioningSignal,
  agent: Agent,
): Promise<IntentSpecification> {
  const systemPrompt =
    'You are a PRD author. Given a FunctionProposal, produce a complete IntentSpecification. ' +
    'Every acceptance criterion must be testable. Respond with JSON only.'

  const userMessage = JSON.stringify({
    proposal,
    repoId: signal.repoId,
    orgId: signal.orgId,
  })

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
      'invalid-intent-specification',
      `LLM response was not valid JSON: ${jsonText.slice(0, 200)}`,
    )
  }

  // Overlay deterministic fields — these are always correct regardless of what
  // the model produced. id uses crypto.randomUUID which is available in both
  // the Cloudflare Workers and Node runtimes.
  const isId = `IS-${crypto.randomUUID().toUpperCase()}`

  const candidate = Object.assign({}, parsed as Record<string, unknown>, {
    id: isId,
    sourceFunctionId: proposal.id,
    sourceCapabilityId: proposal.sourceCapabilityId,
  })

  // Ensure Lineage fields have sensible defaults when the LLM omits them
  if (!Array.isArray((candidate as Record<string, unknown>).source_refs)) {
    (candidate as Record<string, unknown>).source_refs = [proposal.id]
  }
  if (typeof (candidate as Record<string, unknown>).explicitness !== 'string') {
    (candidate as Record<string, unknown>).explicitness = 'inferred'
  }
  if (typeof (candidate as Record<string, unknown>).rationale !== 'string') {
    (candidate as Record<string, unknown>).rationale =
      `Compiled from FunctionProposal ${proposal.id} for org ${signal.orgId}`
  }

  // Validate required fields before parsing so we can surface a clear error
  const requiredFields = [
    'id',
    'version',
    'orgId',
    'repoId',
    'problem',
    'goal',
    'acceptanceCriteria',
    'successMetrics',
    'constraints',
    'outOfScope',
    'sourceFunctionId',
    'sourceCapabilityId',
  ] as const

  const rec = candidate as Record<string, unknown>

  for (const field of requiredFields) {
    const value = rec[field]
    const missing =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && (value as unknown[]).length === 0 && (field === 'acceptanceCriteria' || field === 'successMetrics'))
    if (missing) {
      throw new WorkflowStepError(
        'invalid-intent-specification',
        `Required field missing or empty: ${field}`,
      )
    }
  }

  // Zod parse — throws ZodError (caught by the workflow runner) if shape is wrong
  let specification: IntentSpecification
  try {
    specification = IntentSpecification.parse(candidate)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new WorkflowStepError('invalid-intent-specification', message)
  }

  return specification
}
