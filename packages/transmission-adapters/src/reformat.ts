/**
 * reformat() — THE function.
 *
 * Routes a FactorySpecification through a substrate-specific formatter
 * to produce a CommunicableSpecification ready for an external agent.
 *
 * The atom is INTERNAL. It NEVER appears in any LLM prompt.
 * reformat() is the ONLY way Factory internals reach external agents.
 * Every new agent integration is a new substrate, not a new adapter.
 */

import type { FactorySpecification, CommunicableSpecification, Substrate } from './types.js'
import { formatForCodingAgent } from './substrates/coding-agent.js'

export function reformat(
  spec: FactorySpecification,
  substrate: Substrate,
): CommunicableSpecification {
  switch (substrate) {
    case 'coding-agent':
      return formatForCodingAgent(spec)

    case 'agents-md':
    case 'claude-md':
    case 'skill-md':
    case 'a2a':
      throw new Error(`reformat: substrate "${substrate}" not yet implemented`)

    default: {
      // Exhaustive check for future substrates
      const _exhaustive: never = substrate
      throw new Error(`reformat: unknown substrate "${substrate as string}" not yet implemented`)
    }
  }
}
