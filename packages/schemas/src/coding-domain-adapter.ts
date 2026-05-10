import { DomainAdapterContract } from "./domain-adapter.js"
import { TrellisRuntimeProfile } from "./trellis-execution-packet.js"

export const CodingDomainAdapterContract = DomainAdapterContract.parse({
  adapterId: "adapter.coding",
  domain: "coding",
  substrate: "git-github-ci",
  substrateTermMappings: [
    {
      adapterTerm: "repository",
      kernelConcept: "domain_substrate",
      description: "Versioned source substrate for coding-domain Functions.",
    },
    {
      adapterTerm: "branch",
      kernelConcept: "execution_workspace",
      description: "Isolated coding-domain workspace for a Function realization.",
    },
    {
      adapterTerm: "pull request",
      kernelConcept: "handoff_artifact",
      description: "Coding-domain review and merge handoff artifact.",
    },
    {
      adapterTerm: "diff",
      kernelConcept: "effector_realization_artifact",
      description: "Coding-domain effect realization over files.",
    },
    {
      adapterTerm: "CI check",
      kernelConcept: "verification_evidence_source",
      description: "Coding-domain evidence source for tests, typecheck, audits, and gates.",
    },
    {
      adapterTerm: "code review",
      kernelConcept: "human_governance_input",
      description: "Coding-domain human governance input before acceptance.",
    },
    {
      adapterTerm: "deployment",
      kernelConcept: "lifecycle_transition_substrate",
      description: "Coding-domain substrate transition that realizes a promoted Function.",
    },
    {
      adapterTerm: "Coder",
      kernelConcept: "agent_call_role",
      description: "Coding-domain Agent Call role for implementation work.",
    },
    {
      adapterTerm: "Tester",
      kernelConcept: "agent_call_role",
      description: "Coding-domain Agent Call role for verification work.",
    },
  ],
  supportedExecutionModes: ["simulate", "execute", "verify", "observe"],
  evidenceSources: [
    "test-result",
    "typecheck-result",
    "repository-audit",
    "literate-sync",
    "factory-pr-gate",
    "runtime-diagnostic",
  ],
  effectors: [
    "file-edit",
    "git-commit",
    "git-push",
    "pull-request-update",
    "worker-deploy",
  ],
})
export type CodingDomainAdapterContract = typeof CodingDomainAdapterContract

export const CodingTrellisRuntimeProfile = TrellisRuntimeProfile.parse({
  profileId: "trellis.runtime.coding.v1",
  roleCatalogRef: "catalog.roles.coding.v1",
  toolCatalogRef: "catalog.tools.coding.v1",
  memoryCatalogRef: "catalog.memory.coding.v1",
  policyCatalogRef: "catalog.policy.coding.v1",
  modelPolicyRef: "catalog.model-policy.coding.v1",
  suppliedBy: "trellis-runtime",
})
export type CodingTrellisRuntimeProfile = typeof CodingTrellisRuntimeProfile
