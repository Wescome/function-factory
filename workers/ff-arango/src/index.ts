import { Container } from "@cloudflare/containers";

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
export class ArangoStore extends Container {
  defaultPort = 8529;
  sleepAfter = "30m";
  enableInternet = true;

  private initialized = false;

  async fetch(request: Request): Promise<Response> {
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

    const res = await this.containerFetch(forwarded, 8529);

    // Auto-init DB + collections on first successful response after a (re)start.
    if (!this.initialized && res.ok) {
      this.initialized = true;
      this.ctx.waitUntil(this.ensureDatabase());
    }

    return res;
  }

  override onStop(): void {
    this.initialized = false;
  }

  private async ensureDatabase(): Promise<void> {
    const base = "http://localhost:8529";

    const post = (path: string, body: unknown) =>
      this.containerFetch(
        new Request(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        8529,
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
