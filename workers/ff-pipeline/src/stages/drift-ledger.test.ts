/**
 * Drift Ledger Phase 3: Tests
 *
 * Validates:
 *   1. appendDriftEntry writes to ArangoDB compilation_drift_ledger collection
 *   2. appendDriftEntry is best-effort — never throws
 *   3. analyzeDrift computes violation rate, per-anchor stats, erosion trend
 *   4. detectErosion detects increasing violation rates across windows
 *   5. detectErosion returns safe defaults when not enough data
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mock cloudflare:workers (transitive dep) ───
vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  DurableObject: class {},
}))

vi.mock('agents', () => ({
  Agent: class {},
  callable: () => (t: unknown) => t,
}))

import { appendDriftEntry, analyzeDrift, detectErosion, type DriftEntry } from './drift-ledger'
import type { ArangoClient } from '@factory/arango-client'
import type { ProbeResult } from './reconciliation-gate'

// ── Helpers ──────────────────────────────────────────────────

function makeProbeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    anchor_id: 'IA-TEST-01',
    answer: 'yes',
    is_violation: false,
    pass_name: 'decompose',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

function makeDriftEntry(overrides: Partial<DriftEntry> = {}): DriftEntry {
  return {
    pipeline_id: 'wf-test-001',
    signal_id: 'SIG-TEST-001',
    pass_name: 'decompose',
    anchors_probed: ['IA-TEST-01', 'IA-TEST-02'],
    probe_results: [
      makeProbeResult({ anchor_id: 'IA-TEST-01', is_violation: false }),
      makeProbeResult({ anchor_id: 'IA-TEST-02', is_violation: false }),
    ],
    gate_verdict: 'pass',
    remediation_count: 0,
    probe_model: 'llama-70b',
    latency_ms: 150,
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe('Drift Ledger', () => {
  let mockDb: {
    save: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockDb = {
      save: vi.fn(async () => ({ _key: 'mock-drift-key' })),
    }
    vi.clearAllMocks()
  })

  describe('appendDriftEntry', () => {
    it('writes entry to compilation_drift_ledger collection', async () => {
      const entry = makeDriftEntry()
      await appendDriftEntry(entry, mockDb as unknown as ArangoClient)

      expect(mockDb.save).toHaveBeenCalledOnce()
      expect(mockDb.save).toHaveBeenCalledWith(
        'compilation_drift_ledger',
        expect.objectContaining({
          pipeline_id: 'wf-test-001',
          signal_id: 'SIG-TEST-001',
          pass_name: 'decompose',
          gate_verdict: 'pass',
        }),
      )
    })

    it('never throws — swallows DB errors (best-effort)', async () => {
      mockDb.save.mockRejectedValue(new Error('ArangoDB unavailable'))
      const entry = makeDriftEntry()

      // This must NOT throw
      await expect(appendDriftEntry(entry, mockDb as unknown as ArangoClient)).resolves.toBeUndefined()
    })

    it('includes all required fields in the saved document', async () => {
      const entry = makeDriftEntry({
        pipeline_id: 'wf-123',
        signal_id: 'SIG-456',
        pass_name: 'invariant',
        gate_verdict: 'remediate',
        remediation_count: 1,
        probe_model: 'llama-70b',
        latency_ms: 320,
      })

      await appendDriftEntry(entry, mockDb as unknown as ArangoClient)

      const savedDoc = mockDb.save.mock.calls[0]![1] as Record<string, unknown>
      expect(savedDoc.pipeline_id).toBe('wf-123')
      expect(savedDoc.signal_id).toBe('SIG-456')
      expect(savedDoc.pass_name).toBe('invariant')
      expect(savedDoc.gate_verdict).toBe('remediate')
      expect(savedDoc.remediation_count).toBe(1)
      expect(savedDoc.probe_model).toBe('llama-70b')
      expect(savedDoc.latency_ms).toBe(320)
      expect(savedDoc.timestamp).toBeDefined()
      expect(savedDoc.anchors_probed).toBeDefined()
      expect(savedDoc.probe_results).toBeDefined()
    })
  })

  describe('analyzeDrift', () => {
    it('returns zeroed stats for empty entries', () => {
      const result = analyzeDrift([])

      expect(result.total_entries).toBe(0)
      expect(result.total_probes).toBe(0)
      expect(result.total_violations).toBe(0)
      expect(result.violation_rate).toBe(0)
      expect(result.per_pass_stats).toEqual({})
      expect(result.most_violated_anchors).toEqual([])
    })

    it('computes violation rate across all entries', () => {
      const entries: DriftEntry[] = [
        makeDriftEntry({
          probe_results: [
            makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
            makeProbeResult({ anchor_id: 'IA-02', is_violation: false }),
          ],
        }),
        makeDriftEntry({
          probe_results: [
            makeProbeResult({ anchor_id: 'IA-01', is_violation: false }),
            makeProbeResult({ anchor_id: 'IA-02', is_violation: true }),
          ],
        }),
      ]

      const result = analyzeDrift(entries)

      expect(result.total_entries).toBe(2)
      expect(result.total_probes).toBe(4)
      expect(result.total_violations).toBe(2)
      expect(result.violation_rate).toBe(0.5)
    })

    it('computes per-pass violation stats', () => {
      const entries: DriftEntry[] = [
        makeDriftEntry({
          pass_name: 'decompose',
          probe_results: [
            makeProbeResult({ is_violation: true }),
            makeProbeResult({ is_violation: false }),
          ],
        }),
        makeDriftEntry({
          pass_name: 'dependency',
          probe_results: [
            makeProbeResult({ is_violation: false }),
          ],
        }),
        makeDriftEntry({
          pass_name: 'decompose',
          probe_results: [
            makeProbeResult({ is_violation: true }),
          ],
        }),
      ]

      const result = analyzeDrift(entries)

      expect(result.per_pass_stats.decompose).toBeDefined()
      expect(result.per_pass_stats.decompose!.probes).toBe(3)
      expect(result.per_pass_stats.decompose!.violations).toBe(2)
      expect(result.per_pass_stats.dependency).toBeDefined()
      expect(result.per_pass_stats.dependency!.probes).toBe(1)
      expect(result.per_pass_stats.dependency!.violations).toBe(0)
    })

    it('identifies most violated anchors sorted by violation count', () => {
      const entries: DriftEntry[] = [
        makeDriftEntry({
          probe_results: [
            makeProbeResult({ anchor_id: 'IA-A', is_violation: true }),
            makeProbeResult({ anchor_id: 'IA-B', is_violation: false }),
            makeProbeResult({ anchor_id: 'IA-C', is_violation: true }),
          ],
        }),
        makeDriftEntry({
          probe_results: [
            makeProbeResult({ anchor_id: 'IA-A', is_violation: true }),
            makeProbeResult({ anchor_id: 'IA-B', is_violation: true }),
            makeProbeResult({ anchor_id: 'IA-C', is_violation: true }),
          ],
        }),
      ]

      const result = analyzeDrift(entries)

      // IA-A: 2 violations / 2 total
      // IA-C: 2 violations / 2 total
      // IA-B: 1 violation / 2 total
      expect(result.most_violated_anchors).toHaveLength(3)
      // Sorted by violations descending
      expect(result.most_violated_anchors[0]!.id).toBe('IA-A')
      expect(result.most_violated_anchors[0]!.violations).toBe(2)
      expect(result.most_violated_anchors[2]!.id).toBe('IA-B')
      expect(result.most_violated_anchors[2]!.violations).toBe(1)
    })
  })

  describe('detectErosion', () => {
    it('returns safe defaults when not enough data for two windows', () => {
      const entries = [makeDriftEntry()]

      const result = detectErosion(entries, 3)

      expect(result.eroding).toBe(false)
      expect(result.early_violation_rate).toBe(0)
      expect(result.late_violation_rate).toBe(0)
      expect(result.delta).toBe(0)
    })

    it('detects erosion when late window has significantly higher violation rate', () => {
      // Early entries: no violations
      const earlyEntries = Array.from({ length: 5 }, (_, i) =>
        makeDriftEntry({
          pipeline_id: `wf-early-${i}`,
          probe_results: [
            makeProbeResult({ anchor_id: 'IA-01', is_violation: false }),
            makeProbeResult({ anchor_id: 'IA-02', is_violation: false }),
          ],
        }),
      )

      // Late entries: high violation rate
      const lateEntries = Array.from({ length: 5 }, (_, i) =>
        makeDriftEntry({
          pipeline_id: `wf-late-${i}`,
          probe_results: [
            makeProbeResult({ anchor_id: 'IA-01', is_violation: true }),
            makeProbeResult({ anchor_id: 'IA-02', is_violation: true }),
          ],
        }),
      )

      const result = detectErosion([...earlyEntries, ...lateEntries], 5)

      expect(result.eroding).toBe(true)
      expect(result.early_violation_rate).toBe(0)
      expect(result.late_violation_rate).toBe(1)
      expect(result.delta).toBe(1)
    })

    it('reports no erosion when violation rates are stable', () => {
      // All entries have the same violation pattern
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeDriftEntry({
          pipeline_id: `wf-${i}`,
          probe_results: [
            makeProbeResult({ anchor_id: 'IA-01', is_violation: false }),
            makeProbeResult({ anchor_id: 'IA-02', is_violation: true }),
          ],
        }),
      )

      const result = detectErosion(entries, 5)

      expect(result.eroding).toBe(false)
      expect(result.early_violation_rate).toBe(0.5)
      expect(result.late_violation_rate).toBe(0.5)
      expect(result.delta).toBe(0)
    })

    it('uses default windowSize of 5', () => {
      // Only 8 entries — less than 2 * default window (10)
      const entries = Array.from({ length: 8 }, () => makeDriftEntry())

      const result = detectErosion(entries)

      // Not enough data for two windows of default size 5
      expect(result.eroding).toBe(false)
      expect(result.early_violation_rate).toBe(0)
      expect(result.late_violation_rate).toBe(0)
    })

    it('uses default windowSize to detect erosion when enough data', () => {
      const early = Array.from({ length: 5 }, () =>
        makeDriftEntry({
          probe_results: [makeProbeResult({ is_violation: false })],
        }),
      )
      const late = Array.from({ length: 5 }, () =>
        makeDriftEntry({
          probe_results: [makeProbeResult({ is_violation: true })],
        }),
      )

      const result = detectErosion([...early, ...late])

      expect(result.eroding).toBe(true)
    })
  })
})
