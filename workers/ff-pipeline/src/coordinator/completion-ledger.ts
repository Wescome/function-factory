/**
 * v5.1: Completion ledger — tracks per-atom completion state in ArangoDB.
 *
 * The completion ledger is the shared state that enables event-driven
 * coordination between AtomExecutor DOs. Each atom's DO writes its result
 * to the ledger; the queue consumer reads the ledger to determine when
 * all atoms are complete and whether dependent atoms can be dispatched.
 *
 * Stored in: ArangoDB `completion_ledgers` collection, keyed by workGraphId.
 */

import type { AtomResult } from './atom-executor'
import type { DependencyLayer } from './layer-dispatch'

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface CompletionLedger {
  _key: string // workGraphId
  workflowId: string
  totalAtoms: number
  completedAtoms: number
  atomResults: Record<string, AtomResult>
  layers: DependencyLayer[]
  allAtomSpecs: Record<string, Record<string, unknown>>
  sharedContext: {
    workGraphId: string
    specContent: string | null
    briefingScript: unknown
  }
  pendingAtoms: string[] // atoms waiting for upstream deps
  phase: 'dispatched' | 'executing' | 'complete' | 'failed'
}

export interface CreateLedgerInput {
  workGraphId: string
  workflowId: string
  totalAtoms: number
  layers: DependencyLayer[]
  allAtomSpecs: Record<string, Record<string, unknown>>
  sharedContext: {
    workGraphId: string
    specContent: string | null
    briefingScript: unknown
  }
}

interface ArangoDb {
  save(collection: string, doc: Record<string, unknown>): Promise<{ _key: string }>
  get(collection: string, key: string): Promise<Record<string, unknown> | null>
  update(collection: string, key: string, doc: Record<string, unknown>): Promise<{ _key: string }>
  query<T = unknown>(aql: string, bindVars?: Record<string, unknown>): Promise<T[]>
  ensureCollection?(name: string): Promise<void>
}

// ────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────

/**
 * Create a new completion ledger in ArangoDB.
 *
 * Called by the coordinator after Phase 1 produces the atom plan.
 * Layer 0 atoms (no dependencies) are dispatched immediately;
 * higher-layer atoms are recorded as pending.
 */
export async function createLedger(db: ArangoDb, input: CreateLedgerInput): Promise<void> {
  // Identify atoms that have dependencies (not in layer 0)
  const layer0Atoms = new Set(input.layers[0]?.atomIds ?? [])
  const pendingAtoms = Object.keys(input.allAtomSpecs).filter(id => !layer0Atoms.has(id))

  const ledger: CompletionLedger & Record<string, unknown> = {
    _key: input.workGraphId,
    workflowId: input.workflowId,
    totalAtoms: input.totalAtoms,
    completedAtoms: 0,
    atomResults: {},
    layers: input.layers,
    allAtomSpecs: input.allAtomSpecs,
    sharedContext: input.sharedContext,
    pendingAtoms,
    phase: 'dispatched',
  }

  if (db.ensureCollection) await db.ensureCollection('completion_ledgers')
  await db.save('completion_ledgers', ledger)
}

/**
 * Record an atom's completion result in the ledger.
 *
 * Called by the atom-results queue consumer after an AtomExecutor DO completes.
 * Increments completedAtoms, stores the result, removes the atom from
 * pendingAtoms, and transitions phase to 'complete' when all atoms are done.
 *
 * Returns the updated ledger for the consumer to check readiness of
 * dependent atoms and whether Phase 3 should run.
 */
export async function recordAtomResult(
  db: ArangoDb,
  workGraphId: string,
  atomId: string,
  result: AtomResult,
): Promise<CompletionLedger> {
  // Atomic AQL update — eliminates the get-then-update race condition where
  // two concurrent atom completions could both read the same completedAtoms
  // value, both increment to the same number, and lose one count.
  const aql = `
    LET doc = DOCUMENT('completion_ledgers', @key)
    UPDATE doc WITH {
      completedAtoms: doc.completedAtoms + 1,
      atomResults: MERGE(doc.atomResults, @newResult),
      pendingAtoms: REMOVE_VALUE(doc.pendingAtoms, @atomId),
      phase: (doc.completedAtoms + 1) >= doc.totalAtoms ? 'complete' : doc.phase
    } IN completion_ledgers
    RETURN NEW
  `

  const results = await db.query<CompletionLedger>(aql, {
    key: workGraphId,
    newResult: { [atomId]: result },
    atomId,
  })

  if (!results.length || !results[0]) {
    throw new Error(`Completion ledger not found for workGraphId: ${workGraphId}`)
  }

  return results[0]
}

/**
 * Determine which pending atoms are now ready to execute.
 *
 * An atom is ready when ALL of its upstream dependencies have completed
 * AND the atom itself has not yet completed.
 */
export function getReadyAtoms(ledger: CompletionLedger): string[] {
  const completedIds = new Set(Object.keys(ledger.atomResults))

  return ledger.pendingAtoms.filter(atomId => {
    // Already completed — skip
    if (completedIds.has(atomId)) return false

    // Check all dependencies
    const spec = ledger.allAtomSpecs[atomId]
    const deps = (spec?.dependencies ?? []) as Array<{ atomId: string }>
    if (deps.length === 0) return true

    return deps.every(dep => completedIds.has(dep.atomId))
  })
}

/**
 * Check whether all atoms in the ledger have completed.
 */
export function isComplete(ledger: CompletionLedger): boolean {
  return ledger.completedAtoms >= ledger.totalAtoms
}
