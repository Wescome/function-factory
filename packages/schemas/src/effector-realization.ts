import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const EffectorRealization = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("EFFR-"), "EffectorRealization IDs must start with EFFR-"),
  sourceEffectorId: ArtifactId,
  sourceWorkGraphId: ArtifactId,
  sourceArchitectureCandidateId: ArtifactId,
  sourceSelectionId: ArtifactId,
  sourceAdmissionId: ArtifactId,
  sourceExecutionStartId: ArtifactId,
  realizationMode: z.enum(["safe_execute"]),
  environmentTrust: z.enum(["trusted"]),
  outputEvidenceRef: z.string().min(1),
  summary: z.string().min(1),
})
export type EffectorRealization = z.infer<typeof EffectorRealization>
