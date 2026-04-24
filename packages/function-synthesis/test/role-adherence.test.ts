/**
 * Tests for role adherence checking.
 *
 * AC 6, 7, 9
 */

import { describe, it, expect } from "vitest"
import {
  checkRoleAdherence,
  injectDoNotViolation,
  RoleAdherenceReport,
  ALL_ROLE_CONTRACTS,
} from "../src/index.js"
import { makeRoleIterations } from "./test-fixtures.js"

describe("role-adherence", () => {
  // AC 6: RoleAdherenceReport parses with Zod
  it("AC 6: produces a valid RoleAdherenceReport that parses with Zod", () => {
    const iterations = makeRoleIterations()
    const report = checkRoleAdherence("test-run-001", ALL_ROLE_CONTRACTS, iterations)

    // Zod parse should succeed
    const parsed = RoleAdherenceReport.safeParse(report)
    expect(parsed.success).toBe(true)

    // Should have entries for all five roles
    expect(report.entries).toHaveLength(5)
    const roleNames = report.entries.map((e: { role: string }) => e.role)
    expect(roleNames).toEqual(["Planner", "Coder", "Critic", "Tester", "Verifier"])
  })

  it("AC 6: each entry has exactly 4 contract surface checks", () => {
    const iterations = makeRoleIterations()
    const report = checkRoleAdherence("test-run-001", ALL_ROLE_CONTRACTS, iterations)

    for (const entry of report.entries) {
      expect(entry.checks).toHaveLength(4)
      const surfaces = entry.checks.map((c: { surface: string }) => c.surface)
      expect(surfaces).toEqual(["read_access", "write_access", "do_not", "output_semantics"])
    }
  })

  // AC 7: semantic_intent_unverified is always true
  it("AC 7: semantic_intent_unverified is always true", () => {
    const iterations = makeRoleIterations()
    const report = checkRoleAdherence("test-run-001", ALL_ROLE_CONTRACTS, iterations)
    expect(report.semanticIntentUnverified).toBe(true)
  })

  // AC 7: detect do-not violation
  it("AC 7: detects read-access violation when Coder reads critique", () => {
    const iterations = makeRoleIterations()
    // Inject a violation: Coder reads 'critique' (which is not in its reads)
    const violated = injectDoNotViolation("Coder", "critique", iterations)

    const report = checkRoleAdherence("test-run-002", ALL_ROLE_CONTRACTS, violated)

    const coderEntry = report.entries.find((e: { role: string }) => e.role === "Coder")
    expect(coderEntry).toBeDefined()

    const readCheck = coderEntry!.checks.find((c: { surface: string }) => c.surface === "read_access")
    expect(readCheck).toBeDefined()
    expect(readCheck!.verdict).toBe("fail")
    expect(readCheck!.violations.length).toBeGreaterThan(0)
    expect(readCheck!.violations[0]).toContain("critique")
  })

  // AC 9: compliant iterations produce overall compliant report
  it("AC 9: compliant iterations produce overall compliant report", () => {
    const iterations = makeRoleIterations()
    const report = checkRoleAdherence("test-run-003", ALL_ROLE_CONTRACTS, iterations)
    expect(report.overallCompliant).toBe(true)
  })
})
