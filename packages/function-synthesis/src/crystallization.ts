/**
 * Post-success crystallization check.
 *
 * On successful synthesis (Verifier pass), check if the execution path
 * contains a novel pattern not already captured by an existing invariant
 * or template. If so, propose a new reusable artifact.
 *
 * AC 18
 */

import { CrystallizationProposal, type SynthesisTraceLog } from "./types.js"

// ─── Known Pattern Registry (stub) ───────────────────────────────────

const KNOWN_PATTERNS = new Set<string>([
  "five-role-topology-linear",
  "single-pass-convergence",
  "repair-loop-with-critic-feedback",
])

/**
 * Check if the synthesis trace contains a novel pattern worth
 * crystallizing.
 *
 * This is a stub implementation that logs the check and returns null
 * (no novel patterns detected). Real implementation would analyze
 * the trace for structural patterns not in the registry.
 */
export function checkCrystallization(
  traceLog: SynthesisTraceLog,
): CrystallizationProposal | null {
  // Extract structural pattern from the trace
  const pattern = extractPattern(traceLog)

  if (KNOWN_PATTERNS.has(pattern)) {
    // No novel pattern — nothing to crystallize
    return null
  }

  // Novel pattern detected — propose crystallization
  return CrystallizationProposal.parse({
    synthesisRunId: traceLog.runId,
    pattern,
    proposedArtifactPath: `specs/crystallized/${traceLog.runId}-${pattern}.yaml`,
    sourceRefs: [traceLog.runId],
    timestamp: new Date().toISOString(),
  })
}

/**
 * Extract a pattern signature from a trace log.
 * Stub: returns a deterministic string based on trace structure.
 */
function extractPattern(traceLog: SynthesisTraceLog): string {
  const roleCount = new Set(traceLog.roleIterations.map((r: { role: string }) => r.role)).size
  const hasResample = traceLog.resampleBranches.length > 0
  const repairCount = traceLog.terminalDecision.repairLoopCount

  if (hasResample) {
    return `resample-${roleCount}-roles-${repairCount}-repairs`
  }
  if (repairCount > 0) {
    return "repair-loop-with-critic-feedback"
  }
  return "five-role-topology-linear"
}
