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

const CONTAINER_PORT = 8080

export class PiContainer extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (!this.ctx.container) {
      return new Response(
        JSON.stringify({ error: "pi container not available on this runtime" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      )
    }

    if (!this.ctx.container.running) {
      this.ctx.container.start()
      // Non-blocking: monitor() resolves when the container exits (crash/stop).
      // We do not await it here — we fire it so the DO can react if the
      // container crashes, but we don't block the current request on it.
      this.ctx.container.monitor().catch(() => {})
    }

    return this.ctx.container.getTcpPort(CONTAINER_PORT).fetch(request)
  }
}
