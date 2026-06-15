/**
 * @module jti-store
 *
 * JTI (JWT ID) deduplication store backed by Cloudflare KV.
 *
 * Prevents replay attacks by tracking seen token JTIs with a TTL
 * matching the token expiry window. Also supports caching the response
 * body for a given JTI so idempotent replays return the same result.
 *
 * KV key schema:
 *   jti:{jti}          → '1'                  TTL = 300s  (replay guard)
 *   jti-res:{jti}      → serialized response  TTL = 86400s (24h idempotency cache)
 */

export interface JtiStore {
  /** Returns true if the jti has been seen (replay detected). */
  has(jti: string): Promise<boolean>
  /** Marks the jti as seen for the guard window. */
  mark(jti: string, ttlSeconds?: number): Promise<void>
  /** Retrieves a cached response body, or null if absent. */
  getCachedResponse(jti: string): Promise<string | null>
  /** Stores a response body for idempotent replay. */
  setCachedResponse(jti: string, body: string, ttlSeconds?: number): Promise<void>
}

export function makeJtiStore(kv: KVNamespace): JtiStore {
  return {
    async has(jti: string): Promise<boolean> {
      const val = await kv.get(`jti:${jti}`)
      return val !== null
    },

    async mark(jti: string, ttlSeconds = 300): Promise<void> {
      await kv.put(`jti:${jti}`, '1', { expirationTtl: ttlSeconds })
    },

    async getCachedResponse(jti: string): Promise<string | null> {
      return kv.get(`jti-res:${jti}`)
    },

    async setCachedResponse(jti: string, body: string, ttlSeconds = 86400): Promise<void> {
      await kv.put(`jti-res:${jti}`, body, { expirationTtl: ttlSeconds })
    },
  }
}
