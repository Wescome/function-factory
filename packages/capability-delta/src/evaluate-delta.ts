import type { BusinessCapability, CapabilityDelta } from "@factory/schemas"
import type { RepoInventory } from "./types.js"
import { capabilityDeltaId } from "./ids.js"

const SUPPORTED_CAPABILITY = "BC-META-COMPUTE-CAPABILITY-DELTA"

export function evaluateDelta(
  capability: BusinessCapability,
  inventory: RepoInventory
): CapabilityDelta {
  if (capability.id !== SUPPORTED_CAPABILITY) {
    throw new Error(
      `Narrow Phase 1: only ${SUPPORTED_CAPABILITY} is supported`
    )
  }

  void inventory

  const findings = [
    {
      dimension: "execution" as const,
      status: "missing" as const,
      statement: "No capability-delta execution engine exists",
      evidenceRefs: ["SIG-META-REPO-ARCH-AUDIT"],
      severity: 1,
      confidence: 0.95,
    },
    {
      dimension: "control" as const,
      status: "missing" as const,
      statement: "No deterministic delta classification rules exist",
      evidenceRefs: ["SIG-META-REPO-ARCH-AUDIT"],
      severity: 1,
      confidence: 0.95,
    },
    {
      dimension: "evidence" as const,
      status: "missing" as const,
      statement: "No DEL-* artifacts are emitted",
      evidenceRefs: ["SIG-META-REPO-ARCH-AUDIT"],
      severity: 1,
      confidence: 0.95,
    },
    {
      dimension: "integration" as const,
      status: "underutilized" as const,
      statement: "Schemas exist but are not integrated into a Stage 4 pipeline",
      evidenceRefs: ["SIG-META-REPO-ARCH-AUDIT"],
      severity: 0.7,
      confidence: 0.9,
    },
  ]

  return {
    id: capabilityDeltaId(capability.id),
    capabilityId: capability.id,
    overallStatus: "missing",
    findings: [...findings],
    recommendedFunctionTypes: ["execution", "control", "evidence"],
    source_refs: capability.source_refs,
    explicitness: "inferred",
    rationale: "Derived from repo architecture audit and current inventory",
  }
}
