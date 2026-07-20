/**
 * Step 3 — map-capability
 *
 * Given a PressureArtifact, invokes the planner agent to identify the system
 * ability needed to address the pressure. Produces a CapabilityArtifact with
 * a schema-validated id, gap analysis, and provenance fields.
 *
 * SPEC-FF-CA-REWRITE-001 §Step 3 — map-capability
 * CA-INV-002: Schema-validated input → schema-validated output.
 * CA-INV-005: LLM call goes through the Agent passed in (buildPlannerAgent).
 */

import type { Agent } from '@mastra/core/agent'
import {
  type PressureArtifact,
  type CapabilityArtifact,
  CapabilityArtifactSchema,
} from '../../schemas.js'
import { WorkflowStepError } from './fetch-elucidation.js'

// ── Step implementation ───────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a Capability Mapper. Given a Pressure, identify the system ability needed. ' +
  'A Capability is what the system must be able to do, not the solution. Respond with JSON only.'

/**
 * Map a PressureArtifact to a CapabilityArtifact.
 *
 * The agent generates raw JSON that is parsed, enriched with a stable id and
 * provenance fields, then validated against CapabilityArtifactSchema. A schema
 * validation failure surfaces as WorkflowStepError('capability-mapping-failed').
 *
 * @param pressure   The upstream PressureArtifact (Step 2 output).
 * @param agent      The Mastra Agent instance from buildPlannerAgent('planner', env).
 * @returns          A fully validated CapabilityArtifact ready for ArtifactGraphDO upsert.
 * @throws WorkflowStepError  When the agent response cannot be parsed or fails schema validation.
 */
export async function mapCapabilityStep(
  pressure: PressureArtifact,
  agent: Agent,
): Promise<CapabilityArtifact> {
  const result = await agent.generate(JSON.stringify(pressure), {
    instructions: SYSTEM_PROMPT,
  })

  const raw: unknown = (() => {
    try {
      return JSON.parse(result.text)
    } catch {
      throw new WorkflowStepError(
        'capability-mapping-failed',
        `Agent response was not valid JSON: ${result.text.slice(0, 200)}`,
      )
    }
  })()

  // Merge LLM output with required provenance fields.
  const candidate = {
    ...(typeof raw === 'object' && raw !== null ? raw : {}),
    id: `BC-${crypto.randomUUID()}`,
    sourcePressureId: pressure.id,
    orgId: pressure.orgId,
    sessionId: pressure.sessionId,
  }

  try {
    return CapabilityArtifactSchema.parse(candidate)
  } catch (err) {
    throw new WorkflowStepError(
      'capability-mapping-failed',
      err instanceof Error ? err.message : String(err),
    )
  }
}
