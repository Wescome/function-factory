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
      'FOR d IN memory_semantic FILTER d.type == "decision" LIMIT 10 RETURN { key: d._key, decision: d.decision, rationale: d.rationale }',
    ).catch(() => [] as { key: string; decision: string; rationale?: string }[]),

    db.query<{ key: string; lesson: string; painScore?: number }>(
      'FOR l IN memory_semantic FILTER l.type == "lesson" LIMIT 10 RETURN { key: l._key, lesson: l.lesson, painScore: l.pain_score }',
    ).catch(() => [] as { key: string; lesson: string; painScore?: number }[]),

    db.query<{ ruleId: string; rule: string }>(
      'FOR r IN mentorscript_rules FILTER r.status == "active" LIMIT 10 RETURN { ruleId: r._key, rule: r.rule }',
    ).catch(() => [] as { ruleId: string; rule: string }[]),

    db.query<{ key: string; name: string; domain?: string }>(
      'FOR f IN specs_functions LIMIT 10 RETURN { key: f._key, name: f.name, domain: f.domain }',
    ).catch(() => [] as { key: string; name: string; domain?: string }[]),

    db.query<{ key: string; description: string }>(
      'FOR i IN specs_invariants LIMIT 10 RETURN { key: i._key, description: i.description }',
    ).catch(() => [] as { key: string; description: string }[]),

    db.query<{ key: string; pattern: string; confidence: number; severity: string; recommendation: string; affects_agents: string[] }>(
      `FOR l IN memory_curated
         FILTER l.type == 'curated_lesson'
         FILTER l.decay_status == 'active'
         FILTER l.confidence >= 0.5
         SORT l.confidence DESC
         LIMIT 10
         RETURN { key: l._key, pattern: l.pattern, confidence: l.confidence, severity: l.severity, recommendation: l.recommendation, affects_agents: l.affects_agents }`,
    ).catch(() => [] as { key: string; pattern: string; confidence: number; severity: string; recommendation: string; affects_agents: string[] }[]),
  ])

  return { decisions, lessons, mentorRules, existingFunctions, invariants, curatedLessons }
}

/**
 * Format pre-fetched context into a human-readable markdown block
 * suitable for injection into an agent's user message.
 */
export function formatContextForPrompt(ctx: PrefetchedContext): string {
  const parts: string[] = ['## Factory Knowledge Graph Context (pre-fetched)\n']

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

  if (parts.length === 1) parts.push('(No context available in knowledge graph)')

  return parts.join('\n')
}
