import { z } from "zod"
import { ArtifactId } from "./lineage.js"

export const DomainAdapterId = z
  .string()
  .regex(/^adapter\.[a-z0-9][a-z0-9-]*$/, "DomainAdapterId must be adapter.<kebab-name>")
export type DomainAdapterId = z.infer<typeof DomainAdapterId>

export const KernelConcept = z.enum([
  "domain_substrate",
  "execution_workspace",
  "handoff_artifact",
  "effector_realization_artifact",
  "verification_evidence_source",
  "human_governance_input",
  "lifecycle_transition_substrate",
  "agent_call_role",
])
export type KernelConcept = z.infer<typeof KernelConcept>

export const DomainAdapterTermMapping = z.object({
  adapterTerm: z.string().min(1),
  kernelConcept: KernelConcept,
  description: z.string().min(1),
})
export type DomainAdapterTermMapping = z.infer<typeof DomainAdapterTermMapping>

export const DomainExecutionMode = z.enum(["simulate", "execute", "verify", "observe"])
export type DomainExecutionMode = z.infer<typeof DomainExecutionMode>

export const DomainAdapterContract = z.object({
  adapterId: DomainAdapterId,
  domain: z.string().min(1),
  substrate: z.string().min(1),
  substrateTermMappings: z.array(DomainAdapterTermMapping).min(1),
  supportedExecutionModes: z.array(DomainExecutionMode).min(1),
  evidenceSources: z.array(z.string().min(1)).min(1),
  effectors: z.array(z.string().min(1)).min(1),
})
export type DomainAdapterContract = z.infer<typeof DomainAdapterContract>

export const DomainExecutionRequest = z.object({
  adapterId: DomainAdapterId,
  functionId: ArtifactId,
  intentSpecificationId: ArtifactId,
  executableSpecificationId: ArtifactId,
  runId: z.string().min(1),
  mode: DomainExecutionMode,
  parameters: z.record(z.unknown()).default({}),
})
export type DomainExecutionRequest = z.infer<typeof DomainExecutionRequest>

export const DomainExecutionStatus = z.enum(["succeeded", "failed", "aborted", "blocked"])
export type DomainExecutionStatus = z.infer<typeof DomainExecutionStatus>

export const DomainExecutionEvidence = z.object({
  adapterId: DomainAdapterId,
  executableSpecificationId: ArtifactId,
  runId: z.string().min(1),
  status: DomainExecutionStatus,
  evidenceRefs: z.array(z.string().min(1)).min(1),
  observationSummary: z.string().min(1),
})
export type DomainExecutionEvidence = z.infer<typeof DomainExecutionEvidence>
