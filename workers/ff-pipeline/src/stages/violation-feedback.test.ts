/**
 * Priority 2: Violation feedback in remediation tests (TDD RED phase).
 *
 * Verifies:
 *   1. buildViolationFeedback extracts block-severity anchor claims only
 *   2. Caps at max 6 claims
 *   3. Truncates to first 3 claims when serialized > 500 tokens
 *   4. Returns undefined when no block-severity violations exist
 *   5. Returns undefined when no violated anchors provided
 */

import { describe, it, expect } from 'vitest'
import {
  buildViolationFeedback,
  type ViolationFeedback,
} from './violation-feedback'
import type { IntentAnchor } from './crystallize-intent'

// ── Helpers ────────────────────────────────────────────────────

function makeAnchor(id: string, severity: 'block' | 'warn' | 'log', claim: string): IntentAnchor {
  return {
    id,
    signal_id: 'SIG-TEST',
    claim,
    probe_question: `Does output address: ${claim}?`,
    violation_signal: 'no',
    severity,
    times_probed: 0,
    times_violated: 0,
  }
}

// ── Tests ──────────────────────────────────────────────────────

describe('buildViolationFeedback', () => {
  it('extracts only block-severity anchor claims', () => {
    const anchors: IntentAnchor[] = [
      makeAnchor('IA-01', 'block', 'Signal must define LifecycleState'),
      makeAnchor('IA-02', 'warn', 'Types should be exported'),
      makeAnchor('IA-03', 'block', 'Signal must define LifecycleTransition'),
      makeAnchor('IA-04', 'log', 'Minor naming convention'),
    ]
    const violatedIds = ['IA-01', 'IA-02', 'IA-03', 'IA-04']

    const feedback = buildViolationFeedback(violatedIds, anchors)

    expect(feedback).toBeDefined()
    expect(feedback!.violatedClaims).toEqual([
      'Signal must define LifecycleState',
      'Signal must define LifecycleTransition',
    ])
  })

  it('caps at max 6 claims', () => {
    const anchors: IntentAnchor[] = Array.from({ length: 10 }, (_, i) =>
      makeAnchor(`IA-${i}`, 'block', `Block claim ${i}`),
    )
    const violatedIds = anchors.map(a => a.id)

    const feedback = buildViolationFeedback(violatedIds, anchors)

    expect(feedback).toBeDefined()
    expect(feedback!.violatedClaims.length).toBeLessThanOrEqual(6)
  })

  it('truncates to first 3 claims when serialized exceeds 500 tokens', () => {
    // Each claim ~200 chars = ~50 tokens. 7 block claims * 50 = 350 tokens
    // plus message + instruction overhead. Make claims long enough to exceed.
    const longClaim = 'A'.repeat(400) // ~100 tokens each
    const anchors: IntentAnchor[] = Array.from({ length: 6 }, (_, i) =>
      makeAnchor(`IA-${i}`, 'block', `${longClaim} claim-${i}`),
    )
    const violatedIds = anchors.map(a => a.id)

    const feedback = buildViolationFeedback(violatedIds, anchors)

    expect(feedback).toBeDefined()
    expect(feedback!.violatedClaims.length).toBeLessThanOrEqual(3)
  })

  it('returns undefined when no block-severity violations exist', () => {
    const anchors: IntentAnchor[] = [
      makeAnchor('IA-01', 'warn', 'Types should be exported'),
      makeAnchor('IA-02', 'log', 'Minor naming convention'),
    ]
    const violatedIds = ['IA-01', 'IA-02']

    const feedback = buildViolationFeedback(violatedIds, anchors)

    expect(feedback).toBeUndefined()
  })

  it('returns undefined when violatedIds is empty', () => {
    const anchors: IntentAnchor[] = [
      makeAnchor('IA-01', 'block', 'Signal must define LifecycleState'),
    ]

    const feedback = buildViolationFeedback([], anchors)

    expect(feedback).toBeUndefined()
  })

  it('returns undefined when no anchors match violated IDs', () => {
    const anchors: IntentAnchor[] = [
      makeAnchor('IA-01', 'block', 'Signal must define LifecycleState'),
    ]

    const feedback = buildViolationFeedback(['IA-UNKNOWN'], anchors)

    expect(feedback).toBeUndefined()
  })

  it('feedback has correct message and instruction fields', () => {
    const anchors: IntentAnchor[] = [
      makeAnchor('IA-01', 'block', 'Signal must define LifecycleState'),
    ]
    const violatedIds = ['IA-01']

    const feedback = buildViolationFeedback(violatedIds, anchors)

    expect(feedback).toBeDefined()
    expect(typeof feedback!.message).toBe('string')
    expect(typeof feedback!.instruction).toBe('string')
    expect(feedback!.message.length).toBeGreaterThan(0)
    expect(feedback!.instruction.length).toBeGreaterThan(0)
  })
})
