/**
 * Step 1 — Validate Eluciation Artifact
 *
 * Calls ArtifactGraphDO to confirm the eluciation artifact exists before
 * proceeding with compile. Implements the A9 constraint from SPEC-FF-ILAYER-EXEC-001 §3.2.
 */

import type { FactoryArtifactGraphDO } from '@factory/factory-graph'
import { CompileError, type EluciationArtifact } from '../types.js'

export async function validateEluciationArtifact(
  artifactGraph: DurableObjectNamespace<FactoryArtifactGraphDO>,
  eluciationArtifactId: string,
): Promise<EluciationArtifact> {
  const stub = artifactGraph.get(artifactGraph.idFromName('factory'))
  const res = await stub.fetch(
    new Request(`https://artifact-graph/node/${encodeURIComponent(eluciationArtifactId)}`),
  )

  if (res.status === 404) {
    throw new CompileError(
      'missing_eluciation',
      `Eluciation artifact '${eluciationArtifactId}' not found in ArtifactGraphDO (A9 constraint).`,
    )
  }

  if (!res.ok) {
    throw new CompileError(
      'missing_eluciation',
      `ArtifactGraphDO returned HTTP ${res.status} for eluciation artifact '${eluciationArtifactId}'.`,
    )
  }

  const node = await res.json<EluciationArtifact>()
  return node
}
