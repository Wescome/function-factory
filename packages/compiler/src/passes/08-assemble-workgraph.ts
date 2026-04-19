/**
 * Pass 8- assemble WorkGraph.
 *
 * Terminal compiler pass. Consumes validated intermediates from Passes
 * 1-5 plus a passing Gate 1 Coverage Report from Pass 7, produces a
 * WorkGraph conforming to the WorkGraph Zod schema. Pure function- no
 * IO, no mutation of inputs, no external state.
 *
 * Fail-closed- throws if the Gate 1 verdict is anything other than
 * `pass`. The orchestrator is responsible for providing a report; Pass
 * 8 at this layer trusts the type signature.
 *
 * Determinism- given identical validated inputs, returns a WorkGraph
 * whose serialized content is identical modulo emission timestamp.
 * Node and edge arrays are sorted before emission. No Map or Set
 * iteration order is relied upon.
 *
 * Schema conformance- defensively re-validates the constructed
 * WorkGraph via WorkGraph.safeParse before returning. Matches the
 * belt-and-suspenders pattern in runGate1.
 */

import type { z } from "zod"
import {
  WorkGraph,
  WorkGraphEdge,
  WorkGraphNode,
  WorkGraphNodeType,
  type ArtifactId,
  type Contract,
  type Dependency,
  type Gate1Report,
  type Invariant,
  type PRDDraft,
  type RequirementAtom,
  type ValidationSpec,
} from "@factory/schemas"
import { workGraphId } from "./_shared.js"

type WorkGraphNodeT = z.infer<typeof WorkGraphNode>
type WorkGraphEdgeT = z.infer<typeof WorkGraphEdge>
type WorkGraphNodeTypeT = z.infer<typeof WorkGraphNodeType>

/**
 * Deterministic rule set mapping Contract.kind to WorkGraphNodeType.
 * Behavior contracts describe executable function behavior -> execution.
 * Invariant contracts describe system-level rules -> control.
 * Api and schema contracts describe interface surfaces -> interface.
 * Any other kind is a schema-evolution edge case and throws.
 */
function typeForContract(contract: Contract): WorkGraphNodeTypeT {
  switch (contract.kind) {
    case "behavior":
      return "execution"
    case "invariant":
      return "control"
    case "api":
    case "schema":
      return "interface"
    default: {
      const _exhaustive: never = contract.kind
      throw new Error(
        `Pass 8- unrecognized Contract.kind on ${contract.id}- ${String(
          _exhaustive
        )}`
      )
    }
  }
}

export function assembleWorkgraph(
  prd: PRDDraft,
  atoms: readonly RequirementAtom[],
  contracts: readonly Contract[],
  invariants: readonly Invariant[],
  dependencies: readonly Dependency[],
  validations: readonly ValidationSpec[],
  gate1Report: Gate1Report
): WorkGraph {
  // Fail-closed precondition- Gate 1 must pass.
  if (gate1Report.overall !== "pass") {
    throw new Error(
      `Pass 8 refuses to run on a failed Gate 1 verdict. Coverage Report id- ${gate1Report.id}`
    )
  }

  // Collect node ids (strings reusing source artifact ids directly;
  // WorkGraphNode.id is plain z.string(), not ArtifactId).
  const nodes: WorkGraphNodeT[] = []
  const nodeIdSet = new Set<string>()

  // Nodes from contracts- type per the rule set above.
  for (const c of contracts) {
    nodes.push({
      id: c.id,
      type: typeForContract(c),
      title: c.statement,
      implements: c.id,
    })
    nodeIdSet.add(c.id)
  }

  // Nodes from standalone invariants- type control.
  for (const inv of invariants) {
    nodes.push({
      id: inv.id,
      type: "control",
      title: inv.statement,
      implements: inv.id,
    })
    nodeIdSet.add(inv.id)
  }

  // Nodes from validations- type evidence.
  for (const v of validations) {
    nodes.push({
      id: v.id,
      type: "evidence",
      title: v.statement,
      implements: v.id,
    })
    nodeIdSet.add(v.id)
  }

  // Edges from dependencies- one edge per Dependency, preserving type.
  // Each endpoint must resolve to a node in the set built above.
  const edges: WorkGraphEdgeT[] = []
  for (const d of dependencies) {
    if (!nodeIdSet.has(d.from) || !nodeIdSet.has(d.to)) {
      throw new Error(
        `Pass 8- dependency ${d.id} references artifact id not present in node set (from- ${d.from}, to- ${d.to})`
      )
    }
    edges.push({
      from: d.from,
      to: d.to,
      dependencyType: d.type,
    })
  }

  // Edges from covers-relationships on validations.
  // coversInvariantIds -> evidence-to-control edge
  // coversContractIds -> evidence-to-execution edge
  // coversAtomIds -> no edge (atoms are specification-layer, not nodes)
  for (const v of validations) {
    for (const invId of v.coversInvariantIds) {
      if (nodeIdSet.has(invId)) {
        edges.push({ from: v.id, to: invId, dependencyType: "validates" })
      }
    }
    for (const contractId of v.coversContractIds) {
      if (nodeIdSet.has(contractId)) {
        edges.push({
          from: v.id,
          to: contractId,
          dependencyType: "validates",
        })
      }
    }
  }

  // Determinism- sort nodes by id, edges by (from, to, dependencyType).
  nodes.sort((a, b) => a.id.localeCompare(b.id))
  edges.sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from)
    if (fromCmp !== 0) return fromCmp
    const toCmp = a.to.localeCompare(b.to)
    if (toCmp !== 0) return toCmp
    return (a.dependencyType ?? "").localeCompare(b.dependencyType ?? "")
  })

  // Aggregate source_refs- PRD + Coverage Report + every intermediate.
  const refSet = new Set<string>()
  refSet.add(prd.id)
  refSet.add(gate1Report.id)
  for (const c of contracts) refSet.add(c.id)
  for (const inv of invariants) refSet.add(inv.id)
  for (const d of dependencies) refSet.add(d.id)
  for (const v of validations) refSet.add(v.id)
  // Atoms contribute lineage too (the contracts derived from them); cite
  // to make the assembly auditable all the way to spec-layer.
  for (const a of atoms) refSet.add(a.id)
  const source_refs = Array.from(refSet).sort() as ArtifactId[]

  const candidate: WorkGraph = {
    id: workGraphId(prd.id),
    source_refs,
    explicitness: "explicit",
    rationale: `WorkGraph assembled from validated intermediates of ${prd.id}; Gate 1 verdict ${gate1Report.overall} cited in source_refs`,
    functionId: prd.sourceFunctionId,
    nodes,
    edges,
  }

  // Defensive re-validation. TypeScript types guarantee the shape; Zod
  // refinements (e.g., nodes.min(1), WG- prefix) aren't captured in TS
  // types. If this throws, it's a Pass 8 implementation defect.
  const parsed = WorkGraph.safeParse(candidate)
  if (!parsed.success) {
    throw new Error(
      `Pass 8 produced an invalid WorkGraph- ${parsed.error.message}`
    )
  }
  return parsed.data
}
