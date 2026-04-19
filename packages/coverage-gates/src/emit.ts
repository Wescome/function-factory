/**
 * Gate 1 Coverage Report emission.
 *
 * Writes a Gate1Report to disk as YAML. Side-effect-bearing module,
 * separated from the pure orchestrator in gate-1.ts per PREFERENCES.md
 * ("Pure functions wherever possible; side effects confined to named
 * integration modules").
 *
 * Filename convention per coverage-gate-1 SKILL.md-
 * `<coverageReportsDir>/CR-<PRD-ID>-GATE1-<timestamp>.yaml`
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { stringify as stringifyYaml } from "yaml"
import type { Gate1Report } from "@factory/schemas"

/**
 * Emit a Gate1Report to disk as YAML, creating the destination directory
 * if it does not exist.
 *
 * @param report - The validated Gate1Report to write.
 * @param coverageReportsDir - Destination directory (typically
 *                             `<repo>/specs/coverage-reports`).
 * @returns The path to the written file.
 */
export async function emitGate1Report(
  report: Gate1Report,
  coverageReportsDir: string
): Promise<string> {
  await mkdir(coverageReportsDir, { recursive: true })
  const filename = `${report.id}.yaml`
  const filepath = join(coverageReportsDir, filename)
  const yaml = stringifyYaml(report)
  await writeFile(filepath, yaml, "utf8")
  return filepath
}
