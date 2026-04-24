/**
 * Decision State schema — the decision algebra D = <I,C,P,E,A,X,O,J,T>.
 *
 * Per the cognitive runtime integration whitepaper section 3. This is the
 * full state tuple for a governance decision, supporting uncertainty,
 * escalation, and telemetry extensions.
 */

import { z } from "zod"

export const DecisionState = z.object({
  case_id: z.string().min(1),
  trace_id: z.string().min(1),
  intent: z.string().min(1),
  context: z.record(z.string(), z.unknown()),
  policy: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  authority: z.string().min(1),
  action: z.string().min(1),
  outcome: z.string().min(1),
  justification: z.array(z.string().min(1)).min(1),
  temporal: z.string().datetime(),
  uncertainty: z
    .object({
      confidence: z.number().min(0).max(1),
      alternatives_considered: z.array(z.string()).default([]),
      risk_factors: z.array(z.string()).default([]),
    })
    .optional(),
  escalation: z
    .object({
      escalated_to: z.string().min(1),
      reason: z.string().min(1),
      escalated_at: z.string().datetime(),
    })
    .optional(),
  telemetry: z
    .array(
      z.object({
        metric: z.string().min(1),
        value: z.union([z.string(), z.number()]),
        recorded_at: z.string().datetime(),
      })
    )
    .default([]),
})
export type DecisionState = z.infer<typeof DecisionState>
