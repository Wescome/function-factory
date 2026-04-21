import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const EffectorMode = z.enum(["simulate", "safe_execute"])
export type EffectorMode = z.infer<typeof EffectorMode>

export const EffectorType = z.enum(["tool_call", "file_write", "no_op"])
export type EffectorType = z.infer<typeof EffectorType>

export const EffectorArtifact = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("EFF-"), "EffectorArtifact IDs must start with EFF-"),
  sourceWorkGraphId: ArtifactId,
  sourceArchitectureCandidateId: ArtifactId,
  sourceSelectionId: ArtifactId,
  sourceAdmissionId: ArtifactId,
  sourceExecutionStartId: ArtifactId,
  effectorType: EffectorType,
  effectorMode: EffectorMode,
  toolPolicyMode: z.enum(["allowlist", "restricted", "none"]),
  allowed: z.boolean(),
  targetNodeId: z.string().min(1),
  inputSummary: z.string().min(1),
  outputSummary: z.string().min(1),
})
export type EffectorArtifact = z.infer<typeof EffectorArtifact>

export const ExecutionNodeRecord = z.object({
  nodeId: z.string().min(1),
  effectorArtifactId: ArtifactId,
  effectorType: EffectorType,
  effectorMode: EffectorMode,
  realized: z.boolean().optional(),
  realizationArtifactId: ArtifactId.optional(),
  outputEvidenceRef: z.string().optional(),
  inputSummary: z.string().min(1),
  outputSummary: z.string().min(1),
})
export type ExecutionNodeRecord = z.infer<typeof ExecutionNodeRecord>
