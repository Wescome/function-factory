import type { RepoInventory } from "./types.js"

/**
 * Phase 0 seam only.
 *
 * The first implementation accepts a structured inventory object produced by
 * fixtures or future repo-inspection tooling. No dynamic repo crawling happens
 * in Phase 0.
 */
export function validateInventory(inventory: RepoInventory): RepoInventory {
  return inventory
}
