/**
 * @factory/architect-agent — D2: CRD Resolution
 *
 * Handles POST /crd (was POST /crp — Coverage Reconciliation Directive).
 * Classifies Amendment failure, writes to crd_queue, initiates resolution,
 * escalates to We-layer after 2 failed attempts.
 * Writes CRD-RESOLUTION governance artifact to ArtifactGraphDO.
 */

import type { CrdRequest, CrdResponse, CrdFailureClass, RepoRow } from '../types.js'
import { writeGovernanceArtifact } from '../artifact-graph.js'

const CRD_ID_PREFIX = 'CRD-'
const MAX_RESOLUTION_ATTEMPTS = 2

function generateCrdId(): string {
  return `${CRD_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

/**
 * Classify the Amendment coherence failure based on the verdict detail.
 * Maps verdict text patterns to the 4 canonical failure classes.
 *
 * Open item: taxonomy completeness (GAP-012 open items D2).
 */
function classifyFailure(coherenceVerdictDetail: string): CrdFailureClass {
  const v = coherenceVerdictDetail.toLowerCase()
  if (v.includes('schema') || v.includes('type mismatch') || v.includes('invalid reference')) {
    return 'SCHEMA_VIOLATION'
  }
  if (v.includes('invariant') || v.includes('conflict') || v.includes('cross-repo')) {
    return 'INVARIANT_CONFLICT'
  }
  if (v.includes('coverage') || v.includes('detector') || v.includes('uncovered')) {
    return 'COVERAGE_GAP'
  }
  // Default: lineage break covers undefined failures that sever graph edges
  return 'LINEAGE_BREAK'
}

export interface D2CrdHandlerDeps {
  sql: SqlStorage
  artifactGraph: DurableObjectStub
  repos: RepoRow[]
  weopsGatewayUrl: string
  crdResolutionTimeoutMs: number
}

export async function handleCrd(req: CrdRequest, deps: D2CrdHandlerDeps): Promise<CrdResponse> {
  const { sql, artifactGraph } = deps
  const crdId = generateCrdId()
  const now = new Date().toISOString()
  const failureClass = classifyFailure(req.coherenceVerdictDetail)

  // 1. Insert CRD row
  sql.exec(
    `INSERT INTO crd_queue
       (crd_id, repo_id, amendment_id, coherence_verdict, hypothesis_id,
        divergence_ids, failure_class, status, resolution_attempts, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    crdId,
    req.repoId,
    req.amendmentId,
    req.coherenceVerdictDetail,
    req.hypothesisId,
    JSON.stringify(req.divergenceIds),
    failureClass,
    now,
  )

  // 2. Update pending_crd_count on repos row
  sql.exec(
    `UPDATE repos
     SET pending_crd_count = (
       SELECT COUNT(*) FROM crd_queue
       WHERE repo_id = ? AND status IN ('pending', 'in-resolution')
     )
     WHERE repo_id = ?`,
    req.repoId,
    req.repoId,
  )

  // 3. Begin resolution async (fire-and-forget)
  void resolveInBackground(crdId, req, failureClass, deps)

  return {
    crdId,
    status: 'queued',
    estimatedResolutionMs: deps.crdResolutionTimeoutMs,
  }
}

/**
 * Attempt CRD resolution. Uses model routing: GPT-5.5 for diagnosis.
 * v1 stub: resolution action is computed heuristically, not via LLM call.
 * Full LLM routing is GAP-012 open item (model-routing integration).
 */
