import type { BusinessCapability, CapabilityDelta } from "@factory/schemas"
import type { RepoInventory } from "./types.js"

/**
 * Phase 0 scaffold only.
 */
export function evaluateDelta(
  capability: BusinessCapability,
  inventory: RepoInventory
): CapabilityDelta {
  void capability
  void inventory
  throw new Error(
    "Phase 0 scaffold only: evaluateDelta() is not implemented yet"
  )
}
