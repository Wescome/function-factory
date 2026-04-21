import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const ExecutionTrace = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("EXT-"), "ExecutionTrace IDs must start with EXT-"),
  sourceWorkGraphId: ArtifactId,
  sourceArchitectureCandidateId: ArtifactId,
  sourceSelectionId: ArtifactId,
  sourceAdmissionId: ArtifactId,
  sourceExecutionStartId: ArtifactId,
  runId: z.string().min(1),
  nodeCount: z.number().int().nonnegative(),
  traversedNodeIds: z.array(z.string().min(1)).min(1),
  completionMode: z.enum(["deterministic_single_path"]),
  summary: z.string().min(1),
})
export type ExecutionTrace = z.infer<typeof ExecutionTrace>
