/**
 * Phase 1 — Pattern Appraisal
 *
 * Asks the Think LLM session whether the incoming signal matches a known
 * Factory-addressable pattern for the vertical.
 *
 * Active skills: bundled:factory-authoring-core + bundled:{vertical}-signal-pattern-library
 * Returns { matches: boolean; reason: string }
 */

import type { CommissioningSignal, PatternAppraisalResult } from '../schemas.js'

export async function runPatternAppraisal(
  generate: (prompt: string) => Promise<{ text: string }>,
  signal: CommissioningSignal,
): Promise<PatternAppraisalResult> {
  const prompt = [
    `You are performing pattern appraisal for the following commissioning signal.`,
    ``,
    `Vertical: ${signal.domainProfile.vertical}`,
    `Org context: ${signal.domainProfile.orgContext}`,
    `Disposition event: ${signal.dispositionEventId}`,
    `Elucidation artifact: ${signal.elucidationArtifactId}`,
    ``,
    `Determine whether this signal matches a known Factory-addressable pattern for`,
    `the ${signal.domainProfile.vertical} vertical.`,
    ``,
    `Respond with JSON only:`,
    `{ "matches": boolean, "reason": "...", "patternId": "P{N} or null" }`,
  ].join('\n')

  const result = await generate(prompt)

  // Parse the LLM response — best-effort JSON extraction
  let parsed: PatternAppraisalResult = { matches: false, reason: 'parse-failed' }
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const raw = JSON.parse(jsonMatch[0]) as {
        matches?: boolean
        reason?: string
        patternId?: string | null
      }
      const p: PatternAppraisalResult = {
        matches: raw.matches === true,
        reason: typeof raw.reason === 'string' ? raw.reason : 'no reason given',
      }
      if (typeof raw.patternId === 'string') {
        p.patternId = raw.patternId
      }
      parsed = p
    }
  } catch {
    // Return default no-match — safe fallback
  }

  return parsed
}
