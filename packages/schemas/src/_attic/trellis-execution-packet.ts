import { z } from "zod"
import { ArtifactId, Explicitness } from "../lineage.js"
import {
  DomainAdapterId,
  DomainExecutionEvidence,
  DomainExecutionMode,
  DomainExecutionRequest,
} from "../domain-adapter.js"
import { trellisContentHash } from "./trellis-canonical-json.js"

const TepId = ArtifactId.refine((id) => id.startsWith("EP-"), "TrellisExecutionPacket IDs must start with EP-")
const NonEmptyStringArray = z.array(z.string().min(1)).min(1)

export const InstructionTuningProvenance = z.object({
  transformationVersion: z.string().min(1),
  inputExecutableSpecificationHash: z.string().min(1),
  outputPacketHash: z.string().min(1),
  generatedAt: z.string().datetime(),
  deterministicInputs: NonEmptyStringArray,
  uncertaintyRefs: z.array(z.string().regex(/^UNC-/)).default([]),
})
export type InstructionTuningProvenance = z.infer<typeof InstructionTuningProvenance>

export const TrellisRuntimeProfile = z.object({
  profileId: z.string().min(1),
  roleCatalogRef: z.string().min(1),
  toolCatalogRef: z.string().min(1),
  memoryCatalogRef: z.string().min(1),
  policyCatalogRef: z.string().min(1),
  modelPolicyRef: z.string().min(1).optional(),
  suppliedBy: z.literal("trellis-runtime"),
})
export type TrellisRuntimeProfile = z.infer<typeof TrellisRuntimeProfile>

export const DomainAdapterBinding = z.object({
  adapterId: DomainAdapterId,
  adapterContractRef: z.string().min(1),
  adapterContractHash: z.string().min(1),
  executionMode: DomainExecutionMode,
  requiredEffectors: NonEmptyStringArray,
  requiredEvidenceSources: NonEmptyStringArray,
  executionRequest: DomainExecutionRequest,
})
export type DomainAdapterBinding = z.infer<typeof DomainAdapterBinding>

export const TrellisRoleInstruction = z.object({
  roleId: z.string().min(1),
  roleKind: z.string().min(1),
  objective: z.string().min(1),
  inputs: z.array(z.string().min(1)).default([]),
  outputs: NonEmptyStringArray,
  toolBindingRefs: z.array(z.string().min(1)).default([]),
  evidenceObligations: z.array(z.string().min(1)).default([]),
  stopConditions: NonEmptyStringArray,
  escalationConditions: z.array(z.string().min(1)).default([]),
  instruction: z.string().min(1),
  provenanceRefs: NonEmptyStringArray,
})
export type TrellisRoleInstruction = z.infer<typeof TrellisRoleInstruction>

export const TrellisRoleGraph = z.object({
  nodes: z.array(z.object({
    roleId: z.string().min(1),
    executableNodeRefs: NonEmptyStringArray,
    dependsOn: z.array(z.string().min(1)).default([]),
    parallelizable: z.boolean(),
  })).min(1),
  edges: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    reason: z.string().min(1),
    blocking: z.boolean(),
  })).default([]),
})
export type TrellisRoleGraph = z.infer<typeof TrellisRoleGraph>

export const TrellisContextBundle = z.object({
  intentSummary: z.string().min(1),
  executableSummary: z.string().min(1),
  invariants: z.array(z.string().min(1)).default([]),
  validationRefs: z.array(z.string().min(1)).default([]),
  domainContextRefs: z.array(z.string().min(1)).default([]),
  memoryRefs: z.array(z.string().min(1)).default([]),
  omittedContext: z.array(z.object({
    ref: z.string().min(1),
    reason: z.string().min(1),
  })).default([]),
  provenanceRefs: NonEmptyStringArray,
})
export type TrellisContextBundle = z.infer<typeof TrellisContextBundle>

export const ToolBinding = z.object({
  bindingId: z.string().min(1),
  toolName: z.string().min(1),
  roles: NonEmptyStringArray,
  operation: z.enum(["read", "write", "execute"]),
  parameterSchemaRef: z.string().min(1),
  scopeSchemaRef: z.string().min(1),
  scope: z.array(z.string().min(1)),
  constraints: z.array(z.string().min(1)).default([]),
  timeoutMs: z.number().int().positive(),
  approvalRequired: z.boolean(),
  idempotency: z.enum(["required", "best-effort", "not-applicable"]),
  evidenceRequired: z.boolean(),
}).superRefine((binding, ctx) => {
  if ((binding.operation === "write" || binding.operation === "execute") && binding.scope.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scope"],
      message: "write and execute tool bindings require non-empty scope",
    })
  }
})
export type ToolBinding = z.infer<typeof ToolBinding>

export const TrellisToolPolicy = z.object({
  defaultPolicy: z.literal("deny"),
  bindings: z.array(ToolBinding).min(1),
})
export type TrellisToolPolicy = z.infer<typeof TrellisToolPolicy>

