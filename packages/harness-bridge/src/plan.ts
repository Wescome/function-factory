/**
 * Deterministic execution-plan derivation for a WorkGraph.
 *
 * Plan generation is the deterministic slice of Stage 6 per
 * PRD-META-HARNESS-EXECUTE AC 10. Given identical WorkGraph input, the
 * returned dispatch order is byte-identical across invocations. Runtime
 * outcomes are not required to be deterministic; plan fields are.
 *
 * Order- nodes sorted alphabetically by id. This is the simplest
 * deterministic order that does not presuppose a particular edge
 * semantic (topological order would require fixing a direction
 * convention for WorkGraphEdge.dependencyType, which is a separate
 * architectural decision). Downstream adapters that need dependency
 * ordering can re-sort based on edges; the plan itself is the
 * canonical, schema-trivial ordering.
 */

import type { WorkGraph, WorkGraphNode } from "@factory/schemas"
import type { z } from "zod"

type WorkGraphT = z.infer<typeof WorkGraph>
type WorkGraphNodeT = z.infer<typeof WorkGraphNode>

export function derivePlan(workgraph: WorkGraphT): readonly WorkGraphNodeT[] {
  return [...workgraph.nodes].sort((a, b) => a.id.localeCompare(b.id))
}
