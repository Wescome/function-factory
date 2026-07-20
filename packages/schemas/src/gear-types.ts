/**
 * Gear domain types — shared between @factory/gears and @factory/schemas consumers.
 *
 * RoleModelBinding, ToolPolicy, SourceRef are used in Gear and AtomDirective schemas.
 * SPEC-FF-GEARS-001 §4
 */

import { z } from "zod"

/** A reference to a source artifact (spec section, ADR, etc.). */
export const SourceRef = z.string().min(1)
export type SourceRef = z.infer<typeof SourceRef>

/** Tool policy controlling which tools an agent may call. */
export const ToolPolicy = z.object({
  allowed: z.array(z.string()).default([]),
  denied:  z.array(z.string()).default([]),
})
export type ToolPolicy = z.infer<typeof ToolPolicy>

/** Binds a role to a specific model with runtime parameters. */
export const RoleModelBinding = z.object({
  role:          z.string().min(1),
  modelId:       z.string().min(1),
  thinkingLevel: z.enum(['none', 'low', 'medium', 'high', 'max']).default('none'),
  thinkingBudget: z.object({
    maxTokens:      z.number().int().positive(),
    reservedPrefill: z.number().int().nonnegative(),
  }).optional(),
  temperature: z.number().min(0).max(2).default(0),
})
export type RoleModelBinding = z.infer<typeof RoleModelBinding>
