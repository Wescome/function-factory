import type { CapabilityDelta, FunctionProposal } from "@factory/schemas"

const SUPPORTED_CAPABILITY = "BC-META-COMPUTE-CAPABILITY-DELTA"

export function emitFunctionProposals(
  delta: CapabilityDelta
): FunctionProposal[] {
  if (delta.capabilityId !== SUPPORTED_CAPABILITY) {
    throw new Error(
      `Narrow Phase 1: only ${SUPPORTED_CAPABILITY} is supported`
    )
  }

  return [
    {
      id: "FP-META-CAPABILITY-DELTA-ENGINE",
      source_refs: delta.source_refs,
      explicitness: "inferred",
      rationale: "Execution gap identified in capability delta",
      capabilityId: delta.capabilityId,
      name: "capability_delta_engine",
      purpose: "Compute capability delta deterministically",
      functionType: "execution",
      expectedInputs: ["BusinessCapability", "RepoInventory"],
      expectedOutputs: ["CapabilityDelta"],
      governingConstraints: ["Deterministic only", "No LLM inference"],
      candidateInvariants: ["lineage preserved", "explicit rationale preserved"],
      successSignals: ["DEL artifact emitted"],
      confidence: 0.95,
    },
    {
      id: "FP-META-CAPABILITY-DELTA-RULES",
      source_refs: delta.source_refs,
      explicitness: "inferred",
      rationale: "Control gap identified in capability delta",
      capabilityId: delta.capabilityId,
      name: "capability_delta_rules",
      purpose: "Classify capabilities into missing/degraded/underutilized/sufficient",
      functionType: "control",
      expectedInputs: ["BusinessCapability", "RepoInventory"],
      expectedOutputs: ["CapabilityDeltaFinding[]"],
      governingConstraints: ["Rule-based only"],
      candidateInvariants: ["deterministic classification"],
      successSignals: ["Stable findings across repeated runs"],
      confidence: 0.95,
    },
    {
      id: "FP-META-CAPABILITY-DELTA-EVIDENCE",
      source_refs: delta.source_refs,
      explicitness: "inferred",
      rationale: "Evidence gap identified in capability delta",
      capabilityId: delta.capabilityId,
      name: "capability_delta_evidence",
      purpose: "Emit DEL artifacts with explicit evidence references",
      functionType: "evidence",
      expectedInputs: ["CapabilityDelta"],
      expectedOutputs: ["DEL artifact"],
      governingConstraints: ["evidenceRefs must be populated"],
      candidateInvariants: ["DEL artifacts always cite evidence"],
      successSignals: ["DEL artifact persisted under specs/deltas"],
      confidence: 0.9,
    },
  ]
}
