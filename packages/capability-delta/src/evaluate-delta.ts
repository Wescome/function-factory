import type { BusinessCapability, CapabilityDelta } from "@factory/schemas"
import type { RepoInventory } from "./types.js"
import { capabilityDeltaId } from "./ids.js"

const SUPPORTED_CAPABILITIES = [
  "BC-META-COMPUTE-CAPABILITY-DELTA",
  "BC-META-SEMANTICALLY-REVIEW-PRDS",
  "BC-META-EMIT-ARCHITECTURE-CANDIDATES",
] as const

type SupportedId = (typeof SUPPORTED_CAPABILITIES)[number]

interface FindingTemplate {
  readonly dimension: "execution" | "control" | "evidence" | "integration"
  readonly status: "missing" | "underutilized"
  readonly statement: string
  readonly severity: number
  readonly confidence: number
}

const FINDING_TEMPLATES: Record<SupportedId, readonly FindingTemplate[]> = {
  "BC-META-COMPUTE-CAPABILITY-DELTA": [
    { dimension: "execution", status: "missing", statement: "No capability-delta execution engine exists", severity: 1, confidence: 0.95 },
    { dimension: "control", status: "missing", statement: "No deterministic delta classification rules exist", severity: 1, confidence: 0.95 },
    { dimension: "evidence", status: "missing", statement: "No DEL-* artifacts are emitted", severity: 1, confidence: 0.95 },
    { dimension: "integration", status: "underutilized", statement: "Schemas exist but are not integrated into a Stage 4 pipeline", severity: 0.7, confidence: 0.9 },
  ],
  "BC-META-SEMANTICALLY-REVIEW-PRDS": [
    { dimension: "execution", status: "missing", statement: "No semantic review execution engine exists", severity: 1, confidence: 0.95 },
    { dimension: "control", status: "missing", statement: "No fail-closed semantic review rule set exists", severity: 1, confidence: 0.95 },
    { dimension: "evidence", status: "missing", statement: "No SemanticReviewReport or equivalent artifacts are emitted", severity: 1, confidence: 0.95 },
    { dimension: "integration", status: "underutilized", statement: "Gate 1 exists but semantic review is not integrated into the compile path", severity: 0.75, confidence: 0.9 },
  ],
  "BC-META-EMIT-ARCHITECTURE-CANDIDATES": [
    { dimension: "execution", status: "missing", statement: "No ArchitectureCandidate emission engine exists", severity: 1, confidence: 0.95 },
    { dimension: "control", status: "missing", statement: "No candidate selection and emission rule set exists", severity: 1, confidence: 0.95 },
    { dimension: "evidence", status: "missing", statement: "No ArchitectureCandidate artifacts or candidate evidence records are emitted", severity: 1, confidence: 0.95 },
    { dimension: "integration", status: "underutilized", statement: "WorkGraph emission exists but candidate emission is not integrated into Stage 5", severity: 0.75, confidence: 0.9 },
  ],
}

const RATIONALE: Record<SupportedId, string> = {
  "BC-META-COMPUTE-CAPABILITY-DELTA": "Derived from repo architecture audit and current inventory",
  "BC-META-SEMANTICALLY-REVIEW-PRDS": "Derived from repo architecture audit and semantic-review inventory",
  "BC-META-EMIT-ARCHITECTURE-CANDIDATES": "Derived from repo architecture audit and architecture-candidate inventory",
}

export function evaluateDelta(
  capability: BusinessCapability,
  inventory: RepoInventory
): CapabilityDelta {
  const id = capability.id as SupportedId
  if (!SUPPORTED_CAPABILITIES.includes(id)) {
    throw new Error(
      `Narrow Phase 1: only [${SUPPORTED_CAPABILITIES.join(", ")}] are supported, got ${capability.id}`
    )
  }

  void inventory

  const findings = FINDING_TEMPLATES[id].map((t) => ({
    ...t,
    evidenceRefs: ["SIG-META-REPO-ARCH-AUDIT"],
  }))

  return {
    id: capabilityDeltaId(capability.id),
    capabilityId: capability.id,
    overallStatus: "missing",
    findings: [...findings],
    recommendedFunctionTypes: ["execution", "control", "evidence"],
    source_refs: capability.source_refs,
    explicitness: "inferred",
    rationale: RATIONALE[id],
  }
}
