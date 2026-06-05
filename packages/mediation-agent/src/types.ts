// Mediation Agent DO — event log types
// SPEC-MEDIATION-AGENT-DO-001 v2.0 §2.1

import type { AtomDirective } from '@factory/schemas'

export type AgentLifecycleState =
  | 'UNINITIALIZED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEGRADED'
  | 'TERMINATED'

export type DetectorSpec = {
  detectorId: string       // INV-* ref
  pattern?: string         // regex; type: 'pattern'
  exitCode?: number        // type: 'exit-code'
  severity: 'critical' | 'warning' | 'info'
}

export type DetectorResult = {
  detectorId: string
  fired: boolean
  severity?: 'critical' | 'warning' | 'info'
  matchedContent?: string
}

export type Verdict = {
  value: 'favorable' | 'unfavorable' | 'pending'
  reason?: string
}

// ── Event types ───────────────────────────────────────────────────────────

export type EventType =
  | 'CommissionEvent'
  | 'TraceEvent'
  | 'DivergenceEvent'
  | 'DivergenceClosedEvent'
  | 'VerdictEvent'
  | 'LifecycleEvent'
  | 'FlushEvent'
  | 'SnapshotEvent'

export type DOEvent = {
  seq: number
  type: EventType
  producedAt: string
  payload: unknown
}

export type CommissionPayload = {
  workGraphId: string
  workGraphVersion: string
  policyBeadId: string
  atoms: AtomDirective[]
  detectorSpecs: DetectorSpec[]
  agentsMd: string
  sourceRefs: string[]
  committedBy: string
  stalenessThresholdHours: number
}

export type TracePayload = {
  executionId: string
  directiveId: string
  atomRef: string
  outcome: 'success' | 'failure' | 'timeout' | 'cancelled'
  rawOutput: string          // truncated to 4KB
  sandboxOutputRef?: string  // presigned R2 URL
  durationMs: number
  attemptNumber: number
  detectorResults: DetectorResult[]
}

export type DivergencePayload = {
  divergenceId: string       // DIV-* ID
  atomRef: string
  detectorId: string
  severity: 'blocking' | 'advisory' | 'informational'
  evidence: string           // TraceEvent seq ref
}

export type DivergenceClosedPayload = {
  divergenceId: string
  closedBy: string
  closedAt: string
}

export type VerdictPayload = {
  verdictType: 'coherence' | 'fidelity'
  value: 'favorable' | 'unfavorable' | 'pending'
  reason?: string
  workGraphVersion: string
}

export type LifecyclePayload = {
  state: AgentLifecycleState
  reason: string
  triggeredBy: 'commission' | 'suspend' | 'resume' | 'alarm' | 'terminate'
}

export type FlushPayload = {
  flushedSeqRange: [number, number]
  beadIdsWritten: string[]
}

export type SnapshotPayload = {
  atSeq: number
  lifecycleState: AgentLifecycleState
  workGraphVersion: string
  openDivergenceIds: string[]
  coherenceVerdict: string
  fidelityVerdict: string
}

// ── Reconstructed state (derived from event log tail) ─────────────────────

export type RepoState = {
  lifecycleState: AgentLifecycleState
  workGraphVersion: string
  policyBeadId: string
  atoms: AtomDirective[]
  detectorSpecs: DetectorSpec[]
  agentsMd: string
  coherenceVerdict: Verdict
  fidelityVerdict: Verdict
  openDivergenceIds: string[]
  lastCommissionAt: string
  stalenessThresholdHours: number
  lastFlushSeq: number
}

export type LogMeta = {
  currentShard: number
  totalEvents: number
  lastSnapshotSeq: number
}
