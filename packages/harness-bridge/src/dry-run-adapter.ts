/**
 * Reference HarnessAdapter- dry-run. Accepts any schema-conformant
 * WorkGraphNode, invokes no runtime, returns status `simulated` with
 * a rationale naming the node type. Per PRD-META-HARNESS-EXECUTE
 * Operational constraint section. Used as the baseline adapter before
 * real runtimes (claude-code, cursor, shell-exec) land as separate
 * Functions.
 */

import type { HarnessAdapter } from "./types.js"

export const dryRunAdapter: HarnessAdapter = {
  id: "dry-run",
  async execute(node) {
    return {
      status: "simulated",
      rationale: `dry-run adapter simulated ${node.type} node ${node.id}`,
    }
  },
}
