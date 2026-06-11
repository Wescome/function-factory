import { flue } from '@flue/runtime/routing';
// @ts-ignore — bundler resolves this; ff-pipeline is not a workspace package dep
import ffPipeline from '../workers/ff-pipeline/src/index.js';

interface Env {
  SANDBOX: unknown;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    // Flue handles /workflows/* and Flue agent dispatch routes.
    // Provider config (ofox.ai, kimi CF REST) is set inside atom-execution run()
    // before init(agent) — not here, because DO/Workflow isolates are separate
    // from the fetch isolate and don't share module-global state.
    const flueRes = await (flue() as { fetch(r: Request, e: unknown, c: unknown): Promise<Response> })
      .fetch(req, env, ctx);
    if (flueRes.status !== 404) return flueRes;

    // ff-pipeline handles everything else
    return (ffPipeline as { fetch(r: Request, e: unknown, c: unknown): Promise<Response> })
      .fetch(req, env, ctx);
  },
};
