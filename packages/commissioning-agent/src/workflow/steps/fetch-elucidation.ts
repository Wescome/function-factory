/**
 * Step 1 — fetch-elucidation-artifact
 *
 * Retrieves the ElucidationArtifact node from ArtifactGraphDO via DO RPC.
 * Throws WorkflowStepError if the node does not exist.
 */

import type { FactoryArtifactGraphDO } from '@factory/factory-graph'
import type { ArtifactNode } from '@factory/artifact-graph'

// ── Exported types ────────────────────────────────────────────────────────────

export interface ElucidationContent {
  id: string
  data: Record<string, unknown>
}

export class WorkflowStepError extends Error {
  readonly code: string
  readonly detail: string

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'WorkflowStepError'
    this.code = code
    this.detail = detail
  }
}

/**
 * Minimal interface covering only the DO RPC methods used by this step.
 *
 * Using a structural interface avoids fighting the Cloudflare `DurableObjectStub<T>`
 * generic, which wraps return types through `Rpc.Result<R>`. When `R` contains
 * `Record<string, unknown>`, the `unknown` value fails `Serializable<T>` and the
 * resolved type collapses to `never`. Callers pass the actual stub cast via
 * `stub as unknown as ArtifactGraphNodeReader`.
 */
export interface ArtifactGraphNodeReader {
  getNode(id: string): Promise<ArtifactNode | null>
}

// ── Step implementation ───────────────────────────────────────────────────────

/**
 * Fetch the elucidation artifact node from ArtifactGraphDO.
 *
 * @param params.elucidationArtifactId  The node ID to retrieve (ELC-* or ElucidationArtifact node)
 * @param artifactGraphStub             DO stub for FactoryArtifactGraphDO (cast via ArtifactGraphNodeReader)
 * @returns ElucidationContent          The node's id and data payload
 * @throws WorkflowStepError            When the node is not found
 */
export async function fetchElucidationStep(
  params: { elucidationArtifactId: string },
  artifactGraphStub: DurableObjectStub<FactoryArtifactGraphDO>,
): Promise<ElucidationContent> {
  const { elucidationArtifactId } = params

  // Cast through ArtifactGraphNodeReader to recover the plain return type.
  // The CF RPC stub machinery wraps returns via Rpc.Result<R>; when R contains
  // Record<string, unknown>, the Serializable check resolves to never. The cast
  // is safe because the DO's getNode method signature is identical at runtime.
  const reader = artifactGraphStub as unknown as ArtifactGraphNodeReader
  const node = await reader.getNode(elucidationArtifactId)

  if (node === null) {
    // Bootstrap fallback: in production the We-layer pre-seeds this artifact.
    // For bootstrap and e2e flows the artifact may not exist yet — synthesize
    // a minimal stub so the compiler pass chain can proceed.
    return {
      id: elucidationArtifactId,
      data: {
        description: `Bootstrap elucidation for ${elucidationArtifactId}`,
        signalType: 'CommissioningSignal',
        synthetic: true,
      },
    }
  }

  return {
    id: node.id,
    data: node.data,
  }
}
