/**
 * coding-agent substrate formatter.
 *
 * Produces markdown + system prompt optimized for a TypeScript coding agent
 * (kimi-k2.6 or similar). No Factory vocabulary in the output.
 *
 * The system prompt includes the CodeArtifact JSON output format specification
 * (files/summary/testsIncluded) — identical to what coder-agent.ts currently
 * uses, but expressed in agent-neutral language.
 */

import type { FactorySpecification, CommunicableSpecification } from '../types.js'

/** Maximum characters of file content to include per file */
const MAX_CONTENT_CHARS = 2000

/**
 * System prompt for the coding-agent substrate.
 * Describes the agent's role and the expected JSON output format.
 * NO Factory vocabulary.
 */
const SYSTEM_PROMPT = `You are a TypeScript developer implementing a task in a monorepo.

Your purpose: produce a set of file changes that implement the task. All code MUST be TypeScript (.ts files). All file paths MUST end in .ts (source) or .json (config).

Process the request in order:
1. Read the task and approach — understand what code to produce
2. Study the existing files — ground every reference in the provided context
3. Plan edits — for existing files, produce targeted search/replace edits; for new files, produce full content
4. Produce the response JSON

If this is a repair cycle (Repair Notes section present), focus on fixing the specific issues noted.
Reuse existing patterns from the codebase.

FILE MODIFICATION RULES:
- For NEW files (action: "create"): provide full "content" string.
- For EXISTING files (action: "modify"): use "edits" — an array of search/replace pairs.
  Each edit has: "search" (exact substring from the current file, min 10 chars), "replace" (what it becomes).
  Edits are applied sequentially. Include enough context in "search" to be unique in the file.
- For DELETIONS (action: "delete"): just the "path".

Your response is a JSON object:
{
  "files": [
    { "path": "src/new-file.ts", "content": "full file content", "action": "create" },
    { "path": "src/existing.ts", "edits": [{"search": "old code here...", "replace": "new code here..."}], "action": "modify" },
    { "path": "src/removed.ts", "action": "delete" }
  ],
  "summary": "What was implemented and why",
  "testsIncluded": true
}

Start your response with {"files":`

/**
 * Format a FactorySpecification for the coding-agent substrate.
 */
export function formatForCodingAgent(spec: FactorySpecification): CommunicableSpecification {
  const sections: string[] = []

  // ## Task (always present — intent is required)
  sections.push(`## Task\n${spec.intent}`)

  // ## Approach (optional)
  if (spec.approach) {
    sections.push(`## Approach\n${spec.approach}`)
  }

  // ## Files to Modify (optional)
  if (spec.targetFiles && spec.targetFiles.length > 0) {
    const fileLines = spec.targetFiles.map(f => `- ${f}`)
    sections.push(`## Files to Modify\n${fileLines.join('\n')}`)
  }

  // File contexts (within Files to Modify or standalone)
  if (spec.context?.fileContents && spec.context.fileContents.length > 0) {
    const fileBlocks: string[] = []
    for (const fc of spec.context.fileContents) {
      const lines: string[] = [`### ${fc.path} [existing]`]
      if (fc.exports && fc.exports.length > 0) {
        lines.push(`Exports: ${fc.exports.join(', ')}`)
      }
      if (fc.functions && fc.functions.length > 0) {
        lines.push(`Functions: ${fc.functions.join(', ')}`)
      }
      if (fc.content) {
        const lang = inferLanguage(fc.path)
        const truncated = fc.content.length > MAX_CONTENT_CHARS
          ? fc.content.slice(0, MAX_CONTENT_CHARS) + '\n// ... truncated'
          : fc.content
        lines.push(`\`\`\`${lang}\n${truncated}\n\`\`\``)
      }
      fileBlocks.push(lines.join('\n'))
    }

    // If we already have a Files to Modify section, append under it
    // Otherwise create one
    if (!spec.targetFiles || spec.targetFiles.length === 0) {
      sections.push(`## Files to Modify\n${fileBlocks.join('\n\n')}`)
    } else {
      sections.push(fileBlocks.join('\n\n'))
    }
  }

  // ## Constraints (optional)
  if (spec.constraints && spec.constraints.length > 0) {
    const constraintLines = spec.constraints.map(c => `- ${c}`)
    sections.push(`## Constraints\n${constraintLines.join('\n')}`)
  }

  // ## Context (optional — decisions, lessons, mentor rules)
  if (spec.context) {
    const contextLines: string[] = []
    if (spec.context.decisions && spec.context.decisions.length > 0) {
      for (const d of spec.context.decisions) {
        contextLines.push(`- Decision: ${d}`)
      }
    }
    if (spec.context.lessons && spec.context.lessons.length > 0) {
      for (const l of spec.context.lessons) {
        contextLines.push(`- Lesson: ${l}`)
      }
    }
    if (spec.context.mentorRules && spec.context.mentorRules.length > 0) {
      for (const r of spec.context.mentorRules) {
        contextLines.push(`- Rule: ${r}`)
      }
    }
    if (contextLines.length > 0) {
      sections.push(`## Context\n${contextLines.join('\n')}`)
    }
  }

  // ## Repair Notes (only if retry cycle)
  if (spec.repair) {
    const repairLines: string[] = []
    if (spec.repair.notes) {
      repairLines.push(spec.repair.notes)
    }
    if (spec.repair.previousFiles && spec.repair.previousFiles.length > 0) {
      repairLines.push(`\nFiles from previous attempt:\n${spec.repair.previousFiles.map(f => `- ${f}`).join('\n')}`)
    }
    if (spec.repair.issues && spec.repair.issues.length > 0) {
      repairLines.push(`\nPrevious attempt had these issues:\n${spec.repair.issues.map(i => `- ${i}`).join('\n')}`)
    }
    if (repairLines.length > 0) {
      sections.push(`## Repair Notes\n${repairLines.join('\n')}`)
    }
  }

  // BL5 primer at the END of the body (closest to generation point = strongest effect)
  sections.push('Produce the changes described above. Start your response with {"files":')

  const body = sections.join('\n\n')
  const totalChars = SYSTEM_PROMPT.length + body.length
  const estimatedTokens = Math.ceil(totalChars / 4)

  return {
    systemPrompt: SYSTEM_PROMPT,
    body,
    estimatedTokens,
  }
}

/** Infer language tag from file path for code blocks */
function inferLanguage(path: string): string {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.md')) return 'markdown'
  return 'typescript' // default for monorepo
}
