import type {
  GovernanceEvaluationInput,
  GovernanceEvaluationResult
} from "./types.js"

export function evaluateRecursionGovernance(
  input: GovernanceEvaluationInput
): GovernanceEvaluationResult {
  const { proposal, policy, context } = input

  if (policy.mode !== "bootstrap") {
    return {
      decision: "deny",
      reason: "Only bootstrap mode is supported in the current recursion-governance implementation",
      policyMode: policy.mode,
      proposalId: proposal.id,
    }
  }

  if (!policy.allowedFunctionProposalIds.includes(proposal.id)) {
    return {
      decision: "deny",
      reason: "FunctionProposal is not in the bootstrap self-author allowlist",
      policyMode: policy.mode,
      proposalId: proposal.id,
    }
  }

  const targetPrdId = proposal.id.replace(/^FP-/, "PRD-")
  if (context.alreadyAuthoredPrdIdsInRun.includes(targetPrdId)) {
    return {
      decision: "deny",
      reason: "Same-run recursion guard blocked re-authoring of an already-authored PRD",
      policyMode: policy.mode,
      proposalId: proposal.id,
    }
  }

  return {
    decision: "allow",
    reason: "Bootstrap allowlist permits self-authoring for this FunctionProposal",
    policyMode: policy.mode,
    proposalId: proposal.id,
  }
}
