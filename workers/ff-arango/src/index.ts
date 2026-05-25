import { DurableObject } from "cloudflare:workers";

export class ArangoStore extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start();
    }

    const url = new URL(request.url);
    url.protocol = "http:";
    url.hostname = "localhost";
    url.port = "8529";

    // Strip auth — ArangoDB container runs with ARANGO_NO_AUTH=1
    const headers = new Headers(request.headers);
    headers.delete("Authorization");

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const forwarded = new Request(url.toString(), {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
    });

    try {
      return await container.getTcpPort(8529).fetch(forwarded);
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
    // Validate Basic Auth: root:<ARANGO_ROOT_PASSWORD>
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
