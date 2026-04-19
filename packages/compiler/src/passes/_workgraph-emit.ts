/**
 * WorkGraph emission IO wrapper.
 *
 * Separated from Pass 8's pure assembly so the pure function remains
 * testable without filesystem side effects. Same separation pattern
 * as packages/coverage-gates/src/emit.ts.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { stringify as stringifyYaml } from "yaml"
import type { WorkGraph } from "@factory/schemas"

export async function emitWorkgraph(
  workgraph: WorkGraph,
  workgraphsDir: string
): Promise<string> {
  await mkdir(workgraphsDir, { recursive: true })
  const filename = `${workgraph.id}.yaml`
  const filepath = join(workgraphsDir, filename)
  const yaml = stringifyYaml(workgraph)
  await writeFile(filepath, yaml, "utf8")
  return filepath
}
