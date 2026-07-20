/**
 * @module rejection-flow
 *
 * Handles `reject` dispositions:
 *   1. Writes a RejectionRecord node to ArtifactGraphDO
 *   2. Closes the Linear issue (moves to "Cancelled" or equivalent state)
 *   3. Posts a rejection comment to Linear
 *
 * The RejectionRecord node ID format: REJ-BRIDGE-{escalationId}-{timestamp}
 */

import type { RejectionRecord, Env } from './types.js'
import type { ParsedDisposition } from './types.js'
import { createComment, updateIssueState } from './linear-client.js'

// Note: env is retained for DO + KV bindings. Resolved secret strings are passed explicitly.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RejectionFlowSuccess {
  ok: true
  nodeId: string
}

export interface RejectionFlowFailure {
  ok: false
  error: string
}

export type RejectionFlowResult = RejectionFlowSuccess | RejectionFlowFailure

// ─── Cancellation State ID ────────────────────────────────────────────────────
// This must be configured as a Linear workflow state ID.
// The cancellation state is left configurable — callers pass it in.
// Default: 'CANCELLED' (teams define their own state IDs in Linear).

// ─── Flow ─────────────────────────────────────────────────────────────────────

/**
 * Executes the rejection flow:
 * 1. Writes RejectionRecord to ArtifactGraphDO
 * 2. Posts rejection comment to Linear
 * 3. Moves Linear issue to the cancelled state
 *
 * @param parsed           Parsed DISPOSITION: reject ... comment
 * @param escalationId     Escalation identifier
 * @param repoId           Repository identifier
 * @param linearIssueId    Linear issue ID (UUID)
 * @param linearCommentId  Linear comment ID that triggered the rejection
 * @param rejectedBy       Linear user ID of the authority rejecting
 * @param cancelledStateId Linear workflow state ID for "Cancelled"
 * @param env              Worker env (for DO + KV bindings)
 * @param linearApiKey     Resolved LINEAR_API_KEY secret string
 */
export async function executeRejectionFlow(
  parsed: ParsedDisposition,
  escalationId: string,
  repoId: string,
  linearIssueId: string,
  linearCommentId: string,
  rejectedBy: string,
  cancelledStateId: string,
  env: Env,
  linearApiKey: string,
): Promise<RejectionFlowResult> {
  const nodeId = `REJ-BRIDGE-${escalationId}-${Date.now()}`
  const rejectedAt = new Date().toISOString()

  // Build RejectionRecord node.
  const reason = parsed.rawArgs.join(' ') || undefined
  const record: RejectionRecord = {
    id: nodeId,
    nodeType: 'RejectionRecord',
    escalationId,
    repoId,
    linearIssueId,
    linearCommentId,
    rejectedBy,
    ...(reason !== undefined ? { reason } : {}),
    rejectedAt,
    bridge: 'ff-linear-bridge',
  }

  // Write to ArtifactGraphDO.
  const doId = env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${repoId}`)
  const stub = env.ARTIFACT_GRAPH.get(doId)

  try {
    const resp = await stub.fetch('http://internal/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: record }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '<unreadable>')
      console.error(`rejection-flow: DO /append returned ${resp.status}: ${body}`)
      // Non-fatal: continue with Linear updates even if DO write fails.
    }
  } catch (err) {
    console.error('rejection-flow: DO fetch failed:', err)
    // Non-fatal: continue with Linear updates.
  }

  // Post rejection comment to Linear.
  const commentBody = [
    '**Disposition: REJECTED**',
    '',
    reason ? `Reason: ${reason}` : 'No reason provided.',
    '',
    `Rejected by: ${rejectedBy}`,
    `At: ${rejectedAt}`,
    `Escalation: ${escalationId}`,
  ].join('\n')

  const commentResult = await createComment(linearApiKey, linearIssueId, commentBody)
  if (!commentResult.ok) {
    console.error('rejection-flow: failed to post rejection comment:', commentResult.error)
    // Non-fatal: continue.
  }

  // Move Linear issue to cancelled state.
  const stateResult = await updateIssueState(linearApiKey, linearIssueId, cancelledStateId)
  if (!stateResult.ok) {
    console.error('rejection-flow: failed to update issue state to cancelled:', stateResult.error)
    return { ok: false, error: `rejection recorded but issue state update failed: ${stateResult.error}` }
  }

  return { ok: true, nodeId }
}
