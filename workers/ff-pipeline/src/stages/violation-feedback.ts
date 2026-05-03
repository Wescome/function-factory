/**
 * Violation feedback builder for remediation loops.
 *
 * When the reconciliation gate returns "remediate", this module
 * builds a structured feedback payload from the violated anchors.
 * The feedback flows through compState (C3: survives Workflow step
 * serialization) and is injected into the next compilation context.
 *
 * Constraints (C2):
 *   - Block-severity anchor claims only
 *   - Max 6 claims
 *   - Max 500 tokens serialized; truncate to first 3 if exceeded
 *
 * Traces to: DESIGN-CRYSTALLIZER-NEXT.md Priority 2
 */

import type { IntentAnchor } from './crystallize-intent'

// ── Types ──────────────────────────────────────────────────────

export interface ViolationFeedback {
  message: string
  violatedClaims: string[]
  instruction: string
}

// ── Constants ──────────────────────────────────────────────────

const MAX_CLAIMS = 6
const MAX_TOKENS = 500
const TRUNCATED_CLAIMS = 3
// Rough estimate: 1 token ~ 4 chars
const CHARS_PER_TOKEN = 4

// ── Builder ────────────────────────────────────────────────────

/**
 * Build violation feedback from violated anchor IDs.
 *
 * Returns undefined when there are no block-severity violations
 * (only block-severity anchors produce feedback -- C2 condition).
 */
export function buildViolationFeedback(
  violatedIds: string[],
  anchors: IntentAnchor[],
): ViolationFeedback | undefined {
  if (violatedIds.length === 0) return undefined

  const anchorMap = new Map(anchors.map(a => [a.id, a]))

  // Filter to block-severity only (C2)
  const blockClaims: string[] = []
  for (const id of violatedIds) {
    const anchor = anchorMap.get(id)
    if (anchor && anchor.severity === 'block') {
      blockClaims.push(anchor.claim)
    }
    if (blockClaims.length >= MAX_CLAIMS) break
  }

  if (blockClaims.length === 0) return undefined

  // Build the feedback
  const feedback: ViolationFeedback = {
    message: 'Your previous decomposition missed key concepts from the signal.',
    violatedClaims: blockClaims,
    instruction:
      'Ensure your atoms explicitly address these concepts in their title, description, or verifies field.',
  }

  // Check serialized token count; truncate to 3 if exceeded (C2)
  const serialized = JSON.stringify(feedback)
  const estimatedTokens = Math.ceil(serialized.length / CHARS_PER_TOKEN)
  if (estimatedTokens > MAX_TOKENS) {
    feedback.violatedClaims = blockClaims.slice(0, TRUNCATED_CLAIMS)
  }

  return feedback
}
