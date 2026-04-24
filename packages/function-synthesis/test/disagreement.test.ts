/**
 * Tests for disagreement resolution.
 *
 * AC 8
 */

import { describe, it, expect } from "vitest"
import { resolveDisagreement } from "../src/index.js"

describe("disagreement", () => {
  // AC 8: repairable_local triggers targeted repair
  it("AC 8: repairable_local allows autonomous retry", () => {
    const resolution = resolveDisagreement({
      isLocalDefect: true,
      isArchitecturalMismatch: false,
      isGovernanceViolation: false,
    })

    expect(resolution.disagreementClass).toBe("repairable_local")
    expect(resolution.allowsAutonomousRetry).toBe(true)
    expect(resolution.requiresHumanApproval).toBe(false)
    expect(resolution.requiresCandidateReevaluation).toBe(false)
  })

  // AC 8: architectural prohibits blind replay
  it("AC 8: architectural requires candidate re-evaluation", () => {
    const resolution = resolveDisagreement({
      isLocalDefect: false,
      isArchitecturalMismatch: true,
      isGovernanceViolation: false,
    })

    expect(resolution.disagreementClass).toBe("architectural")
    expect(resolution.allowsAutonomousRetry).toBe(false)
    expect(resolution.requiresCandidateReevaluation).toBe(true)
  })

  // AC 8: governance routes to human approval
  it("AC 8: governance routes to human approval with no autonomous retry", () => {
    const resolution = resolveDisagreement({
      isLocalDefect: false,
      isArchitecturalMismatch: false,
      isGovernanceViolation: true,
    })

    expect(resolution.disagreementClass).toBe("governance")
    expect(resolution.allowsAutonomousRetry).toBe(false)
    expect(resolution.requiresHumanApproval).toBe(true)
  })

  // Governance takes priority over architectural
  it("governance takes priority when both governance and architectural", () => {
    const resolution = resolveDisagreement({
      isLocalDefect: false,
      isArchitecturalMismatch: true,
      isGovernanceViolation: true,
    })

    expect(resolution.disagreementClass).toBe("governance")
  })

  // Default fail-closed behavior
  it("defaults to governance (fail-closed) when nothing matches", () => {
    const resolution = resolveDisagreement({
      isLocalDefect: false,
      isArchitecturalMismatch: false,
      isGovernanceViolation: false,
    })

    expect(resolution.disagreementClass).toBe("governance")
    expect(resolution.requiresHumanApproval).toBe(true)
  })
})
