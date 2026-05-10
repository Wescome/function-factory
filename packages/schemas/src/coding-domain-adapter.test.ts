import { describe, expect, it } from "vitest"
import {
  CodingDomainAdapterContract,
  CodingTrellisRuntimeProfile,
} from "./coding-domain-adapter.js"

describe("CodingDomainAdapterContract", () => {
  it("materializes coding as a Domain Adapter contract", () => {
    expect(CodingDomainAdapterContract.adapterId).toBe("adapter.coding")
    expect(CodingDomainAdapterContract.domain).toBe("coding")
    expect(CodingDomainAdapterContract.substrate).toBe("git-github-ci")
  })

  it("maps coding substrate terms to kernel concepts", () => {
    expect(
      CodingDomainAdapterContract.substrateTermMappings.map((mapping) => [
        mapping.adapterTerm,
        mapping.kernelConcept,
      ])
    ).toEqual([
      ["repository", "domain_substrate"],
      ["branch", "execution_workspace"],
      ["pull request", "handoff_artifact"],
      ["diff", "effector_realization_artifact"],
      ["CI check", "verification_evidence_source"],
      ["code review", "human_governance_input"],
      ["deployment", "lifecycle_transition_substrate"],
      ["Coder", "agent_call_role"],
      ["Tester", "agent_call_role"],
    ])
  })

  it("keeps execution and evidence capabilities adapter-local", () => {
    expect(CodingDomainAdapterContract.supportedExecutionModes).toEqual([
      "simulate",
      "execute",
      "verify",
      "observe",
    ])
    expect(CodingDomainAdapterContract.evidenceSources).toEqual([
      "test-result",
      "typecheck-result",
      "repository-audit",
      "literate-sync",
      "factory-pr-gate",
      "runtime-diagnostic",
    ])
    expect(CodingDomainAdapterContract.effectors).toEqual([
      "file-edit",
      "git-commit",
      "git-push",
      "pull-request-update",
      "worker-deploy",
    ])
  })

  it("materializes a Trellis runtime profile for coding", () => {
    expect(CodingTrellisRuntimeProfile.profileId).toBe("trellis.runtime.coding.v1")
    expect(CodingTrellisRuntimeProfile.suppliedBy).toBe("trellis-runtime")
    expect(CodingTrellisRuntimeProfile.roleCatalogRef).toBe("catalog.roles.coding.v1")
  })
})
