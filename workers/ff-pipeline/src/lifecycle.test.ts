/**
 * Phase D — Lifecycle state tracking tests (TDD RED phase).
 *
 * Verifies lifecycle state transitions per ontology constraint C14
 * and the allowedTransition graph in factory-ontology.ttl.
 *
 * Uses mock ArangoClient — same pattern as other pipeline tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  validateTransition,
  transitionLifecycle,
  ALLOWED_TRANSITIONS,
  GATE_REQUIREMENTS,
  type LifecycleState,
} from './lifecycle'

// ── Mock ArangoClient ──────────────────────────────────────────────

function makeMockDb() {
  return {
    save: vi.fn().mockResolvedValue({ _key: 'mock-key' }),
    update: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(null),
    saveEdge: vi.fn().mockResolvedValue(undefined),
  }
}

// ────────────────────────────────────────────────────────────
// validateTransition
// ────────────────────────────────────────────────────────────

describe('validateTransition', () => {
  it('allows proposed -> designed', () => {
    const result = validateTransition('proposed', 'designed')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('allows designed -> in_progress', () => {
    const result = validateTransition('designed', 'in_progress')
    expect(result.valid).toBe(true)
  })

  it('allows in_progress -> implemented', () => {
    const result = validateTransition('in_progress', 'implemented')
    expect(result.valid).toBe(true)
  })

  it('allows implemented -> verified and returns gateRequired', () => {
    const result = validateTransition('implemented', 'verified')
    expect(result.valid).toBe(true)
    expect(result.gateRequired).toBe('gate-2')
  })

  it('allows verified -> monitored and returns gateRequired', () => {
    const result = validateTransition('verified', 'monitored')
    expect(result.valid).toBe(true)
    expect(result.gateRequired).toBe('gate-3')
  })

  it('allows monitored -> retired', () => {
    const result = validateTransition('monitored', 'retired')
    expect(result.valid).toBe(true)
  })

  it('rejects proposed -> verified (skipping states)', () => {
    const result = validateTransition('proposed', 'verified')
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects proposed -> in_progress (skipping designed)', () => {
    const result = validateTransition('proposed', 'in_progress')
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects retired -> proposed (backward transition)', () => {
    const result = validateTransition('retired', 'proposed')
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects in_progress -> monitored (skipping states)', () => {
    const result = validateTransition('in_progress', 'monitored')
    expect(result.valid).toBe(false)
  })

  it('treats same-state transition as valid (idempotent no-op)', () => {
    const result = validateTransition('proposed', 'proposed')
    expect(result.valid).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// ALLOWED_TRANSITIONS structure
// ────────────────────────────────────────────────────────────

describe('ALLOWED_TRANSITIONS', () => {
  it('defines all 7 lifecycle states', () => {
    const states: LifecycleState[] = [
      'proposed', 'designed', 'in_progress',
      'implemented', 'verified', 'monitored', 'retired',
    ]
    for (const s of states) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(s)
    }
  })

  it('retired has no outgoing transitions', () => {
    expect(ALLOWED_TRANSITIONS.retired).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────
// GATE_REQUIREMENTS structure
// ────────────────────────────────────────────────────────────

describe('GATE_REQUIREMENTS', () => {
  it('verified requires gate-2', () => {
    expect(GATE_REQUIREMENTS.verified).toBe('gate-2')
  })

  it('monitored requires gate-3', () => {
    expect(GATE_REQUIREMENTS.monitored).toBe('gate-3')
  })

  it('proposed has no gate requirement', () => {
    expect(GATE_REQUIREMENTS.proposed).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────
// transitionLifecycle
// ────────────────────────────────────────────────────────────

describe('transitionLifecycle', () => {
  let db: ReturnType<typeof makeMockDb>

  beforeEach(() => {
    db = makeMockDb()
    // Default: function exists with lifecycleState 'proposed'
    db.get.mockResolvedValue({
      _key: 'FP-001',
      lifecycleState: 'proposed',
    })
  })

  it('updates the function document lifecycleState field', async () => {
    await transitionLifecycle(db as any, 'FP-001', 'designed', {
      triggeredBy: 'pipeline-compile',
    })

    expect(db.update).toHaveBeenCalledWith(
      'specs_functions',
      'FP-001',
      expect.objectContaining({
        lifecycleState: 'designed',
      }),
    )
  })

  it('records the transition in lifecycle_transitions edge collection', async () => {
    await transitionLifecycle(db as any, 'FP-001', 'designed', {
      triggeredBy: 'pipeline-compile',
    })

    expect(db.saveEdge).toHaveBeenCalledWith(
      'lifecycle_transitions',
      expect.any(String), // from vertex
      expect.any(String), // to vertex
      expect.objectContaining({
        from: 'proposed',
        to: 'designed',
        triggeredBy: 'pipeline-compile',
      }),
    )
  })

  it('throws for invalid transition', async () => {
    await expect(
      transitionLifecycle(db as any, 'FP-001', 'verified', {
        triggeredBy: 'test',
      }),
    ).rejects.toThrow()
  })

  it('is idempotent — transitioning to current state is a no-op', async () => {
    await transitionLifecycle(db as any, 'FP-001', 'proposed', {
      triggeredBy: 'idempotent-check',
    })

    // No update, no edge written
    expect(db.update).not.toHaveBeenCalled()
    expect(db.saveEdge).not.toHaveBeenCalled()
  })

  it('checks gate requirement for verified transition', async () => {
    db.get.mockResolvedValue({
      _key: 'FP-002',
      lifecycleState: 'implemented',
    })

    // No gate report — should require one
    await expect(
      transitionLifecycle(db as any, 'FP-002', 'verified', {
        triggeredBy: 'test',
        // no gateReport provided
      }),
    ).rejects.toThrow(/gate/i)
  })

  it('allows verified transition when gateReport is provided', async () => {
    db.get.mockResolvedValue({
      _key: 'FP-002',
      lifecycleState: 'implemented',
    })

    // Gate status exists and passed
    db.queryOne.mockResolvedValue({ passed: true })

    await transitionLifecycle(db as any, 'FP-002', 'verified', {
      triggeredBy: 'gate-2-pass',
      gateReport: 'CR-G2-WG-002',
    })

    expect(db.update).toHaveBeenCalledWith(
      'specs_functions',
      'FP-002',
      expect.objectContaining({ lifecycleState: 'verified' }),
    )
  })

  it('throws when function document not found', async () => {
    db.get.mockResolvedValue(null)

    await expect(
      transitionLifecycle(db as any, 'FP-MISSING', 'designed', {
        triggeredBy: 'test',
      }),
    ).rejects.toThrow(/not found/i)
  })

  it('includes timestamp in the transition edge', async () => {
    await transitionLifecycle(db as any, 'FP-001', 'designed', {
      triggeredBy: 'test',
    })

    expect(db.saveEdge).toHaveBeenCalledWith(
      'lifecycle_transitions',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        timestamp: expect.any(String),
      }),
    )
  })

  it('includes gateReport in transition edge when provided', async () => {
    db.get.mockResolvedValue({
      _key: 'FP-002',
      lifecycleState: 'implemented',
    })
    db.queryOne.mockResolvedValue({ passed: true })

    await transitionLifecycle(db as any, 'FP-002', 'verified', {
      triggeredBy: 'gate-2-pass',
      gateReport: 'CR-G2-WG-002',
    })

    expect(db.saveEdge).toHaveBeenCalledWith(
      'lifecycle_transitions',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        gateReport: 'CR-G2-WG-002',
      }),
    )
  })
})
