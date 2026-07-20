/**
 * ArtifactGraphDataSource — thin HTTP adapter over ArtifactGraphDO.
 *
 * DO key convention: artifact-graph:{repoId}
 * Routes used:
 *   GET /nodes?kind={kind}              — governance node list
 *   GET /query/hypothesis?status={status} — hypothesis filter (existing DO route)
 *
 * Both methods return [] on 404 or any fetch error.
 */

export interface GraphNode {
  id: string
  nodeType: string
  namespace: string
  data: Record<string, unknown>
  created_at: number
  updated_at: number
}

export interface HypothesisRow {
  id: string
  nodeType: string
  namespace: string
  status: string | null
  severity: string | null
  surfaced: boolean | null
  surfacedCycleCount: number | null
  data: Record<string, unknown>
}

export class ArtifactGraphDataSource {
  private readonly ns: DurableObjectNamespace

  constructor(namespace: DurableObjectNamespace) {
    this.ns = namespace
  }

  async getGovernanceNodes(repoId: string, kind?: string): Promise<GraphNode[]> {
    try {
      const stub = this.ns.get(this.ns.idFromName(`artifact-graph:${repoId}`))
      const url = new URL('https://do/nodes')
      if (kind !== undefined && kind !== '') url.searchParams.set('kind', kind)
      const res = await stub.fetch(new Request(url.toString()))
      if (res.status === 404) return []
      if (!res.ok) return []
      const data = await res.json() as unknown
      return Array.isArray(data) ? (data as GraphNode[]) : []
    } catch {
      return []
    }
  }

  async getHypotheses(repoId: string, status?: string): Promise<HypothesisRow[]> {
    try {
      const stub = this.ns.get(this.ns.idFromName(`artifact-graph:${repoId}`))
      const url = new URL('https://do/query/hypothesis')
      if (status !== undefined && status !== '') url.searchParams.set('status', status)
      const res = await stub.fetch(new Request(url.toString()))
      if (res.status === 404) return []
      if (!res.ok) return []
      const data = await res.json() as unknown
      return Array.isArray(data) ? (data as HypothesisRow[]) : []
    } catch {
      return []
    }
  }
}