export const EvidenceRequirement = z.object({
  evidenceId: z.string().min(1),
  producedByRole: z.string().min(1),
  verifies: NonEmptyStringArray,
  verifierTarget: z.enum(["fidelity", "persistence", "both"]),
  source: z.string().min(1),
  collectionSource: z.string().min(1),
  expectedOutcome: z.string().min(1),
  retentionPolicy: z.string().min(1),
  hashRequired: z.boolean(),
  requiredForCompletion: z.boolean(),
})
export type EvidenceRequirement = z.infer<typeof EvidenceRequirement>

export const TrellisEvidencePlan = z.object({
  requiredEvidence: z.array(EvidenceRequirement).min(1),
  verificationInputs: z.object({
    fidelity: z.array(z.string().min(1)).default([]),
    persistence: z.array(z.string().min(1)).default([]),
  }),
})
export type TrellisEvidencePlan = z.infer<typeof TrellisEvidencePlan>

export const FailureCode = z.enum([
  "role-output-invalid",
  "required-evidence-missing",
  "tool-policy-violation",
  "adapter-contract-violation",
  "invariant-violation",
  "validation-failed",
  "runtime-timeout",
  "runtime-resource-exhausted",
  "human-escalation-required",
])
export type FailureCode = z.infer<typeof FailureCode>

export const TrellisRepairPolicy = z.object({
  maxRepairAttempts: z.number().int().min(0),
  failureClasses: z.array(z.object({
    code: FailureCode,
    retryable: z.boolean(),
    repairAuthority: z.enum(["none", "same-scope", "narrower-scope"]),
    recertificationRequired: z.boolean(),
  })).min(1),
  patchAuthority: z.array(z.object({
    roleId: z.string().min(1),
    scope: z.array(z.string().min(1)),
  })).default([]),
  escalationTarget: z.string().min(1),
})
export type TrellisRepairPolicy = z.infer<typeof TrellisRepairPolicy>

export const TrellisCompletionContract = z.object({
  successStatus: z.string().min(1),
  failureStatuses: NonEmptyStringArray,
  requiredOutputs: NonEmptyStringArray,
  requiredEvidence: NonEmptyStringArray,
  executionResultSchemaRef: z.string().min(1),
})
export type TrellisCompletionContract = z.infer<typeof TrellisCompletionContract>

export const LifecyclePathway = z.object({
  from: z.enum(["designed", "in_progress", "produced", "accepted"]),
  to: z.enum(["in_progress", "produced", "accepted", "monitored", "none"]),
  requiredVerification: z.enum(["none", "fidelity-verification", "persistence-verification"]),
}).superRefine((pathway, ctx) => {
  if (pathway.to === "accepted" && pathway.requiredVerification !== "fidelity-verification") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requiredVerification"],
      message: "accepted lifecycle pathway requires fidelity-verification",
    })
  }
  if (pathway.to === "monitored" && pathway.requiredVerification !== "persistence-verification") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requiredVerification"],
      message: "monitored lifecycle pathway requires persistence-verification",
    })
  }
})
export type LifecyclePathway = z.infer<typeof LifecyclePathway>

export const RepairAttemptEvidence = z.object({
  attemptId: z.string().min(1),
  failureCode: FailureCode,
  roleId: z.string().min(1),
  evidenceRefs: NonEmptyStringArray,
  recertified: z.boolean(),
})
export type RepairAttemptEvidence = z.infer<typeof RepairAttemptEvidence>

export const TrellisExecutionResult = z.object({
  packetId: TepId,
  packetHash: z.string().min(1),
  runId: z.string().min(1),
  status: z.enum(["succeeded", "failed", "aborted", "blocked"]),
  domainExecutionEvidence: z.array(DomainExecutionEvidence).min(1),
  executionTraceRefs: z.array(z.string().min(1)).default([]),
  validationOutcomes: z.array(z.string().min(1)).default([]),
  repairAttempts: z.array(RepairAttemptEvidence).default([]),
  fidelityVerificationInputRefs: z.array(z.string().min(1)).default([]),
  persistenceVerificationInputRefs: z.array(z.string().min(1)).default([]),
})
export type TrellisExecutionResult = z.infer<typeof TrellisExecutionResult>

export const TrellisPacketAudit = z.object({
  packetHash: z.string().min(1),
  canonicalOrdering: NonEmptyStringArray,
  sourceVerification: z.array(z.object({
    sourceRef: z.string().min(1),
    sourceField: z.string().min(1),
    consumedByPacketField: NonEmptyStringArray,
  })).min(1),
  unmappedExecutableRefs: z.array(z.string().min(1)).default([]),
  policyWarnings: z.array(z.string().min(1)).default([]),
})
export type TrellisPacketAudit = z.infer<typeof TrellisPacketAudit>

