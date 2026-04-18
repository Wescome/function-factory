/**
 * Coverage Report schemas for Gates 1, 2, and 3.
 *
 * Coverage Reports are first-class Factory artifacts and are emitted on
 * every gate run, pass or fail. They live in specs/coverage-reports/ and
 * are versioned alongside the artifacts they concern.
 */

import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const CoverageVerdict = z.enum(["pass", "fail"])
export type CoverageVerdict = z.infer<typeof CoverageVerdict>

export const CoverageCheck = z.object({
  status: CoverageVerdict,
  details: z.array(z.record(z.string(), z.unknown())).default([]),
})

// ─── Gate 1 — Compile Coverage ────────────────────────────────────────

export const Gate1Report = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("CR-"), "CoverageReport IDs must start with CR-"),
  gate: z.literal(1),
  prd_id: ArtifactId,
  timestamp: z.string().datetime(),
  overall: CoverageVerdict,
  checks: z.object({
    atom_coverage: CoverageCheck.extend({
      orphan_atoms: z.array(ArtifactId).default([]),
    }),
    invariant_coverage: CoverageCheck.extend({
      invariants_missing_validation: z.array(ArtifactId).default([]),
      invariants_missing_detector: z.array(ArtifactId).default([]),
    }),
    validation_coverage: CoverageCheck.extend({
      validations_covering_nothing: z.array(ArtifactId).default([]),
    }),
    dependency_closure: CoverageCheck.extend({
      dangling_dependencies: z.array(ArtifactId).default([]),
    }),
  }),
  remediation: z.string().min(1),
})
export type Gate1Report = z.infer<typeof Gate1Report>

// ─── Gate 2 — Simulation Coverage ────────────────────────────────────

export const Gate2Report = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("CR-"), "CoverageReport IDs must start with CR-"),
  gate: z.literal(2),
  function_id: ArtifactId,
  timestamp: z.string().datetime(),
  overall: CoverageVerdict,
  checks: z.object({
    scenario_coverage: CoverageCheck.extend({
      branches_unexercised: z
        .array(
          z.object({
            workgraph_node: z.string(),
            edge: z.string().optional(),
            reason: z.string(),
          })
        )
        .default([]),
    }),
    invariant_exercise: CoverageCheck.extend({
      invariants_without_negative_tests: z.array(ArtifactId).default([]),
    }),
    required_validation_pass_rate: CoverageCheck.extend({
      rate: z.number().min(0).max(1),
      failing_validations: z.array(ArtifactId).default([]),
    }),
  }),
  remediation: z.string().min(1),
})
export type Gate2Report = z.infer<typeof Gate2Report>

// ─── Gate 3 — Assurance Coverage ─────────────────────────────────────

export const Gate3Report = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("CR-"), "CoverageReport IDs must start with CR-"),
  gate: z.literal(3),
  function_id: ArtifactId,
  timestamp: z.string().datetime(),
  overall: CoverageVerdict,
  checks: z.object({
    detector_freshness: CoverageCheck.extend({
      stale_detectors: z
        .array(
          z.object({
            invariant_id: ArtifactId,
            detector: z.string(),
            last_report: z.string().datetime().nullable(),
            threshold: z.string(),
          })
        )
        .default([]),
    }),
    evidence_source_liveness: CoverageCheck.extend({
      quiet_sources: z
        .array(
          z.object({
            source: z.string(),
            last_emission: z.string().datetime().nullable(),
            expected_cadence: z.string(),
          })
        )
        .default([]),
    }),
    audit_pipeline_integrity: CoverageCheck.extend({
      expected_vs_observed: z.object({
        expected: z.number().int().nonnegative(),
        observed: z.number().int().nonnegative(),
        divergence_pct: z.number(),
      }),
    }),
  }),
  remediation: z.string().min(1),
})
export type Gate3Report = z.infer<typeof Gate3Report>

export const CoverageReport = z.discriminatedUnion("gate", [
  Gate1Report,
  Gate2Report,
  Gate3Report,
])
export type CoverageReport = z.infer<typeof CoverageReport>
