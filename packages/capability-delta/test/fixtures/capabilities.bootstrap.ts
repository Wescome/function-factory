import type { BusinessCapability } from "@factory/schemas"

export const bootstrapCapabilities: readonly BusinessCapability[] = [
  {
    id: "BC-META-COMPUTE-CAPABILITY-DELTA",
    source_refs: ["PRS-META-UPSTREAM-PIPELINE-GAP"],
    explicitness: "inferred",
    rationale:
      "Derived from the audited Stage 4 gap: FunctionProposal artifacts exist but no delta engine exists.",
    name: "compute_capability_delta",
    purpose:
      "Determine which meta-capabilities are missing, degraded, underutilized, or sufficient and emit downstream FunctionProposal demand.",
    addressesPressureIds: ["PRS-META-UPSTREAM-PIPELINE-GAP"],
    desiredOutcomes: [
      "Capability deltas become explicit first-class artifacts.",
      "Function proposals can be emitted from deterministic Stage 4 logic."
    ],
    constraints: [
      "Must remain separate from Stage 5 compiler logic.",
      "Must preserve lineage and explicit rationale for all findings."
    ],
    successMetrics: [
      "Deterministic delta classification for audited bootstrap capabilities.",
      "Typed FunctionProposal emission from delta findings."
    ],
    affectedPersonas: ["architect", "coding-agent"],
    strategicPriority: 0.95,
    confidence: 0.95
  },
  {
    id: "BC-META-SEMANTICALLY-REVIEW-PRDS",
    source_refs: ["PRS-META-SEMANTIC-REVIEW-GAP"],
    explicitness: "inferred",
    rationale:
      "Derived from the documented gap between structural Gate 1 success and conceptual correctness.",
    name: "semantically_review_prds",
    purpose:
      "Perform fail-closed semantic review between Gate 1 success and WorkGraph emission.",
    addressesPressureIds: ["PRS-META-SEMANTIC-REVIEW-GAP"],
    desiredOutcomes: [
      "Structurally valid but conceptually wrong PRDs are blocked.",
      "Semantic review becomes a first-class pre-emission control."
    ],
    constraints: [
      "Must not weaken Gate 1 structural coverage discipline.",
      "Bootstrap path remains human-governed."
    ],
    successMetrics: [
      "Semantic review status is required before WorkGraph emission."
    ],
    affectedPersonas: ["architect", "critic-agent"],
    strategicPriority: 0.92,
    confidence: 0.9
  },
  {
    id: "BC-META-EMIT-ARCHITECTURE-CANDIDATES",
    source_refs: ["PRS-META-CANDIDATE-EMISSION-GAP"],
    explicitness: "inferred",
    rationale:
      "Derived from the whitepaper v2 requirement that Stage 5 emit WorkGraph plus ArchitectureCandidate artifacts.",
    name: "emit_architecture_candidates",
    purpose:
      "Emit candidate-bound execution artifacts alongside WorkGraphs at the end of Stage 5.",
    addressesPressureIds: ["PRS-META-CANDIDATE-EMISSION-GAP"],
    desiredOutcomes: [
      "Execution arrangement becomes explicit before runtime exists.",
      "Stage 5 output aligns with v2 paired-emission doctrine."
    ],
    constraints: [
      "Must not pollute WorkGraph with runtime-only execution details."
    ],
    successMetrics: [
      "At least one ArchitectureCandidate artifact emitted alongside each eligible WorkGraph."
    ],
    affectedPersonas: ["architect", "compiler-agent"],
    strategicPriority: 0.94,
    confidence: 0.91
  }
]
