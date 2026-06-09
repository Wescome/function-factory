import { configureProvider } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    // Route all model traffic through the WeOps gateway
    // (reuses ff-linear-bridge's WEOPS_SIGNING_KEY — SPEC-WEOPS-CONSOLE-001)
    configureProvider('anthropic', {
      baseUrl: env.WEOPS_GATEWAY_URL,
      headers: { Authorization: `Bearer ${env.WEOPS_SIGNING_KEY}` },
      apiKey: 'weops',
    });

    return flue().fetch(req, env, ctx);
  },
};

interface Env {
  WEOPS_GATEWAY_URL: string;
  WEOPS_SIGNING_KEY: string;
  ARANGO_ENDPOINT: string;
  ARANGO_DB: string;
  FF_CONTEXT_ENDPOINT: string;
  Sandbox: unknown; // CF Container DO binding
}
