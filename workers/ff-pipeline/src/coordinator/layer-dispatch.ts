/**
 * Layer dispatch — topological sort and parallel-per-layer execution.
 *
 * v5 implementation: groups atoms into dependency layers and executes
 * each layer via Promise.all on executeAtomSlice. Atoms in the same
 * layer run concurrently (concurrent I/O, not parallel compute —
 * fine since agents are I/O-bound on LLM calls).
 */

import { executeAtomSlice, type AtomSlice, type AtomResult, type AtomExecutorDeps } from './atom-executor'

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface DependencyLayer {
  index: number
  atomIds: string[]
}

// ────────────────────────────────────────────────────────────
// topologicalSort — group atoms into dependency layers
// ────────────────────────────────────────────────────────────

/**
 * Groups atoms into dependency layers using Kahn's algorithm.
 *
 * Layer 0 has atoms with no dependencies.
 * Layer N has atoms that depend only on atoms in layers 0..N-1.
 *
 * Dependencies are edges: { from: sourceAtomId, to: targetAtomId }.
 * "from" must complete before "to" can start.
 */
export function topologicalSort(
  atoms: Record<string, unknown>[],
  dependencies: Record<string, unknown>[],
): DependencyLayer[] {
  if (atoms.length === 0) return []

  // Build adjacency lists and in-degree counts
  const atomIds = new Set(atoms.map(a => (a.id ?? a._key) as string))
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const id of atomIds) {
    inDegree.set(id, 0)
    dependents.set(id, [])
  }

  for (const dep of dependencies) {
    const from = dep.from as string
    const to = dep.to as string

    // Only process edges where both endpoints exist in the atom set
    if (!atomIds.has(from) || !atomIds.has(to)) continue

    inDegree.set(to, (inDegree.get(to) ?? 0) + 1)
    dependents.get(from)!.push(to)
  }

  // Kahn's algorithm — layer by layer
  const layers: DependencyLayer[] = []
  let remaining = new Set(atomIds)

  while (remaining.size > 0) {
    // Find all atoms with in-degree 0 (no unresolved dependencies)
    const layerAtoms: string[] = []
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        layerAtoms.push(id)
      }
    }

    if (layerAtoms.length === 0) {
      // Cycle detected — break out with remaining atoms in one layer
      // This should not happen with a well-formed WorkGraph
      layers.push({
        index: layers.length,
        atomIds: [...remaining],
      })
      break
    }

    layers.push({
      index: layers.length,
      atomIds: layerAtoms,
    })

    // Remove completed atoms and decrement in-degrees
    for (const id of layerAtoms) {
      remaining.delete(id)
      for (const dependent of dependents.get(id) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 0) - 1)
      }
    }
  }

  return layers
}

// ────────────────────────────────────────────────────────────
// executeLayer — run all atoms in a layer via Promise.all
// ────────────────────────────────────────────────────────────

/**
 * Executes all atoms in a dependency layer concurrently.
 *
 * Each atom gets its upstream artifacts resolved from completedArtifacts.
 * Returns a map of atomId → AtomResult for all atoms in this layer.
 */
export async function executeLayer(
  layer: DependencyLayer,
  atomSpecs: Map<string, Record<string, unknown>>,
  completedArtifacts: Map<string, AtomResult>,
  deps: AtomExecutorDeps,
  sharedContext: AtomSlice['sharedContext'],
  opts: { maxRetries: number; dryRun: boolean },
): Promise<Map<string, AtomResult>> {
  const results = new Map<string, AtomResult>()

  const promises = layer.atomIds.map(async (atomId) => {
    const spec = atomSpecs.get(atomId)
    if (!spec) {
      // Missing spec — produce a fail result
      return {
        atomId,
        verdict: { decision: 'fail' as const, confidence: 1.0, reason: `No spec found for atom ${atomId}` },
        codeArtifact: null,
        testReport: null,
        critiqueReport: null,
        retryCount: 0,
      } satisfies AtomResult
    }

    // Resolve upstream artifacts for this atom
    const upstreamArtifacts: Record<string, unknown> = {}
    const atomDeps = spec.dependencies as Array<{ atomId: string; edgeType?: string }> | undefined
    if (atomDeps) {
      for (const dep of atomDeps) {
        const upstream = completedArtifacts.get(dep.atomId)
        if (upstream?.codeArtifact) {
          upstreamArtifacts[dep.atomId] = upstream.codeArtifact
        }
      }
    }

    const slice: AtomSlice = {
      atomId,
      atomSpec: spec,
      upstreamArtifacts,
      sharedContext,
    }

    return executeAtomSlice(slice, deps, opts)
  })

  const atomResults = await Promise.all(promises)

  for (const result of atomResults) {
    results.set(result.atomId, result)
  }

  return results
}
