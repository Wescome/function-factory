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

import type { FactorySpecification, CommunicableSpecification, Substrate, AgentsMdInput } from './types.js'
import { agentsMdToCommunicable } from './substrates/agents-md.js'

/** Accepted input types — each substrate declares which it needs. */
export type ReformatInput = FactorySpecification | AgentsMdInput

export function reformat(
  spec: ReformatInput,
  substrate: Substrate,
): CommunicableSpecification {
  switch (substrate) {
    case 'coding-agent':
      throw new Error(
        'coding-agent substrate is bypass — use the working CoderAgent prompt path directly. The adapter is for external substrates only.',
      )

    case 'agents-md':
      return agentsMdToCommunicable(spec as AgentsMdInput)

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
