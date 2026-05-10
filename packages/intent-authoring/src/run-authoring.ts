#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { renderPrdFromFunctionProposal } from "./render-prd.js"
import { validateRenderedPrdShape } from "./validate-prd-shape.js"
import archProposal from "../test/fixtures/fp-meta-architecture-candidate-execution.json" assert { type: "json" }

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..")
const INTENT_SPECIFICATIONS_DIR = join(REPO_ROOT, "specs", "intent-specifications")

async function main(): Promise<void> {
  const rendered = renderPrdFromFunctionProposal({
    proposal: archProposal as never,
    sourceCapabilityId: "BC-META-EMIT-ARCHITECTURE-CANDIDATES",
    sourceFunctionId: "FN-META-ARCHITECTURE-CANDIDATE-EXECUTION",
    sourceRefs: [
      "DEL-META-EMIT-ARCHITECTURE-CANDIDATES",
      "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION",
    ],
  })

  validateRenderedPrdShape(rendered.markdown)

  await mkdir(INTENT_SPECIFICATIONS_DIR, { recursive: true })
  const intentSpecificationPath = join(INTENT_SPECIFICATIONS_DIR, rendered.filename)
  await writeFile(intentSpecificationPath, rendered.markdown, "utf8")

  process.stdout.write(`Intent Specification: ${intentSpecificationPath}\n`)
  process.stdout.write(`  id: ${rendered.id}\n`)
  process.stdout.write(`  filename: ${rendered.filename}\n`)
  process.stdout.write(`  shape: validated\n`)
}

void main().catch((err) => {
  process.stderr.write(`Intent Specification authoring error: ${(err as Error).message}\n`)
  process.exit(1)
})
