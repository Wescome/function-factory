import type { NormalizedSignal } from "@factory/schemas"
import { SIGNAL_WEIGHT_CAP_BY_KIND } from "./policies.js"

export function weightSignals(signals: NormalizedSignal[]): NormalizedSignal[] {
  return signals.map((s) => {
    const raw = s.confidence * s.severity * s.trustScore
    const capped = Math.min(raw, SIGNAL_WEIGHT_CAP_BY_KIND[s.kind])

    return {
      ...s,
      effectiveWeight: Number(capped.toFixed(4)),
    }
  })
}
