/**
 * Phase 5 — Amendment Proposal
 *
 * Calls LoopClosureService.proposeAmendment(). Proposes a targeted WorkGraph
 * amendment grounded in the Hypothesis fault attribution.
 * Amendment.status = CANDIDATE until Mastra eval T4 Verdict.
 *
 * Active skills: bundled:factory-authoring-core + workspace:prd-authoring
 */

import type { HypothesisNode, Amendment } from '../schemas.js'

export async function runAmendmentProposal(
  generate: (prompt: string) => Promise<{ text: string }>,
  hypothesis: HypothesisNode,
  orgId: string,
): Promise<Amendment | null> {
  const prompt = [
    `You are proposing a WorkGraph amendment based on a Hypothesis.`,
    ``,
    `Org: ${orgId}`,
    `Hypothesis ID: ${hypothesis.id}`,
    `Fault attribution: ${hypothesis.faultAttribution}`,
    `Explanation: ${hypothesis.explanation}`,
    `Evidence chain: ${hypothesis.evidenceChain}`,
    `Amendment scope: ${hypothesis.amendmentScope}`,
    ``,
    `Propose a targeted, minimal amendment to the WorkGraph that addresses the`,
    `attributed fault. The amendment must be grounded in the Hypothesis fault`,
    `attribution — do not propose changes outside the stated amendment scope.`,
    ``,
    `Amendment status is CANDIDATE — it will be evaluated by the Mastra eval workflow.`,
    ``,
    `Respond with JSON only:`,
    `{`,
    `  "id": "AMD-{nanoid}",`,
    `  "hypothesisId": "${hypothesis.id}",`,
    `  "workGraphId": null,`,
    `  "proposedChange": {`,
    `    "type": "...",`,
    `    "target": "...",`,
    `    "description": "..."`,
    `  },`,
    `  "status": "CANDIDATE",`,
    `  "producedAt": "..."`,
    `}`,
  ].join('\n')

  const result = await generate(prompt)

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const raw = JSON.parse(jsonMatch[0]) as Partial<Amendment>
      if (typeof raw.proposedChange !== 'undefined') {
        const amendment: Amendment = {
          id: typeof raw.id === 'string' ? raw.id : `AMD-${crypto.randomUUID().slice(0, 8)}`,
          hypothesisId: hypothesis.id,
          workGraphId: typeof raw.workGraphId === 'string' ? raw.workGraphId : null,
          proposedChange: raw.proposedChange,
          status: 'CANDIDATE',
          producedAt: new Date().toISOString(),
        }
        return amendment
      }
    }
  } catch {
    // Fall through
  }

  return null
}
