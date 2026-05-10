/**
 * Coherence Verification report emission.
 *
 * Writes a CoherenceVerificationReport to disk as YAML. Side-effect-bearing module,
 * separated from the pure orchestrator in coherence-verification.ts per
 * PREFERENCES.md
 * ("Pure functions wherever possible; side effects confined to named
 * integration modules").
 *
 * Filename convention:
 * `<verificationReportsDir>/<report-id>.yaml`
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { stringify as stringifyYaml } from "yaml"
import type { CoherenceVerificationReport } from "@factory/schemas"

/**
 * Emit a CoherenceVerificationReport to disk as YAML, creating the destination directory
 * if it does not exist.
 *
 * @param report - The validated CoherenceVerificationReport to write.
 * @param verificationReportsDir - Destination directory (typically
 *                             `<repo>/specs/verification-reports`).
 * @returns The path to the written file.
 */
export async function emitCoherenceVerificationReport(
  report: CoherenceVerificationReport,
  verificationReportsDir: string
): Promise<string> {
  await mkdir(verificationReportsDir, { recursive: true })
  const filename = `${report.id}.yaml`
  const filepath = join(verificationReportsDir, filename)
  const yaml = stringifyYaml(report)
  await writeFile(filepath, yaml, "utf8")
  return filepath
}
