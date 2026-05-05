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
  avoidanceClaims?: string[]
  avoidanceProbes?: string[]
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

  // Filter to block-severity only (C2), preserving anchor polarity.
  // violation_signal=no means a required concept was absent.
  // violation_signal=yes means a prohibited concept was present.
  const requiredClaims: string[] = []
  const avoidanceClaims: string[] = []
  const avoidanceProbes: string[] = []
  for (const id of violatedIds) {
    const anchor = anchorMap.get(id)
    if (anchor && anchor.severity === 'block') {
      if (anchor.violation_signal === 'yes') {
        avoidanceClaims.push(anchor.claim)
        avoidanceProbes.push(anchor.probe_question)
      } else {
        requiredClaims.push(anchor.claim)
      }
    }
    if (requiredClaims.length + avoidanceClaims.length >= MAX_CLAIMS) break
  }

  if (requiredClaims.length === 0 && avoidanceClaims.length === 0) return undefined

  // Build the feedback
  const feedback: ViolationFeedback = {
    message: 'Your previous decomposition violated block-severity intent anchors.',
    violatedClaims: requiredClaims,
    ...(avoidanceClaims.length > 0 ? { avoidanceClaims, avoidanceProbes } : {}),
    instruction: [
      requiredClaims.length > 0
        ? 'Required claims: explicitly address them in at least one atom title, description, or verifies field.'
        : undefined,
      avoidanceClaims.length > 0
        ? 'Avoidance claims: satisfied by absence; remove atom wording, target files, and planned work that would make the avoidance probe answer yes. Do not merely repeat the avoidance claim.'
        : undefined,
    ].filter(Boolean).join(' '),
  }

  // Check serialized token count; truncate to 3 if exceeded (C2)
  const serialized = JSON.stringify(feedback)
  const estimatedTokens = Math.ceil(serialized.length / CHARS_PER_TOKEN)
  if (estimatedTokens > MAX_TOKENS) {
    feedback.violatedClaims = requiredClaims.slice(0, TRUNCATED_CLAIMS)
    if (feedback.avoidanceClaims) feedback.avoidanceClaims = feedback.avoidanceClaims.slice(0, TRUNCATED_CLAIMS)
    if (feedback.avoidanceProbes) feedback.avoidanceProbes = feedback.avoidanceProbes.slice(0, TRUNCATED_CLAIMS)
  }

  return feedback
}
