import { configureProvider } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';
// @ts-ignore — bundler resolves this; ff-pipeline is not a workspace package dep
import ffPipeline from '../workers/ff-pipeline/src/index.js';

interface Env {
  WEOPS_GATEWAY_URL: string;
  WEOPS_SIGNING_KEY: string;
  SANDBOX: unknown;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    // Route model traffic through the WeOps gateway
    configureProvider('anthropic', {
      baseUrl: env.WEOPS_GATEWAY_URL ?? '',
      headers: { Authorization: `Bearer ${env.WEOPS_SIGNING_KEY ?? ''}` },
      apiKey: 'weops',
    });

    // Flue handles /workflows/* and Flue agent dispatch routes
    const flueRes = await (flue() as { fetch(r: Request, e: unknown, c: unknown): Promise<Response> })
      .fetch(req, env, ctx);
    if (flueRes.status !== 404) return flueRes;

    // ff-pipeline handles everything else
    return (ffPipeline as { fetch(r: Request, e: unknown, c: unknown): Promise<Response> })
      .fetch(req, env, ctx);
  },
};
