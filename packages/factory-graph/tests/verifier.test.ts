/**
 * verifier.test.ts — Unit tests for factoryAmendmentVerifier
 *
 * Tests per tasks.md Step 32:
 * - coherenceScore = 0.60 → passed: false, gate: 'compile'
 * - coherenceScore = 0.80, patternScore = 0.60 → passed: true
 * - coherenceScore = 0.80, patternScore = 0.40 → passed: false
 * - coherenceScore = 0.68 → patternScore not called (cross-repo scan skipped)
 * - coherenceScore = 0.71 → cross-repo scan triggered
 */
import { describe, it, expect, vi } from 'vitest';
import { createFactoryAmendmentVerifier } from '../src/verifier.js';
import type { ArtifactGraphDOBase, ArtifactNode } from '@factory/artifact-graph';

// ── Minimal ArtifactGraphDOBase stub ─────────────────────────────────────

function makeArtifactGraphStub(): ArtifactGraphDOBase<unknown> {
  return {
    getNode: async (id: string): Promise<ArtifactNode | null> => {
      if (id === 'amd-test') {
        return {
          id:      'amd-test',
          type:    'Amendment',
          data:    { proposed_change: { change: 'fix' }, status: 'candidate' } as unknown as Record<string, unknown>,
          ns:      'factory',
          created: Date.now(),
          updated: Date.now(),
        };
      }
      return null;
    },
    walkBoundedPath: async () => [],
    getEdgesTo:      async () => [],
    getEdgesFrom:    async () => [],
  } as unknown as ArtifactGraphDOBase<unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('factoryAmendmentVerifier', () => {
  it('returns passed:false when coherenceScore=0.60', async () => {
    const verifier = createFactoryAmendmentVerifier({
      evaluateCoherence: () => 0.60,
    });
    const result = await verifier('amd-test', {}, makeArtifactGraphStub());
    expect(result.passed).toBe(false);
    expect(result.gate).toBe('compile');
  });

  it('returns passed:true when coherenceScore=0.80 and patternScore=0.60', async () => {
    const mockArchitectAgentDO = {
      checkCrossRepoPattern: vi.fn().mockResolvedValue(0.60),
    };
    const verifier = createFactoryAmendmentVerifier({
      evaluateCoherence: () => 0.80,
      architectAgentDO:  mockArchitectAgentDO,
    });
    const result = await verifier('amd-test', {}, makeArtifactGraphStub());
    expect(result.passed).toBe(true);
    expect(mockArchitectAgentDO.checkCrossRepoPattern).toHaveBeenCalledOnce();
  });

  it('returns passed:false when coherenceScore=0.80 and patternScore=0.40', async () => {
    const mockArchitectAgentDO = {
      checkCrossRepoPattern: vi.fn().mockResolvedValue(0.40),
    };
    const verifier = createFactoryAmendmentVerifier({
      evaluateCoherence: () => 0.80,
      architectAgentDO:  mockArchitectAgentDO,
    });
    const result = await verifier('amd-test', {}, makeArtifactGraphStub());
    expect(result.passed).toBe(false);
  });

  it('does not call patternScore when coherenceScore=0.68 (below 0.7 threshold)', async () => {
    const mockArchitectAgentDO = {
      checkCrossRepoPattern: vi.fn().mockResolvedValue(0.90),
    };
    const verifier = createFactoryAmendmentVerifier({
      evaluateCoherence: () => 0.68,
      architectAgentDO:  mockArchitectAgentDO,
    });
    const result = await verifier('amd-test', {}, makeArtifactGraphStub());
    // coherenceScore 0.68 < 0.75 → passed: false; cross-repo scan skipped
    expect(result.passed).toBe(false);
    expect(mockArchitectAgentDO.checkCrossRepoPattern).not.toHaveBeenCalled();
  });

  it('triggers cross-repo scan when coherenceScore=0.71 (above 0.7 threshold)', async () => {
    const mockArchitectAgentDO = {
      checkCrossRepoPattern: vi.fn().mockResolvedValue(0.80),
    };
    const verifier = createFactoryAmendmentVerifier({
      evaluateCoherence: () => 0.71,
      architectAgentDO:  mockArchitectAgentDO,
    });
    await verifier('amd-test', {}, makeArtifactGraphStub());
    expect(mockArchitectAgentDO.checkCrossRepoPattern).toHaveBeenCalledOnce();
  });
});
