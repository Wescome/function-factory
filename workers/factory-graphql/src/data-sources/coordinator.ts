/**
 * CoordinatorDataSource — thin HTTP adapter over CoordinatorDO.
 *
 * DO key convention: coordinator:{runId}
 * Routes used: GET /beads, GET /amendments
 *
 * Both methods return [] on 404 or any fetch error — CoordinatorDO may not
 * yet be seeded for a run that has just been submitted.
 */

export interface BeadRow {
  id: string
  molecule_id: string
  gear_id: string
  node_id: string
  status: 'ready' | 'in_progress' | 'done' | 'failed'
  assigned_to: string | null
  attempt_count: number
  payload: string | null
  result: string | null
  created_at: number | null
  updated_at: number | null
}

export interface AmendmentRow {
  id: string
  bead_id: string
  target_bead_id: string
  target_type: string
  proposed_change: string   // JSON string
  rationale: string
  triggered_by: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED'
  reviewed_by: string | null
  reviewed_at: string | null
  artifact_graph_amendment_id: string | null
}

export class CoordinatorDataSource {
  private readonly ns: DurableObjectNamespace

  constructor(namespace: DurableObjectNamespace) {
    this.ns = namespace
  }

  async getBeads(runId: string): Promise<BeadRow[]> {
    try {
      const stub = this.ns.get(this.ns.idFromName(`coordinator:${runId}`))
      const res = await stub.fetch(new Request('https://do/beads'))
      if (res.status === 404) return []
      if (!res.ok) return []
      const data = await res.json() as unknown
      return Array.isArray(data) ? (data as BeadRow[]) : []
    } catch {
      return []
    }
  }

  async getAmendments(runId: string): Promise<AmendmentRow[]> {
    try {
      const stub = this.ns.get(this.ns.idFromName(`coordinator:${runId}`))
      const res = await stub.fetch(new Request('https://do/amendments'))
      if (res.status === 404) return []
      if (!res.ok) return []
      const data = await res.json() as unknown
      return Array.isArray(data) ? (data as AmendmentRow[]) : []
    } catch {
      return []
    }
  }
}
