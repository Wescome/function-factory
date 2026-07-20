/**
 * @factory/architect-agent — D1: Patch Governance
 *
 * Handles POST /patch.
 * Resolves affected repos via ArtifactGraphDO (replaces AQL traversal).
 * Propagates patch to each CommissioningAgentDO via POST /patch-apply.
 * Tracks progress in SQLite patches table.
 * Writes PATCH governance artifact to ArtifactGraphDO for audit lineage.
 */

import type { PatchRequest, PatchResponse, RepoRow } from '../types.js'
import { writeGovernanceArtifact } from '../artifact-graph.js'

const PATCH_ID_PREFIX = 'PATCH-'

function generatePatchId(): string {
  return `${PATCH_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

/**
 * Query ArtifactGraphDO to find repos whose WorkGraphs reference the changed artifact.
 * Falls back to all registered repos on 404 (ArtifactGraphDO query endpoint not yet live).
 */
async function resolveAffectedRepos(
  changedArtifactId: string,
  artifactGraph: DurableObjectStub,
  allRepos: RepoRow[],
): Promise<string[]> {
  try {
    const resp = await artifactGraph.fetch(
      new Request(
        `https://artifact-graph/query/workgraphs?referencesArtifact=${encodeURIComponent(changedArtifactId)}`,
      ),
    )
    if (resp.status === 404) {
      // Query endpoint not yet implemented — fall back to all repos
      console.warn(
        '[ArchitectAgentDO:D1] ArtifactGraphDO /query/workgraphs returned 404; using all repos as fallback',
      )
      return allRepos.map((r) => r.repo_id)
    }
    if (!resp.ok) {
      console.warn(
        `[ArchitectAgentDO:D1] ArtifactGraphDO /query/workgraphs non-OK status ${resp.status}; using all repos`,
      )
      return allRepos.map((r) => r.repo_id)
    }
    const data = (await resp.json()) as { repoIds?: string[] }
    return Array.isArray(data.repoIds) ? data.repoIds : allRepos.map((r) => r.repo_id)
  } catch (err) {
    console.warn('[ArchitectAgentDO:D1] resolveAffectedRepos error:', err)
    return allRepos.map((r) => r.repo_id)
  }
}

export interface D1PatchHandlerDeps {
  sql: SqlStorage
  artifactGraph: DurableObjectStub
  repos: RepoRow[]
  patchPropagationTimeoutMs: number
}

export async function handlePatch(
  req: PatchRequest,
  deps: D1PatchHandlerDeps,
): Promise<PatchResponse> {
  const { sql, artifactGraph, repos, patchPropagationTimeoutMs: _timeout } = deps
  const patchId = generatePatchId()
  const now = new Date().toISOString()

  // 1. Resolve affected repos
  const affectedRepoIds = await resolveAffectedRepos(req.changedArtifactId, artifactGraph, repos)

  // 2. Insert patch record with status='propagating'
  sql.exec(
    `INSERT INTO patches
       (patch_id, trigger, change_description, authorized_by, urgency, status,
        affected_repo_ids, applied_repo_ids, pending_repo_ids, issued_at)
     VALUES (?, ?, ?, ?, ?, 'propagating', ?, '[]', ?, ?)`,
    patchId,
    `artifact-change:${req.changedArtifactId}`,
    req.changeDescription,
    req.authorizedBy,
    req.urgency,
    JSON.stringify(affectedRepoIds),
    JSON.stringify(affectedRepoIds),
    now,
  )

  // 3. Update factory_state last_patch_at
  sql.exec(
    `UPDATE factory_state SET last_patch_at = ?, updated_at = ? WHERE factory_id = 'factory'`,
    now,
    now,
  )

  // 4. Begin propagation (fire-and-forget; alarm monitors completion)
  void propagatePatch(patchId, affectedRepoIds, req, repos, sql, artifactGraph)

  // 5. Write governance artifact to ArtifactGraphDO (audit lineage)
  void writeGovernanceArtifact(artifactGraph, {
    type: 'PATCH',
    id: patchId,
    domain: 'D1',
    source: 'architect-agent',
    explicitness: 'stated',
    payload: {
      changedArtifactId: req.changedArtifactId,
      changeDescription: req.changeDescription,
      authorizedBy: req.authorizedBy,
      urgency: req.urgency,
      affectedRepoIds,
      issuedAt: now,
    },
  })

  return { patchId, affectedRepoCount: affectedRepoIds.length, status: 'propagating' }
}

