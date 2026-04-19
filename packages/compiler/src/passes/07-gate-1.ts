/**
 * Pass 7- Gate 1.
 *
 * Adapts compiler intermediates into the shape `runGate1` consumes,
 * determines Factory mode from the PRD ID (or from an explicit
 * override), invokes Gate 1, and emits the Coverage Report to disk.
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
 * Gate 1 logic itself; this pass passes it through.
 */

import type { ArtifactId, Gate1Report } from "@factory/schemas"
import { runGate1, emitGate1Report } from "@factory/coverage-gates"
import type { Gate1Input } from "@factory/coverage-gates"
import type { CompilerIntermediates, FactoryMode } from "../types.js"

export interface Gate1PassResult {
  readonly report: Gate1Report
  readonly reportPath: string
}

export async function runGate1Pass(
  intermediates: CompilerIntermediates,
  mode: FactoryMode,
  timestamp: string,
  coverageReportsDir: string
): Promise<Gate1PassResult> {
  const input: Gate1Input = {
    prdId: intermediates.prd.id,
    mode,
    atoms: intermediates.atoms,
    contracts: intermediates.contracts,
    invariants: intermediates.invariants,
    dependencies: intermediates.dependencies,
    validations: intermediates.validations,
  }

  const report = runGate1(input, timestamp)
  const reportPath = await emitGate1Report(report, coverageReportsDir)
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
