import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const RuntimeAdmissionDecision = z.enum(["allow", "deny"])
export type RuntimeAdmissionDecision = z.infer<typeof RuntimeAdmissionDecision>

export const RuntimeAdmissionArtifact = Lineage.extend({
  id: ArtifactId.refine(
    (s) => s.startsWith("RAD-"),
    "RuntimeAdmissionArtifact IDs must start with RAD-"
  ),
  sourceWorkGraphId: ArtifactId,
  sourceArchitectureCandidateId: ArtifactId,
  sourceSelectionId: ArtifactId,
  decision: RuntimeAdmissionDecision,
  reason: z.string().min(1),
})
export type RuntimeAdmissionArtifact = z.infer<typeof RuntimeAdmissionArtifact>

export const ExecutionStart = Lineage.extend({
  id: ArtifactId.refine(
    (s) => s.startsWith("EXS-"),
    "ExecutionStart IDs must start with EXS-"
  ),
  sourceWorkGraphId: ArtifactId,
  sourceArchitectureCandidateId: ArtifactId,
  sourceSelectionId: ArtifactId,
  sourceAdmissionId: ArtifactId,
  runId: z.string().min(1),
  status: z.enum(["started"]),
})
export type ExecutionStart = z.infer<typeof ExecutionStart>

export const ExecutionResult = Lineage.extend({
  id: ArtifactId.refine(
    (s) => s.startsWith("EXR-"),
    "ExecutionResult IDs must start with EXR-"
  ),
  sourceWorkGraphId: ArtifactId,
  sourceArchitectureCandidateId: ArtifactId,
  sourceSelectionId: ArtifactId,
  sourceAdmissionId: ArtifactId,
  runId: z.string().min(1),
  status: z.enum(["succeeded", "failed", "aborted"]),
  summary: z.string().min(1),
})
export type ExecutionResult = z.infer<typeof ExecutionResult>
