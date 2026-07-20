/**
 * @factory/architect-agent — D3: Vertical Slice Policy
 *
 * Manages VsliceConfig: atomRetryIsolation, maxAtomRetries, parallelSliceThreshold,
 * dagDispatchEnabled. Policy updates triggered by anomaly patterns detected in D3.
 *
 * No external DB calls. Reads anomaly patterns from local anomaly_records table.
 * Cross-repo execution trace queries go to ArtifactGraphDO.
 * Broadcasts updated policy to all registered CommissioningAgentDOs.
 */

import type { VsliceConfig, VsliceConfigRow, RepoRow } from '../types.js'
import { writeGovernanceArtifact } from '../artifact-graph.js'

const VSLICE_CONFIG_PREFIX = 'VSLICE-CONFIG-'

function generateVsliceConfigId(): string {
  return `${VSLICE_CONFIG_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export function rowToVsliceConfig(row: VsliceConfigRow): VsliceConfig {
  return {
    configId: row.config_id,
    atomRetryIsolation: row.atom_retry_isolation === 1,
    maxAtomRetries: row.max_atom_retries,
    parallelSliceThreshold: row.parallel_slice_threshold,
    dagDispatchEnabled: row.dag_dispatch_enabled === 1,
    triggerReason: row.trigger_reason,
    effectiveFrom: row.effective_from,
  }
}

export function getActiveVsliceConfig(sql: SqlStorage): VsliceConfig | null {
  const rows = [...sql.exec(
    'SELECT * FROM vslice_configs WHERE superseded_at IS NULL ORDER BY effective_from DESC LIMIT 1',
  )] as unknown as VsliceConfigRow[]
  if (rows.length === 0 || !rows[0]) return null
  return rowToVsliceConfig(rows[0])
}

/**
 * Query ArtifactGraphDO for cross-repo execution trace summaries.
 * Falls back to empty array on 404 (endpoint not yet live — GAP-012 open item).
 */
async function queryExecutionTraceSummaries(
  artifactGraph: DurableObjectStub,
  sinceIso: string,
): Promise<Array<{ passId: string; failureCount: number; totalCount: number }>> {
  try {
    const resp = await artifactGraph.fetch(
      new Request(
        `https://artifact-graph/query/execution-traces/summary?since=${encodeURIComponent(sinceIso)}`,
      ),
    )
    if (resp.status === 404) {
      console.warn('[ArchitectAgentDO:D3] execution-traces/summary: 404 (endpoint stub missing)')
      return []
    }
    if (!resp.ok) return []
    return (await resp.json()) as Array<{ passId: string; failureCount: number; totalCount: number }>
  } catch {
    return []
  }
}

export interface D3PolicyUpdateDeps {
  sql: SqlStorage
  artifactGraph: DurableObjectStub
  repos: RepoRow[]
}

/**
 * Evaluate current anomaly records and update VsliceConfig if warranted.
 * Called from alarm() anomaly scan, or manually via POST /vslice-policy-update.
 */
export async function evaluateAndUpdateVslicePolicy(
  triggerReason: string,
  deps: D3PolicyUpdateDeps,
): Promise<VsliceConfig | null> {
  const { sql, artifactGraph, repos } = deps

  // 1. Read unresolved D3 anomalies
  const anomalies = [...sql.exec(
    `SELECT anomaly_class, evidence FROM anomaly_records WHERE domain = 'D3' AND resolved = 0`,
  )] as unknown as Array<{ anomaly_class: string; evidence: string }>

  // 2. Query execution traces for retry rates
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const traces = await queryExecutionTraceSummaries(artifactGraph, oneHourAgo)

  // 3. Compute high-retry rate signal
  const highRetryRate = traces.some(
    (t) => t.totalCount > 0 && t.failureCount / t.totalCount > 0.2,
  )
  const hasDeadlock = anomalies.some((a) => a.anomaly_class === 'DEADLOCK')
  const hasSequentialFailure = anomalies.some((a) => a.anomaly_class === 'SEQUENTIAL_FAILURE')

  // 4. Get current config
  const current = getActiveVsliceConfig(sql)

  // Compute new policy based on signals
  const newPolicy: Omit<VsliceConfig, 'configId' | 'effectiveFrom'> = {
    atomRetryIsolation: hasDeadlock || highRetryRate ? true : (current?.atomRetryIsolation ?? true),
    maxAtomRetries: hasDeadlock
      ? Math.max(1, (current?.maxAtomRetries ?? 3) - 1)
      : (current?.maxAtomRetries ?? 3),
    parallelSliceThreshold: hasSequentialFailure
      ? Math.max(1, (current?.parallelSliceThreshold ?? 5) - 1)
      : (current?.parallelSliceThreshold ?? 5),
    dagDispatchEnabled: current?.dagDispatchEnabled ?? true,
    triggerReason,
  }

  // 5. If policy unchanged, skip
  if (
    current &&
    current.atomRetryIsolation === newPolicy.atomRetryIsolation &&
    current.maxAtomRetries === newPolicy.maxAtomRetries &&
    current.parallelSliceThreshold === newPolicy.parallelSliceThreshold &&
    current.dagDispatchEnabled === newPolicy.dagDispatchEnabled
  ) {
    return null // No change
  }

  const configId = generateVsliceConfigId()
  const now = new Date().toISOString()

  // 6. Retire current config
  sql.exec(
    `UPDATE vslice_configs SET superseded_at = ? WHERE superseded_at IS NULL`,
    now,
  )

  // 7. Insert new config
  sql.exec(
    `INSERT INTO vslice_configs
       (config_id, atom_retry_isolation, max_atom_retries, parallel_slice_threshold,
        dag_dispatch_enabled, trigger_reason, effective_from)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    configId,
    newPolicy.atomRetryIsolation ? 1 : 0,
    newPolicy.maxAtomRetries,
    newPolicy.parallelSliceThreshold,
    newPolicy.dagDispatchEnabled ? 1 : 0,
    triggerReason,
    now,
  )

  // 8. Update factory_state
  sql.exec(
    `UPDATE factory_state SET active_vslice_cfg = ?, updated_at = ? WHERE factory_id = 'factory'`,
    configId,
    now,
  )

  const newConfig: VsliceConfig = { ...newPolicy, configId, effectiveFrom: now }

  // 9. Write VSLICE-CONFIG governance artifact
  void writeGovernanceArtifact(artifactGraph, {
    type: 'VSLICE-CONFIG',
    id: configId,
    domain: 'D3',
    source: 'architect-agent',
    explicitness: 'stated',
    payload: { ...newConfig },
  })

  // 10. Broadcast to all CommissioningAgentDOs
  void broadcastVslicePolicy(newConfig, repos)

  return newConfig
}

async function broadcastVslicePolicy(
  config: VsliceConfig,
  repos: RepoRow[],
): Promise<void> {
  const results = await Promise.allSettled(
    repos.map((repo) =>
      fetch(`${repo.commissioning_agent_url}/pipeline-config-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vsliceConfig: config, updatedAt: new Date().toISOString() }),
      }),
    ),
  )

  const failures = results.filter((r) => r.status === 'rejected').length
  if (failures > 0) {
    console.warn(
      `[ArchitectAgentDO:D3] broadcastVslicePolicy: ${failures}/${repos.length} repos failed`,
    )
  }
}
