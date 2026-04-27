import { describe, it, expect } from 'vitest'
import { createInitialState } from './state.js'
import type { GraphState } from './state.js'

// ────────────────────────────────────────────────────────────
// GraphState v5 — Phase 5 additions
// ────────────────────────────────────────────────────────────

describe('createInitialState', () => {
  const wgId = 'WG-001'
  const wg = { id: 'WG-001', atoms: [] }

  it('returns required base fields with correct defaults', () => {
    const state = createInitialState(wgId, wg)

    expect(state.workGraphId).toBe(wgId)
    expect(state.workGraph).toBe(wg)
    expect(state.plan).toBeNull()
    expect(state.code).toBeNull()
    expect(state.critique).toBeNull()
    expect(state.tests).toBeNull()
    expect(state.verdict).toBeNull()
    expect(state.roleHistory).toEqual([])
    expect(state.repairCount).toBe(0)
    expect(state.tokenUsage).toBe(0)
    expect(state.maxRepairs).toBe(5)
    expect(state.maxTokens).toBe(150_000)
  })

  it('respects opts overrides for maxRepairs and maxTokens', () => {
    const state = createInitialState(wgId, wg, { maxRepairs: 10, maxTokens: 300_000 })
    expect(state.maxRepairs).toBe(10)
    expect(state.maxTokens).toBe(300_000)
  })

  it('returns workspaceReady: false by default', () => {
    const state = createInitialState(wgId, wg)
    expect(state.workspaceReady).toBe(false)
  })

  it('sets Phase 5 v4 fields to their SS11 defaults', () => {
    const state = createInitialState(wgId, wg)
    expect(state.briefingScript).toBeNull()
    expect(state.semanticReview).toBeNull()
    expect(state.gate1Passed).toBe(false)
    expect(state.gate1Report).toBeNull()
    expect(state.compiledPrd).toBeNull()
    expect(state.sandboxName).toBeNull()
    expect(state.freshBackupHandle).toBeNull()
    expect(state.coderBackupHandle).toBeNull()
    expect(state.executionMode).toBeNull()
  })

  it('does not set optional tool-tracking fields (they remain undefined)', () => {
    const state = createInitialState(wgId, wg)
    expect(state.coderToolCalls).toBeUndefined()
    expect(state.testerToolCalls).toBeUndefined()
    expect(state.blockedToolCalls).toBeUndefined()
  })
})

describe('GraphState type', () => {
  it('accepts Phase 5 v4 fields via assignment', () => {
    const state = createInitialState('WG-002', { id: 'WG-002' })

    // Assign Phase 5 v4 fields — these must compile without error
    state.briefingScript = { sections: ['intro', 'context'] }
    state.semanticReview = { score: 0.95 }
    state.gate1Passed = true
    state.gate1Report = { coverage: 0.88 }
    state.compiledPrd = { sections: ['overview'] }
    state.sandboxName = 'ff-sandbox-wg002'
    state.freshBackupHandle = 'r2://backups/fresh-001'
    state.coderBackupHandle = 'r2://backups/coder-001'
    state.executionMode = 'sandbox'
    state.workspaceReady = true
    state.coderToolCalls = 12
    state.testerToolCalls = 5
    state.blockedToolCalls = [
      { role: 'coder', toolName: 'exec', reason: 'not allowed in sandbox' },
    ]

    expect(state.briefingScript).toEqual({ sections: ['intro', 'context'] })
    expect(state.semanticReview).toEqual({ score: 0.95 })
    expect(state.gate1Passed).toBe(true)
    expect(state.gate1Report).toEqual({ coverage: 0.88 })
    expect(state.compiledPrd).toEqual({ sections: ['overview'] })
    expect(state.sandboxName).toBe('ff-sandbox-wg002')
    expect(state.freshBackupHandle).toBe('r2://backups/fresh-001')
    expect(state.coderBackupHandle).toBe('r2://backups/coder-001')
    expect(state.executionMode).toBe('sandbox')
    expect(state.workspaceReady).toBe(true)
    expect(state.coderToolCalls).toBe(12)
    expect(state.testerToolCalls).toBe(5)
    expect(state.blockedToolCalls).toHaveLength(1)
    expect(state.blockedToolCalls![0]).toEqual({
      role: 'coder',
      toolName: 'exec',
      reason: 'not allowed in sandbox',
    })
  })

  it('preserves index signature for arbitrary keys', () => {
    const state = createInitialState('WG-003', {})
    state.customField = 'anything'
    expect(state.customField).toBe('anything')
  })
})
