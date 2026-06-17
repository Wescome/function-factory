/**
 * @module signals-handler
 *
 * Handles WeOps Gateway signal routes:
 *
 *   POST /signals      — inbound We→I; JWT validation + routing to CA/Architect DO
 *   POST /escalations  — outbound I→We; WGSP envelope verification + forward/KV buffer
 *   POST /vcrs         — outbound I→We; WGSP envelope verification + forward/KV buffer
 *
 * JWT validation (7 steps per spec §2.3):
 *   1. Extract Bearer token
 *   2. Verify HMAC-SHA256 signature (Web Crypto API)
 *   3. Check exp
 *   4. Check jti replay (KV_REPLAY)
 *   5. Mark jti seen (TTL 300s)
 *   6. Check scope for signal type
 *   7. Validate dispositionEventId / elucidationArtifactId present and matching
 *
 * A9 ELC enforcement: structural — gateway rejects any token missing ELC-* ids.
 * The ELC write was done by ff-linear-bridge before token issuance; no ArangoDB
 * write here.
 */

import type { GatewayEnv } from './env.js'
import { makeJtiStore } from './jti-store.js'
import {
  verifyOutboundEnvelope,
  isEnvelopeDelivered,
  markEnvelopeDelivered,
  queueOutboundRetry,
} from './envelope-signer.js'
import { WeOpsDispositionTokenClaims } from '@factory/schemas/weops-disposition-token'
import type { TokenScope } from '@factory/schemas/weops-disposition-token'
import { InboundSignal, OutboundPayload } from '@factory/schemas/weops-signals'
import { OutboundEnvelope } from '@factory/schemas/wgsp-envelope'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

// Base64url decode (JWT uses base64url, not standard base64).
function base64urlDecode(input: string): string {
  // Pad to multiple of 4, replace URL-safe chars.
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    '=',
  )
  return atob(base64)
}

