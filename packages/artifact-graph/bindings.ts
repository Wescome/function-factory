import { ArtifactGraphDOBase } from './src/do.js';
import { v00Base } from './migrations/v00_base.js';

// Minimal concrete subclass for wrangler dev only — not for production use
export class ArtifactGraphDO extends ArtifactGraphDOBase<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      namespace: 'dev:local:generic',
      nodeTypes: [],
      relTypes: [],
    }, [v00Base]);
  }

  async getActiveSpecification(_ns: string, _domain: string): Promise<string> {
    throw new Error('getActiveSpecification not implemented in dev DO');
  }
}

export interface Env {
  ARTIFACT_GRAPH: DurableObjectNamespace<ArtifactGraphDO>;
}
