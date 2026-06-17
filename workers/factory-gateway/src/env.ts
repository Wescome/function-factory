/**
 * @module env
 *
 * Cloudflare Workers environment bindings for factory-gateway.
 *
 * Bindings:
 *   COMMISSIONING_AGENT  — DO namespace; routes SubmitSession to the Commissioning Agent DO.
 *   SUB_BUFFER           — DO namespace; reads SessionEvents for streaming.
 *   SUB_BUFFER_KV        — KV namespace; liveness probe for SubscriptionEventBufferDO.
 *   WEOPS_SIGNING_KEY    — WGSP envelope HMAC-SHA256 verification key (base64).
 *   PDP                  — Service binding to factory-pdp worker (replaces PDP_URL).
 *   PDP_API_KEY          — Bearer token for PDP calls (secret).
 */
export interface Env {
  /** Durable Object namespace for the Commissioning Agent. */
  COMMISSIONING_AGENT: DurableObjectNamespace

  /** Durable Object namespace for the SubscriptionEventBufferDO. */
  SUB_BUFFER: DurableObjectNamespace

  /** KV namespace used to check liveness of a SubscriptionEventBufferDO instance. */
  SUB_BUFFER_KV: KVNamespace

  /** HMAC-SHA256 WGSP signing key, base64-encoded raw bytes. Sourced from CF Secrets Store. */
  WEOPS_SIGNING_KEY: SecretsStoreSecret

  /** Service binding to factory-pdp worker. */
  PDP: Fetcher

  /** Bearer token for authenticating PDP requests. Sourced from CF Secrets Store. */
  PDP_API_KEY: SecretsStoreSecret
}
