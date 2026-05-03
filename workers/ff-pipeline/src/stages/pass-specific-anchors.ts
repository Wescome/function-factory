/**
 * Pass-specific anchor filtering.
 *
 * Filters IntentAnchors by their applicable_passes field.
 * Default: anchors with undefined applicable_passes apply to ['decompose'] only (C4).
 *
 * Traces to: DESIGN-CRYSTALLIZER-NEXT.md Priority 3
 */

import type { IntentAnchor } from './crystallize-intent'

/**
 * Filter anchors to only those applicable to the given pass.
 *
 * C4: applicable_passes defaults to ['decompose'], not undefined-means-all.
 */
export function filterAnchorsForPass(
  anchors: IntentAnchor[],
  passName: string,
): IntentAnchor[] {
  return anchors.filter(a =>
    (a.applicable_passes ?? ['decompose']).includes(passName),
  )
}
