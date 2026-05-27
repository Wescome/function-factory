import { DurableObject } from "cloudflare:workers";

const COLLECTIONS = [
  "execution_packets",
  "formulas",
  "dispatch_log",
  "verification_reports",
  "functions",
  "pressures",
  "function_proposals",
  "intent_specifications",
  "executable_specifications",
  "lineage_edges",
  "invariants",
  "trellis_execution_packets",
];

const DB_NAME = "function_factory";
// Re-arm every 20s — keeps DO alive so the container never idles out.
const KEEPALIVE_MS = 20_000;

export class ArangoStore extends DurableObject {
  private initialized = false;

  async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start();
      this.initialized = false;
      console.log(`[arango-store] container started`);
    }

    // Arm the keepalive alarm on first access so the DO never hibernates.
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_MS);
    }

    const url = new URL(request.url);
    url.protocol = "http:";
    url.hostname = "localhost";
    url.port = "8529";

    const headers = new Headers(request.headers);
    headers.delete("Authorization"); // ArangoDB runs with ARANGO_NO_AUTH=1

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const forwarded = new Request(url.toString(), {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
    });

    let res: Response;
    try {
      res = await container.getTcpPort(8529).fetch(forwarded);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "container_not_ready", detail: String(e) }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    // Auto-init DB + collections on first successful response after a (re)start.
    if (!this.initialized && res.ok) {
      this.initialized = true;
      this.ctx.waitUntil(this.ensureDatabase());
    }

    return res;
  }

  async alarm(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start();
      this.initialized = false;
      console.log(`[arango-store] alarm: container restarted`);
    }
    await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_MS);
  }

  private async ensureDatabase(): Promise<void> {
    const container = this.ctx.container!;
    const base = "http://localhost:8529";

    const post = (path: string, body: unknown) =>
      container.getTcpPort(8529).fetch(
        new Request(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ).catch(() => null);

    await post("/_api/database", { name: DB_NAME });
    for (const col of COLLECTIONS) {
      await post(`/_db/${DB_NAME}/_api/collection`, { name: col });
    }
    console.log(`[arango-store] DB + ${COLLECTIONS.length} collections ensured`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const authHeader = request.headers.get("Authorization") ?? "";
    if (authHeader.startsWith("Basic ")) {
      const decoded = atob(authHeader.slice(6));
      const colonIdx = decoded.indexOf(":");
      const username = decoded.slice(0, colonIdx);
      const password = decoded.slice(colonIdx + 1);
      if (username === "root" && password === env.ARANGO_ROOT_PASSWORD) {
        const id = env.ARANGO_STORE.idFromName("singleton");
        const stub = env.ARANGO_STORE.get(id);
        return stub.fetch(request);
      }
    }
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  },
};

interface Env {
  ARANGO_STORE: DurableObjectNamespace;
  ARANGO_ROOT_PASSWORD: string;
}