function base64urlDecodeBytes(input: string): Uint8Array {
  const str = base64urlDecode(input)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
  return bytes
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ─── A9 Violation logging ─────────────────────────────────────────────────────

interface A9ViolationEvent {
  type: 'A9ViolationEvent'
  jti: string
  signalType: string
  missingField: string
  timestamp: string
}

async function logA9Violation(
  kv: KVNamespace,
  event: A9ViolationEvent,
): Promise<void> {
  console.error('A9ViolationEvent', JSON.stringify(event))
  // Append to audit KV — best effort, non-fatal.
  try {
    const key = `audit:a9-violations`
    const existing = await kv.get(key) ?? '[]'
    const list = JSON.parse(existing) as A9ViolationEvent[]
    list.push(event)
    await kv.put(key, JSON.stringify(list), { expirationTtl: 2_592_000 }) // 30 days
  } catch (err) {
    console.error('Failed to write A9 violation to KV:', err)
  }
}

// ─── Scope requirements per signal type ──────────────────────────────────────

const SIGNAL_SCOPE: Record<string, TokenScope> = {
  CommissioningSignal: 'we-layer:commission',
  ResumeSignal: 'we-layer:commission',
  PatchAuthSignal: 'we-layer:patch',
  PipelineConfigAuthSignal: 'we-layer:pipeline-config',
  OverrideSignal: 'we-layer:override',
}

// ─── JWT validation ───────────────────────────────────────────────────────────

interface JwtValidationSuccess {
  ok: true
  claims: import('@factory/schemas/weops-disposition-token').WeOpsDispositionTokenClaims
}
interface JwtValidationFailure {
  ok: false
  status: number
  error: string
}
type JwtValidationResult = JwtValidationSuccess | JwtValidationFailure

async function validateJwt(
  authHeader: string | null,
  signingKeyBase64: string,
  kv: KVNamespace,
  signalType: string,
  signalDispositionEventId: string,
  signalElucidationArtifactId: string,
): Promise<JwtValidationResult> {
  // Step 1 — extract Bearer token.
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing or malformed Authorization header' }
  }
  const token = authHeader.slice('Bearer '.length).trim()
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { ok: false, status: 401, error: 'Malformed JWT: expected 3 parts' }
  }

  const [headerPart, payloadPart, sigPart] = parts as [string, string, string]

  // Step 2 — verify HMAC-SHA256 signature.
  // The signed content is: base64url(header) + '.' + base64url(payload)
  const signedContent = `${headerPart}.${payloadPart}`
  const keyBytes = base64Decode(signingKeyBase64)

  let cryptoKey: CryptoKey
  try {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  } catch {
    return { ok: false, status: 500, error: 'Invalid WEOPS_SIGNING_KEY configuration' }
  }

  const sigBytes = base64urlDecodeBytes(sigPart)
  const msgBytes = new TextEncoder().encode(signedContent)
  const valid = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, msgBytes)
  if (!valid) {
    return { ok: false, status: 401, error: 'JWT signature verification failed' }
  }

  // Step 3 — decode and validate claims via zod.
  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(base64urlDecode(payloadPart))
  } catch {
    return { ok: false, status: 401, error: 'Malformed JWT payload' }
  }

  const parsed = WeOpsDispositionTokenClaims.safeParse(rawPayload)
  if (!parsed.success) {
    return { ok: false, status: 401, error: `Invalid JWT claims: ${parsed.error.message}` }
  }
  const claims = parsed.data

  // Step 3b — check exp.
  const now = Math.floor(Date.now() / 1000)
  if (claims.exp < now) {
    return { ok: false, status: 401, error: 'JWT has expired' }
  }

  // Steps 4 & 5 — jti replay prevention.
  const jtiStore = makeJtiStore(kv)
  const isSeen = await jtiStore.has(claims.jti)
  if (isSeen) {
    // Return cached response if available.
    const cached = await jtiStore.getCachedResponse(claims.jti)
    if (cached) {
      // Signal to caller: replay with cached body.
      return {
        ok: false,
        status: -1,      // sentinel: replay hit with cached body
        error: cached,
      }
    }
    return { ok: false, status: 401, error: 'JWT replay detected' }
  }
  await jtiStore.mark(claims.jti, 300)

  // Step 6 — scope check.
  const requiredScope = SIGNAL_SCOPE[signalType]
  if (!requiredScope) {
    return { ok: false, status: 400, error: `Unknown signalType: ${signalType}` }
  }
  if (!claims.scope.includes(requiredScope)) {
    return {
      ok: false,
      status: 403,
      error: `Insufficient scope: need '${requiredScope}', got [${claims.scope.join(', ')}]`,
    }
  }

  // Step 7 — A9 ELC field validation.
  const missingOnToken: string[] = []
  if (!claims.dispositionEventId) missingOnToken.push('token.dispositionEventId')
  if (!claims.elucidationArtifactId) missingOnToken.push('token.elucidationArtifactId')
  if (!signalDispositionEventId) missingOnToken.push('signal.dispositionEventId')
  if (!signalElucidationArtifactId) missingOnToken.push('signal.elucidationArtifactId')

  if (missingOnToken.length > 0) {
    await logA9Violation(kv, {
      type: 'A9ViolationEvent',
      jti: claims.jti,
      signalType,
      missingField: missingOnToken.join(', '),
      timestamp: new Date().toISOString(),
    })
    return { ok: false, status: 400, error: `A9 violation: missing fields: ${missingOnToken.join(', ')}` }
  }

  // Cross-check that signal body matches token claims.
  if (signalDispositionEventId !== claims.dispositionEventId) {
    await logA9Violation(kv, {
      type: 'A9ViolationEvent',
      jti: claims.jti,
      signalType,
      missingField: 'dispositionEventId mismatch',
      timestamp: new Date().toISOString(),
    })
    return {
      ok: false,
      status: 400,
      error: 'A9 violation: signal.dispositionEventId does not match token claim',
    }
  }

  return { ok: true, claims }
}

// ─── Signal routing ───────────────────────────────────────────────────────────

/**
 * Derive orgId from repoId per R2:
 * - Strip the literal prefix 'repo:' if present; use the remainder.
 * - Otherwise use repoId verbatim.
 * - Returns { ok: true, orgId } or { ok: false, error } on invalid input.
 *
 * TODO-1 (production): replace with resolveOrgId(repoId, env) backed by KV/D1
 * org-profile store so identity is not inferred from string shape.
 */
