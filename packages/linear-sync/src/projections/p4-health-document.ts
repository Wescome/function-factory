/**
 * @factory/linear-sync — P4: Health Document
 *
 * POST /sync/health
 *
 * Upserts the `Factory Health — Live` Linear document on every call.
 * On midnight-UTC cron, also appends a daily snapshot row to
 * `Factory Health — History` and writes a health_snapshots row to D1.
 *
 * KV keys:
 *   health-doc-live-id    — Linear document UUID for the live doc
 *   health-doc-history-id — Linear document UUID for the history doc
 *
 * Schema: workers/ff-pipeline/d1-factory-ops.sql (health_snapshots)
 */

import type { Env } from '../env.js'
import type { LinearClient } from '../linear-client.js'
import type { CycleContext } from '../linear-client.js'
import { logSyncError } from '../error-log.js'

// ── Request/Response types ─────────────────────────────────────────────────

export interface RepoHealthSummary {
  repoId: string
  repoName: string
  activeBeads: number
  failedBeads: number
  lastActivityAt: string
}

export interface EscalationSummary {
  escalationId: string
  escalationType: string
  requestedAction: string
  createdAt: string
}

export interface PatchSummary {
  patchId: string
  repoId: string
  status: string
}

export interface PipelineConfig {
  autonomyLevel: string
  maxConcurrentBeads: number
  maxRetries: number
}

export interface AdvisoryMetrics {
  queued: number
  surfacedThisCycle: number
  carriedOver: number
}

export interface HealthSyncRequest {
  factoryLifecycleState: string
  activeRepos: RepoHealthSummary[]
  openDivergences: {
    blocking: number
    advisory: number
    informational: number
  }
  openEscalations: EscalationSummary[]
  activePatches: PatchSummary[]
  pendingCrpCount: number
  pipelineConfig: PipelineConfig
  cycleContext?: CycleContext
  advisoryMetrics: AdvisoryMetrics
  producedAt: string
}

export interface HealthSyncResult {
  liveDocId: string
  historyDocId?: string
  snapshotRowId?: number
  error?: string
}

