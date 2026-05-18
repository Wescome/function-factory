/**
 * pi-container.ts — Durable Object shell that manages the pi Container lifecycle.
 *
 * CF Containers are DO-backed: each DO instance owns one container process.
 * `fetch()` starts the container on first call then forwards requests to
 * server.mjs on port 8080. `buildCfWorkerRegistry` addresses a singleton
 * DO ID ("pi") so all stages share one warm container rather than spawning
 * a new one per stage.
 *
 * Wiring: wrangler.jsonc `containers[class_name=PiContainer]` + DO binding
 * `PI_CONTAINER`. The Worker never imports this class directly — CF routes
 * via the namespace binding.
 */

import { DurableObject } from "cloudflare:workers"
import type { HarnessBridgeEnv } from "../harness-env.js"

const CONTAINER_PORT = 8080
// Retry parameters for container cold-start: up to 15 attempts × 500ms = 7.5s
const STARTUP_RETRY_COUNT = 15
const STARTUP_RETRY_DELAY_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class PiContainer extends DurableObject<HarnessBridgeEnv> {
  override async fetch(request: Request): Promise<Response> {
    if (!this.ctx.container) {
      return new Response(
        JSON.stringify({ error: "pi container not available on this runtime" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      )
    }

    if (!this.ctx.container.running) {
      this.ctx.container.start({
        enableInternet: true,
        env: {
          PI_MODEL: this.env.PI_MODEL ?? 'openrouter/moonshotai/kimi-k2',
          OPENROUTER_API_KEY: this.env.OFOX_API_KEY,
        },
      })
      // Non-blocking: fire monitor() so the DO can detect container crashes,
      // but do not await — we want to proceed with the request immediately.
      this.ctx.container.monitor().catch(() => {})
    }

    // Retry with backoff on cold start: the container needs a moment to boot
    // before server.mjs is listening on port 8080. Clone the request each
    // attempt so the body stream is not consumed on a failed try.
    for (let attempt = 0; attempt < STARTUP_RETRY_COUNT; attempt++) {
      try {
        return await this.ctx.container.getTcpPort(CONTAINER_PORT).fetch(request.clone())
      } catch (err) {
        const isNotListening =
          err instanceof Error && err.message.includes("not listening")
        if (!isNotListening || attempt === STARTUP_RETRY_COUNT - 1) {
          throw err
        }
        await sleep(STARTUP_RETRY_DELAY_MS)
      }
    }

    // Final attempt without clone (body hasn't been consumed if all prior
    // clones threw before reading)
    return this.ctx.container.getTcpPort(CONTAINER_PORT).fetch(request)
  }
}