async function resolveInBackground(
  crdId: string,
  req: CrdRequest,
  failureClass: CrdFailureClass,
  deps: D2CrdHandlerDeps,
): Promise<void> {
  const { sql, artifactGraph, weopsGatewayUrl } = deps

  // Mark in-resolution
  sql.exec(
    `UPDATE crd_queue
     SET status = 'in-resolution',
         resolution_attempts = resolution_attempts + 1
     WHERE crd_id = ?`,
    crdId,
  )

  const resolutionAction = computeResolutionAction(failureClass, req)
  const resolvedAt = new Date().toISOString()
  let outcome: 'resolved' | 'escalated'

  // v1: heuristic resolution succeeds for SCHEMA_VIOLATION and COVERAGE_GAP;
  // escalates INVARIANT_CONFLICT and LINEAGE_BREAK on first attempt if they recur.
  const attemptsRow = [...sql.exec(
    'SELECT resolution_attempts FROM crd_queue WHERE crd_id = ?',
    crdId,
  )] as unknown as Array<{ resolution_attempts: number }>
  const attempts = attemptsRow[0]?.resolution_attempts ?? 1

  const canAutoResolve =
    failureClass === 'SCHEMA_VIOLATION' || failureClass === 'COVERAGE_GAP'
  const shouldEscalate = attempts >= MAX_RESOLUTION_ATTEMPTS && !canAutoResolve

  if (shouldEscalate) {
    sql.exec(
      `UPDATE crd_queue SET status = 'escalated-to-we-layer' WHERE crd_id = ?`,
      crdId,
    )
    outcome = 'escalated'
    void escalateToWeLayer(crdId, req, failureClass, weopsGatewayUrl)
  } else {
    sql.exec(
      `UPDATE crd_queue
       SET status = 'resolved',
           resolution_action = ?,
           resolved_at = ?
       WHERE crd_id = ?`,
      resolutionAction,
      resolvedAt,
      crdId,
    )
    outcome = 'resolved'
  }

  // Refresh pending_crd_count
  sql.exec(
    `UPDATE repos
     SET pending_crd_count = (
       SELECT COUNT(*) FROM crd_queue
       WHERE repo_id = ? AND status IN ('pending', 'in-resolution')
     )
     WHERE repo_id = ?`,
    req.repoId,
    req.repoId,
  )

  // Write CRD-RESOLUTION governance artifact to ArtifactGraphDO
  void writeGovernanceArtifact(artifactGraph, {
    type: 'CRD-RESOLUTION',
    id: `CRD-RESOLUTION-${crdId}`,
    domain: 'D2',
    source: 'architect-agent',
    explicitness: 'stated',
    payload: {
      crdId,
      amendmentId: req.amendmentId,
      failureClass,
      resolutionAction,
      outcome,
      resolvedAt,
    },
  })
}

function computeResolutionAction(failureClass: CrdFailureClass, req: CrdRequest): string {
  switch (failureClass) {
    case 'SCHEMA_VIOLATION':
      return `Revert Amendment ${req.amendmentId}; re-author with corrected artifact type references`
    case 'COVERAGE_GAP':
      return `Extend detector coverage to include atoms introduced by Amendment ${req.amendmentId}`
    case 'INVARIANT_CONFLICT':
      return `Escalate cross-repo invariant conflict in Amendment ${req.amendmentId} to We-layer for arbitration`
    case 'LINEAGE_BREAK':
      return `Restore lineage edge severed by Amendment ${req.amendmentId}; re-validate Hypothesis ${req.hypothesisId}`
  }
}

async function escalateToWeLayer(
  crdId: string,
  req: CrdRequest,
  failureClass: CrdFailureClass,
  weopsGatewayUrl: string,
): Promise<void> {
  try {
    await fetch(`${weopsGatewayUrl}/escalation/crd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        crdId,
        repoId: req.repoId,
        amendmentId: req.amendmentId,
        failureClass,
        escalatedAt: new Date().toISOString(),
      }),
    })
  } catch (err) {
    console.warn(`[ArchitectAgentDO:D2] escalateToWeLayer failed for CRD ${crdId}:`, err)
  }
}

/**
 * Get pending CRD count across all repos. Used in anomaly scanner.
 */
export function getPendingCrdCount(sql: SqlStorage): number {
  const rows = [...sql.exec(
    `SELECT COUNT(*) as cnt FROM crd_queue WHERE status IN ('pending', 'in-resolution')`,
  )] as unknown as Array<{ cnt: number }>
  return rows[0]?.cnt ?? 0
}

/**
 * Get CRD-per-hour rate for anomaly detection.
 */
export function getCrdRatePerHour(sql: SqlStorage): number {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const rows = [...sql.exec(
    `SELECT COUNT(*) as cnt FROM crd_queue WHERE received_at >= ?`,
    oneHourAgo,
  )] as unknown as Array<{ cnt: number }>
  return rows[0]?.cnt ?? 0
}
