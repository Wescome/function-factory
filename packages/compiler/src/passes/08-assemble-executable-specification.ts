/**
 * Executable Specification Assembly.
 *
 * Structural Assembly implementation. Ontology v0.2 reserves Pass 8 for future
 * Instruction Tuning, so this module exposes Executable Specification Assembly
 * directly.
 *
 * Consumes validated intermediates plus a passing Coherence Verification
 * report and produces an Executable Specification conforming to the
 * ExecutableSpecification Zod schema.
 * Pure function- no IO, no mutation of inputs, no external state.
 *
 * Fail-closed- throws if the Coherence Verification verdict is anything other than
 * `pass`. The orchestrator is responsible for providing a report; this layer
 * trusts the type signature.
 *
 * Determinism- given identical validated inputs, returns an Executable
 * Specification
 * whose serialized content is identical modulo emission timestamp.
 * Node and edge arrays are sorted before emission. No Map or Set
 * iteration order is relied upon.
 *
 * Schema conformance- defensively re-validates the constructed
 * Executable Specification via ExecutableSpecification.safeParse before returning. Matches the
 * belt-and-suspenders pattern in runCoherenceVerification.
 */

import type { z } from "zod"
import {
  ExecutableSpecification,
  ExecutableSpecificationEdge,
  ExecutableSpecificationNode,
  ExecutableSpecificationNodeType,
  type ArtifactId,
  type Contract,
  type Dependency,
  type CoherenceVerificationReport,
  type Invariant,
  type IntentSpecification,
  type RequirementAtom,
  type ValidationSpec,
} from "@factory/schemas"
import { executableSpecificationId } from "./_shared.js"

type ExecutableSpecificationNodeT = z.infer<typeof ExecutableSpecificationNode>
type ExecutableSpecificationEdgeT = z.infer<typeof ExecutableSpecificationEdge>
type ExecutableSpecificationNodeTypeT = z.infer<typeof ExecutableSpecificationNodeType>

/**
 * Deterministic rule set mapping Contract.kind to ExecutableSpecificationNodeType.
 * Behavior contracts describe executable function behavior -> execution.
 * Invariant contracts describe system-level rules -> control.
 * Api and schema contracts describe interface surfaces -> interface.
 * Any other kind is a schema-evolution edge case and throws.
 */
function typeForContract(contract: Contract): ExecutableSpecificationNodeTypeT {
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
        `Executable Specification Assembly- unrecognized Contract.kind on ${contract.id}- ${String(
          _exhaustive
        )}`
      )
    }
  }
}

export function assembleExecutableSpecification(
  intentSpecification: IntentSpecification,
  atoms: readonly RequirementAtom[],
  contracts: readonly Contract[],
  invariants: readonly Invariant[],
  dependencies: readonly Dependency[],
  validations: readonly ValidationSpec[],
  coherenceVerificationReport: CoherenceVerificationReport
): ExecutableSpecification {
  // Fail-closed precondition- Coherence Verification must pass.
  if (coherenceVerificationReport.overall !== "pass") {
    throw new Error(
      `Executable Specification Assembly refuses to run on a failed Coherence Verification verdict. Verification Report id- ${coherenceVerificationReport.id}`
    )
  }

  // Collect node ids (strings reusing source artifact ids directly;
  // ExecutableSpecificationNode.id is plain z.string(), not ArtifactId).
  const nodes: ExecutableSpecificationNodeT[] = []
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
  const edges: ExecutableSpecificationEdgeT[] = []
  for (const d of dependencies) {
    if (!nodeIdSet.has(d.from) || !nodeIdSet.has(d.to)) {
      throw new Error(
        `Executable Specification Assembly- dependency ${d.id} references artifact id not present in node set (from- ${d.from}, to- ${d.to})`
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

  // Aggregate source_refs- Intent Specification + Verification Report + every intermediate.
  const refSet = new Set<string>()
  refSet.add(intentSpecification.id)
  refSet.add(coherenceVerificationReport.id)
  for (const c of contracts) refSet.add(c.id)
  for (const inv of invariants) refSet.add(inv.id)
  for (const d of dependencies) refSet.add(d.id)
  for (const v of validations) refSet.add(v.id)
  // Atoms contribute lineage too (the contracts derived from them); cite
  // to make the assembly auditable all the way to spec-layer.
  for (const a of atoms) refSet.add(a.id)
  const source_refs = Array.from(refSet).sort() as ArtifactId[]

  const candidate: ExecutableSpecification = {
    id: executableSpecificationId(intentSpecification.id),
    source_refs,
    explicitness: "explicit",
    rationale: `ExecutableSpecification assembled from validated intermediates of ${intentSpecification.id}; Coherence Verification verdict ${coherenceVerificationReport.overall} cited in source_refs`,
    functionId: intentSpecification.sourceFunctionId,
    nodes,
    edges,
  }

  // Defensive re-validation. TypeScript types guarantee the shape; Zod
  // refinements (e.g., nodes.min(1), ES- prefix) aren't captured in TS
  // types. If this throws, it's an assembly implementation defect.
  const parsed = ExecutableSpecification.safeParse(candidate)
  if (!parsed.success) {
    throw new Error(
      `Executable Specification Assembly produced an invalid Executable Specification- ${parsed.error.message}`
    )
  }
  return parsed.data
}
