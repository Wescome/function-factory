/**
 * ReconciliationGate Phase 2: Deterministic gate tests (TDD).
 *
 * Verifies all 5 decision paths:
 *   1. No violations -> pass
 *   2. Log-only violations -> pass (record)
 *   3. Warn violations (no blocks) -> warn
 *   4. Block violations, attempt < max -> remediate
 *   5. Block violations, attempt >= max -> escalate
 *
 * The gate is PURE BOOLEAN LOGIC — no LLM calls, no judgment.
 */

import { describe, expect, it } from 'vitest'
import type { IntentAnchor } from './crystallize-intent'
import { reconcile, type GateDecision, type ProbeResult } from './reconciliation-gate'

// ── Helpers ────────────────────────────────────────────────────

function makeAnchor(overrides: Partial<IntentAnchor> & { id: string; severity: 'block' | 'warn' | 'log' }): IntentAnchor {
  return {
    signal_id: 'SIG-TEST',
    claim: 'Test claim',
    probe_question: 'Is test?',
    violation_signal: 'no',
    times_probed: 0,
    times_violated: 0,
    ...overrides,
  }
}

function makeProbeResult(overrides: Partial<ProbeResult> & { anchor_id: string }): ProbeResult {
  return {
    answer: 'yes',
    is_violation: false,
    pass_name: 'decompose',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

const MAX_REMEDIATION = 2

// ── Tests ──────────────────────────────────────────────────────

describe('reconcile (ReconciliationGate)', () => {
  describe('Decision path 1: No violations -> pass', () => {
    it('returns pass when no probe results are violations', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block' }),
        makeAnchor({ id: 'IA-02', severity: 'warn' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: false }),
        makeProbeResult({ anchor_id: 'IA-02', is_violation: false }),
      ]

      const decision = reconcile(probeResults, anchors, 0, MAX_REMEDIATION)

      expect(decision.verdict).toBe('pass')
      expect(decision.violated_anchors).toEqual([])
      expect(decision.probe_results).toEqual(probeResults)
      expect(decision.remediation_attempt).toBe(0)
    })

    it('returns pass when probe results array is empty', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block' }),
      ]

      const decision = reconcile([], anchors, 0, MAX_REMEDIATION)

      expect(decision.verdict).toBe('pass')
      expect(decision.violated_anchors).toEqual([])
    })
  })

  describe('Decision path 2: Log-only violations -> pass (record)', () => {
    it('returns pass when only log-severity anchors are violated', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'log' }),
        makeAnchor({ id: 'IA-02', severity: 'log' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
        makeProbeResult({ anchor_id: 'IA-02', is_violation: true }),
      ]

      const decision = reconcile(probeResults, anchors, 0, MAX_REMEDIATION)

      expect(decision.verdict).toBe('pass')
      expect(decision.violated_anchors).toContain('IA-01')
      expect(decision.violated_anchors).toContain('IA-02')
    })
  })

  describe('Decision path 3: Warn violations (no blocks) -> warn', () => {
    it('returns warn when warn-severity anchors are violated but no blocks', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'warn' }),
        makeAnchor({ id: 'IA-02', severity: 'log' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
        makeProbeResult({ anchor_id: 'IA-02', is_violation: true }),
      ]

      const decision = reconcile(probeResults, anchors, 0, MAX_REMEDIATION)

      expect(decision.verdict).toBe('warn')
      expect(decision.violated_anchors).toContain('IA-01')
      expect(decision.violated_anchors).toContain('IA-02')
      expect(decision.advisory_text).toBeDefined()
      expect(typeof decision.advisory_text).toBe('string')
    })

    it('includes advisory text in warn decision', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'warn', claim: 'Signal scope preserved' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
      ]

      const decision = reconcile(probeResults, anchors, 0, MAX_REMEDIATION)

      expect(decision.verdict).toBe('warn')
      expect(decision.advisory_text).toBeTruthy()
    })
  })

  describe('Decision path 4: Block violations, attempt < max -> remediate', () => {
    it('returns remediate on first attempt with block violations', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
      ]

      const decision = reconcile(probeResults, anchors, 0, MAX_REMEDIATION)

      expect(decision.verdict).toBe('remediate')
      expect(decision.violated_anchors).toContain('IA-01')
      expect(decision.remediation_attempt).toBe(0)
    })

    it('returns remediate on second attempt (attempt 1 < max 2)', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
      ]

      const decision = reconcile(probeResults, anchors, 1, MAX_REMEDIATION)

      expect(decision.verdict).toBe('remediate')
      expect(decision.remediation_attempt).toBe(1)
    })
  })

  describe('Decision path 5: Block violations, attempt >= max -> escalate', () => {
    it('returns escalate when remediation attempts exhausted', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
      ]

      const decision = reconcile(probeResults, anchors, 2, MAX_REMEDIATION)

      expect(decision.verdict).toBe('escalate')
      expect(decision.violated_anchors).toContain('IA-01')
    })

    it('returns escalate when attempt exceeds max', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
      ]

      const decision = reconcile(probeResults, anchors, 5, MAX_REMEDIATION)

      expect(decision.verdict).toBe('escalate')
    })
  })

  describe('Mixed severity violations', () => {
    it('block takes precedence over warn: returns remediate on first attempt', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block' }),
        makeAnchor({ id: 'IA-02', severity: 'warn' }),
        makeAnchor({ id: 'IA-03', severity: 'log' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
        makeProbeResult({ anchor_id: 'IA-02', is_violation: true }),
        makeProbeResult({ anchor_id: 'IA-03', is_violation: true }),
      ]

      const decision = reconcile(probeResults, anchors, 0, MAX_REMEDIATION)

      expect(decision.verdict).toBe('remediate')
      expect(decision.violated_anchors).toContain('IA-01')
      expect(decision.violated_anchors).toContain('IA-02')
      expect(decision.violated_anchors).toContain('IA-03')
    })

    it('non-violated blocks with violated warns returns warn', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block' }),
        makeAnchor({ id: 'IA-02', severity: 'warn' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: false }),
        makeProbeResult({ anchor_id: 'IA-02', is_violation: true }),
      ]

      const decision = reconcile(probeResults, anchors, 0, MAX_REMEDIATION)

      expect(decision.verdict).toBe('warn')
    })
  })

  describe('GateDecision shape', () => {
    it('always includes probe_results and remediation_attempt', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'block' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-01', is_violation: false }),
      ]

      const decision = reconcile(probeResults, anchors, 0, MAX_REMEDIATION)

      expect(decision).toHaveProperty('verdict')
      expect(decision).toHaveProperty('violated_anchors')
      expect(decision).toHaveProperty('probe_results')
      expect(decision).toHaveProperty('remediation_attempt')
    })
  })

  describe('Unmatched anchor IDs', () => {
    it('ignores violations for anchor IDs not in the anchor list', () => {
      const anchors: IntentAnchor[] = [
        makeAnchor({ id: 'IA-01', severity: 'log' }),
      ]

      const probeResults: ProbeResult[] = [
        makeProbeResult({ anchor_id: 'IA-UNKNOWN', is_violation: true }),
      ]

      // Unmatched violation should not escalate — no severity lookup means ignored
      const decision = reconcile(probeResults, anchors, 0, MAX_REMEDIATION)

      expect(decision.verdict).toBe('pass')
    })
  })
})
