/**
 * Executable Specification emission IO wrapper.
 *
 * Separated from pure Structural Assembly so the pure function remains
 * testable without filesystem side effects.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { stringify as stringifyYaml } from "yaml"
import type { ExecutableSpecification } from "@factory/schemas"

export async function emitExecutableSpecification(
  executableSpecification: ExecutableSpecification,
  executableSpecificationsDir: string
): Promise<string> {
  await mkdir(executableSpecificationsDir, { recursive: true })
  const filename = `${executableSpecification.id}.yaml`
  const filepath = join(executableSpecificationsDir, filename)
  const yaml = stringifyYaml(executableSpecification)
  await writeFile(filepath, yaml, "utf8")
  return filepath
}
