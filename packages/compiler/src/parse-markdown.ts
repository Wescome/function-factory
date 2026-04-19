/**
 * Markdown parsing helper used by Pass 0 (normalize).
 *
 * Responsibilities:
 * - Extract the YAML frontmatter between the first pair of `---` lines.
 * - Skip the document's top-level `# Title` heading (the title is already
 *   in the frontmatter under `title`).
 * - Split the body into sections keyed by their `## ` heading text.
 * - Include `### ` subsection content within its parent `## ` section.
 *
 * The MVP parser is deliberately simple. It does not handle code fences
 * containing `##` as text, nor front-matter values spanning multiple
 * `---` sequences. It is tuned for the shape of PRDs authored under the
 * prd-compiler SKILL discipline.
 */

import { parse as parseYaml } from "yaml"

export interface ParsedMarkdown {
  /** Raw frontmatter object produced by `yaml.parse`. Shape validated by Pass 0. */
  readonly frontmatter: Record<string, unknown>
  /** Sections keyed by `## ` heading text (trimmed). Order preserved. */
  readonly sections: Readonly<Record<string, string>>
  /** Heading text of the first `# Title` (for logging; not used by Pass 0 directly). */
  readonly title: string | null
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  const { frontmatter, body } = splitFrontmatter(raw)
  const { title, sections } = splitSections(body)
  return { frontmatter, sections, title }
}

/**
 * Split a markdown file into its YAML frontmatter and the body that
 * follows. If the file does not begin with `---`, returns an empty
 * frontmatter and the entire content as body.
 */
function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const lines = raw.split("\n")
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: raw }
  }

  // Find the closing `---` after line 0.
  let closingIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closingIndex = i
      break
    }
  }
  if (closingIndex === -1) {
    // No closing delimiter — treat as no frontmatter.
    return { frontmatter: {}, body: raw }
  }

  const yamlText = lines.slice(1, closingIndex).join("\n")
  const parsed = parseYaml(yamlText)
  const frontmatter =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  const body = lines.slice(closingIndex + 1).join("\n")
  return { frontmatter, body }
}

/**
 * Split a markdown body into sections keyed by `## ` heading text.
 * Preserves `### ` subsections as nested content within their parent.
 * Returns the first `# Title` heading separately (or null if absent).
 */
function splitSections(body: string): {
  title: string | null
  sections: Record<string, string>
} {
  const lines = body.split("\n")
  let title: string | null = null
  const sections: Record<string, string> = {}

  let currentSection: string | null = null
  let currentContent: string[] = []

  const flush = (): void => {
    if (currentSection !== null) {
      sections[currentSection] = currentContent.join("\n").trim()
    }
  }

  for (const line of lines) {
    // Match `# Title` (exactly one hash) — only capture first occurrence.
    const h1 = /^# (.+)$/.exec(line)
    if (h1 !== null && title === null && currentSection === null) {
      title = h1[1]?.trim() ?? null
      continue
    }

    // Match `## Section` (exactly two hashes).
    const h2 = /^## (.+)$/.exec(line)
    if (h2 !== null) {
      flush()
      currentSection = h2[1]?.trim() ?? ""
      currentContent = []
      continue
    }

    if (currentSection !== null) {
      currentContent.push(line)
    }
  }

  flush()
  return { title, sections }
}
