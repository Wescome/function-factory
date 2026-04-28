/**
 * v5.1: Completion ledger tests.
 *
 * The completion ledger tracks per-atom completion state in ArangoDB,
 * enabling event-driven coordination across AtomExecutor DOs.
 *
 * Tests:
 *   1. createLedger stores in ArangoDB with correct shape
 *   2. recordAtomResult increments completedAtoms and stores result
 *   3. getReadyAtoms returns atoms whose deps are all complete
 *   4. isComplete returns true when all atoms done
 *   5. getReadyAtoms excludes already-completed atoms
 *   6. recordAtomResult with all atoms triggers phase transition
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createLedger,
  recordAtomResult,
  getReadyAtoms,
  isComplete,
  type CompletionLedger,
} from './completion-ledger.js'
import type { AtomResult } from './atom-executor.js'
import type { DependencyLayer } from './layer-dispatch.js'

// ── Mock ArangoDB client ──

function makeMockDb() {
  const store = new Map<string, unknown>()
  return {
    save: vi.fn(async (collection: string, doc: Record<string, unknown>) => {
      store.set(`${collection}/${doc._key}`, doc)
      return { _key: doc._key }
    }),
    get: vi.fn(async (collection: string, key: string) => {
      return store.get(`${collection}/${key}`) ?? null
    }),
    update: vi.fn(async (collection: string, key: string, doc: Record<string, unknown>) => {
      const existing = store.get(`${collection}/${key}`) as Record<string, unknown> | undefined
      if (existing) {
        const merged = { ...existing, ...doc }
        store.set(`${collection}/${key}`, merged)
      }
      return { _key: key }
    }),
    _store: store,
  }
}

function makeAtomResult(atomId: string, decision: 'pass' | 'fail' = 'pass'): AtomResult {
  return {
    atomId,
    verdict: { decision, confidence: 1.0, reason: `Atom ${atomId} ${decision}` },
    codeArtifact: {
      files: [{ path: `src/${atomId}.ts`, content: '// code', action: 'create' as const }],
      summary: `Code for ${atomId}`,
      testsIncluded: false,
    },
    testReport: { passed: decision === 'pass', testsRun: 1, testsPassed: decision === 'pass' ? 1 : 0, testsFailed: decision === 'pass' ? 0 : 1, failures: [], summary: 'OK' },
    critiqueReport: null,
    retryCount: 0,
  }
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe('v5.1: completion-ledger', () => {

  describe('createLedger', () => {
    it('stores ledger in ArangoDB with correct shape', async () => {
      const db = makeMockDb()
      const layers: DependencyLayer[] = [
        { index: 0, atomIds: ['atom-1', 'atom-2'] },
        { index: 1, atomIds: ['atom-3'] },
      ]
      const allAtomSpecs: Record<string, Record<string, unknown>> = {
        'atom-1': { id: 'atom-1', description: 'Auth' },
        'atom-2': { id: 'atom-2', description: 'Data' },
        'atom-3': { id: 'atom-3', description: 'API', dependencies: [{ atomId: 'atom-1' }, { atomId: 'atom-2' }] },
      }
      const sharedContext = {
        workGraphId: 'WG-001',
        specContent: null as string | null,
        briefingScript: { goal: 'test' } as unknown,
      }

      await createLedger(db as never, {
        workGraphId: 'WG-001',
        workflowId: 'wf-123',
        totalAtoms: 3,
        layers,
        allAtomSpecs,
        sharedContext,
      })

      expect(db.save).toHaveBeenCalledOnce()
      const [collection, doc] = db.save.mock.calls[0]!
      expect(collection).toBe('completion_ledgers')
      expect(doc._key).toBe('WG-001')
      expect(doc.workflowId).toBe('wf-123')
      expect(doc.totalAtoms).toBe(3)
      expect(doc.completedAtoms).toBe(0)
      expect(doc.atomResults).toEqual({})
      expect(doc.layers).toHaveLength(2)
      expect(doc.phase).toBe('dispatched')
      expect(doc.pendingAtoms).toEqual(['atom-3'])
    })
  })

  describe('recordAtomResult', () => {
    it('increments completedAtoms and stores result', async () => {
      const db = makeMockDb()
      // Pre-populate ledger
      const ledger: CompletionLedger = {
        _key: 'WG-001',
        workflowId: 'wf-123',
        totalAtoms: 3,
        completedAtoms: 0,
        atomResults: {},
        layers: [
          { index: 0, atomIds: ['atom-1', 'atom-2'] },
          { index: 1, atomIds: ['atom-3'] },
        ],
        allAtomSpecs: {
          'atom-1': { id: 'atom-1' },
          'atom-2': { id: 'atom-2' },
          'atom-3': { id: 'atom-3', dependencies: [{ atomId: 'atom-1' }, { atomId: 'atom-2' }] },
        },
        sharedContext: { workGraphId: 'WG-001', specContent: null, briefingScript: {} },
        pendingAtoms: ['atom-3'],
        phase: 'executing',
      }
      db._store.set('completion_ledgers/WG-001', ledger)

      const result = makeAtomResult('atom-1')
      const updated = await recordAtomResult(db as never, 'WG-001', 'atom-1', result)

      expect(db.update).toHaveBeenCalledOnce()
      expect(updated.completedAtoms).toBe(1)
      expect(updated.atomResults['atom-1']).toBeDefined()
      expect(updated.atomResults['atom-1']!.verdict.decision).toBe('pass')
    })

    it('transitions phase to complete when all atoms done', async () => {
      const db = makeMockDb()
      const ledger: CompletionLedger = {
        _key: 'WG-002',
        workflowId: 'wf-456',
        totalAtoms: 1,
        completedAtoms: 0,
        atomResults: {},
        layers: [{ index: 0, atomIds: ['atom-only'] }],
        allAtomSpecs: { 'atom-only': { id: 'atom-only' } },
        sharedContext: { workGraphId: 'WG-002', specContent: null, briefingScript: {} },
        pendingAtoms: [],
        phase: 'executing',
      }
      db._store.set('completion_ledgers/WG-002', ledger)

      const result = makeAtomResult('atom-only')
      const updated = await recordAtomResult(db as never, 'WG-002', 'atom-only', result)

      expect(updated.completedAtoms).toBe(1)
      expect(updated.phase).toBe('complete')
    })
  })

  describe('getReadyAtoms', () => {
    it('returns atoms whose deps are all complete', () => {
      const ledger: CompletionLedger = {
        _key: 'WG-001',
        workflowId: 'wf-123',
        totalAtoms: 3,
        completedAtoms: 2,
        atomResults: {
          'atom-1': makeAtomResult('atom-1'),
          'atom-2': makeAtomResult('atom-2'),
        },
        layers: [
          { index: 0, atomIds: ['atom-1', 'atom-2'] },
          { index: 1, atomIds: ['atom-3'] },
        ],
        allAtomSpecs: {
          'atom-1': { id: 'atom-1' },
          'atom-2': { id: 'atom-2' },
          'atom-3': { id: 'atom-3', dependencies: [{ atomId: 'atom-1' }, { atomId: 'atom-2' }] },
        },
        sharedContext: { workGraphId: 'WG-001', specContent: null, briefingScript: {} },
        pendingAtoms: ['atom-3'],
        phase: 'executing',
      }

      const ready = getReadyAtoms(ledger)
      expect(ready).toEqual(['atom-3'])
    })

    it('returns empty when deps not yet complete', () => {
      const ledger: CompletionLedger = {
        _key: 'WG-001',
        workflowId: 'wf-123',
        totalAtoms: 3,
        completedAtoms: 1,
        atomResults: {
          'atom-1': makeAtomResult('atom-1'),
        },
        layers: [
          { index: 0, atomIds: ['atom-1', 'atom-2'] },
          { index: 1, atomIds: ['atom-3'] },
        ],
        allAtomSpecs: {
          'atom-1': { id: 'atom-1' },
          'atom-2': { id: 'atom-2' },
          'atom-3': { id: 'atom-3', dependencies: [{ atomId: 'atom-1' }, { atomId: 'atom-2' }] },
        },
        sharedContext: { workGraphId: 'WG-001', specContent: null, briefingScript: {} },
        pendingAtoms: ['atom-3'],
        phase: 'executing',
      }

      const ready = getReadyAtoms(ledger)
      expect(ready).toEqual([])
    })

    it('excludes already-completed atoms from ready list', () => {
      const ledger: CompletionLedger = {
        _key: 'WG-001',
        workflowId: 'wf-123',
        totalAtoms: 2,
        completedAtoms: 1,
        atomResults: {
          'atom-1': makeAtomResult('atom-1'),
        },
        layers: [
          { index: 0, atomIds: ['atom-1', 'atom-2'] },
        ],
        allAtomSpecs: {
          'atom-1': { id: 'atom-1' },
          'atom-2': { id: 'atom-2' },
        },
        sharedContext: { workGraphId: 'WG-001', specContent: null, briefingScript: {} },
        pendingAtoms: ['atom-2'],
        phase: 'executing',
      }

      // atom-1 is already completed, atom-2 has no deps → should be ready
      const ready = getReadyAtoms(ledger)
      expect(ready).toEqual(['atom-2'])
    })

    it('atoms with no dependencies are immediately ready', () => {
      const ledger: CompletionLedger = {
        _key: 'WG-003',
        workflowId: 'wf-789',
        totalAtoms: 2,
        completedAtoms: 0,
        atomResults: {},
        layers: [
          { index: 0, atomIds: ['atom-1', 'atom-2'] },
        ],
        allAtomSpecs: {
          'atom-1': { id: 'atom-1' },
          'atom-2': { id: 'atom-2' },
        },
        sharedContext: { workGraphId: 'WG-003', specContent: null, briefingScript: {} },
        pendingAtoms: ['atom-1', 'atom-2'],
        phase: 'executing',
      }

      const ready = getReadyAtoms(ledger)
      expect(ready.sort()).toEqual(['atom-1', 'atom-2'])
    })
  })

  describe('isComplete', () => {
    it('returns true when all atoms done', () => {
      const ledger: CompletionLedger = {
        _key: 'WG-001',
        workflowId: 'wf-123',
        totalAtoms: 2,
        completedAtoms: 2,
        atomResults: {
          'atom-1': makeAtomResult('atom-1'),
          'atom-2': makeAtomResult('atom-2'),
        },
        layers: [{ index: 0, atomIds: ['atom-1', 'atom-2'] }],
        allAtomSpecs: {},
        sharedContext: { workGraphId: 'WG-001', specContent: null, briefingScript: {} },
        pendingAtoms: [],
        phase: 'complete',
      }

      expect(isComplete(ledger)).toBe(true)
    })

    it('returns false when atoms remaining', () => {
      const ledger: CompletionLedger = {
        _key: 'WG-001',
        workflowId: 'wf-123',
        totalAtoms: 3,
        completedAtoms: 1,
        atomResults: {
          'atom-1': makeAtomResult('atom-1'),
        },
        layers: [
          { index: 0, atomIds: ['atom-1', 'atom-2'] },
          { index: 1, atomIds: ['atom-3'] },
        ],
        allAtomSpecs: {},
        sharedContext: { workGraphId: 'WG-001', specContent: null, briefingScript: {} },
        pendingAtoms: ['atom-3'],
        phase: 'executing',
      }

      expect(isComplete(ledger)).toBe(false)
    })
  })
})
