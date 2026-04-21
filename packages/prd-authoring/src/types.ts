import type { FunctionProposal } from "@factory/schemas"

export interface ProposalAuthoringContext {
  readonly proposal: FunctionProposal
  readonly sourceCapabilityId: string
  readonly sourceFunctionId: string
  readonly sourceRefs: readonly string[]
}

export interface RenderedPrd {
  readonly id: string
  readonly filename: string
  readonly markdown: string
}
