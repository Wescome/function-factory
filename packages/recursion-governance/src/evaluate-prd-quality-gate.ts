import type { RenderedPrdCandidate } from "./types.js"

export function evaluatePrdQualityGate(candidate: RenderedPrdCandidate): void {
  const markdown = candidate.markdown

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
      throw new Error(`PRD quality gate failed: missing required section ${section}`)
    }
  }

  const forbiddenTokens = ["TODO", "TBD", "[placeholder]", "<placeholder>"]
  for (const token of forbiddenTokens) {
    if (markdown.includes(token)) {
      throw new Error(`PRD quality gate failed: forbidden placeholder token detected: ${token}`)
    }
  }

  if (markdown.length < 600) {
    throw new Error("PRD quality gate failed: rendered markdown is too short")
  }
}
