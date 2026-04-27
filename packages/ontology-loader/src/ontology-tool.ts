/**
 * AgentTool for querying the Factory ontology.
 *
 * Agents use this tool instead of raw AQL for ontology-specific questions:
 *   - "What constraints apply to a WorkGraph?"
 *   - "What tools should the Architect role have?"
 *   - "What's the lifecycle state of Function FN-XXX?"
 *   - "Are there pending CRPs?"
 *   - "What collection does Signal persist to?"
 */

import type { ArangoClient } from '@factory/arango-client'
import {
  getConstraintsForClass,
  getRoleSpec,
  getLifecycleState,
  getPendingCRPs,
  getPersistenceTarget,
} from './index.js'

export type OntologyQueryType =
  | 'constraints_for_class'
  | 'role_spec'
  | 'lifecycle_state'
  | 'pending_crps'
  | 'persistence_target'

export interface OntologyQueryParams {
  queryType: OntologyQueryType
  argument: string
}

/**
 * Build the ontology_query tool for agent sessions.
 *
 * Returns a tool object compatible with gdk-agent AgentTool interface.
 * The tool uses the simplified object shape (no TypeBox dependency at runtime)
 * since it ships in the ontology-loader package, not the agent package.
 */
export function buildOntologyTool(db: ArangoClient) {
  return {
    name: 'ontology_query' as const,
    label: 'Query Factory Ontology',
    description: 'Query the Factory ontology for constraints, role specs, lifecycle states, and pending CRPs. Preferred over raw AQL for ontology questions.',
    parameters: {
      type: 'object' as const,
      properties: {
        queryType: {
          type: 'string',
          enum: ['constraints_for_class', 'role_spec', 'lifecycle_state', 'pending_crps', 'persistence_target'],
          description: 'Type of ontology query to execute.',
        },
        argument: {
          type: 'string',
          description: 'Class name, role key, or function key depending on queryType. Empty string for pending_crps.',
        },
      },
      required: ['queryType', 'argument'],
    },
    async execute(
      _toolCallId: string,
      params: OntologyQueryParams,
    ) {
      const { queryType, argument } = params

      switch (queryType) {
        case 'constraints_for_class': {
          const constraints = await getConstraintsForClass(db, argument)
          if (constraints.length === 0) {
            return {
              content: [{ type: 'text' as const, text: `No constraints found for class "${argument}".` }],
              details: { constraints: [] },
            }
          }
          const summary = constraints
            .map(c => `[${c.constraintId}] ${c.name} (${c.severity}): ${c.message}`)
            .join('\n')
          return {
            content: [{ type: 'text' as const, text: `Constraints for ${argument}:\n${summary}` }],
            details: { constraints },
          }
        }

        case 'role_spec': {
          const role = await getRoleSpec(db, argument)
          if (!role) {
            return {
              content: [{ type: 'text' as const, text: `No role spec found for "${argument}".` }],
              details: null,
            }
          }
          const lines = [
            `Role: ${role._key} (${role.label ?? role.type})`,
            `Tools: ${role.tools?.join(', ') ?? 'none'}`,
            `Permissions: ${role.permissions?.join(', ') ?? 'none'}`,
            `Memory: ${role.memoryAccess?.join(', ') ?? 'none'}`,
            `Environment: ${role.runsIn ?? 'unknown'}`,
          ]
          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
            details: { role },
          }
        }

        case 'lifecycle_state': {
          const state = await getLifecycleState(db, argument)
          return {
            content: [{
              type: 'text' as const,
              text: state
                ? `Function ${argument} lifecycle state: ${state}`
                : `No lifecycle state found for function "${argument}".`,
            }],
            details: { state },
          }
        }

        case 'pending_crps': {
          const crps = await getPendingCRPs(db)
          if (crps.length === 0) {
            return {
              content: [{ type: 'text' as const, text: 'No pending CRPs found.' }],
              details: { crps: [] },
            }
          }
          const summary = crps
            .map(c => `[${c._key}] ${c.context} (confidence: ${c.confidence})`)
            .join('\n')
          return {
            content: [{ type: 'text' as const, text: `Pending CRPs:\n${summary}` }],
            details: { crps },
          }
        }

        case 'persistence_target': {
          const target = await getPersistenceTarget(db, argument)
          return {
            content: [{
              type: 'text' as const,
              text: target
                ? `Class "${argument}" persists to collection: ${target}`
                : `No persistence target found for class "${argument}".`,
            }],
            details: { target },
          }
        }

        default:
          return {
            content: [{ type: 'text' as const, text: `Unknown queryType: "${queryType}".` }],
            details: null,
          }
      }
    },
  }
}
