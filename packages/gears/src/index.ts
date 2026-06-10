/**
 * @factory/gears — Public API barrel
 *
 * Re-exports the complete public surface of @factory/gears.
 * Skills in src/skills/ are workspace-discovered and NOT imported here.
 *
 * SPEC-FF-GEARS-001 §3
 */

export * from './flue/agents.js'
export * from './flue/sandbox.js'
export * from './gears/types.js'
export * from './beads/types.js'
export * from './beads/coordinator-do.js'
export * from './beads/hook.js'
