/**
 * ExecutionLog emission- Stage 6's disk-write side effect.
 *
 * Parallel to coverage-gates/src/emit.ts- pure/IO split. The orchestrator
 * (execute.ts) produces a validated ExecutionLog; this module writes it
 * to disk. Filename convention per PRD AC 11-
 *   <executionLogsDir>/<log.id>.yaml
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { stringify as stringifyYaml } from "yaml"
import type { ExecutionLog } from "@factory/schemas"

export async function emitExecutionLog(
  log: ExecutionLog,
  executionLogsDir: string
): Promise<string> {
  await mkdir(executionLogsDir, { recursive: true })
  const filename = `${log.id}.yaml`
  const filepath = join(executionLogsDir, filename)
  const yaml = stringifyYaml(log)
  await writeFile(filepath, yaml, "utf8")
  return filepath
}
