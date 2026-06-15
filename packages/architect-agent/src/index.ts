/**
 * @factory/architect-agent — package entry point
 *
 * Exports ArchitectAgentDO class for use in workers/ff-architect-agent.
 * Also re-exports types for consumers (e.g., CommissioningAgentDO CRD escalation).
 */

export { ArchitectAgentDO } from './architect-do.js'
export type { Env } from './env.js'
export type {
  PatchRequest,
  PatchResponse,
  CrdRequest,
  CrdResponse,
  RegisterRepoRequest,
  DeregisterRepoRequest,
  HealthResponse,
  VsliceConfig,
  PipelineConfig,
  PassRoutingConfig,
  GateThresholdConfig,
} from './types.js'
