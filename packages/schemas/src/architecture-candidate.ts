import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const CandidateStatus = z.enum(["proposed", "selected", "rejected", "archived"])
export type CandidateStatus = z.infer<typeof CandidateStatus>

export const CandidateTopology = z.object({
  shape: z.enum(["single_node", "linear_chain", "fan_out", "other"]),
  summary: z.string().min(1),
})
export type CandidateTopology = z.infer<typeof CandidateTopology>

export const CandidateModelBinding = z.object({
  bindingMode: z.enum(["fixed", "policy_selected", "unbound"]),
  summary: z.string().min(1),
})
export type CandidateModelBinding = z.infer<typeof CandidateModelBinding>

export const CandidateToolPolicy = z.object({
  mode: z.enum(["allowlist", "restricted", "none"]),
  summary: z.string().min(1),
})
export type CandidateToolPolicy = z.infer<typeof CandidateToolPolicy>

export const CandidateConvergencePolicy = z.object({
  mode: z.enum(["single_pass", "gated_iteration", "manual_review"]),
  summary: z.string().min(1),
})
export type CandidateConvergencePolicy = z.infer<typeof CandidateConvergencePolicy>

export const ArchitectureCandidate = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("AC-"), "ArchitectureCandidate IDs must start with AC-"),
  sourcePrdId: ArtifactId,
  sourceWorkGraphId: ArtifactId,
  candidateStatus: CandidateStatus,
  topology: CandidateTopology,
  modelBinding: CandidateModelBinding,
  toolPolicy: CandidateToolPolicy,
  convergencePolicy: CandidateConvergencePolicy,
})
export type ArchitectureCandidate = z.infer<typeof ArchitectureCandidate>
