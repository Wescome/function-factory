/**
 * @factory/subscription-buffer — hmac
 *
 * HMAC-SHA256 producer token helpers.
 * Spec: Factory GraphQL Subscription Replay Contract v1 §5.2
 */

const enc = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

/**
 * Compute HMAC-SHA256(secret, sessionId) and return as hex string.
 */
export async function computeProducerToken(
  secret:    string,
  sessionId: string
): Promise<string> {
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(sessionId))
  return toHex(sig)
}

/**
 * Constant-time comparison of the expected HMAC against a provided token.
 * Compares hex strings byte-by-byte via XOR to avoid timing attacks.
 */
export async function verifyProducerToken(
  secret:    string,
  sessionId: string,
  token:     string
): Promise<boolean> {
  const expected = await computeProducerToken(secret, sessionId)
  if (expected.length !== token.length) return false

  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  }
  return diff === 0
}
