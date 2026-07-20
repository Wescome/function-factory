/**
 * Step 5 — Write SpecificationNode to ArtifactGraphDO
 *
 * Content-addressed write: second call with same content returns same ID.
 * SPEC-FF-ILAYER-EXEC-001 §3.2 step 5
 */

import type { FactoryArtifactGraphDO } from '@factory/factory-graph'
import { CompileError } from '../types.js'

export interface SpecificationNodeInput {
  workGraphId: string
  workGraphVersion: string
  eluciationArtifactId: string
  compiledAt: string  // ISO timestamp
}

export async function writeSpecificationNode(
  artifactGraph: DurableObjectNamespace<FactoryArtifactGraphDO>,
  input: SpecificationNodeInput,
): Promise<string> {
  const stub = artifactGraph.get(artifactGraph.idFromName('factory'))

  const nodeData = {
    type:                   'Specification',
    workGraphId:            input.workGraphId,
    workGraphVersion:       input.workGraphVersion,
    eluciationArtifactId:   input.eluciationArtifactId,
    compiledAt:             input.compiledAt,
  }

  // Content-addressed ID: deterministic hash of the node contents
  const nodeId = await contentAddressedId('Specification', nodeData)

  const res = await stub.fetch(
    new Request('https://artifact-graph/node', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: nodeId, type: 'Specification', data: nodeData }),
    }),
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new CompileError(
      'coherence_failure',
      `ArtifactGraphDO rejected SpecificationNode write (HTTP ${res.status}): ${text}`,
    )
  }

  const result = await res.json<{ id: string }>()
  return result.id
}

/**
 * Produce a deterministic content-addressed ID for a node.
 * Uses SHA-256 of the stable JSON serialization.
 */
async function contentAddressedId(
  nodeType: string,
  data: Record<string, unknown>,
): Promise<string> {
  const stableJson = JSON.stringify({ nodeType, data }, Object.keys({ nodeType, data }).sort())
  const encoded = new TextEncoder().encode(stableJson)
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded)
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${nodeType.toUpperCase()}-${hashHex.slice(0, 16)}`
}