function resolveOrgId(repoId: string): { ok: true; orgId: string } | { ok: false; error: string } {
  const orgId = repoId.startsWith('repo:') ? repoId.slice('repo:'.length) : repoId
  if (orgId === '') {
    return { ok: false, error: `cannot derive orgId from repoId: stripping 'repo:' prefix yields empty string` }
  }
  if (/[/\s]/.test(orgId)) {
    return { ok: false, error: `cannot derive orgId from repoId: '${orgId}' contains '/' or whitespace — not URL-path-safe` }
  }
  return { ok: true, orgId }
}

async function routeSignal(
  signal: import('@factory/schemas/weops-signals').InboundSignal,
  env: GatewayEnv,
): Promise<Response> {
  const arch = (env.ARCHITECT_AGENT_DO_URL ?? '').replace(/\/+$/, '')

  // Check required bindings exist before attempting fetch.
  function missingBinding(name: string): Response {
    return json({ error: `503 Service Unavailable: binding '${name}' not configured` }, 503)
  }

  let targetUrl: string | undefined
  // caStub is set for signals routed to a Commissioning Agent DO instance.
  let caStub: DurableObjectStub | undefined
  // caPath is the path appended to the DO stub's fetch URL when caStub is used.
  let caPath: string | undefined
  // translatedBody defaults to the raw signal; overridden for CA-bound signals
  // that require shape translation (R6).
  let translatedBody: unknown = signal

  switch (signal.signalType) {
    case 'CommissioningSignal': {
      if (!env.COMMISSIONING_AGENT) return missingBinding('COMMISSIONING_AGENT')
      // R2 — derive orgId from repoId (strip 'repo:' prefix; v1 convenience).
      const orgIdResult = resolveOrgId(signal.repoId)
      if (!orgIdResult.ok) {
        return json({ error: orgIdResult.error }, 400)
      }
      const { orgId } = orgIdResult
      // R1 — correct target route via DO stub.
      caStub = env.COMMISSIONING_AGENT.get(env.COMMISSIONING_AGENT.idFromName(`commissioning-agent:${orgId}`))
      caPath = '/signal'
      // R6 — translate InboundSignal → CA CommissioningSignalSchema body.
      translatedBody = {
        sessionId:              signal.dispositionEventId,
        orgId,
        repoId:                 signal.repoId,
        workGraphId:            signal.workGraphId,
        workGraphVersion:       signal.workGraphVersion,
        dispositionEventId:     signal.dispositionEventId,
        elucidationArtifactId:  signal.elucidationArtifactId,
        issuedAt:               signal.issuedAt,
        requireHumanApproval:   true,
      }
      break
    }
    case 'ResumeSignal': {
      if (!env.COMMISSIONING_AGENT) return missingBinding('COMMISSIONING_AGENT')
      // R7 — correct target route; body passes through as-is (v1).
      const orgIdResult = resolveOrgId(signal.repoId)
      if (!orgIdResult.ok) {
        return json({ error: orgIdResult.error }, 400)
      }
      caStub = env.COMMISSIONING_AGENT.get(env.COMMISSIONING_AGENT.idFromName(`commissioning-agent:${orgIdResult.orgId}`))
      caPath = '/resume'
      // TODO-2: DO must implement /resume handler
      break
    }
    case 'PatchAuthSignal':
      if (!arch) return missingBinding('ARCHITECT_AGENT_DO_URL')
      targetUrl = `${arch}/patch`
      break
    case 'PipelineConfigAuthSignal':
      if (!arch) return missingBinding('ARCHITECT_AGENT_DO_URL')
      targetUrl = `${arch}/pipeline-config-auth`
      break
    case 'OverrideSignal':
      if (signal.targetRepoId) {
        if (!env.COMMISSIONING_AGENT) return missingBinding('COMMISSIONING_AGENT')
        // R7 — correct target route for per-org override via DO stub.
        const orgIdResult = resolveOrgId(signal.targetRepoId)
        if (!orgIdResult.ok) {
          return json({ error: orgIdResult.error }, 400)
        }
        caStub = env.COMMISSIONING_AGENT.get(env.COMMISSIONING_AGENT.idFromName(`commissioning-agent:${orgIdResult.orgId}`))
        caPath = '/override'
        // TODO-2: DO must implement /override handler
      } else {
        if (!arch) return missingBinding('ARCHITECT_AGENT_DO_URL')
        targetUrl = `${arch}/override`
      }
      break
  }

  let resp: Response
  try {
    if (caStub !== undefined) {
      resp = await caStub.fetch(`https://do${caPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(translatedBody),
      })
    } else {
      resp = await fetch(targetUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(translatedBody),
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const dest = caStub !== undefined ? `DO commissioning-agent${caPath}` : targetUrl
    console.error(`Signal routing fetch failed to ${dest}:`, msg)
    return json({ error: `503 Service Unavailable: downstream unreachable — ${msg}` }, 503)
  }

  if (!resp.ok) {
    const body = await resp.text()
    const dest = caStub !== undefined ? `DO commissioning-agent${caPath}` : targetUrl
    console.error(`Signal routing: downstream ${dest} returned ${resp.status}: ${body}`)
    return json({ error: `503 Service Unavailable: downstream returned ${resp.status}` }, 503)
  }

  return resp
}

// ─── Resolved secrets (pre-fetched from Secrets Store in fetch handler) ──────

export interface GatewaySecrets {
  weopsSigningKey: string
  ffAgentSigningKey: string
}

// ─── POST /signals ────────────────────────────────────────────────────────────

export async function handleSignals(
  request: Request,
  env: GatewayEnv,
  secrets: GatewaySecrets,
): Promise<Response> {
  // Parse body first so we know the signalType for scope checking.
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }

  // Partial parse to extract signalType, dispositionEventId, elucidationArtifactId
  // before full schema validation — needed for JWT scope/A9 checks.
  if (typeof rawBody !== 'object' || rawBody === null) {
    return json({ error: 'Request body must be a JSON object' }, 400)
  }
  const partial = rawBody as Record<string, unknown>
  const signalType = typeof partial['signalType'] === 'string' ? partial['signalType'] : ''
  const signalDispositionEventId =
    typeof partial['dispositionEventId'] === 'string' ? partial['dispositionEventId'] : ''
  const signalElucidationArtifactId =
    typeof partial['elucidationArtifactId'] === 'string' ? partial['elucidationArtifactId'] : ''

  if (!signalType) {
    return json({ error: 'Missing "signalType" in request body' }, 400)
  }

  // Validate JWT (7 steps).
  const authHeader = request.headers.get('Authorization')
  const validationResult = await validateJwt(
    authHeader,
    secrets.weopsSigningKey,
    env.KV_REPLAY,
    signalType,
    signalDispositionEventId,
    signalElucidationArtifactId,
  )

  if (!validationResult.ok) {
    // status = -1 is the sentinel for "replay with cached body".
    if (validationResult.status === -1) {
      return new Response(validationResult.error, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return json({ error: validationResult.error }, validationResult.status)
  }

  const { claims } = validationResult

  // Full schema validation of the signal body.
  const signalParsed = InboundSignal.safeParse(rawBody)
  if (!signalParsed.success) {
    return json({ error: `Invalid signal body: ${signalParsed.error.message}` }, 400)
  }
  const signal = signalParsed.data

  // Route signal to the appropriate downstream.
  const routedResponse = await routeSignal(signal, env)
  const responseBody = await routedResponse.text()
  const responseStatus = routedResponse.status

  // Cache response for idempotent replays (only on success).
  if (responseStatus >= 200 && responseStatus < 300) {
    const jtiStore = makeJtiStore(env.KV_REPLAY)
    await jtiStore.setCachedResponse(claims.jti, responseBody, 86400)
  }

  return new Response(responseBody, {
    status: responseStatus,
    headers: {
      'Content-Type': routedResponse.headers.get('Content-Type') ?? 'application/json',
    },
  })
}

// ─── POST /escalations ────────────────────────────────────────────────────────

export async function handleEscalations(
  request: Request,
  env: GatewayEnv,
  secrets: GatewaySecrets,
): Promise<Response> {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }

  // Parse and verify the outbound envelope.
  const envelopeParsed = OutboundEnvelope.safeParse(rawBody)
  if (!envelopeParsed.success) {
    return json({ error: `Invalid WGSP envelope: ${envelopeParsed.error.message}` }, 400)
  }
  const envelope = envelopeParsed.data

  // Verify signature.
  const verifyResult = await verifyOutboundEnvelope(
    envelope,
    secrets.ffAgentSigningKey,
    async (agentId) => env.KV_REPLAY.get(`agent-key:${agentId}`),
  )
  if (!verifyResult.ok) {
    return json({ error: `Envelope verification failed: ${verifyResult.error}` }, 401)
  }

  // Verify the payload discriminated union.
  const payloadParsed = OutboundPayload.safeParse(envelope.work_graph.durable_objects)
  if (!payloadParsed.success) {
    return json({ error: `Invalid outbound payload: ${payloadParsed.error.message}` }, 400)
  }
  const payload = payloadParsed.data

  if (payload.signalType !== 'EscalationEvent') {
    return json({ error: `Unexpected signalType '${payload.signalType}' on /escalations` }, 400)
  }

  const { escalationId } = payload

  // Envelope idempotency.
  if (await isEnvelopeDelivered(env.KV_REPLAY, envelope.envelope_id)) {
    return json({ ok: true, idempotent: true, escalationId })
  }

  // Forward to We-layer escalations endpoint.
  if (!env.WEOPS_ENDPOINT_ESCALATIONS) {
    return json({ error: '503 Service Unavailable: WEOPS_ENDPOINT_ESCALATIONS not configured' }, 503)
  }

  let deliveryOk = false
  try {
    const fwd = await fetch(env.WEOPS_ENDPOINT_ESCALATIONS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    deliveryOk = fwd.ok
  } catch (err) {
    console.error('Escalation forward failed:', err)
  }

  if (!deliveryOk) {
    // Buffer for retry (TTL = 7 days).
    await queueOutboundRetry(env.KV_REPLAY, 'escalation', escalationId, JSON.stringify(envelope))
    return json({ error: '503 Service Unavailable: We-layer delivery failed; queued for retry' }, 503)
  }

  await markEnvelopeDelivered(env.KV_REPLAY, envelope.envelope_id, 604_800)
  return json({ ok: true, escalationId })
}

// ─── POST /vcrs ───────────────────────────────────────────────────────────────

export async function handleVcrs(
  request: Request,
  env: GatewayEnv,
  secrets: GatewaySecrets,
): Promise<Response> {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }

  // Parse and verify the outbound envelope.
  const envelopeParsed = OutboundEnvelope.safeParse(rawBody)
  if (!envelopeParsed.success) {
    return json({ error: `Invalid WGSP envelope: ${envelopeParsed.error.message}` }, 400)
  }
  const envelope = envelopeParsed.data

  // Verify signature.
  const verifyResult = await verifyOutboundEnvelope(
    envelope,
    secrets.ffAgentSigningKey,
    async (agentId) => env.KV_REPLAY.get(`agent-key:${agentId}`),
  )
  if (!verifyResult.ok) {
    return json({ error: `Envelope verification failed: ${verifyResult.error}` }, 401)
  }

  // Verify the payload.
  const payloadParsed = OutboundPayload.safeParse(envelope.work_graph.durable_objects)
  if (!payloadParsed.success) {
    return json({ error: `Invalid outbound payload: ${payloadParsed.error.message}` }, 400)
  }
  const payload = payloadParsed.data

  if (payload.signalType !== 'VCR') {
    return json({ error: `Unexpected signalType '${payload.signalType}' on /vcrs` }, 400)
  }

  const { vcrId } = payload

  // Envelope idempotency.
  if (await isEnvelopeDelivered(env.KV_REPLAY, envelope.envelope_id)) {
    return json({ ok: true, idempotent: true, vcrId })
  }

  // Forward to We-layer VCRs endpoint.
  if (!env.WEOPS_ENDPOINT_VCRS) {
    return json({ error: '503 Service Unavailable: WEOPS_ENDPOINT_VCRS not configured' }, 503)
  }

  let deliveryOk = false
  try {
    const fwd = await fetch(env.WEOPS_ENDPOINT_VCRS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    deliveryOk = fwd.ok
  } catch (err) {
    console.error('VCR forward failed:', err)
  }

  if (!deliveryOk) {
    // Buffer for retry (TTL = 30 days).
    await queueOutboundRetry(env.KV_REPLAY, 'vcr', vcrId, JSON.stringify(envelope))
    return json({ error: '503 Service Unavailable: We-layer delivery failed; queued for retry' }, 503)
  }

  await markEnvelopeDelivered(env.KV_REPLAY, envelope.envelope_id, 2_592_000)
  return json({ ok: true, vcrId })
}
