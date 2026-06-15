/**
 * @module error-log
 *
 * BRIDGE_KV–backed error and security event logging for the linear bridge.
 *
 * In v1 this writes to BRIDGE_KV rather than D1 to avoid requiring a D1 binding.
 * If a D1 `factory-ops` binding is added, bridge_error_log and bridge_security_events
 * tables can be used instead.
 *
 * KV key pattern:
 *   error-log:{timestamp}-{uuid}     → BridgeErrorEvent (TTL 7 days)
 *   security-event:{timestamp}-{uuid} → BridgeSecurityEvent (TTL 30 days)
 */

// ─── Error Event ─────────────────────────────────────────────────────────────

export interface BridgeErrorEvent {
  type: 'BridgeErrorEvent'
  message: string
  context: Record<string, unknown>
  timestamp: string
}

// ─── Security Event ───────────────────────────────────────────────────────────

export interface BridgeSecurityEvent {
  type: 'BridgeSecurityEvent'
  subtype:
    | 'InvalidWebhookSignature'
    | 'UnknownAuthority'
    | 'InsufficientScope'
    | 'JwtReplay'
    | 'A9Violation'
    | 'DuplicateApprover'
  linearUserId?: string
  linearIssueId?: string
  escalationId?: string
  detail: string
  timestamp: string
}

// ─── Writers ─────────────────────────────────────────────────────────────────

const ERROR_TTL_S = 604_800    // 7 days
const SECURITY_TTL_S = 2_592_000  // 30 days

/**
 * Writes a bridge error event to KV. Best-effort: never throws.
 */
export async function logBridgeError(
  kv: KVNamespace,
  message: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    const event: BridgeErrorEvent = {
      type: 'BridgeErrorEvent',
      message,
      context,
      timestamp: new Date().toISOString(),
    }
    const key = `error-log:${Date.now()}-${crypto.randomUUID()}`
    await kv.put(key, JSON.stringify(event), { expirationTtl: ERROR_TTL_S })
  } catch (err) {
    console.error('error-log: failed to write error event:', err)
  }
}

/**
 * Writes a bridge security event to KV. Best-effort: never throws.
 */
export async function logSecurityEvent(
  kv: KVNamespace,
  event: Omit<BridgeSecurityEvent, 'type' | 'timestamp'>,
): Promise<void> {
  try {
    const full: BridgeSecurityEvent = {
      type: 'BridgeSecurityEvent',
      ...event,
      timestamp: new Date().toISOString(),
    }
    const key = `security-event:${Date.now()}-${crypto.randomUUID()}`
    await kv.put(key, JSON.stringify(full), { expirationTtl: SECURITY_TTL_S })
  } catch (err) {
    console.error('error-log: failed to write security event:', err)
  }
}
