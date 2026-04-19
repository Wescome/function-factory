/**
 * Tests for the Gate1Report schema.
 *
 * First test in the @factory/schemas package. Colocated with the
 * implementation per PREFERENCES.md ("Tests colocated with implementation,
 * not in a separate tests/ tree"). Uses vitest, already in devDependencies
 * and wired to `pnpm test` via package.json.
 *
 * Scope of this file- the `bootstrap_prefix_check` amendment added per
 * DECISIONS.md 2026-04-19 entry #2, plus two baseline-integrity assertions
 * to catch regressions on existing Gate1Report fields that the amendment
 * could silently break.
 */

import { describe, it, expect } from "vitest"
import { Gate1Report } from "./coverage.js"

// Minimum valid Gate1Report fixture. Reused across tests. Represents a
// passing Steady-State report (no bootstrap_prefix_check present).
const baseGate1Report = {
  id: "CR-PRD-META-GATE-1-COMPILE-COVERAGE-GATE1-2026-04-19T00-00-00Z",
  source_refs: ["PRD-META-GATE-1-COMPILE-COVERAGE"],
  explicitness: "explicit" as const,
  rationale: "test fixture",
  gate: 1 as const,
  prd_id: "PRD-META-GATE-1-COMPILE-COVERAGE",
  timestamp: "2026-04-19T00:00:00Z",
  overall: "pass" as const,
  checks: {
    atom_coverage: { status: "pass" as const, orphan_atoms: [] },
    invariant_coverage: {
      status: "pass" as const,
      invariants_missing_validation: [],
      invariants_missing_detector: [],
    },
    validation_coverage: {
      status: "pass" as const,
      validations_covering_nothing: [],
    },
    dependency_closure: {
      status: "pass" as const,
      dangling_dependencies: [],
    },
  },
  remediation: "no remediation required",
}

describe("Gate1Report", () => {
  describe("bootstrap_prefix_check (added 2026-04-19)", () => {
    it("accepts a Gate1Report without bootstrap_prefix_check (Steady-State case)", () => {
      const result = Gate1Report.safeParse(baseGate1Report)
      expect(result.success).toBe(true)
    })

    it("accepts a Gate1Report with bootstrap_prefix_check and empty non_meta_artifact_ids", () => {
      const withCheck = {
        ...baseGate1Report,
        checks: {
          ...baseGate1Report.checks,
          bootstrap_prefix_check: {
            status: "pass" as const,
            non_meta_artifact_ids: [],
          },
        },
      }
      const result = Gate1Report.safeParse(withCheck)
      expect(result.success).toBe(true)
    })

    it("accepts a Gate1Report with bootstrap_prefix_check and populated non_meta_artifact_ids", () => {
      const withCheck = {
        ...baseGate1Report,
        overall: "fail" as const,
        checks: {
          ...baseGate1Report.checks,
          bootstrap_prefix_check: {
            status: "fail" as const,
            non_meta_artifact_ids: [
              "PRD-VERTICAL-EXAMPLE",
              "INV-VERTICAL-EXAMPLE-A",
            ],
          },
        },
        remediation: "Tag all non-META artifact IDs with the META- prefix.",
      }
      const result = Gate1Report.safeParse(withCheck)
      expect(result.success).toBe(true)
    })

    it("defaults non_meta_artifact_ids to [] when omitted", () => {
      const withCheck = {
        ...baseGate1Report,
        checks: {
          ...baseGate1Report.checks,
          bootstrap_prefix_check: {
            status: "pass" as const,
          },
        },
      }
      const result = Gate1Report.safeParse(withCheck)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(
          result.data.checks.bootstrap_prefix_check?.non_meta_artifact_ids
        ).toEqual([])
      }
    })

    it("rejects a non-ArtifactId-formatted string in non_meta_artifact_ids", () => {
      const withBadCheck = {
        ...baseGate1Report,
        checks: {
          ...baseGate1Report.checks,
          bootstrap_prefix_check: {
            status: "fail" as const,
            non_meta_artifact_ids: ["not-a-valid-id"],
          },
        },
      }
      const result = Gate1Report.safeParse(withBadCheck)
      expect(result.success).toBe(false)
    })

    it("rejects an unknown-prefix ArtifactId in non_meta_artifact_ids", () => {
      const withBadCheck = {
        ...baseGate1Report,
        checks: {
          ...baseGate1Report.checks,
          bootstrap_prefix_check: {
            status: "fail" as const,
            non_meta_artifact_ids: ["XYZ-UNKNOWN-PREFIX"],
          },
        },
      }
      const result = Gate1Report.safeParse(withBadCheck)
      expect(result.success).toBe(false)
    })
  })

  describe("baseline integrity (existing fields, regression guard)", () => {
    it("accepts the minimum valid Gate1Report fixture", () => {
      const result = Gate1Report.safeParse(baseGate1Report)
      expect(result.success).toBe(true)
    })

    it("rejects a Gate1Report whose id does not start with CR-", () => {
      const bad = { ...baseGate1Report, id: "PRD-NOT-A-COVERAGE-REPORT" }
      const result = Gate1Report.safeParse(bad)
      expect(result.success).toBe(false)
    })

    it("rejects a Gate1Report with gate literal other than 1", () => {
      const bad = { ...baseGate1Report, gate: 2 as const }
      const result = Gate1Report.safeParse(bad)
      expect(result.success).toBe(false)
    })

    it("rejects a Gate1Report with empty remediation", () => {
      const bad = { ...baseGate1Report, remediation: "" }
      const result = Gate1Report.safeParse(bad)
      expect(result.success).toBe(false)
    })
  })
})
