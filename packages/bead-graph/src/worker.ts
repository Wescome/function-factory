import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../bindings.js';
import { BeadGraphDOBase } from './do.js';
import { v00_base } from '../migrations/v00_base.js';
import type { Migration } from './migrate.js';

// Concrete Durable Object class for the bead graph
export class BeadGraphDO extends BeadGraphDOBase<Env> {
  static readonly migrations: Migration[] = [v00_base];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, BeadGraphDO.migrations);
  }
}

export default class BeadGraphWorker extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Route: /org/:orgId/*  → stub to BEAD_GRAPH_DO keyed by orgId
    const orgId = url.pathname.split('/')[2];
    if (!orgId) {
      return new Response('orgId required', { status: 400 });
    }
    const id = this.env.BEAD_GRAPH_DO.idFromName(orgId);
    const stub = this.env.BEAD_GRAPH_DO.get(id);
    return stub.fetch(request);
  }
}
