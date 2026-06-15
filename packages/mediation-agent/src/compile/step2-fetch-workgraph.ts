/**
 * Step 2 — Fetch WorkGraph Artifact Graph
 *
 * Fetches atom rows from D1 by d1ArtifactRef keys.
 * SPEC-FF-ILAYER-EXEC-001 §3.2
 */

import { CompileError, type WorkGraphAtom } from '../types.js'

interface D1WorkGraphAtomRow {
  atom_id:        string
  gear_id:        string
  node_id:        string
  tool_refs:      string   // JSON-encoded string[]
  invariant_ids:  string   // JSON-encoded string[]
  depends_on:     string   // JSON-encoded string[]
  d1_artifact_ref: string
}

export async function fetchWorkgraphAtoms(
  d1: D1Database,
  d1ArtifactRefs: string[],
): Promise<WorkGraphAtom[]> {
  if (d1ArtifactRefs.length === 0) {
    throw new CompileError(
      'invalid_workgraph_node',
      'CommissionRequest.d1ArtifactRefs must not be empty.',
    )
  }

  const placeholders = d1ArtifactRefs.map(() => '?').join(', ')
  const result = await d1
    .prepare(`SELECT atom_id, gear_id, node_id, tool_refs, invariant_ids, depends_on, d1_artifact_ref
              FROM workgraph_atoms
              WHERE d1_artifact_ref IN (${placeholders})`)
    .bind(...d1ArtifactRefs)
    .all<D1WorkGraphAtomRow>()

  const foundRefs = new Set(result.results.map((r) => r.d1_artifact_ref))
  for (const ref of d1ArtifactRefs) {
    if (!foundRefs.has(ref)) {
      throw new CompileError(
        'invalid_workgraph_node',
        `WorkGraph atom with d1ArtifactRef '${ref}' not found in D1.`,
      )
    }
  }

  return result.results.map((row): WorkGraphAtom => ({
    atomId:        row.atom_id,
    gearId:        row.gear_id,
    nodeId:        row.node_id,
    toolRefs:      parseJsonArray(row.tool_refs, 'tool_refs', row.atom_id),
    invariantIds:  parseJsonArray(row.invariant_ids, 'invariant_ids', row.atom_id),
    dependsOn:     parseJsonArray(row.depends_on, 'depends_on', row.atom_id),
    d1ArtifactRef: row.d1_artifact_ref,
  }))
}

function parseJsonArray(raw: string, field: string, atomId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new TypeError('not an array')
    return parsed as string[]
  } catch {
    throw new CompileError(
      'invalid_workgraph_node',
      `Field '${field}' on atom '${atomId}' is not a valid JSON array: ${raw}`,
    )
  }
}
