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
 *   PDP_URL              — WeOps Kernel PDP endpoint (e.g. https://pdp.weops.internal).
 *   PDP_API_KEY          — Bearer token for PDP calls (secret).
 */
export interface Env {
  /** Durable Object namespace for the Commissioning Agent. */
  COMMISSIONING_AGENT: DurableObjectNamespace

  /** Durable Object namespace for the SubscriptionEventBufferDO. */
  SUB_BUFFER: DurableObjectNamespace

  /** KV namespace used to check liveness of a SubscriptionEventBufferDO instance. */
  SUB_BUFFER_KV: KVNamespace

  /** HMAC-SHA256 WGSP signing key, base64-encoded raw bytes. */
  WEOPS_SIGNING_KEY: string

  /** WeOps Kernel Policy Decision Point URL. */
  PDP_URL: string

  /** Bearer token for authenticating PDP requests. */
  PDP_API_KEY: string
}
