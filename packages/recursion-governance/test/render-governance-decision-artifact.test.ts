import { describe, expect, it } from "vitest"
import { renderGovernanceDecisionArtifact } from "../src/render-governance-decision-artifact.js"

describe("renderGovernanceDecisionArtifact", () => {
  it("renders a deterministic allow artifact", () => {
    const rendered = renderGovernanceDecisionArtifact({
      decision: "allow",
      reason: "Bootstrap allowlist permits self-authoring for this FunctionProposal",
      policyMode: "bootstrap",
      proposalId: "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION",
    })

    expect(rendered.id).toBe("RGD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW")
    expect(rendered.yaml).toContain("decision: allow")
  })
})