/**
 * Propagate patch to each affected CommissioningAgentDO in registration order.
 * v1 stub: sequential (DAG-ordered dispatch gated by dagDispatchEnabled flag — GAP-012 open item).
 */
async function propagatePatch(
  patchId: string,
  affectedRepoIds: string[],
  req: PatchRequest,
  repos: RepoRow[],
  sql: SqlStorage,
  artifactGraph: DurableObjectStub,
): Promise<void> {
  const repoMap = new Map(repos.map((r) => [r.repo_id, r]))

  for (const repoId of affectedRepoIds) {
    const repo = repoMap.get(repoId)
    if (!repo) continue

    try {
      const resp = await fetch(`${repo.commissioning_agent_url}/patch-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patchId,
          changedArtifactId: req.changedArtifactId,
          changeDescription: req.changeDescription,
          authorizedBy: req.authorizedBy,
          urgency: req.urgency,
        }),
      })

      if (resp.ok) {
        // Move repoId from pending to applied
        const now = new Date().toISOString()
        const rows = [...sql.exec(
          'SELECT applied_repo_ids, pending_repo_ids FROM patches WHERE patch_id = ?',
          patchId,
        )] as unknown as Array<{ applied_repo_ids: string; pending_repo_ids: string }>
        if (rows.length > 0 && rows[0]) {
          const applied: string[] = JSON.parse(rows[0].applied_repo_ids) as string[]
          const pending: string[] = (JSON.parse(rows[0].pending_repo_ids) as string[]).filter(
            (id) => id !== repoId,
          )
          if (!applied.includes(repoId)) applied.push(repoId)
          sql.exec(
            `UPDATE patches SET applied_repo_ids = ?, pending_repo_ids = ? WHERE patch_id = ?`,
            JSON.stringify(applied),
            JSON.stringify(pending),
            patchId,
          )
        }
      } else {
        console.warn(
          `[ArchitectAgentDO:D1] Patch ${patchId} → repo ${repoId}: CA returned ${resp.status}`,
        )
      }
    } catch (err) {
      console.warn(`[ArchitectAgentDO:D1] Patch ${patchId} → repo ${repoId}: fetch failed:`, err)
    }
  }

  // Finalize patch status
  finalizePatch(patchId, affectedRepoIds, sql)
  void writeGovernanceArtifact(artifactGraph, {
    type: 'PATCH',
    id: `${patchId}-completion`,
    domain: 'D1',
    source: 'architect-agent',
    explicitness: 'stated',
    payload: { patchId, completedAt: new Date().toISOString() },
  })
}

function finalizePatch(patchId: string, affectedRepoIds: string[], sql: SqlStorage): void {
  const now = new Date().toISOString()
  const rows = [...sql.exec('SELECT applied_repo_ids FROM patches WHERE patch_id = ?', patchId)] as unknown as Array<{ applied_repo_ids: string }>

  if (rows.length === 0 || !rows[0]) return
  const applied: string[] = JSON.parse(rows[0].applied_repo_ids) as string[]
  const allApplied = affectedRepoIds.every((id) => applied.includes(id))
  const someApplied = applied.length > 0

  const newStatus = allApplied ? 'complete' : someApplied ? 'partial-failure' : 'partial-failure'

  sql.exec(
    `UPDATE patches SET status = ?, completed_at = ? WHERE patch_id = ?`,
    newStatus,
    now,
    patchId,
  )
}

/**
 * Check for stalled patches (status='propagating' older than timeout).
 * Called from alarm(). Returns anomaly evidence if stalls detected.
 */
export interface PatchStallAnomaly {
  patchId: string
  issuedAt: string
  affectedRepoCount: number
  appliedRepoCount: number
}

export function detectStalledPatches(
  sql: SqlStorage,
  stallThresholdMs: number,
): PatchStallAnomaly[] {
  const cutoff = new Date(Date.now() - stallThresholdMs).toISOString()
  type StallRow = { patch_id: string; issued_at: string; affected_repo_ids: string; applied_repo_ids: string }
  const rows = [...sql.exec(
    `SELECT patch_id, issued_at, affected_repo_ids, applied_repo_ids
     FROM patches
     WHERE status = 'propagating' AND issued_at < ?`,
    cutoff,
  )] as unknown as StallRow[]

  return rows.map((r) => ({
    patchId: r.patch_id,
    issuedAt: r.issued_at,
    affectedRepoCount: (JSON.parse(r.affected_repo_ids) as string[]).length,
    appliedRepoCount: (JSON.parse(r.applied_repo_ids) as string[]).length,
  }))
}
