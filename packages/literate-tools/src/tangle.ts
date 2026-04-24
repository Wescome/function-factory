/**
 * Tangle — extract TypeScript code blocks from the literate canonical reference.
 *
 * Reads: specs/reference/literate-canonical-reference.md
 * Produces: packages/literate-tools/tangled/<context>/index.ts per bounded context
 *
 * Each fenced ```typescript block that begins with a comment like
 *   // context: specification
 * is extracted into the corresponding context directory.
 *
 * Blocks without a context marker go to tangled/_uncontextualized.ts.
 *
 * Exit 0 if all blocks extracted. Exit 1 if any block has a syntax
 * marker the extractor doesn't recognize.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "fs"
import { join, dirname } from "path"

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..")
const REFERENCE_PATH = join(REPO_ROOT, "specs", "reference", "literate-canonical-reference.md")
const OUTPUT_DIR = join(dirname(new URL(import.meta.url).pathname), "..", "tangled")

const KNOWN_CONTEXTS = [
  "specification",
  "search",
  "execution",
  "assurance",
  "observability",
  "adaptation",
  "governance",
  "types",
  "loop",
] as const

type ContextName = (typeof KNOWN_CONTEXTS)[number] | "_uncontextualized"

const PART_TO_CONTEXT: Array<[RegExp, ContextName]> = [
  [/^Part VII\b/, "loop"],
  [/^Part VI\b/, "adaptation"],
  [/^Part V\b/, "observability"],
  [/^Part IV\b/, "assurance"],
  [/^Part III\b/, "execution"],
  [/^Part II\b/, "specification"],
  [/^Part I\b/, "types"],
  [/^Appendix A\b/, "types"],
  [/^Appendix B\b/, "types"],
  [/^Appendix C\b/, "loop"],
]

function inferContextFromPart(partLabel: string): ContextName {
  for (const [pattern, context] of PART_TO_CONTEXT) {
    if (pattern.test(partLabel)) return context
  }
  return "_uncontextualized"
}

interface ExtractedBlock {
  context: ContextName
  code: string
  lineNumber: number
  partLabel: string
}

function extractBlocks(markdown: string): ExtractedBlock[] {
  const lines = markdown.split("\n")
  const blocks: ExtractedBlock[] = []
  let inBlock = false
  let currentCode: string[] = []
  let blockStartLine = 0
  let currentPart = ""

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith("## Part") || line.startsWith("## Appendix")) {
      currentPart = line.replace(/^##\s+/, "").trim()
    }

    if (line.trim().startsWith("```typescript")) {
      inBlock = true
      currentCode = []
      blockStartLine = i + 1
      continue
    }

    if (inBlock && line.trim() === "```") {
      inBlock = false
      const code = currentCode.join("\n")
      const contextMatch = code.match(/^\/\/\s*context:\s*(\w+)/)
      let context: ContextName = "_uncontextualized"

      if (contextMatch) {
        const declared = contextMatch[1]
        if ((KNOWN_CONTEXTS as readonly string[]).includes(declared)) {
          context = declared as ContextName
        } else {
          console.error(
            `WARNING: unrecognized context "${declared}" at line ${blockStartLine}`,
          )
        }
      } else {
        context = inferContextFromPart(currentPart)
      }

      blocks.push({ context, code, lineNumber: blockStartLine, partLabel: currentPart })
      continue
    }

    if (inBlock) {
      currentCode.push(line)
    }
  }

  if (inBlock) {
    console.error(`ERROR: unterminated code block starting at line ${blockStartLine}`)
    process.exit(1)
  }

  return blocks
}

function groupByContext(blocks: ExtractedBlock[]): Map<ContextName, ExtractedBlock[]> {
  const grouped = new Map<ContextName, ExtractedBlock[]>()
  for (const block of blocks) {
    const existing = grouped.get(block.context) ?? []
    existing.push(block)
    grouped.set(block.context, existing)
  }
  return grouped
}

function writeContextFiles(grouped: Map<ContextName, ExtractedBlock[]>): void {
  if (existsSync(OUTPUT_DIR)) {
    // Clean previous tangle output
    rmSync(OUTPUT_DIR, { recursive: true, force: true })
  }

  let totalBlocks = 0
  let totalLines = 0

  for (const [context, blocks] of grouped) {
    const contextDir = join(OUTPUT_DIR, context)
    mkdirSync(contextDir, { recursive: true })

    const header = [
      `// Tangled from specs/reference/literate-canonical-reference.md`,
      `// Context: ${context}`,
      `// Blocks: ${blocks.length}`,
      `// Generated: ${new Date().toISOString()}`,
      `// DO NOT EDIT — edit the literate reference and re-run tangle.`,
      ``,
    ].join("\n")

    const body = blocks
      .map((b) => [
        `// --- Block from line ${b.lineNumber} (${b.partLabel}) ---`,
        b.code.replace(/^\/\/\s*context:\s*\w+\n?/, ""),
        "",
      ].join("\n"))
      .join("\n")

    const filePath = join(contextDir, "index.ts")
    writeFileSync(filePath, header + body)

    totalBlocks += blocks.length
    totalLines += (header + body).split("\n").length

    console.log(`  ${context}/index.ts — ${blocks.length} blocks`)
  }

  console.log(`\nTangled ${totalBlocks} blocks into ${grouped.size} context files (${totalLines} lines total)`)
}

function main(): void {
  console.log("Tangle: extracting TypeScript from literate canonical reference\n")

  if (!existsSync(REFERENCE_PATH)) {
    console.error(`ERROR: literate reference not found at ${REFERENCE_PATH}`)
    process.exit(1)
  }

  const markdown = readFileSync(REFERENCE_PATH, "utf-8")
  const blocks = extractBlocks(markdown)

  if (blocks.length === 0) {
    console.error("ERROR: no TypeScript code blocks found in the literate reference")
    process.exit(1)
  }

  console.log(`Found ${blocks.length} TypeScript code blocks\n`)

  const grouped = groupByContext(blocks)
  writeContextFiles(grouped)

  const uncontextualized = grouped.get("_uncontextualized")
  if (uncontextualized && uncontextualized.length > 0) {
    console.log(`\nWARNING: ${uncontextualized.length} blocks have no context marker`)
    for (const b of uncontextualized) {
      console.log(`  line ${b.lineNumber} (${b.partLabel})`)
    }
  }

  console.log("\nDone.")
}

main()
