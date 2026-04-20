import type { CapabilityDelta, FunctionProposal } from "@factory/schemas"

const SUPPORTED_CAPABILITIES = [
  "BC-META-COMPUTE-CAPABILITY-DELTA",
  "BC-META-SEMANTICALLY-REVIEW-PRDS",
  "BC-META-EMIT-ARCHITECTURE-CANDIDATES",
] as const

type SupportedId = (typeof SUPPORTED_CAPABILITIES)[number]

type ProposalTemplate = Omit<FunctionProposal, "source_refs" | "explicitness" | "capabilityId">

const PROPOSAL_TEMPLATES: Record<SupportedId, readonly ProposalTemplate[]> = {
  "BC-META-COMPUTE-CAPABILITY-DELTA": [
    {
      id: "FP-META-CAPABILITY-DELTA-ENGINE",
      rationale: "Execution gap identified in capability delta",
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
      rationale: "Control gap identified in capability delta",
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
      rationale: "Evidence gap identified in capability delta",
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
  ],
  "BC-META-SEMANTICALLY-REVIEW-PRDS": [
    {
      id: "FP-META-SEMANTIC-REVIEW-EXECUTION",
      rationale: "Execution gap identified in semantic review capability delta",
      name: "semantic_review_execution",
      purpose: "Execute a semantic review pass between Gate 1 and WorkGraph emission",
      functionType: "execution",
      expectedInputs: ["PRDDraft", "Gate1Report", "reference doctrine set"],
      expectedOutputs: ["semantic review verdict"],
      governingConstraints: ["fail-closed", "bootstrap human-governed"],
      candidateInvariants: ["semantic review is required before WorkGraph emission"],
      successSignals: ["semantic review verdict persisted"],
      confidence: 0.94,
    },
    {
      id: "FP-META-SEMANTIC-REVIEW-RULES",
      rationale: "Control gap identified in semantic review capability delta",
      name: "semantic_review_rules",
      purpose: "Define fail-closed semantic review rules and statuses",
      functionType: "control",
      expectedInputs: ["PRDDraft", "Gate1Report", "doctrine sources"],
      expectedOutputs: ["semantic review findings", "semantic review status"],
      governingConstraints: ["must not weaken Gate 1"],
      candidateInvariants: ["structurally valid but conceptually wrong PRDs are blocked"],
      successSignals: ["consistent semantic review classification across repeated runs"],
      confidence: 0.94,
    },
    {
      id: "FP-META-SEMANTIC-REVIEW-EVIDENCE",
      rationale: "Evidence gap identified in semantic review capability delta",
      name: "semantic_review_evidence",
      purpose: "Emit review artifacts proving semantic review occurred and what it concluded",
      functionType: "evidence",
      expectedInputs: ["semantic review findings"],
      expectedOutputs: ["semantic review artifact"],
      governingConstraints: ["source references must be preserved"],
      candidateInvariants: ["semantic review artifacts always cite doctrine and PRD inputs"],
      successSignals: ["persisted evidence artifact for each semantic review run"],
      confidence: 0.9,
    },
  ],
  "BC-META-EMIT-ARCHITECTURE-CANDIDATES": [
    {
      id: "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      rationale: "Execution gap identified in architecture-candidate capability delta",
      name: "architecture_candidate_execution",
      purpose: "Emit ArchitectureCandidate artifacts alongside WorkGraphs",
      functionType: "execution",
      expectedInputs: ["PRDDraft", "WorkGraph", "candidate selection inputs"],
      expectedOutputs: ["ArchitectureCandidate artifact"],
      governingConstraints: ["Candidate artifact must remain separate from WorkGraph", "Candidate artifact must preserve lineage"],
      candidateInvariants: ["Every emitted candidate has explicit topology and binding intent"],
      successSignals: ["Candidate artifact persisted alongside WorkGraph"],
      confidence: 0.94,
    },
    {
      id: "FP-META-ARCHITECTURE-CANDIDATE-RULES",
      rationale: "Control gap identified in architecture-candidate capability delta",
      name: "architecture_candidate_rules",
      purpose: "Define candidate emission rules, selection criteria, and required fields",
      functionType: "control",
      expectedInputs: ["PRDDraft", "WorkGraph", "doctrine sources"],
      expectedOutputs: ["candidate emission rules", "candidate validity checks"],
      governingConstraints: ["Must not weaken compiler determinism"],
      candidateInvariants: ["Candidate artifacts always specify execution arrangement explicitly"],
      successSignals: ["Stable candidate classification across repeated runs"],
      confidence: 0.94,
    },
    {
      id: "FP-META-ARCHITECTURE-CANDIDATE-EVIDENCE",
      rationale: "Evidence gap identified in architecture-candidate capability delta",
      name: "architecture_candidate_evidence",
      purpose: "Emit reviewable artifacts proving candidate emission occurred and what was selected",
      functionType: "evidence",
      expectedInputs: ["candidate emission results"],
      expectedOutputs: ["candidate evidence artifact"],
      governingConstraints: ["source references must be preserved"],
      candidateInvariants: ["candidate evidence always cites doctrine and PRD inputs"],
      successSignals: ["persisted evidence artifact for each candidate emission run"],
      confidence: 0.9,
    },
  ],
}

export function emitFunctionProposals(
  delta: CapabilityDelta
): FunctionProposal[] {
  const id = delta.capabilityId as SupportedId
  if (!SUPPORTED_CAPABILITIES.includes(id)) {
    throw new Error(
      `Narrow Phase 1: only [${SUPPORTED_CAPABILITIES.join(", ")}] are supported, got ${delta.capabilityId}`
    )
  }

  return PROPOSAL_TEMPLATES[id].map((t) => ({
    ...t,
    source_refs: delta.source_refs,
    explicitness: "inferred" as const,
    capabilityId: delta.capabilityId,
  }))
}
