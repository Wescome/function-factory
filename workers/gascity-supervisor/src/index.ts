import { Container } from "@cloudflare/containers";
import { FactoryStore } from "./factory-store-do";

const SUPERVISOR_SINGLETON = "singleton-v45";

export class GasCitySupervisor extends Container<Env> {
  defaultPort = 9443;
  sleepAfter = "30m";
  enableInternet = true;

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      // Inject the operator token so gc supervisor run can authenticate
      // outbound calls to ff-pipeline /__pi-container/execute.
      // city.toml [provider.pi-rpc] token_env = "FF_OPERATOR_CONTROL_TOKEN"
      FF_OPERATOR_CONTROL_TOKEN: env.OPERATOR_CONTROL_TOKEN,
      GC_SUPERVISOR_TOKEN: env.GC_SUPERVISOR_TOKEN,
      GC_BEAD_STORE_URL: "https://gascity-supervisor.koales.workers.dev/internal/bead-store/factory",
      GAS_CITY_HMAC_SECRET: env.GAS_CITY_HMAC_SECRET,
      // R2-backed Dolt bead store — S3-compatible credentials for dolt push/pull
      AWS_ACCESS_KEY_ID: env.DOLT_R2_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: env.DOLT_R2_SECRET_ACCESS_KEY,
      AWS_REGION: "auto",
      DOLT_R2_ENDPOINT: env.DOLT_R2_ENDPOINT,
      DOLT_AWS_ENDPOINT: "https://cb56a846c70a38987f31cf6e2b85cb57.r2.cloudflarestorage.com",
    };
  }

  override async onActivityExpired(): Promise<void> {
    const refcount = (await this.ctx.storage.get<number>("keepalive_refcount")) ?? 0;
    if (refcount > 0) {
      this.renewActivityTimeout();
      return;
    }
    await super.onActivityExpired();
  }

  override onStop(): void {
    this.ctx.storage.delete("keepalive_refcount").catch(() => {});
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/v0/keepalive/start" && request.method === "POST") {
      const current = (await this.ctx.storage.get<number>("keepalive_refcount")) ?? 0;
      const next = current + 1;
      await this.ctx.storage.put("keepalive_refcount", next);
      this.renewActivityTimeout();
      return new Response(JSON.stringify({ ok: true, refcount: next }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/v0/keepalive/stop" && request.method === "POST") {
      const current = (await this.ctx.storage.get<number>("keepalive_refcount")) ?? 0;
      const next = Math.max(0, current - 1);
      await this.ctx.storage.put("keepalive_refcount", next);
      // Other concurrent molecules still hold the Container pinned — keep it warm.
      if (next > 0) {
        this.renewActivityTimeout();
      }
      return new Response(JSON.stringify({ ok: true, refcount: next }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/__supervisor/fence") {
      const refcount = (await this.ctx.storage.get<number>("keepalive_refcount")) ?? 0;
      return new Response(
        JSON.stringify({ active: refcount > 0, refcount }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Inject CSRF header — Gas City requires X-GC-Request on all mutations.
    const headers = new Headers(request.headers);
    headers.set("X-GC-Request", "true");

    // Rewrite to http:// — getTcpPort connects over plain TCP; https:// is rejected.
    url.protocol = "http:";
    url.hostname = "localhost";
    url.port = "9443";

    // Build forwarded request. Omit body on GET/HEAD to avoid "body with GET" errors.
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const forwarded = new Request(url.toString(), {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
    });

    try {
      return await this.containerFetch(forwarded, 9443);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "container_not_ready", detail: String(e) }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/internal/telemetry" && request.method === "POST") {
      const auth = request.headers.get("Authorization") ?? ""
      if (auth !== `Bearer ${env.GC_SUPERVISOR_TOKEN}`) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      }
      let events: unknown[] = []
      try {
        const body = await request.json<unknown>()
        if (!Array.isArray(body)) {
          return new Response(JSON.stringify({ error: "events must be an array" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })
        }
        if (body.length > 50) {
          return new Response(JSON.stringify({ error: "max 50 events per batch" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })
        }
        events = body
      } catch {
        return new Response(JSON.stringify({ error: "invalid json" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (!env.TELEMETRY_QUEUE) {
        return new Response(JSON.stringify({ error: "telemetry_queue_unbound" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      }
      await env.TELEMETRY_QUEUE.send(events)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname === "/internal/telemetry/health" && request.method === "GET") {
      const auth = request.headers.get("Authorization") ?? ""
      if (auth !== `Bearer ${env.GC_SUPERVISOR_TOKEN}`) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      }
      const ok = Boolean(env.TELEMETRY_QUEUE)
      return new Response(JSON.stringify({
        ok,
        telemetry_queue_bound: ok,
        timestamp: new Date().toISOString(),
      }), {
        status: ok ? 200 : 503,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname.startsWith("/internal/bead-store/")) {
      const auth = request.headers.get("Authorization") ?? ""
      if (auth !== `Bearer ${env.GC_SUPERVISOR_TOKEN}`) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      }
      const rest = url.pathname.slice("/internal/bead-store/".length)
      const slash = rest.indexOf("/")
      if (slash <= 0) {
        return new Response(JSON.stringify({ error: "invalid_path" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      }
      const city = rest.slice(0, slash)
      const doPath = rest.slice(slash)
      // Proxy is the auth gate (validated above against the always-current secret).
      // Strip the rotating bearer and inject a stable internal sentinel so the DO
      // validates something that never goes stale on token rotation.
      const inner = new Headers(request.headers)
      inner.delete("Authorization")
      inner.set("X-FF-Internal", "factory-store")
      const stub = env.FACTORY_STORE.get(env.FACTORY_STORE.idFromName(city))
      return stub.fetch(new Request(new URL(doPath + url.search, "https://do.internal"), {
        method: request.method,
        headers: inner,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      }))
    }

    // Auth gate — all requests require bearer token
    const auth = request.headers.get("Authorization") ?? "";
    if (auth !== `Bearer ${env.GC_SUPERVISOR_TOKEN}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Singleton supervisor DO. The suffix intentionally rotates the container
    // instance after Gas City graph routing/session runtime fixes so Cloudflare
    // starts the newly deployed image instead of reusing a warm pre-fix container.
    const id = env.SUPERVISOR.idFromName(SUPERVISOR_SINGLETON);
    const stub = env.SUPERVISOR.get(id);
    return stub.fetch(request);
  },
};

interface Env {
  SUPERVISOR: DurableObjectNamespace;
  FACTORY_STORE: DurableObjectNamespace;
  TELEMETRY_QUEUE?: Queue;
  GC_SUPERVISOR_TOKEN: string;
  OPERATOR_CONTROL_TOKEN: string;
  GAS_CITY_HMAC_SECRET: string;
  DOLT_R2_ACCESS_KEY_ID: string;
  DOLT_R2_SECRET_ACCESS_KEY: string;
  DOLT_R2_ENDPOINT: string;
}

export { FactoryStore };
