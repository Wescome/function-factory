/**
 * @factory/architect-agent — ArtifactGraphDO write helpers
 *
 * Replaces all ArangoDB collection writes from the original spec.
 * Governance artifacts (PATCH, CRD-RESOLUTION, VSLICE-CONFIG, PIPELINE-CONFIG, ELUCIDATION)
 * are written to FactoryArtifactGraphDO as lineage/audit nodes.
 *
 * All writes are best-effort (warn on failure, never throw).
 */

import type { GovernanceArtifactPayload } from './types.js'

/**
 * Write a governance artifact node to FactoryArtifactGraphDO.
 * The `/governance-artifact` endpoint is a stub in v1 — returns 404 until
 * FactoryArtifactGraphDO implements it (GAP-012 open item).
 */
export async function writeGovernanceArtifact(
  artifactGraph: DurableObjectStub,
  payload: GovernanceArtifactPayload,
): Promise<void> {
  try {
    const resp = await artifactGraph.fetch(
      new Request('https://artifact-graph/governance-artifact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    )
    if (resp.status === 404) {
      // Endpoint not yet implemented in FactoryArtifactGraphDO — expected in v1
      console.info(
        `[ArchitectAgentDO] writeGovernanceArtifact: ${payload.type} ${payload.id} skipped (404 — endpoint not yet live)`,
      )
      return
    }
    if (!resp.ok) {
      console.warn(
        `[ArchitectAgentDO] writeGovernanceArtifact: ${payload.type} ${payload.id} — non-OK status ${resp.status}`,
      )
    }
  } catch (err) {
    console.warn(
      `[ArchitectAgentDO] writeGovernanceArtifact: ${payload.type} ${payload.id} failed:`,
      err,
    )
  }
}
