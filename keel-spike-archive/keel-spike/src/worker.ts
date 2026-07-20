/**
 * worker.ts — live entry point. POST /spike runs S1–S8 against the deployed
 * substrate and returns the G1 report.
 *
 * `forceEviction` still returns `false` here — this is unaffected by D7's
 * resolution. `evictDurableObject()`/`runDurableObjectAlarm()` (confirmed
 * real and working — see test/spike.test.ts) are `cloudflare:test`-only
 * APIs, not available from a production fetch handler. There is no live-
 * Worker equivalent way to force true instance disposal on demand. S1's
 * real-eviction claim can only be tested through cloudflare:test, or
 * observed passively in production via `listFibers()`/`inspectFiber()`
 * after a genuine idle-driven eviction.
 */

import { runChecks, g1, type Harness } from "./checks";
export { Orchestrator } from "./orchestrator";
// Manual alternative to the @cloudflare/codemode/vite plugin (not used here,
// this spike deploys via raw `wrangler deploy`): the Workers runtime needs
// facet classes reachable through ctx.exports, so CodemodeRuntime must be
// re-exported from the Worker entry module. See docs/vite-plugin.md.
export { CodemodeRuntime } from "@cloudflare/codemode";
import type { Env } from "./substrate";

function makeHarness(env: Env): Harness {
  let n = 0;
  return {
    async fresh() {
      const id = env.ORCHESTRATOR.idFromName(`spike-${Date.now()}-${n++}`);
      return env.ORCHESTRATOR.get(id) as any;
    },
    async forceEviction() {
      // VERIFY: no known public API forces DO disposal on demand from a
      // fetch handler. Returning false is the honest answer, not a stub to
      // silently fix later — S1 must not claim a pass it cannot back up.
      return false;
    },
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/spike") {
      const results = await runChecks(makeHarness(env));
      const gate = g1(results);
      return Response.json(
        { gate: gate.green ? "GREEN" : "RED", reds: gate.reds, results },
        { status: gate.green ? 200 : 424 } // 424 Failed Dependency = gate red
      );
    }
    return new Response("KEEL spike. POST /spike to run S1-S8.\n", { status: 200 });
  },
};
