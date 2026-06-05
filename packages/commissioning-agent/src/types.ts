// Commissioning Agent — artifact and signal types
// SPEC-COMMISSIONING-AGENT-001

export type CommissionRecord = {
  _key: string               // CMR-{repoId}-{timestamp}
  repoId: string
  workGraphId: string
  workGraphVersion: string
  commissionedAt: string
  mediationAgentDoKey: string
  elucidationArtifactId: string
  status: 'success' | 'error'
  errorReason?: string
  source: 'commissioning-agent'
  explicitness: 'stated'
}

export type ElucidationArtifact = {
  _key: string               // ELC-CMR-{repoId}-{timestamp}
  dispositionEventType: 'commission' | 'amendment-adoption' | 'suspension' | 'resumption'
  candidateSet: { workGraphVersions: string[] }
  selectedOption: string
  rejectedOptions: Array<{ workGraphVersion: string; rejectionReason: string }>
  constraintsApplied: string[]
  producedAt: string
  producedBy: string
  source: 'commissioning-agent'
  explicitness: 'stated'
}

export type VCR = {
  _key: string
  dispositionEventType: string
  repoId: string
  workGraphVersion?: string
  verdict: 'favorable' | 'unfavorable'
  verdictSource: 'coherence-verification' | 'fidelity-verification' | 'we-layer-override'
  producedAt: string
  linkedArtifacts: string[]
  source: 'commissioning-agent'
  explicitness: 'stated'
}

export type CommissioningSignal = {
  signalType: 'CommissioningSignal'
  repoId: string
  workGraphId: string
  workGraphVersion: string
  commissionedBy: string
  dispositionEventId: string
  elucidationArtifactId: string
  issuedAt: string
}

export type EscalationEvent = {
  signalType: 'EscalationEvent'
  escalationId: string
  sourceAgent: 'CommissioningAgent'
  sourceId: string
  escalationType: 'AutoSuspend' | 'AmendmentCoherenceFail' | 'CommissionFail'
  evidence: {
    divergenceIds?: string[]
    hypothesisId?: string
    amendmentId?: string
    coherenceVerdictDetail?: string
  }
  requestedAction: string
  issuedAt: string
}
