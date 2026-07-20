import type { Env } from '../bindings.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const id = env.ARTIFACT_GRAPH.idFromName('default');
    const stub = env.ARTIFACT_GRAPH.get(id);
    return stub.fetch(new Request(url.toString(), request));
  },
} satisfies ExportedHandler<Env>;
