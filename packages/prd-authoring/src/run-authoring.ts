#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { renderPrdFromFunctionProposal } from "./render-prd.js"
import { validateRenderedPrdShape } from "./validate-prd-shape.js"
import semanticProposal from "../test/fixtures/fp-meta-semantic-review-execution.json" assert { type: "json" }

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..")
const PRDS_DIR = join(REPO_ROOT, "specs", "prds")

async function main(): Promise<void> {
  const rendered = renderPrdFromFunctionProposal({
    proposal: semanticProposal as never,
    sourceCapabilityId: "BC-META-SEMANTICALLY-REVIEW-PRDS",
    sourceFunctionId: "FN-META-SEMANTIC-REVIEW-EXECUTION",
    sourceRefs: [
      "DEL-META-SEMANTICALLY-REVIEW-PRDS",
      "FP-META-SEMANTIC-REVIEW-EXECUTION",
    ],
  })

  validateRenderedPrdShape(rendered.markdown)

  await mkdir(PRDS_DIR, { recursive: true })
  const prdPath = join(PRDS_DIR, rendered.filename)
  await writeFile(prdPath, rendered.markdown, "utf8")

  process.stdout.write(`PRD: ${prdPath}\n`)
  process.stdout.write(`  id: ${rendered.id}\n`)
  process.stdout.write(`  filename: ${rendered.filename}\n`)
  process.stdout.write(`  shape: validated\n`)
}

void main().catch((err) => {
  process.stderr.write(`PRD authoring error: ${(err as Error).message}\n`)
  process.exit(1)
})
