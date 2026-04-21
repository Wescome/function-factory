import type { NormalizedSignal } from "@factory/schemas"
import { SIGNAL_TRUST_BY_KIND } from "./policies.js"

export function normalizeSignals(signals: Array<{
  id: string
  kind: "external" | "feedback" | "inferred"
  title: string
  source: string
  confidence: number
  severity: number
}>): NormalizedSignal[] {
  return signals.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title.trim(),
    source: s.source.trim(),
    confidence: s.confidence,
    severity: s.severity,
    trustScore: SIGNAL_TRUST_BY_KIND[s.kind],
    effectiveWeight: 0,
    dedupeKey: `${s.kind}::${s.title.trim().toLowerCase()}::${s.source.trim().toLowerCase()}`,
  }))
}
