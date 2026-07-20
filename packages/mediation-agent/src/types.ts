/**
 * MediationAgentDO — shared types for the mediation compile pipeline.
 *
 * SPEC-FF-ILAYER-EXEC-001 §3
 */

import type { AtomDirective, ToolSchemaEntry } from '@factory/schemas'
import type { Gear } from '@factory/gears'

// ── Lifecycle ─────────────────────────────────────────────────────────────

export type MediationLifecycle =
  | 'UNINITIALIZED'
  | 'COMPILING'
  | 'FAILED'
  | 'SEEDED'
  | 'COMPLETE'

// ── HTTP request/response types ───────────────────────────────────────────

/** POST /commission request body */
export interface CommissionRequest {
  /** SHA-256 deterministic run identifier */
  runId: string
  orgId: string
  workGraphId: string
  workGraphVersion: string
  /** D1 row keys for WorkGraph artifact graph atoms */
  d1ArtifactRefs: string[]
  /** Must exist in ArtifactGraphDO before compile begins (A9 constraint) */
  eluciationArtifactId: string
  /** A9 elucidation event reference (from signal) */
  dispositionEventId: string
  /** Default 24 hours */
  stalenessThresholdHours?: number
}

/** POST /commission success response (HTTP 200) */
export interface CommissionResponseSuccess {
  status: 'seeded'
  runId: string
  atomCount: number
  workGraphVersion: string
}

/** POST /commission failure response (HTTP 422) */
export interface CommissionResponseFailure {
  status: 'failed'
  reason:
    | 'missing_gear'
    | 'invalid_workgraph_node'
    | 'coherence_failure'
    | 'missing_eluciation'
    | 'coordinator_seed_failed'
  details: string
}

export type CommissionResponse = CommissionResponseSuccess | CommissionResponseFailure

/** POST /complete request body */
export interface CompleteRequest {
  runId: string
  outcome: 'all_done' | 'partial_failure'
  failedAtomIds: string[]
}

/** POST /complete response */
export interface CompleteResponse {
  status: 'acknowledged'
}

/** GET /health response */
export interface HealthResponse {
  lifecycle: MediationLifecycle
  runId: string | null
  lastCommissionAt: string | null
  atomCount: number | null
}

// ── Internal compile pipeline types ──────────────────────────────────────

/**
 * A single atom entry from the WorkGraph artifact graph.
 * Represents one row from D1 `workgraph_atoms`.
 */
export interface WorkGraphAtom {
  atomId: string
  gearId: string
  nodeId: string
  toolRefs: string[]
  invariantIds: string[]
  dependsOn: string[]
  d1ArtifactRef: string
}

/**
 * Eluciation artifact node retrieved from ArtifactGraphDO.
 * SPEC-FF-ILAYER-EXEC-001 §3.2 constraint A9.
 */
export interface EluciationArtifact {
  id: string
  type: string
  data: Record<string, unknown>
}

/**
 * Result of a successful compile sequence.
 */
export interface CompileResult {
  specificationNodeId: string
  directives: Map<string, AtomDirective>
}

/**
 * An error thrown by compile steps — carries a typed reason code.
 */
export class CompileError extends Error {
  constructor(
    public readonly reason: CommissionResponseFailure['reason'],
    message: string,
  ) {
    super(message)
    this.name = 'CompileError'
  }
}

/**
 * Internal probe result used by the coherence probe (step 4).
 * Distinct from CoherenceVerificationReport (which has schema constraints
 * on IDs and lineage fields). This is the lightweight probe verdict.
 */
export interface ProbeResult {
  verdict: 'favorable' | 'unfavorable'
  reason: string
}

/**
 * Resolved gear + tool schemas per atom — produced by step 3.
 */
export interface ResolvedAtomBinding {
  atom: WorkGraphAtom
  gear: Gear
  toolSchemas: ToolSchemaEntry[]
}
