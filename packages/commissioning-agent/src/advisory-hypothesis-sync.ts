/**
 * @factory/commissioning-agent — AdvisoryHypothesisSyncRequest
 *
 * Typed request body for POST {LINEAR_SYNC_URL}/sync/advisory-hypothesis.
 *
 * Implements SPEC-FF-CYCLE-HEALTH-001 §2.2 surfaceAdvisoryHypothesis() body
 * contract. The LinearSyncService uses `surfacedBecause` to determine which
 * Linear issue label and priority to apply.
 *
 * - `cycle-boundary`: surfaced because `cycle.isLastTwoDays === true`
 * - `no-active-cycle`: surfaced because no active cycle was found (null cycle)
 */

import type { HypothesisNode, CycleContext } from './schemas.js'

// ── Request / response types ──────────────────────────────────────────────────

export type SurfacedBecause = 'cycle-boundary' | 'no-active-cycle'

export interface AdvisoryHypothesisSyncRequest {
  orgId: string
  hypothesisNodeId: string
  hypothesisContent: HypothesisNode
  /** cycleContext is null when surfacedBecause === 'no-active-cycle'. */
  cycleContext: CycleContext | null
  surfacedBecause: SurfacedBecause
  surfacedAt: string
}

export interface AdvisoryHypothesisSyncResponse {
  linearIssueId: string
  linearIssueUrl: string
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Build an AdvisoryHypothesisSyncRequest from a HypothesisNode and cycle context.
 *
 * The `surfacedBecause` discriminator is derived from the cycle context:
 * - null cycle → 'no-active-cycle'
 * - active cycle with isLastTwoDays → 'cycle-boundary'
 */
export function buildAdvisoryHypothesisSyncRequest(
  orgId: string,
  hyp: HypothesisNode,
  cycle: CycleContext | null,
): AdvisoryHypothesisSyncRequest {
  const surfacedBecause: SurfacedBecause =
    cycle === null ? 'no-active-cycle' : 'cycle-boundary'

  return {
    orgId,
    hypothesisNodeId: hyp.id,
    hypothesisContent: hyp,
    cycleContext: cycle,
    surfacedBecause,
    surfacedAt: new Date().toISOString(),
  }
}
