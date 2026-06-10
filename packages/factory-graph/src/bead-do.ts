import { BeadGraphDOBase } from '@factory/bead-graph';
import { v00_base as v00Base } from '@factory/bead-graph/migrations/v00_base';
import type { Migration } from '@factory/bead-graph';
import type { FactoryArtifactGraphDO } from './artifact-do.js';

// ── Cloudflare Worker environment type ────────────────────────────────────

export interface BeadEnv {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ARTIFACT_GRAPH: DurableObjectNamespace<FactoryArtifactGraphDO>;
  BEAD_GRAPH: DurableObjectNamespace<FactoryBeadGraphDO>;
  KV_CACHE: KVNamespace;
}

// ── FactoryBeadGraphDO ────────────────────────────────────────────────────
//
// Extends BeadGraphDOBase with the Factory domain Bead types.
// writeBead() is inherited from the base class and validates incoming Beads
// against the AnyBead discriminated union (which includes all Factory-domain
// Bead types registered in types.ts once they are added to the union there).
//
// The Factory-specific Bead schemas (ArchitectureDecisionBead, PatternTrustBead,
// CommitBead, BuildOutcomeBead, ArchAmendmentBead) are defined in ./types.ts and
// exported for use by Mediation Agent and Commissioning Agent consumers.

export class FactoryBeadGraphDO extends BeadGraphDOBase<BeadEnv> {
  constructor(ctx: DurableObjectState, env: BeadEnv) {
    super(ctx, env, [v00Base]);
  }
}
