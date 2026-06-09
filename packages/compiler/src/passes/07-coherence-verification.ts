/**
 * Completeness Certification / Coherence Verification.
 *
 * Adapts compiler intermediates into the shape `runCoherenceVerification` consumes,
 * determines Factory mode from the Intent Specification ID (or from an explicit
 * override), invokes Coherence Verification, and emits the Verification Report to disk.
 *
 * Mode determination- a Intent Specification ID matching `^IS-META-` compiles in
 * bootstrap mode, where the fifth coverage check (META- prefix
 * enforcement) runs. Any other Intent Specification ID compiles in steady_state mode.
 * The orchestrator can override this default via an explicit mode
 * argument (e.g., to test bootstrap behavior on a non-meta Intent Specification).
 *
 * Emission- the report is written to
 * `<verificationReportsDir>/VR-<IS-ID>-COHERENCE-<timestamp>.yaml`. The
 * timestamp is supplied by the orchestrator to preserve purity of the
 * Coherence Verification logic itself; this pass passes it through.
 */

import type { ArtifactId, CoherenceVerificationReport } from "@factory/schemas"
import {
  emitCoherenceVerificationReport,
  runCoherenceVerification,
} from "@factory/verification"
import type { CoherenceVerificationInput } from "@factory/verification"
import type { CompilerIntermediates, FactoryMode } from "../types.js"

export interface CoherenceVerificationPassResult {
  readonly report: CoherenceVerificationReport
  readonly reportPath: string
}

export async function runCoherenceVerificationPass(
  intermediates: CompilerIntermediates,
  mode: FactoryMode,
  timestamp: string,
  verificationReportsDir: string
): Promise<CoherenceVerificationPassResult> {
  const input: CoherenceVerificationInput = {
    intentSpecificationId: intermediates.intentSpecification.id,
    mode,
    atoms: intermediates.atoms,
    contracts: intermediates.contracts,
    invariants: intermediates.invariants,
    dependencies: intermediates.dependencies,
    validations: intermediates.validations,
  }

  const report = runCoherenceVerification(input, timestamp)
  const reportPath = await emitCoherenceVerificationReport(report, verificationReportsDir)
  return { report, reportPath }
}

/**
 * Determine Factory mode from Intent Specification ID. Intent Specifications whose ID starts with
 * "IS-META-" compile in bootstrap mode; all others compile in
 * steady_state. The orchestrator can override this via an explicit
 * mode parameter.
 */
export function determineMode(intentSpecificationId: ArtifactId): FactoryMode {
  return intentSpecificationId.startsWith("IS-META-") ? "bootstrap" : "steady_state"
}
