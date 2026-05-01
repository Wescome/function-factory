/**
 * Phase D — Lifecycle state tracking tests (aligned to canonical literate reference).
 *
 * Verifies lifecycle state transitions per the canonical transition table
 * in packages/literate-tools/tangled/types/index.ts.
 *
 * State renames vs. prior implementation:
 *   implemented → produced
 *   verified → accepted
 *
 * New state: regressed (between monitored and in_progress/retired)
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

  it('allows proposed -> retired', () => {
    const result = validateTransition('proposed', 'retired')
    expect(result.valid).toBe(true)
  })

  it('allows designed -> in_progress', () => {
    const result = validateTransition('designed', 'in_progress')
    expect(result.valid).toBe(true)
  })

  it('allows designed -> retired', () => {
    const result = validateTransition('designed', 'retired')
    expect(result.valid).toBe(true)
  })

  it('allows in_progress -> produced', () => {
    const result = validateTransition('in_progress', 'produced')
    expect(result.valid).toBe(true)
  })

  it('allows produced -> accepted and returns gateRequired', () => {
    const result = validateTransition('produced', 'accepted')
    expect(result.valid).toBe(true)
    expect(result.gateRequired).toBe('gate-2')
  })

  it('allows produced -> retired', () => {
    const result = validateTransition('produced', 'retired')
    expect(result.valid).toBe(true)
  })

  it('allows accepted -> monitored and returns gateRequired', () => {
    const result = validateTransition('accepted', 'monitored')
    expect(result.valid).toBe(true)
    expect(result.gateRequired).toBe('gate-3')
  })

  it('allows accepted -> retired', () => {
    const result = validateTransition('accepted', 'retired')
    expect(result.valid).toBe(true)
  })

  it('allows monitored -> regressed', () => {
    const result = validateTransition('monitored', 'regressed')
    expect(result.valid).toBe(true)
  })

  it('allows monitored -> retired', () => {
    const result = validateTransition('monitored', 'retired')
    expect(result.valid).toBe(true)
  })

  it('allows regressed -> in_progress', () => {
    const result = validateTransition('regressed', 'in_progress')
    expect(result.valid).toBe(true)
  })

  it('allows regressed -> retired', () => {
    const result = validateTransition('regressed', 'retired')
    expect(result.valid).toBe(true)
  })

  it('rejects proposed -> accepted (skipping states)', () => {
    const result = validateTransition('proposed', 'accepted')
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
  it('defines all 8 lifecycle states', () => {
    const states: LifecycleState[] = [
      'proposed', 'designed', 'in_progress',
      'produced', 'accepted', 'monitored', 'regressed', 'retired',
    ]
    for (const s of states) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(s)
    }
  })

  it('retired has no outgoing transitions', () => {
    expect(ALLOWED_TRANSITIONS.retired).toEqual([])
  })

  it('every non-retired state can transition to retired', () => {
    const nonRetired: LifecycleState[] = [
      'proposed', 'designed', 'produced', 'accepted', 'monitored', 'regressed',
    ]
    for (const s of nonRetired) {
      expect(ALLOWED_TRANSITIONS[s]).toContain('retired')
    }
  })

  it('regressed can go back to in_progress', () => {
    expect(ALLOWED_TRANSITIONS.regressed).toContain('in_progress')
  })
})

// ────────────────────────────────────────────────────────────
// GATE_REQUIREMENTS structure
// ────────────────────────────────────────────────────────────

describe('GATE_REQUIREMENTS', () => {
  it('accepted requires gate-2', () => {
    expect(GATE_REQUIREMENTS.accepted).toBe('gate-2')
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
      trigger: 'pipeline-compile',
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
      trigger: 'pipeline-compile',
    })

    expect(db.saveEdge).toHaveBeenCalledWith(
      'lifecycle_transitions',
      expect.any(String), // from vertex
      expect.any(String), // to vertex
      expect.objectContaining({
        from: 'proposed',
        to: 'designed',
        trigger: 'pipeline-compile',
      }),
    )
  })

  it('throws for invalid transition', async () => {
    await expect(
      transitionLifecycle(db as any, 'FP-001', 'accepted', {
        trigger: 'test',
      }),
    ).rejects.toThrow()
  })

  it('is idempotent — transitioning to current state is a no-op', async () => {
    await transitionLifecycle(db as any, 'FP-001', 'proposed', {
      trigger: 'idempotent-check',
    })

    // No update, no edge written
    expect(db.update).not.toHaveBeenCalled()
    expect(db.saveEdge).not.toHaveBeenCalled()
  })

  it('checks gate requirement for accepted transition', async () => {
    db.get.mockResolvedValue({
      _key: 'FP-002',
      lifecycleState: 'produced',
    })

    // No gate report — should require one
    await expect(
      transitionLifecycle(db as any, 'FP-002', 'accepted', {
        trigger: 'test',
        // no gateReport provided
      }),
    ).rejects.toThrow(/gate/i)
  })

  it('allows accepted transition when gateReport is provided', async () => {
    db.get.mockResolvedValue({
      _key: 'FP-002',
      lifecycleState: 'produced',
    })

    // Gate status exists and passed
    db.queryOne.mockResolvedValue({ passed: true })

    await transitionLifecycle(db as any, 'FP-002', 'accepted', {
      trigger: 'gate-2-pass',
      gateReport: 'CR-G2-WG-002',
    })

    expect(db.update).toHaveBeenCalledWith(
      'specs_functions',
      'FP-002',
      expect.objectContaining({ lifecycleState: 'accepted' }),
    )
  })

  it('throws when function document not found', async () => {
    db.get.mockResolvedValue(null)

    await expect(
      transitionLifecycle(db as any, 'FP-MISSING', 'designed', {
        trigger: 'test',
      }),
    ).rejects.toThrow(/not found/i)
  })

  it('includes timestamp in the transition edge', async () => {
    await transitionLifecycle(db as any, 'FP-001', 'designed', {
      trigger: 'test',
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
      lifecycleState: 'produced',
    })
    db.queryOne.mockResolvedValue({ passed: true })

    await transitionLifecycle(db as any, 'FP-002', 'accepted', {
      trigger: 'gate-2-pass',
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

  it('supports guard and responsible_context in transition options', async () => {
    await transitionLifecycle(db as any, 'FP-001', 'designed', {
      trigger: 'architect_approves_function',
      guard: 'function_proposal_has_valid_invariants_and_contracts',
      responsible_context: 'Governance',
    })

    expect(db.saveEdge).toHaveBeenCalledWith(
      'lifecycle_transitions',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        guard: 'function_proposal_has_valid_invariants_and_contracts',
        responsible_context: 'Governance',
      }),
    )
  })

  it('allows regressed -> in_progress transition', async () => {
    db.get.mockResolvedValue({
      _key: 'FP-003',
      lifecycleState: 'regressed',
    })

    await transitionLifecycle(db as any, 'FP-003', 'in_progress', {
      trigger: 'remediation_initiated',
    })

    expect(db.update).toHaveBeenCalledWith(
      'specs_functions',
      'FP-003',
      expect.objectContaining({ lifecycleState: 'in_progress' }),
    )
  })

  it('allows monitored -> regressed transition', async () => {
    db.get.mockResolvedValue({
      _key: 'FP-004',
      lifecycleState: 'monitored',
    })

    await transitionLifecycle(db as any, 'FP-004', 'regressed', {
      trigger: 'trusted_evidence_invalidated',
    })

    expect(db.update).toHaveBeenCalledWith(
      'specs_functions',
      'FP-004',
      expect.objectContaining({ lifecycleState: 'regressed' }),
    )
  })
})
