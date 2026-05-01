/**
 * @module lifecycle
 *
 * Phase D — Function lifecycle state tracking (ontology constraint C14).
 *
 * Implements the lifecycle state machine aligned to the canonical literate
 * reference (packages/literate-tools/tangled/types/index.ts):
 *   Proposed -> Designed -> InProgress -> Produced -> Accepted -> Monitored -> Retired
 *                                                                    |-> Regressed -> InProgress
 *
 * State renames from prior implementation:
 *   implemented → produced
 *   verified → accepted
 *
 * Gate requirements (from factory-shapes.ttl C14, updated):
 *   Produced -> Accepted requires Gate 2 pass
 *   Accepted -> Monitored requires Gate 3 active
 *
 * Transitions are IDEMPOTENT: transitioning to the current state is a no-op.
 *
 * NOTE: Existing ArangoDB documents may contain old state names ('implemented',
 * 'verified'). A migration query is needed for existing data:
 *   FOR f IN specs_functions
 *     FILTER f.lifecycleState == 'implemented'
 *     UPDATE f WITH { lifecycleState: 'produced' } IN specs_functions
 *   FOR f IN specs_functions
 *     FILTER f.lifecycleState == 'verified'
 *     UPDATE f WITH { lifecycleState: 'accepted' } IN specs_functions
 *
 * Ontology reference:
 *   ff:FunctionLifecycleState (factory-ontology.ttl)
 *   ff:allowedTransition (factory-ontology.ttl)
 *   ff:LifecycleTransitionShape (factory-shapes.ttl C14)
 */

import type { ArangoClient } from '@factory/arango-client'

// ── Types ──────────────────────────────────────────────────────────

export type LifecycleState =
  | 'proposed' | 'designed' | 'in_progress'
  | 'produced' | 'accepted' | 'monitored'
  | 'regressed' | 'retired'

export interface LifecycleTransition {
  from: LifecycleState
  to: LifecycleState
  trigger: string              // canonical field name (was `triggeredBy`)
  guard?: string               // named precondition from canonical transition table
  responsible_context?: string // which subsystem owns this transition
  timestamp: string
  gateReport?: string          // _key of the gate report that authorized this transition
}

// ── Constants ──────────────────────────────────────────────────────

/**
 * Allowed lifecycle transitions per canonical literate reference.
 * Transitions not in this graph are forbidden.
 *
 * `proposed` is a pipeline-specific initial state (not in canonical
 * but functionally needed as the entry point for new function proposals).
 */
export const ALLOWED_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  proposed: ['designed', 'retired'],
  designed: ['in_progress', 'retired'],
  in_progress: ['produced'],
  produced: ['accepted', 'retired'],
  accepted: ['monitored', 'retired'],
  monitored: ['regressed', 'retired'],
  regressed: ['in_progress', 'retired'],
  retired: [],
}

/**
 * Gate requirements for target states.
 * If a target state is in this map, the named gate must have passed.
 */
export const GATE_REQUIREMENTS: Partial<Record<LifecycleState, string>> = {
  accepted: 'gate-2',
  monitored: 'gate-3',
}

// ── Validation ─────────────────────────────────────────────────────

/**
 * Validate a lifecycle state transition.
 *
 * Returns { valid: true } if the transition is allowed.
 * Returns { valid: true, gateRequired } if a gate must pass first.
 * Returns { valid: false, error } if the transition is forbidden.
 *
 * Same-state transitions are treated as valid (idempotent no-op).
 */
export function validateTransition(
  from: LifecycleState,
  to: LifecycleState,
): { valid: boolean; error?: string; gateRequired?: string } {
  // Idempotent: same state -> no-op
  if (from === to) {
    return { valid: true }
  }

  const allowed = ALLOWED_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    return {
      valid: false,
      error: `Invalid lifecycle transition: ${from} -> ${to}. Allowed targets from ${from}: [${allowed.join(', ')}]`,
    }
  }

  const gateRequired = GATE_REQUIREMENTS[to]
  return { valid: true, ...(gateRequired ? { gateRequired } : {}) }
}

// ── State transition ───────────────────────────────────────────────

/**
 * Transition a FunctionProposal's lifecycle state.
 *
 * 1. Fetches the current document from specs_functions
 * 2. Validates the transition
 * 3. If a gate is required, verifies it has passed (via gateReport or gate_status query)
 * 4. Updates the document's lifecycleState field
 * 5. Records the transition in lifecycle_transitions edge collection
 *
 * Throws if the transition is invalid, the document is not found,
 * or a required gate has not passed.
 *
 * Idempotent: transitioning to the current state is a silent no-op.
 */
export async function transitionLifecycle(
  db: ArangoClient,
  functionKey: string,
  to: LifecycleState,
  opts: {
    trigger: string
    guard?: string
    responsible_context?: string
    gateReport?: string
  },
): Promise<void> {
  // 1. Fetch current state
  const doc = await db.get<{ _key: string; lifecycleState?: string }>(
    'specs_functions',
    functionKey,
  )

  if (!doc) {
    throw new Error(`Function ${functionKey} not found in specs_functions`)
  }

  const from = (doc.lifecycleState ?? 'proposed') as LifecycleState

  // 2. Idempotent check
  if (from === to) {
    return // no-op
  }

  // 3. Validate transition
  const validation = validateTransition(from, to)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  // 4. Gate check
  if (validation.gateRequired) {
    if (!opts.gateReport) {
      throw new Error(
        `Transition ${from} -> ${to} requires ${validation.gateRequired} gate pass. ` +
        `Provide a gateReport key.`,
      )
    }

    // Verify gate actually passed
    const gateStatus = await db.queryOne<{ passed: boolean }>(
      `FOR g IN gate_status
         FILTER g._key == @key OR g.report._key == @key
         RETURN { passed: g.passed }`,
      { key: opts.gateReport },
    )

    if (!gateStatus?.passed) {
      throw new Error(
        `Gate ${validation.gateRequired} has not passed for report ${opts.gateReport}. ` +
        `Cannot transition ${from} -> ${to}.`,
      )
    }
  }

  // 5. Update document
  await db.update('specs_functions', functionKey, {
    lifecycleState: to,
    lifecycleUpdatedAt: new Date().toISOString(),
  })

  // 6. Record transition edge
  const transition: LifecycleTransition = {
    from,
    to,
    trigger: opts.trigger,
    timestamp: new Date().toISOString(),
    ...(opts.guard ? { guard: opts.guard } : {}),
    ...(opts.responsible_context ? { responsible_context: opts.responsible_context } : {}),
    ...(opts.gateReport ? { gateReport: opts.gateReport } : {}),
  }

  await db.saveEdge(
    'lifecycle_transitions',
    `specs_functions/${functionKey}`,
    `specs_functions/${functionKey}`,
    transition as unknown as Record<string, unknown>,
  )
}
