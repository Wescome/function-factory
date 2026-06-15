/**
 * @factory/linear-sync — escalation-sync
 *
 * POST /sync/escalation
 *
 * Creates a Linear issue for a Factory escalation event.
 * The issue includes a disposition comment template for ff-linear-bridge.
 * Labels: factory:escalation + requires-{type} per escalation type.
 */

import type { Env } from './env.js'
import type { LinearClient } from './linear-client.js'
import { getBinding, upsertBinding } from './binding-store.js'
import { logSyncError } from './error-log.js'

// ── Request/Response types ─────────────────────────────────────────────────

export type EscalationType =
  | 'human_review_required'
  | 'architecture_decision_required'
  | 'governance_override_required'
  | 'resource_limit_exceeded'
  | 'dependency_blocked'

export interface EscalationEvidence {
  divergenceIds?: string[]
  hypothesisNodeId?: string
  amendmentNodeId?: string
}

export interface EscalationSyncRequest {
  escalationId: string          // ESC-*
  repoId: string
  workGraphVersion: string
  escalationType: EscalationType
  requestedAction: string
  evidence: EscalationEvidence
  linearDivergenceIssueIds: string[]  // Linear UUIDs of linked divergence issues
}

export interface EscalationSyncResult {
  escalationId: string
  created: boolean
  skipped: boolean
  linearIssueId?: string
  error?: string
}

// ── Escalation type → label name ──────────────────────────────────────────

const TYPE_LABEL: Record<EscalationType, string> = {
  human_review_required:          'requires-human-review',
  architecture_decision_required: 'requires-architecture-decision',
  governance_override_required:   'requires-governance-override',
  resource_limit_exceeded:        'requires-resource-review',
  dependency_blocked:             'requires-dependency-resolution',
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleEscalationSync(
  req: EscalationSyncRequest,
  env: Env,
  client: LinearClient,
  labelCache: Map<string, string>,  // label name → Linear label UUID
): Promise<EscalationSyncResult> {
  // Idempotency check
  const existing = await getBinding(env.FACTORY_ARTIFACTS_DB, req.escalationId)
  if (existing) {
    return {
      escalationId: req.escalationId,
      created: false,
      skipped: true,
      linearIssueId: existing.linear_issue_id,
    }
  }

  // Resolve labels
  const escalationLabelId = labelCache.get('factory:escalation')
  const typeLabelId = labelCache.get(TYPE_LABEL[req.escalationType])
  const labelIds = [escalationLabelId, typeLabelId].filter((id): id is string => id !== undefined)

  try {
    const description = buildEscalationDescription(req)
    const issue = await client.issueCreate({
      teamId: env.LINEAR_TEAM_ID,
      title: `Escalation ${req.escalationId} — ${req.escalationType}`,
      description,
      labelIds,
    })

    await upsertBinding(env.FACTORY_ARTIFACTS_DB, {
      factoryArtifactId: req.escalationId,
      linearIssueId: issue.identifier,
      linearIssueInternalId: issue.id,
      bindingType: 'escalation',
      workGraphVersion: req.workGraphVersion,
    })

    return {
      escalationId: req.escalationId,
      created: true,
      skipped: false,
      linearIssueId: issue.identifier,
    }
  } catch (err) {
    await logSyncError(env.FACTORY_OPS_DB, {
      factoryArtifactId: req.escalationId,
      errorType: 'escalation_create_failed',
      errorDetail: String(err),
      endpoint: '/sync/escalation',
    })
    return {
      escalationId: req.escalationId,
      created: false,
      skipped: false,
      error: String(err),
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildEscalationDescription(req: EscalationSyncRequest): string {
  const lines: string[] = [
    `**Escalation ID:** \`${req.escalationId}\``,
    `**Type:** ${req.escalationType}`,
    `**Repo:** \`${req.repoId}\``,
    `**WorkGraph version:** \`${req.workGraphVersion}\``,
    `**Requested action:** ${req.requestedAction}`,
    '',
  ]

  if (req.evidence.divergenceIds && req.evidence.divergenceIds.length > 0) {
    lines.push(`**Related divergences:** ${req.evidence.divergenceIds.join(', ')}`)
  }
  if (req.evidence.hypothesisNodeId) {
    lines.push(`**Hypothesis node:** \`${req.evidence.hypothesisNodeId}\``)
  }
  if (req.evidence.amendmentNodeId) {
    lines.push(`**Amendment node:** \`${req.evidence.amendmentNodeId}\``)
  }
  if (req.linearDivergenceIssueIds.length > 0) {
    lines.push(`**Linked Linear issues:** ${req.linearDivergenceIssueIds.join(', ')}`)
  }

  lines.push(
    '',
    '---',
    '',
    '### Disposition (ff-linear-bridge)',
    '',
    'Reply with one of the following to trigger the bridge:',
    '',
    '```',
    '/approve',
    '/reject reason: <explain why>',
    '/defer until: <date or milestone>',
    '```',
  )

  return lines.join('\n')
}
