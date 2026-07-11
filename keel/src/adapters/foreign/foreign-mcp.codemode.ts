import { CodemodeConnector } from "@cloudflare/codemode";
import { foreignCall } from "./mcp-call";
import type { ForeignAllowlist, ResponseSchema } from "../../domain/index";
import type { CallRecorder } from "../codemode/call-recorder";

export interface ForeignToolConfig {
  /** KEEL-authored description — NEVER the foreign server's own tools/list text
   *  (INV-FOREIGN-DESC-NOT-INGESTED). foreignCall doesn't call tools/list at
   *  all, so there's no server-authored text anywhere in this path to ingest. */
  readonly description: string;
  readonly responseSchema: ResponseSchema;
  /** D8: this foreign tool's effect is consequential — pause for human approval
   *  before it runs, same mechanism gate.commit uses. */
  readonly requiresApproval?: boolean;
}

export interface ForeignMcpConnectorConfig {
  readonly connectorName: string;
  readonly serverUrl: string;
  readonly allow: ForeignAllowlist;
  readonly tools: Readonly<Record<string, ForeignToolConfig>>;
  readonly recorder?: CallRecorder;
  readonly fetchImpl?: typeof fetch;
}

/**
 * The live delta over the deterministic 6b core: foreignCall issues a bare
 * tools/call, but a real 2025-11-25 Streamable-HTTP server requires an
 * initialize handshake first (-> Mcp-Session-Id), then that header on every
 * subsequent call. This is done ENTIRELY by wrapping the injected fetchImpl —
 * foreignCall's own code is untouched. Session state is per-connector-instance
 * (i.e. per DO lifetime); a fresh DO re-handshakes on its first foreign call.
 */
class McpSession {
  private sessionId: string | undefined;
  private initializing: Promise<string | undefined> | undefined;

  constructor(private readonly serverUrl: string, private readonly fetchImpl: typeof fetch) {}

  async ensure(): Promise<string | undefined> {
    if (this.sessionId !== undefined) return this.sessionId;
    if (!this.initializing) this.initializing = this.doInitialize();
    return this.initializing;
  }

  private async doInitialize(): Promise<string | undefined> {
    const res = await this.fetchImpl(this.serverUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "keel", version: "0.1.0" },
        },
      }),
    });
    if (!res.ok) throw new Error(`MCP initialize failed: HTTP ${res.status}`);
    // Validate this is actually the origin we asked for (no redirect to somewhere
    // else slipped in) before trusting anything it handed back, session id included.
    if (new URL(res.url).origin !== new URL(this.serverUrl).origin) {
      throw new Error(`MCP initialize response came from an unexpected origin: ${res.url}`);
    }
    const sessionId = res.headers.get("Mcp-Session-Id") ?? undefined;
    if (sessionId) {
      // notifications/initialized is a notification (no id, no response expected);
      // best-effort per spec — some servers gate tools/call on having seen it,
      // most don't, but sending it costs nothing and matches the real handshake.
      await this.fetchImpl(this.serverUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "Mcp-Session-Id": sessionId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      }).catch(() => {});
    }
    this.sessionId = sessionId;
    return sessionId;
  }
}

export class ForeignMcpConnector extends CodemodeConnector<unknown> {
  private readonly session: McpSession;
  // The global `fetch` relies on internal state bound to its receiver; passing
  // the bare function reference around (e.g. `cfg.fetchImpl ?? fetch`) and
  // calling it detached throws "Illegal invocation" on Workers. Bind once, here.
  private readonly baseFetch: typeof fetch;

  constructor(ctx: unknown, env: unknown, private readonly cfg: ForeignMcpConnectorConfig) {
    super(ctx as never, env as never);
    this.baseFetch = cfg.fetchImpl ?? fetch.bind(globalThis);
    this.session = new McpSession(cfg.serverUrl, this.baseFetch);
  }

  override name() { return this.cfg.connectorName; }

  override tools() {
    const out: Record<string, { description: string; requiresApproval?: boolean; execute: (args: unknown) => Promise<unknown> }> = {};
    for (const [method, tool] of Object.entries(this.cfg.tools)) {
      out[method] = {
        description: tool.description, // KEEL-authored — see class doc
        requiresApproval: tool.requiresApproval,
        execute: async (args: unknown) => {
          const sessionedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const sessionId = await this.session.ensure();
            const headers = new Headers(init?.headers);
            if (sessionId) headers.set("Mcp-Session-Id", sessionId);
            if (!headers.has("accept")) headers.set("accept", "application/json, text/event-stream");
            return this.baseFetch(input, { ...init, headers });
          }) as typeof fetch;

          const { projected, divergent } = await foreignCall(this.cfg.serverUrl, method, args, {
            allow: this.cfg.allow,
            schema: tool.responseSchema,
            fetchImpl: sessionedFetch,
            recorder: this.cfg.recorder,
          });
          // foreignCall already records the PROJECTED response (E-A/E-B path);
          // divergence is a separate, explicit signal, recorded distinctly so it
          // never gets mistaken for part of the tool's actual return value.
          if (divergent) this.cfg.recorder?.record(this.cfg.connectorName, `${method}:divergence`, args, { divergent: true });
          return projected;
        },
      };
    }
    return out;
  }
}