export const TrellisExecutionPacket = z.object({
  id: TepId,
  packetVersion: z.string().min(1),
  functionId: ArtifactId,
  intentSpecificationId: ArtifactId,
  executableSpecificationId: ArtifactId,
  selectedArchitectureCandidateId: ArtifactId.refine((id) => id.startsWith("AC-"), "selectedArchitectureCandidateId must start with AC-"),
  runtimeAdmissionId: ArtifactId.refine((id) => id.startsWith("RAD-"), "runtimeAdmissionId must start with RAD-"),
  source_refs: z.array(ArtifactId).min(5),
  explicitness: Explicitness,
  rationale: z.string().min(1),
  instructionTuning: InstructionTuningProvenance,
  runtimeProfile: TrellisRuntimeProfile,
  adapter: DomainAdapterBinding,
  roles: z.array(TrellisRoleInstruction).min(1),
  roleGraph: TrellisRoleGraph,
  contextBundle: TrellisContextBundle,
  toolPolicy: TrellisToolPolicy,
  evidencePlan: TrellisEvidencePlan,
  repairPolicy: TrellisRepairPolicy,
  completionContract: TrellisCompletionContract,
  lifecyclePathway: LifecyclePathway,
  audit: TrellisPacketAudit,
})
export type TrellisExecutionPacket = z.infer<typeof TrellisExecutionPacket>

export const InstructionTuningDiagnostic = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warning", "blocking"]),
  blocking: z.boolean(),
  source_refs: z.array(ArtifactId).min(1),
  message: z.string().min(1),
  packetField: z.string().min(1).optional(),
})
export type InstructionTuningDiagnostic = z.infer<typeof InstructionTuningDiagnostic>

export const InstructionTuningResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("emitted"),
    packet: TrellisExecutionPacket,
    diagnostics: z.array(InstructionTuningDiagnostic).default([]),
  }),
  z.object({
    status: z.literal("blocked"),
    diagnostics: z.array(InstructionTuningDiagnostic).min(1),
    uncertaintyEntries: z.array(z.string().regex(/^UNC-/)).min(1),
  }),
])
export type InstructionTuningResult = z.infer<typeof InstructionTuningResult>

export interface PacketCertificationResult {
  valid: boolean
  diagnostics: string[]
  packetHash: string
}

export function computeTrellisPacketHash(packet: TrellisExecutionPacket): string {
  return trellisContentHash(packet)
}

export function certifyTrellisExecutionPacket(packetInput: unknown): PacketCertificationResult {
  const parsed = TrellisExecutionPacket.safeParse(packetInput)
  if (!parsed.success) {
    return {
      valid: false,
      diagnostics: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      packetHash: "",
    }
  }

  const packet = parsed.data
  const diagnostics: string[] = []
  const roleIds = new Set(packet.roles.map((role) => role.roleId))
  const toolBindingIds = new Set(packet.toolPolicy.bindings.map((binding) => binding.bindingId))
  const evidenceIds = new Set(packet.evidencePlan.requiredEvidence.map((evidence) => evidence.evidenceId))
  const computedHash = computeTrellisPacketHash(packet)

  if (packet.audit.packetHash !== computedHash) diagnostics.push("audit.packetHash does not match canonical packet hash")
  if (packet.instructionTuning.outputPacketHash !== computedHash) diagnostics.push("instructionTuning.outputPacketHash does not match canonical packet hash")
  if (packet.audit.unmappedExecutableRefs.length > 0) diagnostics.push("audit.unmappedExecutableRefs must be empty")

  for (const node of packet.roleGraph.nodes) {
    if (!roleIds.has(node.roleId)) diagnostics.push(`roleGraph node references missing role: ${node.roleId}`)
    for (const dep of node.dependsOn) {
      if (!roleIds.has(dep)) diagnostics.push(`roleGraph dependency references missing role: ${dep}`)
    }
  }
  for (const edge of packet.roleGraph.edges) {
    if (!roleIds.has(edge.from)) diagnostics.push(`roleGraph edge.from references missing role: ${edge.from}`)
    if (!roleIds.has(edge.to)) diagnostics.push(`roleGraph edge.to references missing role: ${edge.to}`)
  }
  for (const role of packet.roles) {
    for (const bindingRef of role.toolBindingRefs) {
      if (!toolBindingIds.has(bindingRef)) diagnostics.push(`role ${role.roleId} references missing tool binding: ${bindingRef}`)
    }
    for (const evidenceRef of role.evidenceObligations) {
      if (!evidenceIds.has(evidenceRef)) diagnostics.push(`role ${role.roleId} references missing evidence obligation: ${evidenceRef}`)
    }
  }
  for (const binding of packet.toolPolicy.bindings) {
    for (const role of binding.roles) {
      if (!roleIds.has(role)) diagnostics.push(`tool binding ${binding.bindingId} references missing role: ${role}`)
    }
  }
  for (const evidence of packet.evidencePlan.requiredEvidence) {
    if (!roleIds.has(evidence.producedByRole)) diagnostics.push(`evidence ${evidence.evidenceId} references missing role: ${evidence.producedByRole}`)
  }
  for (const evidenceId of packet.completionContract.requiredEvidence) {
    if (!evidenceIds.has(evidenceId)) diagnostics.push(`completionContract references missing evidence: ${evidenceId}`)
  }
  if (packet.audit.sourceVerification.length === 0) diagnostics.push("audit.sourceVerification must not be empty")

  return {
    valid: diagnostics.length === 0,
    diagnostics,
    packetHash: computedHash,
  }
}
