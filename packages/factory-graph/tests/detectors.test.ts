/**
 * detectors.test.ts — Unit tests for factoryDivergenceDetector
 *
 * Tests per tasks.md Step 30:
 * - null trace → returns []
 * - severity 'critical' firing → DetectedDivergence.severity === 'critical'
 * - severity 'warning' firing → 'medium'
 * - unknown severity → 'low'
 * - outcome: 'failure' + attempts_exhausted: true → adds 'high' divergence
 * - outcome: 'timeout' + attempts_exhausted: true → adds 'high' divergence
 * - empty detector_firings + successful outcome → returns []
 */
import { describe, it, expect } from 'vitest';
import { factoryDivergenceDetector } from '../src/detectors.js';
import type { ArtifactGraphDOBase } from '@factory/artifact-graph';
import type { ArtifactNode } from '@factory/artifact-graph';
import type { TraceFragmentData } from '../src/types.js';

// ── Minimal ArtifactGraphDOBase stub ─────────────────────────────────────

function makeArtifactGraphStub(traceData: TraceFragmentData | null): ArtifactGraphDOBase<unknown> {
  return {
    getNode: async (_id: string): Promise<ArtifactNode | null> => {
      if (traceData === null) return null;
      return {
        id:      'trace-test',
        type:    'ExecutionTrace',
        data:    traceData as unknown as Record<string, unknown>,
        ns:      'factory',
        created: Date.now(),
        updated: Date.now(),
      };
    },
  } as unknown as ArtifactGraphDOBase<unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('factoryDivergenceDetector', () => {
  it('returns [] when the trace node does not exist', async () => {
    const stub = makeArtifactGraphStub(null);
    const result = await factoryDivergenceDetector('trace-missing', 'spec-1', stub);
    expect(result).toEqual([]);
  });

  it('maps severity "critical" to "critical"', async () => {
    const traceData: TraceFragmentData = {
      atom_id:            'atom-1',
      outcome:            'success',
      attempts_exhausted: false,
      detector_firings:   [{ inv_id: 'INV-001', severity: 'critical', message: 'type violation' }],
    };
    const stub = makeArtifactGraphStub(traceData);
    const result = await factoryDivergenceDetector('trace-1', 'spec-1', stub);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('critical');
    expect(result[0]?.claimId).toBe('INV-001');
  });

  it('maps severity "warning" to "medium"', async () => {
    const traceData: TraceFragmentData = {
      atom_id:            'atom-2',
      outcome:            'success',
      attempts_exhausted: false,
      detector_firings:   [{ inv_id: 'INV-002', severity: 'warning', message: 'partial match' }],
    };
    const stub = makeArtifactGraphStub(traceData);
    const result = await factoryDivergenceDetector('trace-2', 'spec-1', stub);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('medium');
  });

  it('maps unknown severity to "low"', async () => {
    const traceData: TraceFragmentData = {
      atom_id:            'atom-3',
      outcome:            'success',
      attempts_exhausted: false,
      detector_firings:   [{ inv_id: 'INV-003', severity: 'info', message: 'minor note' }],
    };
    const stub = makeArtifactGraphStub(traceData);
    const result = await factoryDivergenceDetector('trace-3', 'spec-1', stub);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('low');
  });

  it('adds high divergence when outcome=failure and attempts_exhausted=true', async () => {
    const traceData: TraceFragmentData = {
      atom_id:            'atom-42',
      outcome:            'failure',
      attempts_exhausted: true,
      detector_firings:   [],
    };
    const stub = makeArtifactGraphStub(traceData);
    const result = await factoryDivergenceDetector('trace-4', 'spec-1', stub);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('high');
    expect(result[0]?.claimId).toBe('claim-atom-outcome-atom-42');
  });

  it('adds high divergence when outcome=timeout and attempts_exhausted=true', async () => {
    const traceData: TraceFragmentData = {
      atom_id:            'atom-99',
      outcome:            'timeout',
      attempts_exhausted: true,
      detector_firings:   [],
    };
    const stub = makeArtifactGraphStub(traceData);
    const result = await factoryDivergenceDetector('trace-5', 'spec-1', stub);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('high');
    expect(result[0]?.claimId).toBe('claim-atom-timeout-atom-99');
  });

  it('returns [] when detector_firings is empty and outcome is success', async () => {
    const traceData: TraceFragmentData = {
      atom_id:            'atom-7',
      outcome:            'success',
      attempts_exhausted: false,
      detector_firings:   [],
    };
    const stub = makeArtifactGraphStub(traceData);
    const result = await factoryDivergenceDetector('trace-6', 'spec-1', stub);
    expect(result).toEqual([]);
  });
});
