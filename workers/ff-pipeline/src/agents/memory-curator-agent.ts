/**
 * MemoryCuratorAgent — the first Orientation Agent.
 *
 * Curates raw telemetry + lessons into ranked, cross-referenced knowledge.
 * Runs asynchronously after feedback signal processing, consolidating
 * scattered learnings into actionable patterns.
 *
 * Context is pre-fetched from ArangoDB via 4 parallel queries.
 * Single-turn LLM invocation produces structured curation output.
 * Results are persisted to memory_curated, pattern_library, and
 * orientation_assessments collections.
 */

import { agentLoop } from '@weops/gdk-agent'
import type { Model, AssistantMessage, Message, UserMessage } from '@weops/gdk-ai'
import type { ArangoClient } from '@factory/arango-client'
import { resolveAgentModel } from './resolve-model'
import { processAgentOutput, extractAssistantText, buildTelemetryEntry, type OutputSchema } from './output-reliability'

// ── Types ─────────────────────────────────────────────────────────

export interface CuratedLesson {
  pattern: string
  confidence: number
  severity: 'critical' | 'high' | 'medium' | 'low'
  recommendation: string
  evidence_count: number
  last_seen: string
  affects_agents: string[]
  decay_status: 'active' | 'decaying' | 'archived'
}

export interface PatternLibraryEntry {
  pattern_name: string
  description: string
  frequency: number
  first_seen: string
  last_seen: string
  related_lessons: string[]
}

export interface GovernanceRecommendation {
  recommendation: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  rationale: string
  source_patterns: string[]
}

export interface MemoryCurationResult {
  curated_lessons: CuratedLesson[]
  pattern_library_entries: PatternLibraryEntry[]
  governance_recommendations: GovernanceRecommendation[]
  curation_summary: string
}

export interface CuratorContext {
  orl_telemetry: Record<string, unknown>[]
  memory_semantic: Record<string, unknown>[]
  memory_episodic: Record<string, unknown>[]
  specs_signals: Record<string, unknown>[]
}

// ── ORL Schema ────────────────────────────────────────────────────

export const MEMORY_CURATION_SCHEMA: OutputSchema<MemoryCurationResult> = {
  name: 'MemoryCuration',
  requiredFields: ['curated_lessons', 'pattern_library_entries', 'governance_recommendations', 'curation_summary'],
  fieldTypes: {
    curated_lessons: 'array',
    pattern_library_entries: 'array',
    governance_recommendations: 'array',
    curation_summary: 'string',
  },
  fieldAliases: {
    curated_lessons: ['lessons', 'curatedLessons', 'curated'],
    pattern_library_entries: ['patterns', 'patternLibrary', 'pattern_library'],
    governance_recommendations: ['recommendations', 'governance', 'governanceRecs'],
    curation_summary: ['summary', 'curationSummary', 'overview'],
  },
  coerce: true,
}

// ── Context Prefetch ──────────────────────────────────────────────

/**
 * Pre-fetch curation context from ArangoDB via 4 parallel queries.
 * Never throws — all queries catch errors and return empty arrays.
 */
