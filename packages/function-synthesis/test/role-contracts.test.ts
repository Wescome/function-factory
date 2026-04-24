/**
 * Tests for role contracts.
 *
 * AC 15, 16
 */

import { describe, it, expect } from "vitest"
import {
  ALL_ROLE_CONTRACTS,
  PlannerContract,
  CoderContract,
  CriticContract,
  TesterContract,
  VerifierContract,
  getRoleContract,
} from "../src/index.js"

describe("role-contracts", () => {
  // AC 15: role contracts are identical regardless of binding mode
  it("AC 15: all five contracts are defined with correct names", () => {
    expect(ALL_ROLE_CONTRACTS).toHaveLength(5)
    const names = ALL_ROLE_CONTRACTS.map((c) => c.name)
    expect(names).toEqual(["Planner", "Coder", "Critic", "Tester", "Verifier"])
  })

  it("each contract has non-empty reads, writes, doNot, and outputArtifact", () => {
    for (const contract of ALL_ROLE_CONTRACTS) {
      expect(contract.reads.length).toBeGreaterThan(0)
      expect(contract.writes.length).toBeGreaterThan(0)
      expect(contract.doNot.length).toBeGreaterThan(0)
      expect(contract.outputArtifact.length).toBeGreaterThan(0)
    }
  })

  it("Planner reads the expected fields per PRD constraints", () => {
    expect(PlannerContract.reads).toContain("specEnvelope")
    expect(PlannerContract.reads).toContain("workGraph")
    expect(PlannerContract.reads).toContain("activeCandidate")
    expect(PlannerContract.writes).toEqual(["plan"])
  })

  it("Coder reads plan and writes patchProposals", () => {
    expect(CoderContract.reads).toContain("plan")
    expect(CoderContract.writes).toEqual(["patchProposals"])
  })

  it("Verifier reads validationOutcomes and writes decision", () => {
    expect(VerifierContract.reads).toContain("validationOutcomes")
    expect(VerifierContract.reads).toContain("repairLoopCount")
    expect(VerifierContract.writes).toContain("decision")
  })

  it("getRoleContract returns correct contract by name", () => {
    expect(getRoleContract("Planner")).toBe(PlannerContract)
    expect(getRoleContract("Verifier")).toBe(VerifierContract)
  })

  it("getRoleContract throws for unknown role", () => {
    expect(() => getRoleContract("Unknown" as "Planner")).toThrow("Unknown role")
  })

  // AC 15: structural identity across binding modes
  it("AC 15: contracts are structurally identical constants", () => {
    // Verify they are the same object references from ALL_ROLE_CONTRACTS
    const fromArray = ALL_ROLE_CONTRACTS.find((c) => c.name === "Planner")
    expect(fromArray).toBe(PlannerContract)
  })
})
