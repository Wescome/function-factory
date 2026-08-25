/**
 * Phase 6b foreign MCP call — the host-side call path. Enforces the allowlist
 * (KEEL-enforced, since DO egress is open), issues a JSON-RPC 2.0 `tools/call`
 * over Streamable HTTP, projects the response (severing injection), records the
 * PROJECTED I/O (E-A) — never the raw prose — and flags divergence. fetch is
 * injected so this is deterministically testable; the live handshake is a smoke.
 */
import {
  isAllowedServer, projectResponse, hasDivergence, statusToErrorClass,
  type ForeignAllowlist, type ResponseSchema,
} from "../../domain/index";
import type { CallRecorder } from "../codemode/call-recorder";

export interface ForeignCallDeps {
  readonly allow: ForeignAllowlist;
  readonly schema: ResponseSchema;
  readonly fetchImpl: typeof fetch;
  readonly recorder?: CallRecorder;
}
export interface ForeignCallResult {
  readonly projected: Record<string, unknown>;
  readonly divergent: boolean;
}

export async function foreignCall(
  serverUrl: string, method: string, args: unknown, deps: ForeignCallDeps,
): Promise<ForeignCallResult> {
  // INV-FOREIGN-CEILING: the runtime will NOT stop this (DO egress is open) — we
  // do. BRIEF-KEEL-EFFECT-SIGNATURE-001 v1.3 emitter 1 (terminal): classify,
  // don't throw-as-code — the class is data on the trace (CallRecorder.
  // setTerminalError), not a crash. decide() ESCALATEs from the recorded
  // class on attempt 1, instead of burning the attempt budget on a retry
  // that can never succeed (a disallowed server stays disallowed).
  if (!isAllowedServer(serverUrl, deps.allow)) {
    deps.recorder?.setTerminalError("PermissionDenied");
    deps.recorder?.record("foreign", method, args, { error: "not_allowlisted" });
    return { projected: {}, divergent: false };
  }
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: method, arguments: args } });
  const res = await deps.fetchImpl(serverUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body,
  });
  if (!res.ok) {
    // Classify what status-map already knows how to classify (401/403 — the
    // same identity/authorization failures the OpenAPI importer maps); leave
    // everything else a raw throw for now (out of this brief's scope — only
    // the two named emitters are wired this pass).
    const cls = statusToErrorClass(res.status);
    if (cls === "AuthenticationFailed" || cls === "PermissionDenied") {
      deps.recorder?.setTerminalError(cls);
      deps.recorder?.record("foreign", method, args, { error: `http_${res.status}` });
      return { projected: {}, divergent: false };
    }
    throw new Error(`foreign call failed: HTTP ${res.status}`);
  }
  const rpc = (await res.json()) as { result?: { structuredContent?: unknown; content?: unknown }; error?: unknown };
  if (rpc.error) throw new Error(`foreign error: ${JSON.stringify(rpc.error)}`);

  const raw = rpc.result?.structuredContent ?? rpc.result?.content ?? rpc.result;
  const proj = projectResponse(raw, deps.schema);        // sever injection
  const divergent = hasDivergence(deps.schema, proj);    // INV-FOREIGN-DIVERGENCE (per-call)
  // Emitter 2 (amendable): store.append has no uniqueness constraint (a pure
  // append log — see do-ledger.adapter.ts), so it can never Conflict; per the
  // playbook's own fallback, this connector's schema-divergence signal is the
  // amendable source instead — a response that doesn't match its declared
  // contract IS a validation failure a differently-shaped retry can recover
  // from, not a terminal one. classifyTerminal("InvalidResponse") === false,
  // so this falls through to AMEND, carrying the class as evidence.
  if (divergent) deps.recorder?.setTerminalError("InvalidResponse");
  // record the PROJECTED response, never the raw prose (so E-B can never surface injected text)
  deps.recorder?.record("foreign", method, args, proj.projected);
  return { projected: proj.projected, divergent };
}

// --- OD-6b-4: KEEL-authored connector docs for a foreign tool ---------------
export interface ForeignToolConfig {
  readonly method: string;
  /** KEEL-AUTHORED description shown to the model. NEVER the server's own
   *  tools/list text (INV-FOREIGN-DESC-NOT-INGESTED). */
  readonly description: string;
  readonly responseSchema: ResponseSchema;
}
/** Build the model-facing connector doc from KEEL config. Structurally there is
 *  no path from the foreign server's descriptions into this — the text is KEEL's. */
export function foreignConnectorDoc(
  connectorName: string, tools: readonly ForeignToolConfig[],
): { name: string; description: string } {
  const methods = tools.map((t) => `${connectorName}.${t.method}(...) => ${t.description}`).join("; ");
  return { name: connectorName, description: methods };
}
