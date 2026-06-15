/**
 * @factory/linear-sync — P3: Divergence Projection
 *
 * POST /sync/divergences
 *
 * Creates a child Linear issue for a divergence, linked to the parent atom issue.
 * Subsequent lifecycle updates (hypothesis, amendment, resolution) are delivered
 * via dedicated endpoints (/sync/hypothesis, /sync/divergence-closed).
 */

import type { Env } from '../env.js'
import type { LinearClient } from '../linear-client.js'
import { getBinding, upsertBinding } from '../binding-store.js'
import { logSyncError } from '../error-log.js'

// ── Request/Response types ─────────────────────────────────────────────────

export type DivergenceSeverity = 'blocking' | 'advisory' | 'informational'

export interface DivergenceEvidence {
  rawOutputFragment: string
  traceNodeId: string  // ExecutionTrace node ID in ArtifactGraphDO
}

export interface DivergenceSyncRequest {
  repoId: string
  workGraphVersion: string
  divergenceId: string   // DIV-*
  atomId: string
  detectorId: string     // INV-*
  severity: DivergenceSeverity
  evidence: DivergenceEvidence
  elucidationArtifactId?: string
}

export interface DivergenceSyncResult {
  divergenceId: string
  created: boolean
  skipped: boolean
  linearIssueId?: string
  error?: string
}

// ── Severity → label name ──────────────────────────────────────────────────

const SEVERITY_LABEL: Record<DivergenceSeverity, string> = {
  blocking:      'factory:divergence-blocking',
  advisory:      'factory:divergence-advisory',
  informational: 'factory:divergence-informational',
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleDivergenceSync(
  req: DivergenceSyncRequest,
  env: Env,
  client: LinearClient,
  labelCache: Map<string, string>,  // label name → Linear label UUID
): Promise<DivergenceSyncResult> {
  // Idempotency check
  const existing = await getBinding(env.FACTORY_ARTIFACTS_DB, req.divergenceId)
  if (existing) {
    return {
      divergenceId: req.divergenceId,
      created: false,
      skipped: true,
      linearIssueId: existing.linear_issue_id,
    }
  }

  // Resolve parent atom issue (for parentId linkage)
  const parentBinding = await getBinding(env.FACTORY_ARTIFACTS_DB, req.atomId)

  // Resolve severity label
  const severityLabelName = SEVERITY_LABEL[req.severity]
  const severityLabelId = labelCache.get(severityLabelName)

  try {
    const description = buildDivergenceDescription(req)
    const issue = await client.issueCreate({
      teamId: env.LINEAR_TEAM_ID,
      title: `Divergence ${req.divergenceId} — ${req.severity} (${req.detectorId})`,
      description,
      ...(parentBinding?.linear_issue_internal_id !== undefined
        ? { parentId: parentBinding.linear_issue_internal_id }
        : {}),
      labelIds: severityLabelId ? [severityLabelId] : [],
    })

    await upsertBinding(env.FACTORY_ARTIFACTS_DB, {
      factoryArtifactId: req.divergenceId,
      linearIssueId: issue.identifier,
      linearIssueInternalId: issue.id,
      bindingType: 'divergence',
      workGraphVersion: req.workGraphVersion,
    })

    return {
      divergenceId: req.divergenceId,
      created: true,
      skipped: false,
      linearIssueId: issue.identifier,
    }
  } catch (err) {
    await logSyncError(env.FACTORY_OPS_DB, {
      factoryArtifactId: req.divergenceId,
      errorType: 'divergence_create_failed',
      errorDetail: String(err),
      endpoint: '/sync/divergences',
    })
    return {
      divergenceId: req.divergenceId,
      created: false,
      skipped: false,
      error: String(err),
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildDivergenceDescription(req: DivergenceSyncRequest): string {
  const lines: string[] = [
    `**Divergence ID:** \`${req.divergenceId}\``,
    `**Detector:** \`${req.detectorId}\``,
    `**Severity:** ${req.severity}`,
    `**Atom:** \`${req.atomId}\``,
    `**WorkGraph version:** \`${req.workGraphVersion}\``,
    `**Trace node:** \`${req.evidence.traceNodeId}\``,
    '',
    '### Evidence',
    '```',
    req.evidence.rawOutputFragment,
    '```',
  ]
  if (req.elucidationArtifactId) {
    lines.splice(4, 0, `**Elucidation:** \`${req.elucidationArtifactId}\``)
  }
  return lines.join('\n')
}
