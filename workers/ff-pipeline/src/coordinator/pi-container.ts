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
import {
  resolveDesiredPiContainerBuildId,
  shouldRestartPiContainerForBuild,
} from "./pi-container-version.js"

const CONTAINER_PORT = 8080
// Retry parameters for container cold-start: up to 15 attempts × 500ms = 7.5s
const STARTUP_RETRY_COUNT = 15
const STARTUP_RETRY_DELAY_MS = 500
const STARTED_BUILD_ID_KEY = "pi:container:started-build-id"
const STARTED_AT_KEY = "pi:container:started-at"
const LAST_MONITOR_EVENT_KEY = "pi:container:last-monitor-event"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class PiContainer extends DurableObject<HarnessBridgeEnv> {
  private startPromise: Promise<void> | null = null

  override async fetch(request: Request): Promise<Response> {
    if (!this.ctx.container) {
      return new Response(
        JSON.stringify({ error: "pi container not available on this runtime" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      )
    }

    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/__pi-container/status") {
      return this.statusResponse()
    }

    if (request.method === "POST" && url.pathname === "/__pi-container/restart") {
      const desiredBuildId = resolveDesiredPiContainerBuildId(this.env)
      await this.restartContainer(desiredBuildId, "manual")
      return this.statusResponse()
    }

    await this.ensureContainerReady()

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

  private async ensureContainerReady(): Promise<void> {
    if (!this.ctx.container) return

    const desiredBuildId = resolveDesiredPiContainerBuildId(this.env)
    const startedBuildId = await this.ctx.storage.get<string>(STARTED_BUILD_ID_KEY)
    if (shouldRestartPiContainerForBuild({
      running: this.ctx.container.running,
      startedBuildId: startedBuildId ?? null,
      desiredBuildId,
    })) {
      console.warn("pi.container.version_mismatch_restart", {
        desiredBuildId,
        startedBuildId: startedBuildId ?? null,
      })
      await this.restartContainer(desiredBuildId, "worker-version-changed")
      return
    }

    if (!this.ctx.container.running) {
      await this.startContainer(desiredBuildId)
    }
  }

  private async restartContainer(desiredBuildId: string, reason: string): Promise<void> {
    if (!this.ctx.container) return

    if (this.ctx.container.running) {
      await this.ctx.container.destroy(reason)
    }
    await this.ctx.storage.delete(STARTED_BUILD_ID_KEY)
    await this.ctx.storage.delete(STARTED_AT_KEY)
    await this.startContainer(desiredBuildId)
  }

  private async startContainer(desiredBuildId: string): Promise<void> {
    if (!this.ctx.container) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this.startContainerOnce(desiredBuildId)
      .finally(() => {
        this.startPromise = null
      })
    return this.startPromise
  }

  private async startContainerOnce(desiredBuildId: string): Promise<void> {
    if (!this.ctx.container) return

    const startedAt = new Date().toISOString()
    console.log("pi.container.start", { desiredBuildId, startedAt })
    this.ctx.container.start({
      enableInternet: true,
      env: {
        PI_MODEL: this.env.PI_MODEL ?? 'openrouter/openai/gpt-5.4',
        PI_WORKER_VERSION_ID: desiredBuildId,
        PI_CONTAINER_STARTED_AT: startedAt,
        ...(this.env.CF_VERSION_METADATA?.tag ? { PI_WORKER_VERSION_TAG: this.env.CF_VERSION_METADATA.tag } : {}),
        ...(this.env.CF_VERSION_METADATA?.timestamp ? { PI_WORKER_VERSION_TIMESTAMP: this.env.CF_VERSION_METADATA.timestamp } : {}),
        ...(this.env.PI_MODEL_CANDIDATES ? { PI_MODEL_CANDIDATES: this.env.PI_MODEL_CANDIDATES } : {}),
        ...(this.env.PI_FILESYSTEM_MODEL_CANDIDATES ? { PI_FILESYSTEM_MODEL_CANDIDATES: this.env.PI_FILESYSTEM_MODEL_CANDIDATES } : {}),
        OPENROUTER_API_KEY: this.env.OFOX_API_KEY,
      },
    })
    await this.ctx.storage.put(STARTED_BUILD_ID_KEY, desiredBuildId)
    await this.ctx.storage.put(STARTED_AT_KEY, startedAt)
    this.monitorContainer(desiredBuildId)
  }

  private monitorContainer(buildId: string): void {
    this.ctx.container?.monitor()
      .then(() => this.recordMonitorEvent({ level: "info", event: "exit", buildId }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error("pi.container.error", { buildId, message })
        void this.recordMonitorEvent({ level: "error", event: "error", buildId, message })
      })
  }

  private async recordMonitorEvent(event: {
    level: "info" | "error"
    event: "exit" | "error"
    buildId: string
    message?: string
  }): Promise<void> {
    await this.ctx.storage.put(LAST_MONITOR_EVENT_KEY, {
      ...event,
      ts: new Date().toISOString(),
    })
  }

  private async statusResponse(): Promise<Response> {
    const [startedBuildId, startedAt, lastMonitorEvent] = await Promise.all([
      this.ctx.storage.get<string>(STARTED_BUILD_ID_KEY),
      this.ctx.storage.get<string>(STARTED_AT_KEY),
      this.ctx.storage.get<unknown>(LAST_MONITOR_EVENT_KEY),
    ])
    return new Response(
      JSON.stringify({
        status: "ok",
        running: Boolean(this.ctx.container?.running),
        desiredBuildId: resolveDesiredPiContainerBuildId(this.env),
        startedBuildId: startedBuildId ?? null,
        startedAt: startedAt ?? null,
        lastMonitorEvent: lastMonitorEvent ?? null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }
}
