import { describe, expect, it } from "vitest"
import { emitPolicyActivation } from "../src/emit-policy-activation.js"
import { emitRollbackPlan } from "../src/emit-rollback-plan.js"

describe("policy activation", () => {
  it("emits activation and rollback plan deterministically", () => {
    const gova = emitPolicyActivation({
      predecessorPolicyId: "GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION",
      successorPolicyId: "GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION-V2",
      sourceProposalId: "GOVP-META-ADAPTIVE-PRESSURE-RECALIBRATION",
      sourceDecisionId: "GOVD-META-ADAPTIVE-PRESSURE-RECALIBRATION",
      sourceSuccessorNoteId: "GOVS-META-ADAPTIVE-PRESSURE-RECALIBRATION",
      decision: "approved",
      decisionSourceProposalId: "GOVP-META-ADAPTIVE-PRESSURE-RECALIBRATION",
      autoActivationAllowed: false,
      rolloutState: "shadow",
      sourceRefs: [
        "GOVP-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        "GOVD-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        "GOVS-META-ADAPTIVE-PRESSURE-RECALIBRATION",
      ],
    })

    expect(gova.id).toBe("GOVA-META-ADAPTIVE-PRESSURE-RECALIBRATION-V2")
    expect(gova.rolloutState).toBe("shadow")
    expect(gova.rollbackTargetPolicyId).toBe("GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION")

    const govr = emitRollbackPlan({
      sourceActivationId: gova.id,
      predecessorPolicyId: gova.predecessorPolicyId,
      successorPolicyId: gova.successorPolicyId,
      rolloutStateAtCreation: gova.rolloutState,
      sourceRefs: [gova.id],
    })

    expect(govr.id).toBe("GOVR-META-ADAPTIVE-PRESSURE-RECALIBRATION-V2")
    expect(govr.rollbackTargetPolicyId).toBe("GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION")
    expect(govr.rolloutStateAtCreation).toBe("shadow")
  })

  it("fails closed when decision is rejected", () => {
    expect(() =>
      emitPolicyActivation({
        predecessorPolicyId: "GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        successorPolicyId: "GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION-V2",
        sourceProposalId: "GOVP-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        sourceDecisionId: "GOVD-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        sourceSuccessorNoteId: "GOVS-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        decision: "rejected",
        decisionSourceProposalId: "GOVP-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        autoActivationAllowed: false,
        rolloutState: "shadow",
        sourceRefs: ["GOVD-META-ADAPTIVE-PRESSURE-RECALIBRATION"],
      })
    ).toThrow("governance decision is not approved")
  })

  it("fails closed when auto-activation is enabled", () => {
    expect(() =>
      emitPolicyActivation({
        predecessorPolicyId: "GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        successorPolicyId: "GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION-V2",
        sourceProposalId: "GOVP-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        sourceDecisionId: "GOVD-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        sourceSuccessorNoteId: "GOVS-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        decision: "approved",
        decisionSourceProposalId: "GOVP-META-ADAPTIVE-PRESSURE-RECALIBRATION",
        autoActivationAllowed: true,
        rolloutState: "shadow",
        sourceRefs: ["GOVD-META-ADAPTIVE-PRESSURE-RECALIBRATION"],
      })
    ).toThrow("auto-activation must remain disabled")
  })
})
