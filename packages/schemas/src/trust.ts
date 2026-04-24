/**
 * Trust and invariant health measurement schemas.
 *
 * TrustComposite is the 5-dimensional trust score with weighted
 * composite (30/25/20/15/10). InvariantHealth tracks per-invariant
 * health for the assurance layer.
 */

import { z } from "zod"
import { ArtifactId } from "./lineage.js"

// ─── TrustComposite ─────────────────────────────────────────────────

export const TrustComposite = z.object({
  correctness: z.number().min(0).max(1),
  compliance: z.number().min(0).max(1),
  observability: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  user_response: z.number().min(0).max(1),
  composite: z.number().min(0).max(1),
  computed_at: z.string().datetime(),
})
export type TrustComposite = z.infer<typeof TrustComposite>

// ─── InvariantHealth ────────────────────────────────────────────────

export const RegressionPolicyStatus = z.enum(["watch", "degraded", "regressed", "healthy"])
export type RegressionPolicyStatus = z.infer<typeof RegressionPolicyStatus>

export const InvariantHealth = z.object({
  invariant_id: ArtifactId,
  health: z.number().min(0).max(1),
  direct_violations: z.number().int().nonnegative(),
  warning_signals: z.number().int().nonnegative(),
  detector_freshness: z.number().min(0).max(1),
  regression_policy_status: RegressionPolicyStatus,
})
export type InvariantHealth = z.infer<typeof InvariantHealth>
