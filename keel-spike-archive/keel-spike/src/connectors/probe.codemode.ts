/**
 * probe.codemode.ts — a real CodemodeConnector used only by the spike.
 *
 * REVISION NOTE: the prior draft was a bare class with commented-out
 * `@tool()` decorators — that decorator doesn't exist. The real base class
 * (@cloudflare/codemode's CodemodeConnector) requires:
 *   - constructor(ctx: DurableObjectState | ExecutionContext, env)
 *   - abstract name(): string
 *   - abstract tools(): ConnectorTools | Promise<ConnectorTools>
 * Each entry in the tools() record IS the tool: { execute, requiresApproval?,
 * revert?, ... } — there's no per-method decorator, just a plain object.
 *
 * Exposes:
 *   - bump():   increments a durable real-invocation counter. Used by S2 to
 *               prove a replayed call does NOT re-execute (the counter must
 *               not advance on replay).
 *   - mutate(): requiresApproval: true — used by S8 (approval pause/resume).
 */

import { CodemodeConnector, type ConnectorTools } from "@cloudflare/codemode";

export class ProbeConnector extends CodemodeConnector {
  // Durable across the whole run via the connector's own DO-backed storage.
  // VERIFY: CodemodeConnector extends WorkerEntrypoint, constructed fresh per
  // call per the base class docs ("connectors are used in-process... they're
  // constructed with `new`") — so plain instance state here may NOT persist
  // across replay/resume the way `this.realInvocations` implies. If it
  // doesn't, back this with `this.ctx.storage` (DurableObjectState) instead,
  // keyed by executionId from ToolExecuteContext.
  private realInvocations = 0;

  name(): string {
    return "probe";
  }

  protected tools(): ConnectorTools {
    return {
      bump: {
        description: "Real-effect call. Counts ONLY actual executions, never replays.",
        execute: async (args: unknown) => {
          const { tag } = (args ?? {}) as { tag?: string };
          this.realInvocations += 1;
          return { count: this.realInvocations, tag };
        },
      },
      mutate: {
        description: "Approval-gated effect for S8.",
        requiresApproval: true,
        execute: async (args: unknown) => {
          const { payload } = (args ?? {}) as { payload?: string };
          this.realInvocations += 1;
          return { applied: payload };
        },
      },
    };
  }

  /** Test-only accessor the checks read to assert real-vs-replayed execution. */
  __realInvocations(): number {
    return this.realInvocations;
  }
}
