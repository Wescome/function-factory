import type { GqlContext } from '../context.js'
import type { BeadRow, AmendmentRow } from '../data-sources/coordinator.js'

const Query = {
  beads: (
    _: unknown,
    args: { runId: string },
    ctx: GqlContext,
  ): Promise<BeadRow[]> => {
    return ctx.coordinator.getBeads(args.runId)
  },

  amendments: (
    _: unknown,
    args: { runId: string },
    ctx: GqlContext,
  ): Promise<AmendmentRow[]> => {
    return ctx.coordinator.getAmendments(args.runId)
  },
}

// ── ExecutionBead field resolvers ─────────────────────────────────────────────

const ExecutionBead = {
  id: (row: BeadRow): string => row.id,
  moleculeId: (row: BeadRow): string => row.molecule_id,
  gearId: (row: BeadRow): string => row.gear_id,
  nodeId: (row: BeadRow): string => row.node_id,
  status: (row: BeadRow): string => row.status,
  assignedTo: (row: BeadRow): string | null => row.assigned_to ?? null,
  attemptCount: (row: BeadRow): number => row.attempt_count,

  payload: (row: BeadRow): unknown => {
    if (row.payload === null || row.payload === undefined) return null
    try {
      return JSON.parse(row.payload) as unknown
    } catch {
      return null
    }
  },

  result: (row: BeadRow): unknown => {
    if (row.result === null || row.result === undefined) return null
    try {
      return JSON.parse(row.result) as unknown
    } catch {
      return null
    }
  },

  createdAt: (row: BeadRow): string | null =>
    row.created_at !== null && row.created_at !== undefined
      ? new Date(row.created_at).toISOString()
      : null,

  updatedAt: (row: BeadRow): string | null =>
    row.updated_at !== null && row.updated_at !== undefined
      ? new Date(row.updated_at).toISOString()
      : null,

  // Stub: consent beads are stored in CoordinatorDO's consent_audit table but
  // there is no GET /consent-beads route yet. Returns [] until wired.
  consentBeads: (_row: BeadRow): unknown[] => [],
}

// ── Amendment field resolvers ─────────────────────────────────────────────────

const Amendment = {
  id: (row: AmendmentRow): string => row.id,
  beadId: (row: AmendmentRow): string => row.bead_id,
  targetBeadId: (row: AmendmentRow): string => row.target_bead_id,
  targetType: (row: AmendmentRow): string => row.target_type,
  proposedChange: (row: AmendmentRow): unknown => {
    try {
      return JSON.parse(row.proposed_change) as unknown
    } catch {
      return null
    }
  },
  rationale: (row: AmendmentRow): string => row.rationale,
  triggeredBy: (row: AmendmentRow): string => row.triggered_by,
  status: (row: AmendmentRow): string => row.status,
  reviewedBy: (row: AmendmentRow): string | null => row.reviewed_by ?? null,
  reviewedAt: (row: AmendmentRow): string | null => row.reviewed_at ?? null,
  artifactGraphAmendmentId: (row: AmendmentRow): string | null =>
    row.artifact_graph_amendment_id ?? null,
}

export const beadResolvers = { Query, ExecutionBead, Amendment }
