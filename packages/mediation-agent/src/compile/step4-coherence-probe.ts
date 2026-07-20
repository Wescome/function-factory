/**
 * Step 4 — Coherence Verification Probe
 *
 * Purely deterministic validation pass — no LLM calls, no network I/O.
 *
 * Four checks:
 *   1. Invariant coverage  — every atom has at least one INV-* entry
 *   2. DAG acyclicity      — Kahn's algorithm over dependsOn edges
 *   3. Tool schema resolution — every tool in Gear.toolPolicy.allowed has a ToolSchemaEntry
 *   4. Detector ID resolution — every INV-* id is known in the invariant set
 *
 * SPEC-FF-ILAYER-EXEC-001 §3.2 step 4
 */

import type { ResolvedAtomBinding } from '../types.js'
import { CompileError, type ProbeResult } from '../types.js'

/**
 * Run the four-check coherence probe.
 * Throws CompileError('coherence_failure', …) on first failed check.
 * Returns ProbeResult { verdict: 'favorable' } on success.
 */
export function runCoherenceProbe(
  bindings: ResolvedAtomBinding[],
  knownInvariantIds: Set<string>,
): ProbeResult {
  // ── Check 1: Invariant coverage ──────────────────────────────────────────
  for (const { atom } of bindings) {
    const invIds = atom.invariantIds.filter((id) => id.startsWith('INV-'))
    if (invIds.length === 0) {
      const reason = `atom ${atom.atomId} has no INV-* binding`
      throw new CompileError('coherence_failure', reason)
    }
  }

  // ── Check 2: DAG acyclicity (Kahn's algorithm) ───────────────────────────
  const atomIds = new Set(bindings.map(({ atom }) => atom.atomId))

  // Build adjacency and in-degree map
  const inDegree = new Map<string, number>()
  const children = new Map<string, string[]>()

  for (const { atom } of bindings) {
    if (!inDegree.has(atom.atomId)) inDegree.set(atom.atomId, 0)
    if (!children.has(atom.atomId)) children.set(atom.atomId, [])

    for (const parent of atom.dependsOn) {
      // Only count internal edges (skip edges to atoms outside this workgraph slice)
      if (atomIds.has(parent)) {
        inDegree.set(atom.atomId, (inDegree.get(atom.atomId) ?? 0) + 1)
        const kids = children.get(parent) ?? []
        kids.push(atom.atomId)
        children.set(parent, kids)
      }
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  let processed = 0
  while (queue.length > 0) {
    const current = queue.shift()!
    processed++
    for (const child of children.get(current) ?? []) {
      const newDeg = (inDegree.get(child) ?? 0) - 1
      inDegree.set(child, newDeg)
      if (newDeg === 0) queue.push(child)
    }
  }

  if (processed !== bindings.length) {
    // Find a cycle participant for the error message
    const cycleNode = [...inDegree.entries()].find(([, deg]) => deg > 0)?.[0] ?? '(unknown)'
    const reason = `circular dependsOn: ${cycleNode} → … → ${cycleNode}`
    throw new CompileError('coherence_failure', reason)
  }

  // ── Check 3: Tool schema resolution ─────────────────────────────────────
  for (const { atom, gear, toolSchemas } of bindings) {
    const knownTools = new Set(toolSchemas.map((ts) => ts.name))
    for (const toolName of gear.toolPolicy.allowed) {
      if (!knownTools.has(toolName)) {
        const reason = `tool ${toolName} in atom ${atom.atomId} has no schema`
        throw new CompileError('coherence_failure', reason)
      }
    }
  }

  // ── Check 4: Detector ID resolution ─────────────────────────────────────
  if (knownInvariantIds.size > 0) {
    for (const { atom } of bindings) {
      for (const invId of atom.invariantIds) {
        if (!knownInvariantIds.has(invId)) {
          const reason = `detectorId ${invId} in atom ${atom.atomId} not found in invariant set`
          throw new CompileError('coherence_failure', reason)
        }
      }
    }
  }
  // When no invariant set is provided (empty), check 4 is skipped (non-bootstrapped run)

  return { verdict: 'favorable', reason: 'all coherence checks passed' }
}
