import type { NormalizedSignal } from "@factory/schemas"

export function deduplicateSignals(signals: NormalizedSignal[]): {
  kept: NormalizedSignal[]
  duplicates: string[]
} {
  const seen = new Map<string, NormalizedSignal>()
  const duplicates: string[] = []

  for (const s of signals) {
    if (!seen.has(s.dedupeKey)) {
      seen.set(s.dedupeKey, s)
    } else {
      duplicates.push(s.id)
    }
  }

  return {
    kept: [...seen.values()],
    duplicates,
  }
}
