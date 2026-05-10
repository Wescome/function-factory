/**
 * Completeness Certification / Coherence Verification.
 *
 * Adapts compiler intermediates into the shape `runCoherenceVerification` consumes,
 * determines Factory mode from the PRD ID (or from an explicit
 * override), invokes Coherence Verification, and emits the Coverage Report to disk.
 *
 * Mode determination- a PRD ID matching `^PRD-META-` compiles in
 * bootstrap mode, where the fifth coverage check (META- prefix
 * enforcement) runs. Any other PRD ID compiles in steady_state mode.
 * The orchestrator can override this default via an explicit mode
 * argument (e.g., to test bootstrap behavior on a non-meta PRD).
 *
 * Emission- the report is written to
 * `<coverageReportsDir>/CR-<PRD-ID>-GATE1-<timestamp>.yaml`. The
 * timestamp is supplied by the orchestrator to preserve purity of the
 * Coherence Verification logic itself; this pass passes it through.
 */

import type { ArtifactId, CoherenceVerificationReport } from "@factory/schemas"
import {
  emitCoherenceVerificationReport,
  runCoherenceVerification,
} from "@factory/coverage-gates"
import type { CoherenceVerificationInput } from "@factory/coverage-gates"
import type { CompilerIntermediates, FactoryMode } from "../types.js"

export interface CoherenceVerificationPassResult {
  readonly report: CoherenceVerificationReport
  readonly reportPath: string
}

export async function runCoherenceVerificationPass(
  intermediates: CompilerIntermediates,
  mode: FactoryMode,
  timestamp: string,
  coverageReportsDir: string
): Promise<CoherenceVerificationPassResult> {
  const input: CoherenceVerificationInput = {
    prdId: intermediates.prd.id,
    mode,
    atoms: intermediates.atoms,
    contracts: intermediates.contracts,
    invariants: intermediates.invariants,
    dependencies: intermediates.dependencies,
    validations: intermediates.validations,
  }

  const report = runCoherenceVerification(input, timestamp)
  const reportPath = await emitCoherenceVerificationReport(report, coverageReportsDir)
  return { report, reportPath }
}

/**
 * Determine Factory mode from PRD ID. PRDs whose ID starts with
 * "PRD-META-" compile in bootstrap mode; all others compile in
 * steady_state. The orchestrator can override this via an explicit
 * mode parameter.
 */
export function determineMode(prdId: ArtifactId): FactoryMode {
  return prdId.startsWith("PRD-META-") ? "bootstrap" : "steady_state"
}
