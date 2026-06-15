import { DurableObject } from 'cloudflare:workers';
import { migrate } from './migrate.js';
import type { Migration } from './migrate.js';
import * as Q from './queries.js';
import type {
  ArtifactNode,
  ArtifactEdge,
  RelType,
  NodeType,
  LineageChain,
  PathResult,
  PathStep,
  DomainConfig,
} from './types.js';

// ── HTTP route helpers ────────────────────────────────────────────────────

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonErr(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export abstract class ArtifactGraphDOBase<Env> extends DurableObject<Env> {
  protected sql: SqlStorage;
  protected config: DomainConfig;

  constructor(
    ctx: DurableObjectState,
    env: Env,
    config: DomainConfig,
    migrations: Migration[]
  ) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.config = config;

    this.ctx.blockConcurrencyWhile(async () => {
      migrate(ctx.storage, migrations);
    });
  }

  // ── Node operations ──────────────────────────────────────────────────────

  async upsertNode(id: string, type: NodeType, data: Record<string, unknown>): Promise<ArtifactNode> {
    return Q.upsertNode(this.sql, id, type, this.config.namespace, data);
  }

  async getNode(id: string): Promise<ArtifactNode | null> {
    return Q.getNode(this.sql, id);
  }

  async getNodesByType(type: NodeType, limit = 100, offset = 0): Promise<ArtifactNode[]> {
    return Q.getNodesByType(this.sql, this.config.namespace, type, limit, offset);
  }

  // ── Edge operations ──────────────────────────────────────────────────────

  async upsertEdge(source: string, target: string, rel: RelType, props?: Record<string, unknown>): Promise<ArtifactEdge> {
    return Q.upsertEdge(this.sql, source, target, rel, props);
  }

  async getEdgesFrom(source: string, rel?: RelType): Promise<ArtifactEdge[]> {
    return Q.getEdgesFrom(this.sql, source, rel);
  }

  async getEdgesTo(target: string, rel?: RelType): Promise<ArtifactEdge[]> {
    return Q.getEdgesTo(this.sql, target, rel);
  }

  // ── Generic traversal contracts ──────────────────────────────────────────

  async walkLineageBackward(startId: string, rel: RelType, maxDepth?: number): Promise<LineageChain> {
    return Q.walkLineageBackward(this.sql, startId, rel, maxDepth);
  }

  async walkLineageForward(startId: string, rel: RelType, maxDepth?: number): Promise<LineageChain> {
    return Q.walkLineageForward(this.sql, startId, rel, maxDepth);
  }

  async walkBoundedPath(startId: string, steps: PathStep[]): Promise<PathResult[]> {
    return Q.walkBoundedPath(this.sql, startId, steps);
  }

  async collectLineageIds(anyNodeId: string, rel: RelType): Promise<string[]> {
    return Q.collectLineageIds(this.sql, anyNodeId, rel);
  }

  // ── HTTP fetch handler ────────────────────────────────────────────────────

  /**
   * HTTP surface for ArtifactGraphDO.
   *
   * Routes:
   *   POST /append              — append-only governance node write
   *   GET  /query/hypothesis    — filter Hypothesis nodes
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    // POST /append
    if (method === 'POST' && pathname === '/append') {
      return this.handleAppend(request);
    }

    // GET /query/hypothesis
    if (method === 'GET' && pathname === '/query/hypothesis') {
      return this.handleQueryHypothesis(url);
    }

    return jsonErr({ ok: false, error: 'not found' }, 404);
  }

  private async handleAppend(request: Request): Promise<Response> {
    let body: { node?: Record<string, unknown> };
    try {
      body = await request.json() as { node?: Record<string, unknown> };
    } catch {
      return jsonErr({ ok: false, error: 'invalid JSON body' }, 400);
    }

    const node = body.node;
    if (!node || typeof node !== 'object') {
      return jsonErr({ ok: false, error: 'missing required field: node' }, 400);
    }
    if (typeof node['id'] !== 'string' || !node['id']) {
      return jsonErr({ ok: false, error: 'missing required field: id' }, 400);
    }
    if (typeof node['nodeType'] !== 'string' || !node['nodeType']) {
      return jsonErr({ ok: false, error: 'missing required field: nodeType' }, 400);
    }

    const id = node['id'] as string;
    const nodeType = node['nodeType'] as string;

    // Append-only: reject if node already exists
    const existing = Q.getNode(this.sql, id);
    if (existing !== null) {
      return jsonErr({ ok: false, error: 'node already exists', id }, 409);
    }

    // Store all fields except nodeType in the data blob
    const { nodeType: _stripped, ...dataFields } = node;
    void _stripped; // suppress unused warning

    Q.upsertNode(this.sql, id, nodeType, this.config.namespace, dataFields as Record<string, unknown>);
    return jsonOk({ ok: true, id });
  }

  private handleQueryHypothesis(url: URL): Response {
    const params: Q.HypothesisFilterParams = { ns: this.config.namespace };

    const status = url.searchParams.get('status');
    if (status !== null) params.status = status;

    const severity = url.searchParams.get('severity');
    if (severity !== null) params.severity = severity;

    const surfaced = url.searchParams.get('surfaced');
    if (surfaced !== null) params.surfaced = surfaced === 'true';

    const cycleCountGte = url.searchParams.get('surfacedCycleCount_gte');
    if (cycleCountGte !== null) {
      const n = parseInt(cycleCountGte, 10);
      if (!isNaN(n)) params.surfacedCycleCountGte = n;
    }

    const nodes = Q.queryHypothesisByFilters(this.sql, params);
    return jsonOk(nodes);
  }

  // ── Abstract method for domain instantiation ─────────────────────────────

  /**
   * Returns the node ID of the head Specification for the given namespace + domain.
   * Implemented by each domain instantiation (e.g., FactoryArtifactGraphDO).
   * Contract: LoopClosureService.openSession() calls this via the DO stub.
   */
  abstract getActiveSpecification(ns: string, domain: string): Promise<string>;
}

// Re-export types so consumers can import from this entrypoint
export type {
  ArtifactNode,
  ArtifactEdge,
  LineageChain,
  PathResult,
  PathStep,
  DomainConfig,
  NodeType,
  RelType,
};

export { migrate };
export type { Migration };

export {
  upsertNode,
  getNode,
  getNodesByType,
  upsertEdge,
  getEdgesFrom,
  getEdgesTo,
  walkLineageBackward,
  walkLineageForward,
  walkBoundedPath,
  collectLineageIds,
  queryHypothesisByFilters,
} from './queries.js';
export type { HypothesisFilterParams } from './queries.js';

export { CORE_NODE_TYPES, CORE_REL_TYPES } from './types.js';
export type { CoreNodeType, CoreRelType } from './types.js';
