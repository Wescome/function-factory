/**
 * mcp-inbound.ts — inbound MCP v1 (BRIEF-KEEL-INBOUND-001, frozen).
 *
 * The spike logic promoted to real wiring: the menu (DEFAULT_REGISTRY) +
 * envelope enforcement (resolveInvocation) live in `src/domain/inbound`
 * (pure, tested — 137/137). This file wires them into the authenticated MCP
 * endpoint: `tools/list` scoped via `visibleSpecs` (enable/disable per caller
 * session), `tools/call` gated by `resolveInvocation` BOTH at the HTTP layer
 * (before the MCP dispatch even starts) and again inside the tool handler
 * (defense in depth), dispatching admitted specs through the SAME KEEL loop
 * every other path uses, in a fresh per-invocation DO.
 *
 * INV-INBOUND-NO-PASSTHROUGH: `Principal` (src/domain/inbound/envelope.ts)
 * carries `caller` only, no token field — nothing here has a token to forward,
 * and the connector construction path (FxConnector(ctx, env, recorder) etc.)
 * never receives the inbound Request either. Absence by construction.
 *
 * INV-INBOUND-EFFECT-GATED: a granted scope admits the CLASS of spec
 * (ledger.ensureRecord); the effect itself still D8-gates at execution
 * (PAUSE, held for a human `POST /approve?name=<doName>`). A scope is not a
 * standing effect approval.
 */
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveInvocation, visibleSpecs, evaluateQuota, DEFAULT_REGISTRY, type AuditStatus } from "../domain/index";
import type { SpecificationContent } from "../domain/lineage/nodes";
import type { Env } from "./orchestrator";
import { D1InboundAuditAdapter } from "../adapters/inbound/d1-inbound-audit.adapter";

/** OD-IN-3 stopgap: hardcoded per-caller-per-spec limit until the OD-IN-4
 *  authoring surface lands and makes this operator-configurable. */
const QUOTA_LIMIT = 100;
const QUOTA_WINDOW_MS = 60 * 60 * 1000;

function auditStatusFor(state: string | null): AuditStatus {
  if (state === "ACCEPT") return "accepted";
  if (state === "PAUSE") return "paused";
  return "rejected"; // ESCALATE or no terminal state reached within the poll window
}

type OrchestratorStub = {
  admit(c: unknown): Promise<{ accepted: boolean; status: string; runId: string }>;
  result(): Promise<{ state: string | null; verdict: unknown; executionId: string | null; nodeKinds: string[] } | null>;
  dumpNodes(): Promise<readonly { kind: string; content: Record<string, unknown> }[]>;
};

function orchestratorStub(env: Env, doName: string): OrchestratorStub {
  const ns = env.ORCHESTRATOR;
  return ns.get(ns.idFromName(doName)) as unknown as OrchestratorStub;
}

async function pollResult(
  env: Env,
  doName: string,
  maxWaitMs = 20_000,
): Promise<{ state: string | null; verdict: unknown; nodeKinds: string[] } | null> {
  const stub = orchestratorStub(env, doName);
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const r = await stub.result();
    if (r && r.state) return r; // ACCEPT | ESCALATE | PAUSE are all terminal-for-us
    if (Date.now() > deadline) return r;
    await new Promise((res) => setTimeout(res, 300));
  }
}

interface SpecOutcome { readonly doName: string; readonly state: string | null; readonly result?: unknown; }

/** Run an admitted, operator-vetted spec through the EXISTING KEEL loop (same
 *  execute path, same anchored oracle) in a fresh, dedicated DO — never the
 *  caller's own instance, so one invocation's execution can't taint another's. */
async function invokeRegisteredSpec(env: Env, specName: string, content: SpecificationContent): Promise<SpecOutcome> {
  const doName = `mcp-${specName.replace(/[^a-zA-Z0-9]/g, "-")}-${crypto.randomUUID()}`;
  const stub = orchestratorStub(env, doName);
  await stub.admit(content);
  const terminal = await pollResult(env, doName);
  if (!terminal || terminal.state !== "ACCEPT") {
    return { doName, state: terminal?.state ?? null };
  }
  const nodes = await stub.dumpNodes();
  const executions = nodes.filter((n) => n.kind === "ExecutionTrace");
  const last = executions[executions.length - 1];
  return { doName, state: "ACCEPT", result: last?.content?.result ?? null };
}

