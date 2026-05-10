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

    expect(state.executableSpecificationId).toBe(wgId)
    expect(state.executableSpecification).toBe(wg)
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
    expect(state.coherenceVerificationPassed).toBe(false)
    expect(state.coherenceVerificationReport).toBeNull()
    expect(state.domainExecutionRequest.adapterId).toBe('adapter.coding')
    expect(state.domainExecutionRequest.executableSpecificationId).toBe(wgId)
    expect(state.domainExecutionRequest.intentSpecificationId).toBe('PRD-001')
    expect(state.domainExecutionEvidence).toBeNull()
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
  it('Phase 5 v4 fields survive a spread-merge cycle (simulates graph state update)', () => {
    const base = createInitialState('WG-002', { id: 'WG-002' })

    // Simulate what sandboxRole does: spread-merge partial updates into state
    const update: Partial<GraphState> = {
      workspaceReady: true,
      coderBackupHandle: { id: 'coder-001', dir: '/workspace' },
      executionMode: 'sandbox',
      coherenceVerificationPassed: true,
      coderToolCalls: 12,
    }

    const merged = { ...base, ...update } as GraphState

    // The merge must preserve base defaults that were NOT overridden
    expect(merged.briefingScript).toBeNull()
    expect(merged.semanticReview).toBeNull()
    expect(merged.coherenceVerificationReport).toBeNull()
    expect(merged.domainExecutionEvidence).toBeNull()
    expect(merged.compiledPrd).toBeNull()
    expect(merged.sandboxName).toBeNull()
    expect(merged.freshBackupHandle).toBeNull()

    // And the overrides must take effect
    expect(merged.workspaceReady).toBe(true)
    expect(merged.coderBackupHandle).toEqual({ id: 'coder-001', dir: '/workspace' })
    expect(merged.executionMode).toBe('sandbox')
    expect(merged.coherenceVerificationPassed).toBe(true)
    expect(merged.coderToolCalls).toBe(12)

    // Original state must be unmodified (no mutation)
    expect(base.workspaceReady).toBe(false)
    expect(base.coderBackupHandle).toBeNull()
    expect(base.executionMode).toBeNull()
  })

  it('preserves index signature for arbitrary keys', () => {
    const state = createInitialState('WG-003', { id: 'WG-003' })
    state.customField = 'anything'
    expect(state.customField).toBe('anything')
  })
})
