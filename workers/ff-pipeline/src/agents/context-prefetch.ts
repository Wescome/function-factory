/**
 * Context Prefetch — pre-fetches ArangoDB context for injection into agent prompts.
 *
 * Replaces multi-turn tool calling (which Workers AI doesn't support) with a
 * single pre-fetch that runs ONCE per synthesis. All agents receive the same
 * pre-fetched context as part of their user message.
 *
 * Never throws — all queries catch errors and return empty arrays.
 */

import type { ArangoClient } from '@factory/arango-client'

export interface PrefetchedContext {
  decisions: { key: string; decision: string; rationale?: string }[]
  lessons: { key: string; lesson: string; painScore?: number }[]
  mentorRules: { ruleId: string; rule: string }[]
  existingFunctions: { key: string; name: string; domain?: string }[]
  invariants: { key: string; description: string }[]
  curatedLessons: { key: string; pattern: string; confidence: number; severity: string; recommendation: string; affects_agents: string[] }[]
}

/**
 * Pre-fetch Factory knowledge graph context from ArangoDB.
 *
 * Runs 5 queries in parallel with LIMIT 10 each. Each query catches
 * errors independently — partial results are fine, total failure
 * returns an empty context object (agents still work, just without
 * grounding data).
 */
export async function prefetchAgentContext(db: ArangoClient): Promise<PrefetchedContext> {
  const [decisions, lessons, mentorRules, existingFunctions, invariants, curatedLessons] = await Promise.all([
    db.query<{ key: string; decision: string; rationale?: string }>(
      `SELECT key, json_extract(json,'$.decision') AS decision, json_extract(json,'$.rationale') AS rationale FROM documents WHERE collection='memory_semantic' AND json_extract(json,'$.type')='decision' LIMIT 10`,
    ).catch(() => [] as { key: string; decision: string; rationale?: string }[]),

    db.query<{ key: string; lesson: string; painScore?: number }>(
      `SELECT key, json_extract(json,'$.lesson') AS lesson, json_extract(json,'$.pain_score') AS painScore FROM documents WHERE collection='memory_semantic' AND json_extract(json,'$.type')='lesson' LIMIT 10`,
    ).catch(() => [] as { key: string; lesson: string; painScore?: number }[]),

    db.query<{ ruleId: string; rule: string }>(
      `SELECT key AS ruleId, json_extract(json,'$.rule') AS rule FROM documents WHERE collection='mentorscript_rules' AND json_extract(json,'$.status')='active' LIMIT 10`,
    ).catch(() => [] as { ruleId: string; rule: string }[]),

    db.query<{ key: string; name: string; domain?: string }>(
      `SELECT key, json_extract(json,'$.name') AS name, json_extract(json,'$.domain') AS domain FROM documents WHERE collection='specs_functions' LIMIT 10`,
    ).catch(() => [] as { key: string; name: string; domain?: string }[]),

    db.query<{ key: string; description: string }>(
      `SELECT key, json_extract(json,'$.description') AS description FROM documents WHERE collection='specs_invariants' LIMIT 10`,
    ).catch(() => [] as { key: string; description: string }[]),

    db.query<{ key: string; pattern: string; confidence: number; severity: string; recommendation: string; affects_agents: string[] }>(
      `SELECT key, json_extract(json,'$.pattern') AS pattern, json_extract(json,'$.confidence') AS confidence, json_extract(json,'$.severity') AS severity, json_extract(json,'$.recommendation') AS recommendation, json_extract(json,'$.affects_agents') AS affects_agents FROM documents WHERE collection='memory_curated' AND json_extract(json,'$.type')='curated_lesson' AND json_extract(json,'$.decay_status')='active' AND CAST(json_extract(json,'$.confidence') AS REAL) >= 0.5 ORDER BY json_extract(json,'$.confidence') DESC LIMIT 10`,
    ).catch(() => [] as { key: string; pattern: string; confidence: number; severity: string; recommendation: string; affects_agents: string[] }[]),
  ])

  return { decisions, lessons, mentorRules, existingFunctions, invariants, curatedLessons }
}

/**
 * Format pre-fetched context into a human-readable markdown block
 * suitable for injection into an agent's user message.
 */
export function formatContextForPrompt(ctx: PrefetchedContext): string {
  // Context Contract Header — provides attention-guiding counts for all agents
  const counts = {
    decisions: ctx.decisions.length,
    lessons: ctx.lessons.length,
    mentorRules: ctx.mentorRules.length,
    functions: ctx.existingFunctions.length,
    invariants: ctx.invariants.length,
    curatedLessons: ctx.curatedLessons.length,
  }

  const warnings: string[] = []
  if (counts.decisions === 0) warnings.push('decisions')
  if (counts.lessons === 0) warnings.push('lessons')
  if (counts.mentorRules === 0) warnings.push('mentor rules')
  if (counts.functions === 0) warnings.push('functions')
  if (counts.invariants === 0) warnings.push('invariants')
  if (counts.curatedLessons === 0) warnings.push('curated lessons')

  const parts: string[] = [
    '## Context Contract',
    `Provided: ${counts.decisions} decisions, ${counts.lessons} lessons, ${counts.mentorRules} mentor rules, ${counts.functions} functions, ${counts.invariants} invariants, ${counts.curatedLessons} curated lessons`,
  ]

  if (warnings.length > 0) {
    parts.push(`Warning: No ${warnings.join(', ')} available — proceed without grounding for ${warnings.length === 1 ? 'this dimension' : 'these dimensions'}`)
  }

  parts.push('\n## Factory Knowledge Graph Context (pre-fetched)\n')

  if (ctx.decisions.length > 0) {
    parts.push('### Architectural Decisions')
    for (const d of ctx.decisions) parts.push(`- [${d.key}] ${d.decision}`)
  }
  if (ctx.lessons.length > 0) {
    parts.push('\n### Lessons Learned')
    for (const l of ctx.lessons) parts.push(`- [${l.key}] ${l.lesson}`)
  }
  if (ctx.mentorRules.length > 0) {
    parts.push('\n### Active MentorScript Rules')
    for (const r of ctx.mentorRules) parts.push(`- [${r.ruleId}] ${r.rule}`)
  }
  if (ctx.existingFunctions.length > 0) {
    parts.push('\n### Existing Functions')
    for (const f of ctx.existingFunctions) parts.push(`- [${f.key}] ${f.name} (${f.domain ?? 'unknown'})`)
  }
  if (ctx.invariants.length > 0) {
    parts.push('\n### Active Invariants')
    for (const i of ctx.invariants) parts.push(`- [${i.key}] ${i.description}`)
  }
  if (ctx.curatedLessons.length > 0) {
    parts.push('\n### Curated Lessons (orientation-verified)')
    for (const l of ctx.curatedLessons) parts.push(`- [${l.key}] ${l.pattern} (confidence: ${l.confidence}, severity: ${l.severity}) — ${l.recommendation}`)
  }

  if (counts.decisions + counts.lessons + counts.mentorRules + counts.functions + counts.invariants + counts.curatedLessons === 0) {
    parts.push('(No context available in knowledge graph)')
  }

  return parts.join('\n')
}
