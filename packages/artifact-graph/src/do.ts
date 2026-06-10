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
} from './queries.js';

export { CORE_NODE_TYPES, CORE_REL_TYPES } from './types.js';
export type { CoreNodeType, CoreRelType } from './types.js';
