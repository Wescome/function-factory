/**
 * Three-class disagreement resolution.
 *
 * When Verifier passes but acceptance review rejects, classify as
 * repairable_local / architectural / governance per PRD constraints.
 *
 * AC 8
 */

import type { DisagreementClass } from "./types.js"

// ─── Disagreement Conditions ──────────────────────────────────────────

export interface DisagreementConditions {
  /** True if the rejection is a localized code defect (test failure, lint error) */
  readonly isLocalDefect: boolean
  /** True if the rejection challenges the ArchitectureCandidate itself */
  readonly isArchitecturalMismatch: boolean
  /** True if the rejection involves governance scope or hard constraints */
  readonly isGovernanceViolation: boolean
}

// ─── Resolution Procedure ─────────────────────────────────────────────

export interface DisagreementResolution {
  readonly disagreementClass: DisagreementClass
  readonly procedure: string
  readonly allowsAutonomousRetry: boolean
  readonly requiresHumanApproval: boolean
  readonly requiresCandidateReevaluation: boolean
}

/**
 * Classify and resolve a disagreement between Verifier pass and
 * acceptance rejection.
 *
 * Priority: governance > architectural > repairable_local
 */
export function resolveDisagreement(
  conditions: DisagreementConditions,
): DisagreementResolution {
  // Governance takes highest priority — no autonomous retry
  if (conditions.isGovernanceViolation) {
    return {
      disagreementClass: "governance",
      procedure: "Route to human approval. No autonomous retry permitted.",
      allowsAutonomousRetry: false,
      requiresHumanApproval: true,
      requiresCandidateReevaluation: false,
    }
  }

  // Architectural — no blind replay, requires candidate re-evaluation
  if (conditions.isArchitecturalMismatch) {
    return {
      disagreementClass: "architectural",
      procedure: "Prohibit blind replay. Re-evaluate ArchitectureCandidate before retry.",
      allowsAutonomousRetry: false,
      requiresHumanApproval: false,
      requiresCandidateReevaluation: true,
    }
  }

  // Repairable local — targeted repair is permitted
  if (conditions.isLocalDefect) {
    return {
      disagreementClass: "repairable_local",
      procedure: "Retry with targeted repair addressing the specific defect.",
      allowsAutonomousRetry: true,
      requiresHumanApproval: false,
      requiresCandidateReevaluation: false,
    }
  }

  // Default to governance if nothing matches (fail-closed)
  return {
    disagreementClass: "governance",
    procedure: "Unclassifiable disagreement — route to human approval (fail-closed).",
    allowsAutonomousRetry: false,
    requiresHumanApproval: true,
    requiresCandidateReevaluation: false,
  }
}
