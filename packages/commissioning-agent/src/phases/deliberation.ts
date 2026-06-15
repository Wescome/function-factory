/**
 * Phase 2 — Deliberation
 *
 * Builds a scored CandidateSet from the signal and nominates the best option.
 * Per SPEC-FF-ILAYER-EXEC-001 §1 the CA awaits human approval here via
 * Mastra workflow suspend()/resume() when requireHumanApproval: true.
 *
 * Active skills: bundled:factory-authoring-core + bundled:{vertical}-candidate-evaluation
 */

import type { CommissioningSignal, CandidateSet } from '../schemas.js'

export async function runDeliberation(
  generate: (prompt: string) => Promise<{ text: string }>,
  signal: CommissioningSignal,
): Promise<CandidateSet | null> {
  const blockingConstraints = signal.domainProfile.constraints
    .filter((c) => c.severity === 'blocking')
    .map((c) => `- [${c.id}] ${c.description}`)
    .join('\n')

  const prompt = [
    `You are performing deliberation for the following commissioning signal.`,
    ``,
    `Vertical: ${signal.domainProfile.vertical}`,
    `Org context: ${signal.domainProfile.orgContext}`,
    `Disposition event: ${signal.dispositionEventId}`,
    `Elucidation artifact: ${signal.elucidationArtifactId}`,
    ``,
    blockingConstraints
      ? `Blocking constraints (MUST NOT be violated):\n${blockingConstraints}`
      : `No blocking constraints specified.`,
    ``,
    `Build a scored CandidateSet. Produce 2-4 candidates. Nominate the highest-scoring`,
    `feasible candidate that does not violate any blocking constraint.`,
    ``,
    `Respond with JSON only:`,
    `{`,
    `  "candidates": [{ "id": "CND-1", "description": "...", "score": 8.5, "feasible": true }],`,
    `  "nominated": "CND-1",`,
    `  "nominationReason": "..."`,
    `}`,
  ].join('\n')

  const result = await generate(prompt)

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const raw = JSON.parse(jsonMatch[0]) as CandidateSet
      if (
        Array.isArray(raw.candidates) &&
        typeof raw.nominated === 'string' &&
        typeof raw.nominationReason === 'string'
      ) {
        return raw
      }
    }
  } catch {
    // Fall through to null
  }

  return null
}
