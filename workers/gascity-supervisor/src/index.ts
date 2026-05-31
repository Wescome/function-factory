import { Container } from "@cloudflare/containers";
import { FactoryStore } from "./factory-store-do";

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
    const active = await this.ctx.storage.get<boolean>("keepalive_active");
    if (active) {
      this.renewActivityTimeout();
      return;
    }
    await super.onActivityExpired();
  }

  override onStop(): void {
    this.ctx.storage.delete("keepalive_active").catch(() => {});
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/v0/keepalive/start" && request.method === "POST") {
      await this.ctx.storage.put("keepalive_active", true);
      this.renewActivityTimeout();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/v0/keepalive/stop" && request.method === "POST") {
      await this.ctx.storage.delete("keepalive_active");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
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
      const stub = env.FACTORY_STORE.get(env.FACTORY_STORE.idFromName(city))
      return stub.fetch(new Request(new URL(doPath + url.search, "https://do.internal"), request))
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
    const id = env.SUPERVISOR.idFromName("singleton-v24");
    const stub = env.SUPERVISOR.get(id);
    return stub.fetch(request);
  },
};

interface Env {
  SUPERVISOR: DurableObjectNamespace;
  FACTORY_STORE: DurableObjectNamespace;
  GC_SUPERVISOR_TOKEN: string;
  OPERATOR_CONTROL_TOKEN: string;
  GAS_CITY_HMAC_SECRET: string;
  DOLT_R2_ACCESS_KEY_ID: string;
  DOLT_R2_SECRET_ACCESS_KEY: string;
  DOLT_R2_ENDPOINT: string;
}

export { FactoryStore };
