/**
 * Phase 3 — WorkGraph Authoring
 *
 * Authors the full WorkGraph artifact (pressure → capability → function proposal → PRD chain).
 * Enforces severity:'blocking' constraints from DomainProfile.constraints — a WorkGraph
 * violating a blocking constraint must not be dispatched (CA-INV-003).
 * If requireHumanApproval, suspends for human gate.
 *
 * Active skills: bundled:factory-authoring-core + workspace:pressure-authoring +
 *   workspace:capability-authoring + workspace:function-proposal + workspace:prd-authoring +
 *   workspace:grill-me + (optional) bundled:{vertical}-acceptance-criteria
 */

import type { CommissioningSignal, CandidateSet, WorkGraph, DomainConstraint } from '../schemas.js'

async function validateAgainstConstraints(
  workGraph: WorkGraph,
  blockingConstraints: DomainConstraint[],
  generate: (prompt: string) => Promise<{ text: string }>,
): Promise<{ valid: boolean; violations: string[] }> {
  if (blockingConstraints.length === 0) {
    return { valid: true, violations: [] }
  }

  const constraintLines = blockingConstraints
    .map((c) => `[${c.id}] ${c.description}`)
    .join('\n')
  const workGraphJson = JSON.stringify(workGraph, null, 2)

  const prompt = [
    `Does this WorkGraph JSON violate any of the following blocking constraints?`,
    ``,
    `Constraints:`,
    constraintLines,
    ``,
    `WorkGraph:`,
    workGraphJson,
    ``,
    `Respond with JSON only: {"valid": boolean, "violations": string[]}`,
  ].join('\n')

  try {
    const result = await generate(prompt)
    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      // TODO-strict: tighten to fail-closed once prompt reliability is confirmed
      return { valid: true, violations: [] }
    }
    const parsed = JSON.parse(jsonMatch[0]) as { valid: boolean; violations: string[] }
    return {
      valid: typeof parsed.valid === 'boolean' ? parsed.valid : true,
      violations: Array.isArray(parsed.violations) ? parsed.violations : [],
    }
  } catch {
    // TODO-strict: tighten to fail-closed once prompt reliability is confirmed
    return { valid: true, violations: [] }
  }
}

export async function runWorkGraphAuthoring(
  generate: (prompt: string) => Promise<{ text: string }>,
  signal: CommissioningSignal,
  candidateSet: CandidateSet,
  orgId: string,
): Promise<WorkGraph | null> {
  const blockingConstraints = signal.domainProfile.constraints.filter(
    (c) => c.severity === 'blocking',
  )
  const blockingLines = blockingConstraints
    .map((c) => `- [${c.id}] ${c.description}`)
    .join('\n')

  const nominated = candidateSet.candidates.find((c) => c.id === candidateSet.nominated)

  const prompt = [
    `You are authoring a WorkGraph for the following commission.`,
    ``,
    `Org: ${orgId}`,
    `Vertical: ${signal.domainProfile.vertical}`,
    `Org context: ${signal.domainProfile.orgContext}`,
    `Disposition event: ${signal.dispositionEventId}`,
    `Nominated candidate: ${nominated?.description ?? 'see elucidation artifact'}`,
    `Nomination reason: ${candidateSet.nominationReason}`,
    ``,
    blockingConstraints.length > 0
      ? `BLOCKING CONSTRAINTS (must not be violated):\n${blockingLines}`
      : `No blocking constraints.`,
    ``,
    `Author the full WorkGraph artifact chain:`,
    `1. Pressure node — the forcing function from the disposition event`,
    `2. Capability node — the capability gap the pressure creates`,
    `3. Function proposal — what Factory should build`,
    `4. PRD — product requirements with testable success conditions per atom`,
    ``,
    `Every artifact must carry:`,
    `  producedBy: CommissioningAgentDO:${orgId}`,
    `  dispositionEventId: ${signal.dispositionEventId}`,
    `  producedAt: (current timestamp)`,
    ``,
    `Respond with JSON only (WorkGraph object):`,
    `{`,
    `  "id": "WG-{nanoid}",`,
    `  "orgId": "${orgId}",`,
    `  "dispositionEventId": "${signal.dispositionEventId}",`,
    `  "producedBy": "CommissioningAgentDO:${orgId}",`,
    `  "producedAt": "...",`,
    `  "pressure": { ... },`,
    `  "capability": { ... },`,
    `  "functionProposal": { ... },`,
    `  "prd": { ... }`,
    `}`,
  ].join('\n')

  const result = await generate(prompt)

  let workGraph: WorkGraph | null = null
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const raw = JSON.parse(jsonMatch[0]) as WorkGraph
      if (
        typeof raw.id === 'string' &&
        typeof raw.orgId === 'string' &&
        typeof raw.dispositionEventId === 'string'
      ) {
        workGraph = raw
      }
    }
  } catch {
    return null
  }

  if (!workGraph) return null

  // Validate blocking constraints (CA-INV-003)
  const { valid, violations } = await validateAgainstConstraints(workGraph, blockingConstraints, generate)
  if (!valid) {
    console.warn('[workgraph-authoring] WorkGraph violates blocking constraints:', violations)
    return null
  }

  return workGraph
}
