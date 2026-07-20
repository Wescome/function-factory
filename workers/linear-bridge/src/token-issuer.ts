/**
 * @module token-issuer
 *
 * Issues WeOpsDispositionToken JWTs signed with HMAC-SHA256 using WEOPS_SIGNING_KEY.
 *
 * The gateway (signals-handler.ts) validates with:
 *   crypto.subtle.importKey('raw', base64Decode(signingKeyBase64), {name:'HMAC',hash:'SHA-256'}, false, ['verify'])
 *
 * The bridge signs with the same key:
 *   crypto.subtle.importKey('raw', base64Decode(signingKeyBase64), {name:'HMAC',hash:'SHA-256'}, false, ['sign'])
 *
 * Key format: WEOPS_SIGNING_KEY is base64-encoded raw bytes on both sides.
 * Do NOT UTF-8-encode it like the Linear webhook secret.
 *
 * JWT format: HS256 HMAC-SHA256, base64url-encoded header.payload.signature
 * Claims conform to WeOpsDispositionTokenClaims zod schema:
 *   iss: 'weops-gateway'   (intentional — bridge acts as authorized issuer)
 *   aud: 'factory-i-layer'
 *   exp: iat + 300
 *   scope: [required scope for verb]
 *   dispositionEventId: ELC-* node ID
 *   elucidationArtifactId: same ELC-* node ID
 */

import type { WeOpsDispositionTokenClaims, TokenScope } from '@factory/schemas/weops-disposition-token'

// ─── Base64 helpers ────────────────────────────────────────────────────────────

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlEncodeString(str: string): string {
  // TextEncoder → ArrayBuffer path for strings (header, payload JSON)
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// ─── Token Issuer ─────────────────────────────────────────────────────────────

export interface TokenIssuanceInput {
  /** Linear user ID of the commenter */
  sub: string
  /** Scopes granted (derived from verb) */
  scope: TokenScope[]
  /** ELC-* node ID — must match elucidationArtifactId */
  dispositionEventId: string
  /** ELC-* node ID — must match dispositionEventId */
  elucidationArtifactId: string
}

/**
 * Issues a WeOpsDispositionToken JWT.
 *
 * Steps:
 * 1. Build header + payload claims
 * 2. base64url-encode header.payload
 * 3. HMAC-SHA256 sign with WEOPS_SIGNING_KEY (base64-decoded raw bytes)
 * 4. Append signature as base64url
 * 5. Store JTI in BRIDGE_KV (TTL 300s) for local replay prevention
 *
 * @param input             Token claims input
 * @param signingKeyBase64  WEOPS_SIGNING_KEY — base64-encoded raw bytes
 * @param kv                BRIDGE_KV — for JTI replay prevention storage
 * @returns                 Signed JWT string
 */
export async function issueDispositionToken(
  input: TokenIssuanceInput,
  signingKeyBase64: string,
  kv: KVNamespace,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const jti = crypto.randomUUID()

  const header = { alg: 'HS256', typ: 'JWT' }
  const payload: WeOpsDispositionTokenClaims = {
    iss: 'weops-gateway',
    sub: input.sub,
    aud: 'factory-i-layer',
    iat: now,
    exp: now + 300,
    jti,
    scope: input.scope,
    dispositionEventId: input.dispositionEventId,
    elucidationArtifactId: input.elucidationArtifactId,
  }

  const headerB64 = base64urlEncodeString(JSON.stringify(header))
  const payloadB64 = base64urlEncodeString(JSON.stringify(payload))
  const signedContent = `${headerB64}.${payloadB64}`

  // Import key — base64-encoded raw bytes matching gateway's importKey call.
  const keyBytes = base64Decode(signingKeyBase64)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const msgBytes = new TextEncoder().encode(signedContent)
  const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes)
  const sigB64 = base64urlEncode(sigBytes)

  // Store JTI for local replay prevention (gateway checks independently in KV_REPLAY).
  await kv.put(`jti:${jti}`, '1', { expirationTtl: 300 })

  return `${headerB64}.${payloadB64}.${sigB64}`
}
