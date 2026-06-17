/**
 * @module session-router
 *
 * Routes an accepted SubmitSession request to the Commissioning Agent DO.
 *
 * The Commissioning Agent DO (one per org) owns the SM1 state machine.
 * It is addressed by `idFromName("commissioning-agent:" + orgId)`.
 *
 * Protocol:
 *   POST https://do/signal
 *   Body: CommissioningSignal (matches @factory/commissioning-agent CommissioningSignalSchema)
 *
 *   200/202 → accepted
 *   409     → already commissioned (idempotent duplicate)
 *   412     → precondition failed (e.g. work order not found)
 *   other   → rejected
 */

export interface RouteResult {
  accepted: boolean
  reason?: string
}

// ── WGSP envelope shape (mirrors wgsp-envelope.ts OutboundEnvelope) ───────────

interface ParsedWorkGraph {
  durable_objects?: Record<string, unknown>
  [key: string]: unknown
}

interface ParsedEnvelope {
  envelope_schema_version: string
  actor_type: string
  purpose_id: string
  timestamp?: string
  /** base64-encoded bytes or raw JSON of the work_graph subgraph */
  work_graph?: string | ParsedWorkGraph
  governance_context?: {
    work_order_id?: string
    evidence_chain_root?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

// ── DomainProfile default ─────────────────────────────────────────────────────

const DEFAULT_DOMAIN_PROFILE = {
  vertical: 'default' as const,
  orgContext: '',
  constraints: [] as unknown[],
  version: '1.0',
}

// ── Work-graph parser ─────────────────────────────────────────────────────────

/**
 * Decodes the work_graph field from the WGSP envelope.
 * Handles both base64-encoded bytes and raw JSON string / object forms.
 */
function parseWorkGraph(raw: string | ParsedWorkGraph | undefined): ParsedWorkGraph | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  // string: try base64-decode first, fall back to raw JSON
  let json: string
  try {
    json = atob(raw)
  } catch {
    json = raw
  }
  try {
    return JSON.parse(json) as ParsedWorkGraph
  } catch {
    return null
  }
}

// ── Signal mapper ─────────────────────────────────────────────────────────────

/**
 * Maps a validated WGSP envelope to a CommissioningSignal body expected by the
 * Commissioning Agent DO's POST /signal endpoint.
 *
 * Field derivation:
 *   sessionId             → passed-in gateway-minted streaming identity
 *   orgId                 → work_graph.durable_objects.org_id
 *   dispositionEventId    → work_graph.durable_objects.disposition_event_id
 *                           or governance_context.work_order_id as fallback
 *   domainProfile         → work_graph.durable_objects.domain_profile or default
 *   elucidationArtifactId → work_graph.durable_objects.elucidation_artifact_id or ""
 *   issuedAt              → envelope.timestamp or new Date().toISOString()
 *   requireHumanApproval  → work_graph.durable_objects.require_human_approval or false
 */
export function mapEnvelopeToSignal(
  envelope: ParsedEnvelope,
  sessionId: string,
  workOrderId: string,
): { signal: Record<string, unknown> } | { accepted: false; reason: string } {
  const wg = parseWorkGraph(envelope.work_graph)
  const durableObjects = (wg?.durable_objects ?? {}) as Record<string, unknown>

  const orgId = durableObjects['org_id']
  if (typeof orgId !== 'string' || orgId.length === 0) {
    return { accepted: false, reason: 'missing required field orgId (work_graph.durable_objects.org_id)' }
  }

  const rawDispositionEventId = durableObjects['disposition_event_id']
  const dispositionEventId =
    typeof rawDispositionEventId === 'string' && rawDispositionEventId.length > 0
      ? rawDispositionEventId
      : workOrderId

  const rawElucidationArtifactId = durableObjects['elucidation_artifact_id']
  const elucidationArtifactId =
    typeof rawElucidationArtifactId === 'string' ? rawElucidationArtifactId : ''

  const rawDomainProfile = durableObjects['domain_profile']
  const domainProfile =
    rawDomainProfile !== null && typeof rawDomainProfile === 'object'
      ? rawDomainProfile
      : DEFAULT_DOMAIN_PROFILE

  const rawRequireHumanApproval = durableObjects['require_human_approval']
  const requireHumanApproval =
    typeof rawRequireHumanApproval === 'boolean' ? rawRequireHumanApproval : false

  const issuedAt =
    typeof envelope.timestamp === 'string' && envelope.timestamp.length > 0
      ? envelope.timestamp
      : new Date().toISOString()

  const signal: Record<string, unknown> = {
    sessionId,
    orgId,
    dispositionEventId,
    domainProfile,
    elucidationArtifactId,
    issuedAt,
    requireHumanApproval,
  }

  return { signal }
}

/**
 * Routes a new session to the Commissioning Agent DO for the given org.
 *
 * @param caNamespace  DO namespace for the Commissioning Agent.
 * @param sessionId    Newly-minted session id (streaming identity key).
 * @param workOrderId  Work order id extracted from the WGSP envelope.
 * @param envelope     Raw parsed WGSP envelope.
 */
export async function routeToCommissioningAgent(
  caNamespace: DurableObjectNamespace,
  sessionId: string,
  workOrderId: string,
  envelope: unknown,
): Promise<RouteResult> {
  const envelopeParsed = envelope as ParsedEnvelope

  // Map envelope to CommissioningSignal; return early if required fields are absent.
  const mapped = mapEnvelopeToSignal(envelopeParsed, sessionId, workOrderId)
  if ('accepted' in mapped) {
    return mapped
  }

  const { signal } = mapped
  const orgId = signal['orgId'] as string

  // Address the DO by orgId — must match idFromName('commissioning-agent:{orgId}') in CA
  const stub = caNamespace.get(caNamespace.idFromName(`commissioning-agent:${orgId}`))

  let response: Response
  try {
    response = await stub.fetch('https://do/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signal),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { accepted: false, reason: `commissioning agent unreachable: ${message}` }
  }

  if (response.status === 200 || response.status === 202) {
    return { accepted: true }
  }

  // 409 = already commissioned — still accepted (idempotent)
  if (response.status === 409) {
    return { accepted: true }
  }

  // 412 = precondition failed (work order not found / wrong state)
  if (response.status === 412) {
    let reason = 'precondition failed'
    try {
      const body = (await response.json()) as { reason?: string }
      reason = body.reason ?? reason
    } catch {
      // ignore parse failure
    }
    return { accepted: false, reason }
  }

  let reason = `commissioning agent returned HTTP ${response.status}`
  try {
    const body = (await response.json()) as { reason?: string }
    reason = body.reason ?? reason
  } catch {
    // ignore parse failure
  }
  return { accepted: false, reason }
}
