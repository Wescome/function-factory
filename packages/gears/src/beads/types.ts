/**
 * @factory/gears — ExecutionBead and ExecutionBeadStatus Zod schemas
 *
 * Mirrors the `execution_beads` SQLite table in CoordinatorDO exactly.
 *
 * Cross-reference:
 *   ExecutionBead.id         → CommitBead.content.artifact_graph_execution_id (Bead Graph)
 *   ExecutionBead.result     → ExecutionTrace node in Artifact Graph (written by LoopClosureService)
 *
 * SPEC-FF-GEARS-001 §7a
 */

import { z } from 'zod'

export const ExecutionBeadStatus = z.enum(['ready', 'in_progress', 'done', 'failed'])

export const ExecutionBead = z.object({
  id:            z.string(),
  molecule_id:   z.string(),
  gear_id:       z.string(),
  node_id:       z.string(),
  status:        ExecutionBeadStatus,
  assigned_to:   z.string().nullable(),
  attempt_count: z.number().int(),
  payload:       z.string().nullable(),   // JSON: AtomDirective
  result:        z.string().nullable(),   // JSON: ConductingAgentTraceFragment
  created_at:    z.number().nullable(),
  updated_at:    z.number().nullable(),
})

export type ExecutionBead       = z.infer<typeof ExecutionBead>
export type ExecutionBeadStatus = z.infer<typeof ExecutionBeadStatus>
