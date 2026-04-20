/**
 * Deterministic DEL-* ID helper for Phase 0.
 */
export function capabilityDeltaId(capabilityId: string): string {
  return capabilityId.replace(/^BC-/, "DEL-")
}