export async function prefetchCuratorContext(db: ArangoClient): Promise<CuratorContext> {
  const [orl_telemetry, memory_semantic, memory_episodic, specs_signals] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT json_extract(json,'$.schemaName') AS schemaName, SUM(CASE WHEN json_extract(json,'$.success')=1 THEN 1 ELSE 0 END) AS success_count, SUM(CASE WHEN json_extract(json,'$.success')=1 THEN 0 ELSE 1 END) AS fail_count, AVG(CAST(json_extract(json,'$.repairAttempts') AS REAL)) AS avg_repairs FROM documents WHERE collection='orl_telemetry' AND json_extract(json,'$.timestamp') >= datetime('now','-7 days') GROUP BY json_extract(json,'$.schemaName')`,
    ).catch(() => [] as Record<string, unknown>[]),

    db.query<Record<string, unknown>>(
      `SELECT json FROM documents WHERE collection='memory_semantic' AND json_extract(json,'$.type')='lesson' ORDER BY json_extract(json,'$.lastSeen') DESC LIMIT 50`,
    ).then(rows => rows.map(r => JSON.parse((r as { json: string }).json) as Record<string, unknown>)).catch(() => [] as Record<string, unknown>[]),

    db.query<Record<string, unknown>>(
      `SELECT json FROM documents WHERE collection='memory_episodic' ORDER BY json_extract(json,'$.timestamp') DESC LIMIT 50`,
    ).then(rows => rows.map(r => JSON.parse((r as { json: string }).json) as Record<string, unknown>)).catch(() => [] as Record<string, unknown>[]),

    db.query<Record<string, unknown>>(
      `SELECT key AS _key, json_extract(json,'$.subtype') AS subtype, json_extract(json,'$.title') AS title, json_extract(json,'$.createdAt') AS createdAt FROM documents WHERE collection='specs_signals' AND json_extract(json,'$.source')='factory:feedback-loop' ORDER BY json_extract(json,'$.createdAt') DESC LIMIT 20`,
    ).catch(() => [] as Record<string, unknown>[]),
  ])

  return { orl_telemetry, memory_semantic, memory_episodic, specs_signals }
}

// ── Context Formatter ─────────────────────────────────────────────

/**
 * Format curation context into markdown sections for the agent prompt.
 */
export function formatCuratorContextForPrompt(ctx: CuratorContext): string {
  const parts: string[] = ['## Memory Curation Context\n']

  if (ctx.orl_telemetry.length > 0) {
    parts.push('### ORL Telemetry (7-day)')
    for (const t of ctx.orl_telemetry) {
      parts.push(`- ${t.schemaName}: ${t.success_count} success, ${t.fail_count} fail, avg repairs: ${t.avg_repairs}`)
    }
  }

  if (ctx.memory_semantic.length > 0) {
    parts.push('\n### Semantic Memory (lessons)')
    for (const l of ctx.memory_semantic) {
      parts.push(`- [${l._key}] ${l.pattern} (count: ${l.count ?? 1}, recommendation: ${l.recommendation ?? 'none'})`)
    }
  }

  if (ctx.memory_episodic.length > 0) {
    parts.push('\n### Episodic Memory (recent)')
    for (const e of ctx.memory_episodic) {
      parts.push(`- [${e._key}] ${e.action}: ${e.outcome ?? 'unknown'} at ${e.timestamp ?? 'unknown'}`)
    }
  }

  if (ctx.specs_signals.length > 0) {
    parts.push('\n### Feedback Signals')
    for (const s of ctx.specs_signals) {
      parts.push(`- [${s._key}] ${s.subtype}: ${s.title} (${s.createdAt ?? 'unknown'})`)
    }
  }

  if (parts.length === 1) {
    parts.push('(No data available for curation)')
  }

  return parts.join('\n')
}

// ── System Prompt ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the MemoryCurator — the first Orientation role in the Function Factory.

Your purpose: curate raw telemetry, lessons, and episodic memory into ranked, cross-referenced knowledge that all Factory roles can use.

Process this request in order:
1. Read the ORL telemetry, semantic memory, episodic memory, and feedback signals
2. Consolidate duplicate or near-duplicate lessons — merge with accumulated evidence counts
3. Apply the 8 curation rules below to rank, decay, cross-reference, and classify
4. Produce the MemoryCuration JSON

CURATION RULES:
1. CONSOLIDATE — merge duplicates into single entries with accumulated evidence counts
2. RANK — assign confidence (0.0-1.0) based on evidence frequency and recency
3. DECAY — mark lessons with no recent evidence (>14 days) as "decaying"; >30 days as "archived"
4. CROSS-REFERENCE — link lessons to the roles they affect (CodeProducer, PlanProducer, Architect, Verifier, CriticReviewer)
5. LINEAGE — every curated lesson traces back to specific ORL telemetry or episodic events
6. SEVERITY — classify as critical/high/medium/low based on impact on synthesis success rate
7. PATTERN DETECTION — identify recurring failure modes across roles and consolidate into named patterns
8. GOVERNANCE — recommend process changes when patterns indicate systemic issues

Your response is a JSON object:
{
  "curated_lessons": [
    {
      "pattern": "descriptive name",
      "confidence": 0.85,
      "severity": "high",
      "recommendation": "actionable recommendation",
      "evidence_count": 5,
      "last_seen": "ISO 8601",
      "affects_agents": ["CodeProducer", "Verifier"],
      "decay_status": "active"
    }
  ],
  "pattern_library_entries": [
    {
      "pattern_name": "kebab-case-name",
      "description": "what this pattern means",
      "frequency": 5,
      "first_seen": "ISO 8601",
      "last_seen": "ISO 8601",
      "related_lessons": ["pattern name from curated_lessons"]
    }
  ],
  "governance_recommendations": [
    {
      "recommendation": "what to change",
      "priority": "high",
      "rationale": "why, grounded in evidence",
      "source_patterns": ["pattern-name"]
    }
  ],
  "curation_summary": "Brief summary of what was curated"
}`

// ── Agent Class ───────────────────────────────────────────────────

export interface MemoryCuratorAgentOpts {
  db: ArangoClient
  apiKey: string
  dryRun?: boolean
  model?: Model<any>
}

export class MemoryCuratorAgent {
  private db: ArangoClient
  private apiKey: string
  private dryRun: boolean
  private modelOverride: Model<any> | undefined

  constructor(opts: MemoryCuratorAgentOpts) {
    this.db = opts.db
    this.apiKey = opts.apiKey
    this.dryRun = opts.dryRun ?? false
    this.modelOverride = opts.model
  }

  /**
   * Run the curation cycle: prefetch context, invoke LLM, parse output.
   */
  async curate(): Promise<MemoryCurationResult> {
    if (this.dryRun) {
      return {
        curated_lessons: [],
        pattern_library_entries: [],
        governance_recommendations: [],
        curation_summary: 'Dry-run: no curation performed',
      }
    }

    // Prefetch context from ArangoDB
    const ctx = await prefetchCuratorContext(this.db)
    const contextPrompt = formatCuratorContextForPrompt(ctx)

    const userContent = `${contextPrompt}\n\nCurate the above context into consolidated, ranked knowledge. Apply all 8 curation rules. Start your response with {"curated_lessons":`

    const model = this.modelOverride ?? resolveAgentModel('planning')

    const stream = agentLoop(
      [{ role: 'user', content: userContent, timestamp: Date.now() } as UserMessage],
      { systemPrompt: SYSTEM_PROMPT, messages: [] },
      {
        model,
        convertToLlm: (msgs) => msgs as Message[],
        getApiKey: async () => this.apiKey,
        maxTokens: 8192,
        onPayload: (payload: unknown) => ({
          ...(payload as Record<string, unknown>),
          response_format: { type: 'json_object' },
        }),
      },
      AbortSignal.timeout(300_000),
    )

    const messages = await stream.result()
    const lastAssistant = [...messages].reverse().find((m): m is AssistantMessage => m.role === 'assistant')
    if (!lastAssistant) throw new Error('MemoryCuratorAgent: no assistant response')
    if (lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted') {
      throw new Error(`MemoryCuratorAgent: ${lastAssistant.errorMessage ?? 'unknown error'}`)
    }

    const rawText = extractAssistantText(lastAssistant.content as any)
    if (!rawText) {
      const blockTypes = lastAssistant.content.map(c => c.type).join(',')
      throw new Error(`MemoryCuratorAgent: empty response (blocks: ${blockTypes || 'none'}, stopReason: ${lastAssistant.stopReason})`)
    }

    const result = await processAgentOutput(rawText, MEMORY_CURATION_SCHEMA)

    // ORL telemetry — fire-and-forget
    try {
      const telemetry = buildTelemetryEntry(result, 'MemoryCuration')
      await this.db.save('orl_telemetry', telemetry as unknown as Record<string, unknown>).catch(() => {})
    } catch { /* telemetry is best-effort */ }

    if (!result.success) {
      throw new Error(`MemoryCuratorAgent: ${result.failureMode}: could not produce valid curation. Response: ${result.rawResponse.slice(0, 500)}`)
    }

    return result.data!
  }

  /**
   * Persist curation results to ArangoDB collections.
   * Uses UPSERT for memory_curated and pattern_library to handle duplicates.
   */
  async persist(curation: MemoryCurationResult): Promise<{ written: number; errors: string[] }> {
    let written = 0
    const errors: string[] = []

    // Ensure collections exist
    await Promise.all([
      this.db.ensureCollection('memory_curated').catch(() => {}),
      this.db.ensureCollection('pattern_library').catch(() => {}),
      this.db.ensureCollection('orientation_assessments').catch(() => {}),
    ])

    // Write curated lessons via UPSERT
    for (const lesson of curation.curated_lessons) {
      try {
        await this.db.query(
          `INSERT INTO documents (collection, key, json) VALUES ('memory_curated', ?, json(?)) ON CONFLICT(collection, key) DO UPDATE SET json=json_patch(json, ?)`,
          [
            lesson.pattern.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
            JSON.stringify({ _key: lesson.pattern.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), pattern: lesson.pattern, confidence: lesson.confidence, severity: lesson.severity, recommendation: lesson.recommendation, evidence_count: lesson.evidence_count, last_seen: lesson.last_seen, affects_agents: lesson.affects_agents, decay_status: lesson.decay_status, type: 'curated_lesson', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
            JSON.stringify({ confidence: lesson.confidence, severity: lesson.severity, recommendation: lesson.recommendation, evidence_count: lesson.evidence_count, last_seen: lesson.last_seen, affects_agents: lesson.affects_agents, decay_status: lesson.decay_status, updatedAt: new Date().toISOString() }),
          ],
        )
        written++
      } catch (err) {
        errors.push(`memory_curated/${lesson.pattern}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Write pattern library entries via UPSERT
    for (const entry of curation.pattern_library_entries) {
      try {
        await this.db.query(
          `INSERT INTO documents (collection, key, json) VALUES ('pattern_library', ?, json(?)) ON CONFLICT(collection, key) DO UPDATE SET json=json_patch(json, ?)`,
          [
            entry.pattern_name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
            JSON.stringify({ _key: entry.pattern_name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), pattern_name: entry.pattern_name, description: entry.description, frequency: entry.frequency, first_seen: entry.first_seen, last_seen: entry.last_seen, related_lessons: entry.related_lessons, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
            JSON.stringify({ description: entry.description, frequency: entry.frequency, last_seen: entry.last_seen, related_lessons: entry.related_lessons, updatedAt: new Date().toISOString() }),
          ],
        )
        written++
      } catch (err) {
        errors.push(`pattern_library/${entry.pattern_name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Write governance recommendations
    for (const rec of curation.governance_recommendations) {
      try {
        await this.db.save('orientation_assessments', {
          type: 'governance_recommendation',
          recommendation: rec.recommendation,
          priority: rec.priority,
          rationale: rec.rationale,
          source_patterns: rec.source_patterns,
          createdAt: new Date().toISOString(),
        })
        written++
      } catch (err) {
        errors.push(`orientation_assessments/${rec.recommendation.slice(0, 40)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return { written, errors }
  }
}
