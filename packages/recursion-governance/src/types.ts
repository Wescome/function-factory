import type { FunctionProposal } from "@factory/schemas"

export type GovernanceMode = "bootstrap" | "expanded"
export type GovernanceDecision = "allow" | "deny"

export interface BootstrapAllowlistPolicy {
  readonly mode: GovernanceMode
  readonly allowedFunctionProposalIds: readonly string[]
}

export interface RecursionRunContext {
  readonly runId: string
  readonly proposalId: string
  readonly sourceRefs: readonly string[]
  readonly lineageArtifactIds: readonly string[]
  readonly alreadyAuthoredPrdIdsInRun: readonly string[]
}

export interface GovernanceEvaluationInput {
  readonly proposal: FunctionProposal
  readonly policy: BootstrapAllowlistPolicy
  readonly context: RecursionRunContext
}

export interface GovernanceEvaluationResult {
  readonly decision: GovernanceDecision
  readonly reason: string
  readonly policyMode: GovernanceMode
  readonly proposalId: string
}

export interface RenderedPrdCandidate {
  readonly id: string
  readonly markdown: string
}
