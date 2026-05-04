/**
 * agents-md substrate formatter.
 *
 * Generates an AGENTS.md-format markdown document from structured input
 * so external agents (Codex, Cursor, Devin) can work on Factory code
 * with Factory constraints.
 *
 * Output is plain markdown — no Factory-internal vocabulary.
 */

import type { AgentsMdInput, CommunicableSpecification } from '../types.js'

/**
 * System prompt for agents consuming AGENTS.md content.
 * Describes the role: an external coding agent onboarding to a project.
 */
const SYSTEM_PROMPT = `You are a coding agent working on a TypeScript monorepo. The following document describes the project conventions, build commands, artifact ID formats, and architecture. Follow these conventions exactly when making changes.`

/**
 * Format an AgentsMdInput into an AGENTS.md-style markdown document
 * wrapped as a CommunicableSpecification.
 */
export function formatForAgentsMd(input: AgentsMdInput): string {
  const sections: string[] = []

  // # Project Name
  sections.push(`# ${input.projectName}`)

  // Project description
  if (input.projectDescription) {
    sections.push(input.projectDescription)
  }

  // ## Build & Test
  const buildLines = [
    `- Install: \`${input.buildCommands.install}\``,
    `- Build: \`${input.buildCommands.build}\``,
    `- Test: \`${input.buildCommands.test}\``,
    `- Typecheck: \`${input.buildCommands.typecheck}\``,
  ]
  sections.push(`## Build & Test\n${buildLines.join('\n')}`)

  // ## Code Conventions
  const conventionLines = [
    `- Language: ${input.conventions.language}`,
    `- Monorepo: ${input.conventions.monorepo}`,
    `- Commit format: ${input.conventions.commitFormat}`,
  ]
  sections.push(`## Code Conventions\n${conventionLines.join('\n')}`)

  // ## Artifact IDs
  const prefixLines = Object.entries(input.artifactPrefixes).map(
    ([prefix, desc]) => `| \`${prefix}\` | ${desc} |`,
  )
  const table = [
    '| Prefix | Description |',
    '| --- | --- |',
    ...prefixLines,
  ]
  sections.push(`## Artifact IDs\n${table.join('\n')}`)

  // ## Architecture (optional)
  if (input.architectureDescription) {
    sections.push(`## Architecture\n${input.architectureDescription}`)
  }

  return sections.join('\n\n')
}

/**
 * Wrap formatForAgentsMd output as a CommunicableSpecification
 * for use with reformat().
 */
export function agentsMdToCommunicable(input: AgentsMdInput): CommunicableSpecification {
  const body = formatForAgentsMd(input)
  const totalChars = SYSTEM_PROMPT.length + body.length
  const estimatedTokens = Math.ceil(totalChars / 4)

  return {
    systemPrompt: SYSTEM_PROMPT,
    body,
    estimatedTokens,
  }
}
