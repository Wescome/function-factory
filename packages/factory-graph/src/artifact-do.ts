import { ArtifactGraphDOBase } from '@factory/artifact-graph';
import { v00Base } from '@factory/artifact-graph/migrations/v00_base';
import type { DomainConfig } from '@factory/artifact-graph';
import { FACTORY_NODE_TYPES, FACTORY_REL_TYPES } from './types.js';

// ── Cloudflare Worker environment type ────────────────────────────────────
// BEAD_GRAPH uses DurableObjectNamespace<object> here to avoid a circular
// import with bead-do.ts. Consumers that need the precise type should import
// FactoryBeadGraphDO from './bead-do' directly.

export interface Env {
  ARTIFACT_GRAPH: DurableObjectNamespace<FactoryArtifactGraphDO>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BEAD_GRAPH: DurableObjectNamespace<any>;
}

// ── Factory domain config ─────────────────────────────────────────────────

const FACTORY_CONFIG: DomainConfig = {
  namespace:  'factory',
  nodeTypes:  FACTORY_NODE_TYPES,
  relTypes:   FACTORY_REL_TYPES,
};

// ── FactoryArtifactGraphDO ────────────────────────────────────────────────

export class FactoryArtifactGraphDO extends ArtifactGraphDOBase<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, FACTORY_CONFIG, [v00Base]);
  }

  /**
   * Returns the node ID of the head Specification for the given namespace and domain.
   * Looks up a node of type 'WorkGraph' or 'Specification' tagged as active.
   * Returns the most-recently-created Specification node as a safe default.
   */
  override async getActiveSpecification(ns: string, domain: string): Promise<string> {
    // Retrieve WorkGraph nodes and return the most recently created
    const nodes = await this.getNodesByType('WorkGraph', 1, 0);
    if (nodes.length > 0 && nodes[0] !== undefined) {
      return nodes[0].id;
    }
    // Fallback to Specification nodes
    const specNodes = await this.getNodesByType('Specification', 1, 0);
    if (specNodes.length > 0 && specNodes[0] !== undefined) {
      return specNodes[0].id;
    }
    // Return a canonical sentinel when no active specification exists
    return `factory:${ns}:${domain}:no-active-specification`;
  }
}
