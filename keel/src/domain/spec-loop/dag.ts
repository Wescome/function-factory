/**
 * spec-loop/dag.ts — PLAYBOOK-KEEL-HANDOFF-001 (C2, Track 1): the pure
 * dependency-graph check over one `runSpecLoop` batch (a parent's derived
 * children), mirroring `coverage.ts`'s own shape and discipline exactly —
 * a SET check over the whole candidate batch, never a per-candidate
 * judgment, checked BEFORE any candidate in the batch is admitted.
 *
 * "Load edges flat, run the algorithm, discard" (KEEL's own D-note:
 * recursive CTEs are banned everywhere) -- this is the in-memory
 * equivalent, over the run's own tiny sub-spec set. A hand-rolled Kahn's
 * algorithm, not a third-party graph library: disclosed decision --
 * evaluated a reference `@factory/graph` (graphology + seven
 * graphology-* plugins) the user supplied alongside this playbook, but
 * that package is built for a much broader surface (centrality,
 * PageRank, shortest-path, transitive closure up to 1000 nodes) than
 * this needs, and pulling 8 new npm dependencies into KEEL's frozen,
 * substrate-free domain layer for a textbook ~20-line algorithm over a
 * single run's own sub-specs (single-digit to low-dozens of nodes) is
 * disproportionate to the need -- the SAME "load flat, run, discard"
 * pattern that reference package documents, without the dependency.
 */
import type { SpecificationContent } from "../lineage/nodes";

export interface DagEdge {
  readonly downstream: string; // servesClause id
  readonly upstream: string;   // servesClause id
}

export interface DependencyReport {
  /** True iff no cycle and no dangling edge -- the batch's dependency
   *  declarations are well-formed and admittable. */
  readonly ok: boolean;
  /** Non-empty iff the declared edges (restricted to this batch's own
   *  servesClause ids) contain a cycle -- Kahn's algorithm's own
   *  leftover-after-processing set. INV-HANDOFF-CYCLE fail-closed (C2a):
   *  a cycle here escalates the WHOLE batch, never a silent partial admit,
   *  never a deadlock. */
  readonly cycleNodes: readonly string[];
  /** A `dependsOnClauses` entry that does not resolve to any SIBLING's
   *  servesClause in this SAME batch -- a malformed declaration (the
   *  dependency it names doesn't exist here to ever satisfy it, which
   *  would otherwise hang the held child forever, uncaught by any reaper
   *  since a held child has none of its own). Fail-closed, same severity
   *  as a cycle: escalate rather than silently never-release. */
  readonly danglingEdges: readonly DagEdge[];
}

/** Every declared edge in the batch, well-formed or not (danglingEdges in
 *  the report is exactly the ones NOT resolving to a sibling). */
function declaredEdges(candidates: readonly SpecificationContent[]): readonly DagEdge[] {
  const edges: DagEdge[] = [];
  for (const c of candidates) {
    if (!c.servesClause) continue;
    for (const upstream of c.dependsOnClauses ?? []) edges.push({ downstream: c.servesClause, upstream });
  }
  return edges;
}

/** Kahn's algorithm: process nodes with zero remaining in-degree,
 *  decrementing neighbors, repeatedly. Whatever's left unprocessed once
 *  the queue drains is exactly the node set involved in a cycle (a node
 *  outside any cycle always eventually reaches in-degree 0). Pure,
 *  in-memory, O(V+E) -- never a recursive CTE. */
function cycleNodesOf(nodeIds: readonly string[], edges: readonly DagEdge[]): readonly string[] {
  const nodes = new Set(nodeIds);
  const inDegree = new Map<string, number>([...nodes].map((n) => [n, 0]));
  const adj = new Map<string, string[]>([...nodes].map((n) => [n, []]));
  for (const e of edges) {
    if (!nodes.has(e.upstream) || !nodes.has(e.downstream)) continue; // dangling -- reported separately, not a cycle input
    adj.get(e.upstream)!.push(e.downstream);
    inDegree.set(e.downstream, (inDegree.get(e.downstream) ?? 0) + 1);
  }
  const queue = [...nodes].filter((n) => inDegree.get(n) === 0);
  const processed = new Set<string>();
  while (queue.length) {
    const n = queue.shift()!;
    processed.add(n);
    for (const next of adj.get(n) ?? []) {
      const d = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return [...nodes].filter((n) => !processed.has(n)).sort();
}

/**
 * The whole-batch check `runSpecLoop` runs alongside `checkCoverage`, on
 * the SAME sliced candidate list, before any of them is admitted (Track
 * 1). Empty (no candidate declares a dependency) is trivially ok — no
 * dependency graph, nothing to check (Track C, additive).
 */
export function checkDependencyGraph(candidates: readonly SpecificationContent[]): DependencyReport {
  const edges = declaredEdges(candidates);
  if (edges.length === 0) return { ok: true, cycleNodes: [], danglingEdges: [] };

  const nodeIds = candidates.map((c) => c.servesClause).filter((id): id is string => !!id);
  const nodeIdSet = new Set(nodeIds);
  const danglingEdges = edges.filter((e) => !nodeIdSet.has(e.upstream) || !nodeIdSet.has(e.downstream));
  const cycleNodes = cycleNodesOf(nodeIds, edges);

  return { ok: cycleNodes.length === 0 && danglingEdges.length === 0, cycleNodes, danglingEdges };
}
