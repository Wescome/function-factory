/**
 * Executable Specification emission IO wrapper.
 *
 * Separated from pure Structural Assembly so the pure function remains
 * testable without filesystem side effects. The historical emitWorkgraph name
 * remains as a compatibility export.
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

export const emitExecutableSpecification = emitWorkgraph
