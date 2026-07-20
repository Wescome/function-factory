/**
 * @factory/linear-sync — P2: Trace State Sync
 *
 * POST /sync/atoms (state-machine path)
 *
 * Driven by bead outcome events from releaseBead() / failBead().
 * Maps bead outcomes to Linear workflow states and labels.
 *
 * State machine:
 *   releaseBead() done            → Done        + factory:success
 *   failBead() recoverable        → In Review   + factory:retrying
 *   failBead() governance_violation → Cancelled + factory:divergence, factory:failure
 *   failBead() provider_error (terminal) → Cancelled + factory:failure
 *   Bead claimed (in_progress)    → In Progress
 */

import type { Env } from '../env.js'
import type { LinearClient } from '../linear-client.js'
import { getBinding, markBindingSynced } from '../binding-store.js'
import { logSyncError } from '../error-log.js'

// ── Request/Response types ─────────────────────────────────────────────────

export type BeadOutcome =
  | 'done'
  | 'in_progress'
  | 'recoverable_failure'
  | 'governance_violation'
  | 'provider_error_terminal'

export interface TraceSyncRequest {
  atomId: string
  outcome: BeadOutcome
  errorCode?: string
  commitSha?: string
}

export interface TraceSyncResult {
  atomId: string
  updated: boolean
  skipped: boolean
  error?: string
}

// ── State machine map ──────────────────────────────────────────────────────

interface StateTransition {
  stateName: string
  addLabels: string[]
}

const OUTCOME_MAP: Record<BeadOutcome, StateTransition> = {
  done:                   { stateName: 'Done',        addLabels: ['factory:success'] },
  in_progress:            { stateName: 'In Progress', addLabels: [] },
  recoverable_failure:    { stateName: 'In Review',   addLabels: ['factory:retrying'] },
  governance_violation:   { stateName: 'Cancelled',   addLabels: ['factory:divergence', 'factory:failure'] },
  provider_error_terminal:{ stateName: 'Cancelled',   addLabels: ['factory:failure'] },
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleTraceStateSync(
  req: TraceSyncRequest,
  env: Env,
  client: LinearClient,
  labelCache: Map<string, string>,  // label name → Linear label UUID
  stateCache: Map<string, string>,  // state name → Linear state UUID
): Promise<TraceSyncResult> {
  const binding = await getBinding(env.FACTORY_ARTIFACTS_DB, req.atomId)
  if (!binding) {
    return { atomId: req.atomId, updated: false, skipped: true }
  }

  const transition = OUTCOME_MAP[req.outcome]
  const stateId = stateCache.get(transition.stateName)
  const labelIds = transition.addLabels
    .map((name) => labelCache.get(name))
    .filter((id): id is string => id !== undefined)

  try {
    const updateInput: { stateId?: string; labelIds?: string[] } = {}
    if (stateId) updateInput.stateId = stateId
    if (labelIds.length > 0) updateInput.labelIds = labelIds

    if (Object.keys(updateInput).length > 0) {
      await client.issueUpdate(binding.linear_issue_internal_id, updateInput)
    }

    // Attach commit SHA as a comment if present
    if (req.commitSha) {
      await client.commentCreate({
        issueId: binding.linear_issue_internal_id,
        body: `Commit: \`${req.commitSha}\``,
      })
    }

    await markBindingSynced(env.FACTORY_ARTIFACTS_DB, req.atomId, 'ok')
    return { atomId: req.atomId, updated: true, skipped: false }
  } catch (err) {
    await markBindingSynced(env.FACTORY_ARTIFACTS_DB, req.atomId, 'error')
    await logSyncError(env.FACTORY_OPS_DB, {
      factoryArtifactId: req.atomId,
      errorType: 'state_update_failed',
      errorDetail: String(err),
      endpoint: '/sync/atoms',
    })
    return { atomId: req.atomId, updated: false, skipped: false, error: String(err) }
  }
}
