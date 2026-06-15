/**
 * @factory/mediation-agent — Public API barrel
 *
 * Exports the MediationAgentDO class and its Env interface.
 * Also re-exports types used by callers (CommissionRequest, etc.)
 *
 * SPEC-FF-ILAYER-EXEC-001
 */

export { MediationAgentDO } from './mediation-agent-do.js'
export type { Env } from './mediation-agent-do.js'

export type {
  CommissionRequest,
  CommissionResponseSuccess,
  CommissionResponseFailure,
  CommissionResponse,
  CompleteRequest,
  CompleteResponse,
  HealthResponse,
  MediationLifecycle,
  WorkGraphAtom,
  EluciationArtifact,
  CompileResult,
  ProbeResult,
  ResolvedAtomBinding,
} from './types.js'

export { CompileError } from './types.js'
