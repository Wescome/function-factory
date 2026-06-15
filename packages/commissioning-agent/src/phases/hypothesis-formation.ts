/**
 * Phase 4 — Hypothesis Formation
 *
 * Calls LoopClosureService.buildHypothesis() with the divergence evidence.
 * Attributes fault. Claude Opus required as authorModelId (CA-INV-003 —
 * ResourceBudgetBead allowlist enforced).
 *
 * Active skills: bundled:factory-authoring-core + bundled:{vertical}-fault-attribution
 */

import type { DivergenceNotification, HypothesisNode } from '../schemas.js'

/** The author model for hypothesis formation — Claude Opus (CA-INV-003). */
const HYPOTHESIS_AUTHOR_MODEL = 'anthropic/claude-opus-4-5'

export async function runHypothesisFormation(
  generate: (prompt: string) => Promise<{ text: string }>,
  divergence: DivergenceNotification,
  orgId: string,
  vertical: string,
): Promise<HypothesisNode | null> {
  const prompt = [
    `You are performing hypothesis formation for a Divergence notification.`,
    ``,
    `Org: ${orgId}`,
    `Vertical: ${vertical}`,
    `Divergence ID: ${divergence.divergenceId}`,
    `Specification ID: ${divergence.specificationId}`,
    `Run ID: ${divergence.runId}`,
    ``,
    `Attribute the fault to ONE of:`,
    `  - SPECIFICATION_GAP: the WorkGraph did not capture a required behaviour`,
    `  - TOOLING_FAILURE: a permitted tool produced incorrect output`,
    `  - INVARIANT_MISMATCH: the atom's INV-* binding does not match the actual execution constraint`,
    `  - ENVIRONMENTAL: external dependency failure outside Factory scope`,
    ``,
    `Every Hypothesis must state:`,
    `  1. fault category (one of the four above)`,
    `  2. evidence chain from Divergence trace`,
    `  3. proposed scope of amendment`,
    ``,
    `Respond with JSON only:`,
    `{`,
    `  "id": "HYP-{nanoid}",`,
    `  "faultAttribution": "SPECIFICATION_GAP|TOOLING_FAILURE|INVARIANT_MISMATCH|ENVIRONMENTAL",`,
    `  "explanation": "...",`,
    `  "evidenceChain": "...",`,
    `  "amendmentScope": "...",`,
    `  "severity": "advisory|blocking"`,
    `}`,
  ].join('\n')

  const result = await generate(prompt)

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const raw = JSON.parse(jsonMatch[0]) as Partial<HypothesisNode>
      if (
        typeof raw.faultAttribution === 'string' &&
        typeof raw.explanation === 'string'
      ) {
        const hyp: HypothesisNode = {
          id: typeof raw.id === 'string' ? raw.id : `HYP-${crypto.randomUUID().slice(0, 8)}`,
          divergenceId: divergence.divergenceId,
          specificationId: divergence.specificationId,
          runId: divergence.runId,
          faultAttribution: raw.faultAttribution as HypothesisNode['faultAttribution'],
          explanation: raw.explanation,
          evidenceChain: typeof raw.evidenceChain === 'string' ? raw.evidenceChain : '',
          amendmentScope: typeof raw.amendmentScope === 'string' ? raw.amendmentScope : '',
          authorModelId: HYPOTHESIS_AUTHOR_MODEL,
          severity: raw.severity === 'blocking' ? 'blocking' : 'advisory',
          producedAt: new Date().toISOString(),
          surfaced: false,
          surfacedAt: null,
        }
        return hyp
      }
    }
  } catch {
    // Fall through
  }

  return null
}
