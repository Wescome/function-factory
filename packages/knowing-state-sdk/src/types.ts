// Knowing-State Prosthesis SDK — domain-agnostic types
// SPEC-MEDIATION-AGENT-DO-001 §8, DECISIONS N+3

export type BeadId = string

export type BeadEnvelope = {
  _key: string
  beadType: string
  createdAt: string
  immutable: true
  source: string
  explicitness: 'stated' | 'inferred'
}

export type KnowingState<TrustContent> = {
  policyBeadId: BeadId
  trustContent: TrustContent
  lifecycleState: string
  coherenceVerdict: {
    value: 'favorable' | 'unfavorable' | 'pending'
    reason?: string
  }
}

export type AmendmentBead<PolicyContent = unknown> = BeadEnvelope & {
  beadType: 'AmendmentBead'
  proposedModification: PolicyContent
  motivatedBy: BeadId
  status: 'open' | 'adopted' | 'rejected'
}
