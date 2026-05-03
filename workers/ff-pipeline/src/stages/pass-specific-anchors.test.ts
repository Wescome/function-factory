/**
 * Priority 3: Pass-specific anchor filtering tests (TDD RED phase).
 *
 * Verifies:
 *   1. filterAnchorsForPass returns only anchors whose applicable_passes includes passName
 *   2. Anchors with undefined applicable_passes default to ['decompose'] (C4)
 *   3. Anchors with explicit applicable_passes are respected
 *   4. Returns empty array when no anchors match the pass
 *   5. Returns all defaulting anchors for 'decompose' pass
 */

import { describe, it, expect } from 'vitest'
import { filterAnchorsForPass } from './pass-specific-anchors'
import type { IntentAnchor } from './crystallize-intent'

// ── Helpers ────────────────────────────────────────────────────

function makeAnchor(
  id: string,
  applicablePasses?: string[],
): IntentAnchor {
  return {
    id,
    signal_id: 'SIG-TEST',
    claim: `Claim for ${id}`,
    probe_question: `Is ${id} addressed?`,
    violation_signal: 'no',
    severity: 'block',
    times_probed: 0,
    times_violated: 0,
    applicable_passes: applicablePasses,
  } as IntentAnchor
}

// ── Tests ──────────────────────────────────────────────────────

describe('filterAnchorsForPass', () => {
  it('returns anchors whose applicable_passes includes the passName', () => {
    const anchors = [
      makeAnchor('IA-01', ['decompose', 'dependency']),
      makeAnchor('IA-02', ['invariant']),
      makeAnchor('IA-03', ['decompose']),
    ]

    const result = filterAnchorsForPass(anchors, 'decompose')
    expect(result.map(a => a.id)).toEqual(['IA-01', 'IA-03'])
  })

  it('defaults to ["decompose"] when applicable_passes is undefined (C4)', () => {
    const anchors = [
      makeAnchor('IA-01'), // undefined -> defaults to ['decompose']
      makeAnchor('IA-02', ['dependency']),
    ]

    const result = filterAnchorsForPass(anchors, 'decompose')
    expect(result.map(a => a.id)).toEqual(['IA-01'])
  })

  it('undefined applicable_passes does NOT match non-decompose passes', () => {
    const anchors = [
      makeAnchor('IA-01'), // undefined -> defaults to ['decompose']
    ]

    const result = filterAnchorsForPass(anchors, 'dependency')
    expect(result).toEqual([])
  })

  it('returns empty array when no anchors match the pass', () => {
    const anchors = [
      makeAnchor('IA-01', ['decompose']),
      makeAnchor('IA-02', ['decompose']),
    ]

    const result = filterAnchorsForPass(anchors, 'invariant')
    expect(result).toEqual([])
  })

  it('returns all defaulting anchors for decompose pass', () => {
    const anchors = [
      makeAnchor('IA-01'),
      makeAnchor('IA-02'),
      makeAnchor('IA-03'),
    ]

    const result = filterAnchorsForPass(anchors, 'decompose')
    expect(result.length).toBe(3)
  })

  it('filters correctly for dependency pass', () => {
    const anchors = [
      makeAnchor('IA-01', ['decompose', 'dependency']),
      makeAnchor('IA-02', ['dependency', 'invariant']),
      makeAnchor('IA-03', ['decompose']),
    ]

    const result = filterAnchorsForPass(anchors, 'dependency')
    expect(result.map(a => a.id)).toEqual(['IA-01', 'IA-02'])
  })

  it('filters correctly for invariant pass', () => {
    const anchors = [
      makeAnchor('IA-01', ['decompose']),
      makeAnchor('IA-02', ['invariant']),
      makeAnchor('IA-03', ['decompose', 'dependency', 'invariant']),
    ]

    const result = filterAnchorsForPass(anchors, 'invariant')
    expect(result.map(a => a.id)).toEqual(['IA-02', 'IA-03'])
  })

  it('handles empty anchors array', () => {
    const result = filterAnchorsForPass([], 'decompose')
    expect(result).toEqual([])
  })
})
