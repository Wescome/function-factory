/**
 * @factory/transmission-adapters
 *
 * ONE function: reformat(specification, substrate) → communicable_specification
 *
 * The atom is INTERNAL. It NEVER appears in any LLM prompt.
 * reformat() is the ONLY way Factory internals reach external agents.
 * Every new agent integration is a new substrate, not a new adapter.
 */

export { reformat } from './reformat.js'
export type { FactorySpecification, CommunicableSpecification, Substrate } from './types.js'
