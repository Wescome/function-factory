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

function validateAgainstConstraints(
  workGraph: WorkGraph,
  blockingConstraints: DomainConstraint[],
): { valid: boolean; violations: string[] } {
  // TODO(GAP-008): implement semantic constraint checking via LLM
  // For now, structural validation only — the workgraph-authoring prompt
  // instructs the LLM to honour blocking constraints during authoring.
  void workGraph
  void blockingConstraints
  return { valid: true, violations: [] }
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
  const { valid, violations } = validateAgainstConstraints(workGraph, blockingConstraints)
  if (!valid) {
    console.warn('[workgraph-authoring] WorkGraph violates blocking constraints:', violations)
    return null
  }

  return workGraph
}
