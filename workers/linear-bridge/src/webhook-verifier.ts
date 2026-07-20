/**
 * @module webhook-verifier
 *
 * Linear webhook HMAC-SHA256 signature verification using Web Crypto API.
 *
 * Linear sends a `Linear-Signature` header containing the hex-encoded HMAC-SHA256
 * signature of the raw request body, keyed by the webhook secret.
 *
 * The secret is a raw string (NOT base64-encoded). It is UTF-8-encoded before
 * being used as the HMAC key — contrast with WEOPS_SIGNING_KEY which is stored
 * as base64-encoded raw bytes.
 */

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verifies a Linear webhook HMAC-SHA256 signature.
 *
 * @param payload    Raw request body as a string
 * @param signature  Hex-encoded HMAC-SHA256 signature from `Linear-Signature` header
 * @param secret     Raw Linear webhook secret string (NOT base64; UTF-8 encoded as key)
 * @returns          true if signature is valid
 */
export async function verifyLinearSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  // Key is the raw webhook secret string, UTF-8-encoded.
  const keyBytes = new TextEncoder().encode(secret)
  let cryptoKey: CryptoKey
  try {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  } catch {
    console.error('webhook-verifier: failed to import HMAC key')
    return false
  }

  const msgBytes = new TextEncoder().encode(payload)
  const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes)

  // Convert ArrayBuffer → hex string for comparison with Linear-Signature header value.
  const expected = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison to prevent timing attacks.
  // Web Crypto has no timingSafeEqual equivalent, so we XOR each character code.
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    // Non-null assertion: both strings have length === expected.length checked above.
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}
