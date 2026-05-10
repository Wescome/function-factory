/**
 * Lightweight guardrail for rendered Intent Specification markdown.
 */
export function validateRenderedPrdShape(markdown: string): void {
  const requiredSections = [
    "## Problem",
    "## Goal",
    "## Constraints",
    "## Acceptance Criteria",
    "## Success Metrics",
    "## Out of Scope",
  ]

  for (const section of requiredSections) {
    if (!markdown.includes(section)) {
      throw new Error(`Rendered Intent Specification missing required section: ${section}`)
    }
  }

  if (!markdown.startsWith("---\n")) {
    throw new Error("Rendered Intent Specification missing YAML frontmatter start delimiter")
  }
}
