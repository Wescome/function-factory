/**
 * @module envelope-signer
 *
 * WGSP outbound envelope signing and verification using Web Crypto API.
 *
 * Signing (I-layer agents):
 *   - HMAC-SHA256 over RFC 8785 canonical JSON of the envelope (excluding
 *     the `signature` field itself).
 *   - signing_kernel_id = 'factory-i-layer'
 *
 * Verification (gateway inbound from I-layer):
 *   - Recomputes canonical JSON, checks HMAC-SHA256 against stored key.
 *   - Also checks agent is in KV registry and signed_at is within 60s.
 *
 * RFC 8785 canonical JSON:
 *   Implemented inline (no external package). Object keys sorted
 *   lexicographically at every nesting level; primitives serialized
 *   with standard JSON.stringify rules. Arrays preserve order.
 */

import type { EnvelopeSignature, OutboundEnvelope } from "@factory/schemas/wgsp-envelope"

// ─── RFC 8785 Canonical JSON ──────────────────────────────────────────────────

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Produces RFC 8785 canonical JSON: object keys sorted lexicographically
 * (UTF-16 code unit order, which matches JS String.prototype.localeCompare
 * with no locale — i.e. simple < comparison), arrays preserve insertion order,
 * primitives use standard JSON serialization.
 */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value as JsonValue)
}

function canonicalizeValue(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error('RFC8785: non-finite numbers not allowed')
    // Use JSON.stringify for number serialization (handles -0, integers, floats).
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    const items = (value as JsonValue[]).map(canonicalizeValue)
    return `[${items.join(',')}]`
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, JsonValue>
    const keys = Object.keys(obj).sort()
    const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeValue(obj[k] as JsonValue)}`)
    return `{${pairs.join(',')}}`
  }
  throw new Error(`RFC8785: unsupported type ${typeof value}`)
}

// ─── Base64 helpers (Web Crypto works with ArrayBuffer) ───────────────────────

function base64Encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ─── Sign ─────────────────────────────────────────────────────────────────────

/**
 * Signs an envelope (without its signature field) using HMAC-SHA256.
 * Called by I-layer agents (Mediation Agent DO, Commissioning Agent Worker).
 *
 * @param envelopeWithoutSig  Envelope object with the `signature` field absent.
 * @param signingKeyBase64    FF_AGENT_SIGNING_KEY as base64-encoded raw bytes.
 * @returns                   EnvelopeSignature to attach to the envelope.
 */
export async function signEnvelope(
  envelopeWithoutSig: Omit<OutboundEnvelope, 'signature'>,
  signingKeyBase64: string,
): Promise<EnvelopeSignature> {
  const canonical = canonicalize(envelopeWithoutSig as unknown)
  const keyBytes = base64Decode(signingKeyBase64)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const msgBytes = new TextEncoder().encode(canonical)
  const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes)
  return {
    algorithm: 'HMAC-SHA256',
    signing_kernel_id: 'factory-i-layer',
    signed_at: new Date().toISOString(),
    signature: base64Encode(sigBytes),
    canonicalization: 'RFC8785',
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────────

export interface VerifyResult {
  ok: boolean
  error?: string
}

/**
 * Verifies the HMAC-SHA256 signature on an outbound envelope.
 * Called by ff-gateway when receiving POST /escalations or POST /vcrs.
 *
 * @param envelope            Full OutboundEnvelope (with signature).
 * @param agentSigningKeyB64  FF_AGENT_SIGNING_KEY as base64-encoded raw bytes.
 * @param agentKeyLookup      KV-backed lookup for per-agent keys (optional override).
 * @param stalenessMs         Maximum age of signed_at (default 60s).
 */
export async function verifyOutboundEnvelope(
  envelope: OutboundEnvelope,
  agentSigningKeyB64: string,
  agentKeyLookup: ((agentId: string) => Promise<string | null>) | null = null,
  stalenessMs = 60_000,
): Promise<VerifyResult> {
  const sig = envelope.signature
  if (!sig) return { ok: false, error: 'missing signature' }

  if (sig.signing_kernel_id !== 'factory-i-layer') {
    return { ok: false, error: `unknown signing_kernel_id: ${sig.signing_kernel_id}` }
  }

  // If a per-agent key lookup is provided, use it; otherwise fall back to the
  // shared FF_AGENT_SIGNING_KEY.
  let keyBase64 = agentSigningKeyB64
  if (agentKeyLookup) {
    const agentKey = await agentKeyLookup(envelope.source.agent_id)
    if (agentKey === null) {
      return { ok: false, error: `unknown agent: ${envelope.source.agent_id}` }
    }
    keyBase64 = agentKey
  }

  // Check signed_at staleness.
  const signedAt = new Date(sig.signed_at).getTime()
  if (isNaN(signedAt)) return { ok: false, error: 'invalid signed_at timestamp' }
  if (Math.abs(Date.now() - signedAt) > stalenessMs) {
    return { ok: false, error: 'stale signature' }
  }

  // Reconstruct the signed payload: envelope minus the `signature` field.
  const { signature: _omitted, ...envelopeWithoutSig } = envelope
  const canonical = canonicalize(envelopeWithoutSig as unknown)

  // Verify HMAC-SHA256.
  const keyBytes = base64Decode(keyBase64)
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
    return { ok: false, error: 'invalid signing key' }
  }

  const sigBytes = base64Decode(sig.signature)
  const msgBytes = new TextEncoder().encode(canonical)
  const valid = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, msgBytes)
  if (!valid) return { ok: false, error: 'invalid signature' }

  return { ok: true }
}

// ─── Envelope idempotency helpers ─────────────────────────────────────────────

/**
 * Checks whether an outbound envelope has already been delivered.
 * Keyed by `env:{envelope_id}` in KV_REPLAY.
 */
export async function isEnvelopeDelivered(
  kv: KVNamespace,
  envelopeId: string,
): Promise<boolean> {
  const val = await kv.get(`env:${envelopeId}`)
  return val !== null
}

/**
 * Marks an outbound envelope as delivered in KV.
 */
export async function markEnvelopeDelivered(
  kv: KVNamespace,
  envelopeId: string,
  ttlSeconds: number,
): Promise<void> {
  await kv.put(`env:${envelopeId}`, '1', { expirationTtl: ttlSeconds })
}

/**
 * Stores a failed outbound envelope in the KV retry queue.
 *
 * key pattern:
 *   escalation:{escalationId}  TTL = 7 days (604800s)
 *   vcr:{vcrId}                TTL = 30 days (2592000s)
 */
export async function queueOutboundRetry(
  kv: KVNamespace,
  type: 'escalation' | 'vcr',
  id: string,
  envelopeJson: string,
): Promise<void> {
  const ttl = type === 'escalation' ? 604_800 : 2_592_000
  await kv.put(`${type}:${id}`, envelopeJson, { expirationTtl: ttl })
}
