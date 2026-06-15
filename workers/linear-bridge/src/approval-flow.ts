/**
 * @module approval-flow
 *
 * Two-person override approval state machine, backed by BRIDGE_KV.
 *
 * State persisted in BRIDGE_KV under key: `pending-override:{escalationId}`
 * TTL: 3600s (1 hour). Cloudflare evicts automatically on expiry.
 *
 * States:
 *   NONE → PENDING_SECOND_APPROVAL (first authority approves)
 *   PENDING_SECOND_APPROVAL → COMPLETE (second authority, different from initiator, approves)
 *   PENDING_SECOND_APPROVAL → EXPIRED (TTL elapses, evicted by CF)
 *
 * Transitions:
 *   initiate()   — first authority actor submits override disposition
 *   approve()    — second authority actor submits override disposition
 *   getStatus()  — read pending state
 *   expire()     — detected on approval attempt when KV entry is absent
 */

import type { ParsedDisposition } from './types.js'

// ─── KV Schema ───────────────────────────────────────────────────────────────

export interface PendingOverride {
  parsed: ParsedDisposition
  initiatorLinearId: string
  initiatedAt: string          // ISO 8601
  approvals: string[]          // Linear user IDs who have approved (starts with [initiatorLinearId])
  expiresAt: string            // initiatedAt + 3600000ms ISO 8601
  escalationId: string
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ApprovalInitiated {
  state: 'PENDING_SECOND_APPROVAL'
  pending: PendingOverride
}

export interface ApprovalComplete {
  state: 'COMPLETE'
  pending: PendingOverride
}

export interface ApprovalAlreadyPending {
  state: 'ALREADY_PENDING'
  pending: PendingOverride
}

export interface ApprovalDuplicate {
  state: 'DUPLICATE_APPROVER'
  reason: string
}

export interface ApprovalExpiredOrNone {
  state: 'NONE'
  reason: string
}

export type ApprovalFlowResult =
  | ApprovalInitiated
  | ApprovalComplete
  | ApprovalAlreadyPending
  | ApprovalDuplicate
  | ApprovalExpiredOrNone

// ─── KV key factory ──────────────────────────────────────────────────────────

function pendingKey(escalationId: string): string {
  return `pending-override:${escalationId}`
}

const OVERRIDE_TTL_MS = 3_600_000  // 1 hour
const OVERRIDE_TTL_S = 3600

// ─── State Machine ───────────────────────────────────────────────────────────

/**
 * Initiates a two-person override or advances it to completion.
 *
 * Called whenever a user submits an `override` disposition.
 * - No existing pending entry → writes a new PENDING_SECOND_APPROVAL entry.
 * - Existing entry + different approver → COMPLETE; deletes KV entry.
 * - Existing entry + same approver → DUPLICATE_APPROVER error.
 *
 * @param kv             BRIDGE_KV namespace
 * @param escalationId   Unique escalation ID (from Linear issue label / escalation payload)
 * @param linearUserId   Linear user ID of the authority submitting the override
 * @param parsed         The parsed DISPOSITION: override ... comment
 */
export async function processOverrideDisposition(
  kv: KVNamespace,
  escalationId: string,
  linearUserId: string,
  parsed: ParsedDisposition,
): Promise<ApprovalFlowResult> {
  const key = pendingKey(escalationId)
  const existing = await kv.get(key)

  if (existing === null) {
    // No pending override — initiate.
    const now = new Date()
    const expiresAt = new Date(now.getTime() + OVERRIDE_TTL_MS).toISOString()
    const pending: PendingOverride = {
      parsed,
      initiatorLinearId: linearUserId,
      initiatedAt: now.toISOString(),
      approvals: [linearUserId],
      expiresAt,
      escalationId,
    }
    await kv.put(key, JSON.stringify(pending), { expirationTtl: OVERRIDE_TTL_S })
    return { state: 'PENDING_SECOND_APPROVAL', pending }
  }

  // Pending entry exists.
  let pending: PendingOverride
  try {
    pending = JSON.parse(existing) as PendingOverride
  } catch {
    // Corrupted KV entry — treat as none.
    await kv.delete(key)
    return { state: 'NONE', reason: 'corrupted pending override entry; cleared' }
  }

  // Duplicate approver check.
  if (pending.approvals.includes(linearUserId)) {
    return {
      state: 'DUPLICATE_APPROVER',
      reason: `user ${linearUserId} already in approvals list; a second distinct authority is required`,
    }
  }

  // Second approval — transition to COMPLETE.
  const completed: PendingOverride = {
    ...pending,
    approvals: [...pending.approvals, linearUserId],
  }
  await kv.delete(key)
  return { state: 'COMPLETE', pending: completed }
}

/**
 * Returns the current pending override state for an escalation, if any.
 */
export async function getPendingOverride(
  kv: KVNamespace,
  escalationId: string,
): Promise<PendingOverride | null> {
  const raw = await kv.get(pendingKey(escalationId))
  if (raw === null) return null
  try {
    return JSON.parse(raw) as PendingOverride
  } catch {
    return null
  }
}

/**
 * Removes a stale pending override entry (called when TTL expiry is detected
 * by checking that the pending state has an expired expiresAt timestamp).
 * Normally the CF TTL handles this; this is a belt-and-suspenders clean-up path.
 */
export async function clearExpiredOverride(
  kv: KVNamespace,
  escalationId: string,
): Promise<void> {
  await kv.delete(pendingKey(escalationId))
}
