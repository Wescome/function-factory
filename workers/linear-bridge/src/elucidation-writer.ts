/**
 * @module elucidation-writer
 *
 * A9 enforcement: writes an ElucidationArtifact node to ArtifactGraphDO
 * via POST /append BEFORE a disposition JWT is issued.
 *
 * Node ID format: ELC-BRIDGE-{escalationId}-{Date.now()}
 * The ELC-* prefix is required by the gateway's A9 structural enforcement.
 *
 * If the DO write fails, the bridge MUST NOT issue a JWT — this is the
 * core A9 invariant.
 */

import type { DispositionElucidationArtifact } from './types.js'

// ─── Write ────────────────────────────────────────────────────────────────────

export interface ElucidationWriteSuccess {
  ok: true
  nodeId: string
}

export interface ElucidationWriteFailure {
  ok: false
  error: string
}

export type ElucidationWriteResult = ElucidationWriteSuccess | ElucidationWriteFailure

/**
 * Appends a DispositionElucidationArtifact node to the ArtifactGraphDO.
 *
 * Uses `idFromName('artifact-graph:{repoId}')` to resolve the per-repo DO stub.
 *
 * @param artifact      The elucidation artifact to write
 * @param artifactGraph ARTIFACT_GRAPH Durable Object namespace
 * @param repoId        Repository identifier — used for DO shard name
 */
export async function writeElucidationArtifact(
  artifact: DispositionElucidationArtifact,
  artifactGraph: DurableObjectNamespace,
  repoId: string,
): Promise<ElucidationWriteResult> {
  const doId = artifactGraph.idFromName(`artifact-graph:${repoId}`)
  const stub = artifactGraph.get(doId)

  let resp: Response
  try {
    resp = await stub.fetch('http://internal/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: artifact }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('elucidation-writer: DO fetch failed:', msg)
    return { ok: false, error: `ArtifactGraphDO fetch failed: ${msg}` }
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '<unreadable>')
    console.error(`elucidation-writer: DO /append returned ${resp.status}: ${body}`)
    return {
      ok: false,
      error: `ArtifactGraphDO /append returned ${resp.status}: ${body}`,
    }
  }

  return { ok: true, nodeId: artifact.id }
}

// ─── ID Factory ──────────────────────────────────────────────────────────────

/**
 * Generates a stable ELC-* node ID for a given escalation and timestamp.
 * Format: ELC-BRIDGE-{escalationId}-{timestamp}
 */
export function makeElucidationNodeId(escalationId: string): string {
  return `ELC-BRIDGE-${escalationId}-${Date.now()}`
}