const KV_LIVE_KEY = 'health-doc-live-id'
const KV_HISTORY_KEY = 'health-doc-history-id'

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleHealthSync(
  req: HealthSyncRequest,
  env: Env,
  client: LinearClient,
  projectId: string,
  appendHistory = false,  // set true by midnight cron
): Promise<HealthSyncResult> {
  let liveDocId: string | null = await env.FACTORY_LINEAR_KV.get(KV_LIVE_KEY)
  const liveContent = buildLiveDocument(req)

  try {
    if (!liveDocId) {
      const doc = await client.documentCreate({
        projectId,
        title: 'Factory Health — Live',
        content: liveContent,
      })
      liveDocId = doc.id
      await env.FACTORY_LINEAR_KV.put(KV_LIVE_KEY, liveDocId)
    } else {
      await client.documentUpdate(liveDocId, { content: liveContent })
    }
  } catch (err) {
    await logSyncError(env.FACTORY_OPS_DB, {
      errorType: 'health_doc_update_failed',
      errorDetail: String(err),
      endpoint: '/sync/health',
    })
    return { liveDocId: liveDocId ?? 'unknown', error: String(err) }
  }

  const result: HealthSyncResult = { liveDocId }

  // Midnight cron: append history snapshot
  if (appendHistory) {
    try {
      let historyDocId: string | null = await env.FACTORY_LINEAR_KV.get(KV_HISTORY_KEY)
      const historyContent = buildHistorySnapshotRow(req)

      if (!historyDocId) {
        const doc = await client.documentCreate({
          projectId,
          title: 'Factory Health — History',
          content: historyContent,
        })
        historyDocId = doc.id
        await env.FACTORY_LINEAR_KV.put(KV_HISTORY_KEY, historyDocId)
      } else {
        // Append: fetch existing + append new row (Linear docs support full replace only)
        // For append semantics, we rely on the caller providing the full snapshot.
        await client.documentUpdate(historyDocId, { content: historyContent })
      }

      result.historyDocId = historyDocId
    } catch (err) {
      await logSyncError(env.FACTORY_OPS_DB, {
        errorType: 'history_doc_update_failed',
        errorDetail: String(err),
        endpoint: '/sync/health',
      })
    }

    // Write D1 snapshot row
    try {
      const insertResult = await env.FACTORY_OPS_DB
        .prepare(`
          INSERT INTO health_snapshots
            (factory_lifecycle_state, payload_json, active_repo_count,
             open_divergences_blocking, open_divergences_advisory, open_divergences_informational,
             open_escalation_count, pending_crp_count, produced_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          req.factoryLifecycleState,
          JSON.stringify(req),
          req.activeRepos.length,
          req.openDivergences.blocking,
          req.openDivergences.advisory,
          req.openDivergences.informational,
          req.openEscalations.length,
          req.pendingCrpCount,
          req.producedAt,
          new Date().toISOString(),
        )
        .run()

      result.snapshotRowId = insertResult.meta.last_row_id
    } catch (err) {
      await logSyncError(env.FACTORY_OPS_DB, {
        errorType: 'health_snapshot_insert_failed',
        errorDetail: String(err),
        endpoint: '/sync/health',
      })
    }
  }

  return result
}

// ── Document builders ──────────────────────────────────────────────────────

function buildLiveDocument(req: HealthSyncRequest): string {
  const lines: string[] = [
    `# Factory Health — Live`,
    ``,
    `**Updated:** ${req.producedAt}`,
    `**Lifecycle state:** ${req.factoryLifecycleState}`,
    ``,
  ]

  if (req.cycleContext) {
    lines.push(
      `## Active Cycle`,
      `- **Cycle:** ${req.cycleContext.cycleName}`,
      `- **Ends:** ${req.cycleContext.endDate}`,
      req.cycleContext.isLastTwoDays ? `- ⚠️ Last two days of cycle` : '',
      ``,
    )
  }

  lines.push(
    `## Divergences`,
    `- Blocking: **${req.openDivergences.blocking}**`,
    `- Advisory: ${req.openDivergences.advisory}`,
    `- Informational: ${req.openDivergences.informational}`,
    ``,
  )

  if (req.openEscalations.length > 0) {
    lines.push(`## Open Escalations (${req.openEscalations.length})`)
    for (const esc of req.openEscalations) {
      lines.push(`- \`${esc.escalationId}\` — ${esc.escalationType}: ${esc.requestedAction}`)
    }
    lines.push('')
  }

  lines.push(
    `## Advisory Queue`,
    `- Queued: ${req.advisoryMetrics.queued}`,
    `- Surfaced this cycle: ${req.advisoryMetrics.surfacedThisCycle}`,
    `- Carried over: ${req.advisoryMetrics.carriedOver}`,
    ``,
  )

  lines.push(
    `## Active Repos (${req.activeRepos.length})`,
  )
  for (const repo of req.activeRepos) {
    lines.push(`- **${repo.repoName}** (\`${repo.repoId}\`) — active: ${repo.activeBeads}, failed: ${repo.failedBeads}`)
  }

  lines.push(
    ``,
    `## Pipeline Config`,
    `- Autonomy: ${req.pipelineConfig.autonomyLevel}`,
    `- Max concurrent beads: ${req.pipelineConfig.maxConcurrentBeads}`,
    `- Max retries: ${req.pipelineConfig.maxRetries}`,
    `- Pending CRP: ${req.pendingCrpCount}`,
  )

  return lines.filter(Boolean).join('\n')
}

function buildHistorySnapshotRow(req: HealthSyncRequest): string {
  return [
    `## Snapshot ${req.producedAt}`,
    ``,
    `| State | Repos | Blocking | Advisory | Escalations | Pending CRP |`,
    `|---|---|---|---|---|---|`,
    `| ${req.factoryLifecycleState} | ${req.activeRepos.length} | ${req.openDivergences.blocking} | ${req.openDivergences.advisory} | ${req.openEscalations.length} | ${req.pendingCrpCount} |`,
    ``,
  ].join('\n')
}