export class InboundMcpAgent extends McpAgent<Env, unknown, { scopes?: string[]; caller?: string }> {
  server = new McpServer({ name: "keel-inbound", version: "1.0.0" });

  async init(): Promise<void> {
    const scopes = this.props?.scopes ?? [];
    const caller = this.props?.caller ?? "unknown";
    const visible = new Set(visibleSpecs(DEFAULT_REGISTRY, scopes));

    for (const reg of DEFAULT_REGISTRY) {
      const handle = this.server.registerTool(
        reg.name,
        { description: `${reg.name} — operator-registered, oracle-verified via ${reg.spec.oracleRef}` },
        async () => {
          const nonce = crypto.randomUUID();
          const admission = resolveInvocation(DEFAULT_REGISTRY, scopes, caller, reg.name, nonce);
          if (!admission.admit) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: `${admission.status} ${admission.reason}` }],
              structuredContent: { status: admission.status, reason: admission.reason },
            };
          }
          const outcome = await invokeRegisteredSpec(this.env, reg.name, admission.spec);
          if (this.env.DB) {
            await new D1InboundAuditAdapter(this.env.DB).record(
              admission.auditKey, admission.principal.caller, reg.name, nonce, outcome.doName, auditStatusFor(outcome.state),
            );
          }
          if (outcome.state === "PAUSE") {
            return {
              content: [{ type: "text" as const, text: `paused: awaiting operator approval (doName=${outcome.doName})` }],
              structuredContent: { status: "paused", doName: outcome.doName },
            };
          }
          if (outcome.state !== "ACCEPT") {
            return { isError: true, content: [{ type: "text" as const, text: `not verified: state=${outcome.state}` }] };
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify(outcome.result) }],
            structuredContent: outcome.result as Record<string, unknown>,
          };
        },
      );
      if (!visible.has(reg.name)) handle.disable();
    }
  }
}

/** Check 1's "403/404 BEFORE the loop starts", generalized from the spike's
 *  single-scope gate to the full registry, plus OD-IN-3's quota gate: peek at
 *  `tools/call` requests only (everything else passes through untouched —
 *  tools/list's own scoping is the enable/disable above), run the SAME
 *  `resolveInvocation` the tool handler uses, then — only once admitted — the
 *  quota check, BOTH before the MCP dispatch even starts, so an out-of-
 *  envelope, unknown-spec, or over-quota call never reaches the KEEL loop:
 *  no per-invocation DO is spun up, no outbound connector call is made. */
export function makeInboundApiHandler(mcpServe: { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext & { props?: { scopes?: string[]; caller?: string } }): Promise<Response> {
      const scopes = ctx.props?.scopes ?? [];
      const caller = ctx.props?.caller ?? "unknown";
      if (request.method === "POST") {
        try {
          const body = await request.clone().json() as { method?: string; params?: { name?: string } };
          if (body?.method === "tools/call" && typeof body.params?.name === "string") {
            const admission = resolveInvocation(DEFAULT_REGISTRY, scopes, caller, body.params.name, "http-gate");
            if (!admission.admit) {
              return new Response(
                JSON.stringify({ error: admission.status === 403 ? "insufficient_scope" : "not_found", error_description: admission.reason }),
                { status: admission.status, headers: { "content-type": "application/json" } },
              );
            }
            // OD-IN-3: fail-closed if usage can't be determined at all (no D1
            // index, or the count query throws) — evaluateQuota(0, -1) forces
            // its "unconfigured" branch rather than falling through unlimited.
            let quota;
            try {
              if (!env.DB) throw new Error("no D1 index configured");
              const used = await new D1InboundAuditAdapter(env.DB).countSince(caller, body.params.name, Date.now() - QUOTA_WINDOW_MS);
              quota = evaluateQuota(used, QUOTA_LIMIT);
            } catch {
              quota = evaluateQuota(0, -1);
            }
            if (!quota.allowed) {
              return new Response(
                JSON.stringify({ error: "quota_exceeded", error_description: quota.reason }),
                { status: 429, headers: { "content-type": "application/json" } },
              );
            }
          }
        } catch { /* not a tools/call-shaped JSON body — fall through to the MCP layer, which validates it */ }
      }
      return mcpServe.fetch(request, env, ctx);
    },
  };
}
