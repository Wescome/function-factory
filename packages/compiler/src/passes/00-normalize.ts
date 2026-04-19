/**
 * Pass 0- normalize.
 *
 * Raw markdown → NormalizedPRD. Parses the PRD file's YAML frontmatter,
 * validates it against the PRDDraft Zod schema, and splits the body
 * into sections that populate the PRDDraft's list-valued fields
 * (problem, goal, constraints, acceptanceCriteria, successMetrics,
 * outOfScope).
 *
 * Sections not mapped to a PRDDraft field are flagged as unrecognized
 * but do not block compilation — a PRD can carry informational
 * sections alongside the structured PRDDraft shape.
 */

import type { PRDDraft } from "@factory/schemas"
import { PRDDraft as PRDDraftSchema } from "@factory/schemas"
import { parseMarkdown } from "../parse-markdown.js"
import type { NormalizedPRD } from "../types.js"

/**
 * Map of markdown section heading text (lowercased) to the
 * corresponding PRDDraft field name.
 */
const SECTION_TO_FIELD: Readonly<Record<string, keyof PRDDraft>> = {
  problem: "problem",
  goal: "goal",
  constraints: "constraints",
  "acceptance criteria": "acceptanceCriteria",
  "success metrics": "successMetrics",
  "out of scope": "outOfScope",
}

/**
 * Fields that are string arrays in the PRDDraft schema. The content of
 * these sections is split into list items; everything else is kept as
 * a single string.
 */
const LIST_FIELDS: ReadonlyArray<keyof PRDDraft> = [
  "constraints",
  "acceptanceCriteria",
  "successMetrics",
  "outOfScope",
]

export function normalize(rawMarkdown: string, sourceFile: string): NormalizedPRD {
  const { frontmatter, sections } = parseMarkdown(rawMarkdown)

  // Build a draft object combining frontmatter with body-derived fields.
  // Populate list fields by splitting section content; populate scalar
  // fields with the section content as a single string.
  const draftObj: Record<string, unknown> = { ...frontmatter }

  // Normalize section keys for matching (case-insensitive).
  const normalizedSections: Record<string, string> = {}
  const unrecognized: string[] = []

  for (const [heading, content] of Object.entries(sections)) {
    const key = heading.toLowerCase().trim()
    normalizedSections[heading] = content

    const field = SECTION_TO_FIELD[key]
    if (field === undefined) {
      unrecognized.push(heading)
      continue
    }

    if ((LIST_FIELDS as readonly string[]).includes(field)) {
      draftObj[field] = splitListItems(field, content)
    } else {
      draftObj[field] = content
    }
  }

  // Validate against PRDDraft Zod schema — this enforces the
  // lineage fields from frontmatter (id, source_refs, explicitness,
  // rationale) plus all required body-derived fields.
  const parsed = PRDDraftSchema.safeParse(draftObj)
  if (!parsed.success) {
    throw new Error(
      `Pass 0 (normalize)- PRD at ${sourceFile} failed PRDDraft validation- ` +
        parsed.error.message
    )
  }

  return {
    draft: parsed.data,
    sections: normalizedSections,
    unrecognizedSections: unrecognized,
    sourceFile,
  }
}

/**
 * Split a section's content into list items per the field's expected
 * shape. For acceptanceCriteria, each numbered list item is one entry.
 * For other list fields, paragraph-separated entries are used.
 */
function splitListItems(field: keyof PRDDraft, content: string): string[] {
  if (field === "acceptanceCriteria") {
    return splitNumberedList(content)
  }
  return splitParagraphs(content)
}

/**
 * Split content by numbered list markers at line starts. Each item
 * extends from its `N. ` marker until the next marker or end of
 * content. The leading `N. ` is stripped; interior whitespace is
 * preserved.
 */
function splitNumberedList(content: string): string[] {
  const items: string[] = []
  const lines = content.split("\n")
  let current: string[] = []
  let inItem = false

  const flush = (): void => {
    if (current.length > 0) {
      const joined = current.join("\n").trim()
      if (joined.length > 0) items.push(joined)
    }
  }

  for (const line of lines) {
    const match = /^\d+\.\s+(.*)$/.exec(line)
    if (match !== null) {
      flush()
      current = [match[1] ?? ""]
      inItem = true
    } else if (inItem) {
      current.push(line)
    }
    // Lines before the first numbered item are ignored.
  }
  flush()
  return items
}

/**
 * Split content by paragraph boundaries (blank lines). Sub-headings
 * (`### ...`) are dropped; paragraphs under them are kept as standalone
 * entries. Empty paragraphs are discarded.
 */
function splitParagraphs(content: string): string[] {
  const blocks = content.split(/\n\s*\n/)
  const items: string[] = []
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => !/^#+\s/.test(l.trim()))
    const joined = lines.join("\n").trim()
    if (joined.length > 0) items.push(joined)
  }
  return items
}
