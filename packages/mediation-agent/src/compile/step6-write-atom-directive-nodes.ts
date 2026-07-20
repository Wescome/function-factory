/**
 * Step 6 — Write AtomDirective Nodes to ArtifactGraphDO
 *
 * For each atom, constructs a full AtomDirective v2.0 and writes it as a node
 * to ArtifactGraphDO. Creates an edge: SpecificationNode → AtomDirectiveNode.
 *
 * SPEC-FF-ILAYER-EXEC-001 §3.2 step 6
 */

import type { FactoryArtifactGraphDO } from '@factory/factory-graph'
import type { AtomDirective } from '@factory/schemas'
import { CompileError, type ResolvedAtomBinding } from '../types.js'

interface WriteAtomDirectiveInput {
  bindings:             ResolvedAtomBinding[]
  specificationNodeId:  string
  runId:                string
  workGraphId:          string
  workGraphVersion:     string
  eluciationArtifactId: string
}

export async function writeAtomDirectiveNodes(
  artifactGraph: DurableObjectNamespace<FactoryArtifactGraphDO>,
  input: WriteAtomDirectiveInput,
): Promise<Map<string, AtomDirective>> {
  const stub = artifactGraph.get(artifactGraph.idFromName('factory'))

  const directives = new Map<string, AtomDirective>()

  for (const { atom, gear, toolSchemas } of input.bindings) {
    const directive: AtomDirective = {
      atomId:               atom.atomId,
      workGraphId:          input.workGraphId,
      workGraphVersion:     input.workGraphVersion,
      runId:                input.runId,
      model:                gear.modelBinding.modelId,
      instructions:         `Execute atom ${atom.atomId} using gear ${gear.name} (${gear.skillRef}).`,
      toolPolicy:           { permittedTools: gear.toolPolicy.allowed },
      toolSchemas,
      specFiles:            [],   // specFiles are hydrated by a later enrichment step
      invariantIds:         atom.invariantIds,
      dependsOn:            atom.dependsOn,
      eluciationArtifactId: input.eluciationArtifactId,
      d1ArtifactRef:        atom.d1ArtifactRef,
      policyBeadId:         `BEAD-${atom.atomId}`,
      thinkingLevel:        mapThinkingLevel(gear.modelBinding.thinkingLevel),
    }

    directives.set(atom.atomId, directive)

    const nodeId = `ATOM-DIRECTIVE-${atom.atomId}`

    // Write the AtomDirectiveNode to ArtifactGraphDO
    const writeRes = await stub.fetch(
      new Request('https://artifact-graph/node', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id:   nodeId,
          type: 'AtomDirective',
          data: directive as unknown as Record<string, unknown>,
        }),
      }),
    )

    if (!writeRes.ok) {
      const text = await writeRes.text().catch(() => '')
      throw new CompileError(
        'coherence_failure',
        `ArtifactGraphDO rejected AtomDirectiveNode for ${atom.atomId} (HTTP ${writeRes.status}): ${text}`,
      )
    }

    // Create edge: SpecificationNode → AtomDirectiveNode
    const edgeRes = await stub.fetch(
      new Request('https://artifact-graph/edge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          source: input.specificationNodeId,
          target: nodeId,
          rel:    'SPECIFIES',
        }),
      }),
    )

    if (!edgeRes.ok) {
      // Non-fatal: edge write failure does not abort the compile
      console.warn(
        `[mediation-agent] edge write failed for ${input.specificationNodeId} → ${nodeId}: HTTP ${edgeRes.status}`,
      )
    }
  }

  return directives
}

/**
 * Maps Gear.modelBinding.thinkingLevel (which includes 'medium' and 'max')
 * to the AtomDirective thinkingLevel enum ('none' | 'low' | 'high').
 */
function mapThinkingLevel(
  level: 'none' | 'low' | 'medium' | 'high' | 'max',
): 'none' | 'low' | 'high' {
  switch (level) {
    case 'none':   return 'none'
    case 'low':    return 'low'
    case 'medium': return 'low'
    case 'high':   return 'high'
    case 'max':    return 'high'
  }
}
