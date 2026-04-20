#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import type { BusinessCapability } from "@factory/schemas"
import type { RepoInventory } from "./types.js"
import { evaluateDelta } from "./evaluate-delta.js"
import { emitFunctionProposals } from "./emit-proposals.js"

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..")
const SPECS_DIR = resolve(REPO_ROOT, "specs")

async function main(): Promise<void> {
  const capabilityPath =
    process.argv[2] ??
    resolve(SPECS_DIR, "capabilities", "BC-META-COMPUTE-CAPABILITY-DELTA.yaml")
  const inventoryPath =
    process.argv[3] ??
    resolve(import.meta.dirname, "..", "fixtures", "repoInventory.current.json")

  const capabilityRaw = await readFile(capabilityPath, "utf8")
  const capability = parseYaml(capabilityRaw) as BusinessCapability

  const inventoryRaw = await readFile(inventoryPath, "utf8")
  const inventory = JSON.parse(inventoryRaw) as RepoInventory

  const delta = evaluateDelta(capability, inventory)
  const proposals = emitFunctionProposals(delta)

  const deltasDir = join(SPECS_DIR, "deltas")
  await mkdir(deltasDir, { recursive: true })
  const deltaPath = join(deltasDir, `${delta.id}.yaml`)
  await writeFile(deltaPath, stringifyYaml(delta), "utf8")

  process.stdout.write(`Delta: ${deltaPath}\n`)
  process.stdout.write(
    `  overallStatus: ${delta.overallStatus}\n` +
      `  findings: ${delta.findings.length}\n` +
      `  recommendedFunctionTypes: ${delta.recommendedFunctionTypes.join(", ")}\n`
  )

  const functionsDir = join(SPECS_DIR, "functions")
  await mkdir(functionsDir, { recursive: true })
  for (const fp of proposals) {
    const fpPath = join(functionsDir, `${fp.id}.yaml`)
    await writeFile(fpPath, stringifyYaml(fp), "utf8")
    process.stdout.write(`FunctionProposal: ${fpPath}\n`)
  }

  process.stdout.write(`\nStage 4 complete. ${1} delta + ${proposals.length} proposals persisted.\n`)
}

void main().catch((err) => {
  process.stderr.write(`Stage 4 error: ${(err as Error).message}\n`)
  process.exit(1)
})
