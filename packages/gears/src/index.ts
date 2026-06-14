/**
 * @factory/gears — Public API barrel
 *
 * Re-exports the complete public surface of @factory/gears.
 * Skills in src/skills/ are workspace-discovered and NOT imported here.
 *
 * SPEC-FF-GEARS-001 §3
 */

export { ThinkExecutor } from './agents/think-executor.js'
export { buildConductingAgent } from './agents/conducting-agent.js'
export { MODEL_BY_ROLE } from './agents/models.js'
export type { RoleName } from './agents/models.js'
export { ConsentBeadAuditProcessor, ConsentDeniedError } from './processors/consent-bead-audit-processor.js'
export * from './gears/types.js'
export * from './beads/types.js'
export * from './beads/coordinator-do.js'
export * from './beads/hook.js'
export * from './beads/d1-audit.js'
