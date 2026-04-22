import { describe, expect, it } from "vitest"
import { detectPolicyStress } from "../src/detect-policy-stress.js"
import { emitGovernanceProposal } from "../src/emit-governance-proposal.js"
import { emitGovernanceDecision } from "../src/emit-governance-decision.js"
import { emitPolicySuccessorNote } from "../src/emit-policy-successor-note.js"

describe("meta governance", () => {
  it("emits stress report, proposal, decision, and successor note deterministically", () => {
    const psr = detectPolicyStress({
      targetPolicyId: "GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION",
      driftIndicator: 0.5,
      deviationCount: 3,
      repeatedProposalCount: 2,
      sourceRefs: [
        "DDI-META-CANDIDATE-EMISSION-GAP",
        "OBS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      ],
    })

    expect(psr.id).toBe("PSR-META-ADAPTIVE-PRESSURE-RECALIBRATION")
    expect(psr.stressLevel).toBe("high")

    const govp = emitGovernanceProposal({
      targetPolicyId: psr.targetPolicyId,
      sourceStressReportId: psr.id,
      proposedPolicyId: "GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION-V2",
      proposalType: "threshold_adjustment",
      proposedChangeSummary: "Reduce drift cap from 0.8 to 0.7",
      justification: "Repeated high drift suggests policy thresholds need tightening.",
      sourceRefs: [psr.id],
    })

    const govd = emitGovernanceDecision({
      sourceProposalId: govp.id,
      decision: "approved",
      decidedBy: "human-reviewer",
      decisionSummary: "Approved for staged rollout preparation, not auto-activation.",
      sourceRefs: [govp.id],
    })

    const govs = emitPolicySuccessorNote({
      predecessorPolicyId: psr.targetPolicyId,
      sourceProposalId: govp.id,
      sourceDecisionId: govd.id,
      successorPolicyId: "GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION-V2",
      activationState: "approved_not_activated",
      sourceRefs: [govp.id, govd.id],
    })

    expect(govp.id).toBe("GOVP-META-ADAPTIVE-PRESSURE-RECALIBRATION")
    expect(govd.id).toBe("GOVD-META-ADAPTIVE-PRESSURE-RECALIBRATION")
    expect(govs.id).toBe("GOVS-META-ADAPTIVE-PRESSURE-RECALIBRATION")
  })
})
