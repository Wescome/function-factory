/**
 * Verification Report schemas for Coherence, Fidelity, and Persistence Verification.
 *
 * Verification Reports are first-class Factory artifacts and are emitted on
 * every verification run, pass or fail. They live in specs/verification-reports/ and
 * are versioned alongside the artifacts they concern.
 */

import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

export const VerificationVerdict = z.enum(["pass", "fail"])
export type VerificationVerdict = z.infer<typeof VerificationVerdict>

export const VerificationCheck = z.object({
  status: VerificationVerdict,
  details: z.array(z.record(z.string(), z.unknown())).default([]),
})

// ─── Coherence Verification ───────────────────────────────────────────

export const CoherenceVerificationReport = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("VR-"), "VerificationReport IDs must start with VR-"),
  verification: z.literal("coherence"),
  intent_specification_id: ArtifactId,
  timestamp: z.string().datetime(),
  overall: VerificationVerdict,
  checks: z.object({
    atom_coverage: VerificationCheck.extend({
      orphan_atoms: z.array(ArtifactId).default([]),
    }),
    invariant_coverage: VerificationCheck.extend({
      invariants_missing_validation: z.array(ArtifactId).default([]),
      invariants_missing_detector: z.array(ArtifactId).default([]),
    }),
    validation_coverage: VerificationCheck.extend({
      validations_covering_nothing: z.array(ArtifactId).default([]),
    }),
    dependency_closure: VerificationCheck.extend({
      dangling_dependencies: z.array(ArtifactId).default([]),
    }),
    // Added per DECISIONS.md 2026-04-19 entry #2. Populated only when
    // Coherence Verification runs with Factory mode `bootstrap`; absent from reports emitted
    // in `steady_state`. `overall: fail` is set when this check's status is
    // `fail`, consistent with the other four checks. Enforces the META-
    // prefix rule from ConOps §4.1 Rule 2 during Bootstrap.
    bootstrap_prefix_check: VerificationCheck.extend({
      non_meta_artifact_ids: z.array(ArtifactId).default([]),
    }).optional(),
  }),
  remediation: z.string().min(1),
})
export type CoherenceVerificationReport = z.infer<typeof CoherenceVerificationReport>

// ─── Fidelity Verification ───────────────────────────────────────────

export const FidelityVerificationReport = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("VR-"), "VerificationReport IDs must start with VR-"),
  verification: z.literal("fidelity"),
  function_id: ArtifactId,
  timestamp: z.string().datetime(),
  overall: VerificationVerdict,
  checks: z.object({
    scenario_coverage: VerificationCheck.extend({
      branches_unexercised: z
        .array(
          z.object({
            executableSpecification_node: z.string(),
            edge: z.string().optional(),
            reason: z.string(),
          })
        )
        .default([]),
    }),
    invariant_exercise: VerificationCheck.extend({
      invariants_without_negative_tests: z.array(ArtifactId).default([]),
    }),
    required_validation_pass_rate: VerificationCheck.extend({
      rate: z.number().min(0).max(1),
      failing_validations: z.array(ArtifactId).default([]),
    }),
  }),
  remediation: z.string().min(1),
})
export type FidelityVerificationReport = z.infer<typeof FidelityVerificationReport>

// ─── Persistence Verification ────────────────────────────────────────

export const PersistenceVerificationReport = Lineage.extend({
  id: ArtifactId.refine((s) => s.startsWith("VR-"), "VerificationReport IDs must start with VR-"),
  verification: z.literal("persistence"),
  function_id: ArtifactId,
  timestamp: z.string().datetime(),
  overall: VerificationVerdict,
  checks: z.object({
    detector_freshness: VerificationCheck.extend({
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
    evidence_source_liveness: VerificationCheck.extend({
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
    audit_pipeline_integrity: VerificationCheck.extend({
      expected_vs_observed: z.object({
        expected: z.number().int().nonnegative(),
        observed: z.number().int().nonnegative(),
        divergence_pct: z.number(),
      }),
    }),
  }),
  remediation: z.string().min(1),
})
export type PersistenceVerificationReport = z.infer<typeof PersistenceVerificationReport>

export const VerificationReport = z.discriminatedUnion("verification", [
  CoherenceVerificationReport,
  FidelityVerificationReport,
  PersistenceVerificationReport,
])
export type VerificationReport = z.infer<typeof VerificationReport>

// ─── Fidelity Verification Verdict ──────────────────────────────────

export const FidelityVerificationVerdict = z.object({
  verdict: z.enum(["accepted", "rejected", "needs_remediation"]),
  evidence_reviewed: z.array(z.string().min(1)).min(1),
  scenario_verification_score: z.number().min(0).max(1),
  invariant_exercise_rate: z.number().min(0).max(1),
  remediation_notes: z.array(z.string()).default([]),
})
export type FidelityVerificationVerdict = z.infer<typeof FidelityVerificationVerdict>

// ─── Verification Check Failure ─────────────────────────────────────────

export const VerificationCheckType = z.enum([
  "atom",
  "invariant",
  "validation",
  "dependency",
  "bootstrap_prefix",
])
export type VerificationCheckType = z.infer<typeof VerificationCheckType>

export const VerificationFailure = z.object({
  check_type: VerificationCheckType,
  failed_artifact_ids: z.array(ArtifactId).min(1),
  remediation: z.string().min(1),
})
export type VerificationFailure = z.infer<typeof VerificationFailure>
