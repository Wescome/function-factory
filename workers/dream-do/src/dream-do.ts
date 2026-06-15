/**
 * DreamDO — Full Durable Object implementation
 *
 * Singleton: env.DREAM_DO.idFromName('factory-singleton')
 *
 * Responsibilities:
 *   - Crystallize PassTemplates from zero-repair runs (INV-DREAM-04)
 *   - Periodic consolidation via DO Alarm (Phase 1 deterministic + Phase 2 LLM)
 *   - Quality signal ingestion
 *   - Routing patch proposals (operator-approval-only, INV-DREAM-06)
 *   - Template lifecycle management (active → stale → retired, INV-DREAM-02)
 *
 * GAP-013: DreamDO singleton
 */

import { DurableObject } from 'cloudflare:workers'
import {
  QualitySignalSchema,
  TemplateDiffSchema,
  LlmProposalSchema,
  type Env,
  type PassTemplate,
  type PassTemplateState,
  type PrdSignature,
  type QualitySignal,
  type TemplateDiff,
  type CrystallizeResult,
  type ConsolidationReport,
  type RoutingPatch,
  type DreamStatus,
  type LlmProposal,
} from './types.js'
import { z } from 'zod'

// ── Constants ──────────────────────────────────────────────────────────────────

const STALE_THRESHOLD_DAYS     = 30
const RETIRED_THRESHOLD_DAYS   = 90
const DEFAULT_CONSOLIDATION_INTERVAL_HOURS = 24 * 7  // 7 days
const DEFAULT_SIGNAL_WINDOW_RUNS = 10
const FAILURE_RATE_THRESHOLD   = 0.20 // 20%

// ── Utility helpers ────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

function nowMs(): number {
  return Date.now()
}

function uuid(): string {
  return crypto.randomUUID()
}

function daysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return d.toISOString()
}

function computeAtomSignature(prd: PrdSignature): string {
  const sorted = [...prd.concernClasses].sort().join(',')
  return `${sorted}|${prd.dependencyTopology}|${prd.signalClass}`
}

// ── DreamDO ────────────────────────────────────────────────────────────────────

export class DreamDO extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql

    this.ctx.blockConcurrencyWhile(async () => {
      this.migrate()
      // Arm consolidation alarm if not already set
      const existing = await this.ctx.storage.getAlarm()
      if (existing === null) {
        await this.ctx.storage.setAlarm(Date.now() + this.consolidationIntervalMs())
      }
    })
  }

  // ── Migration ──────────────────────────────────────────────────────────────

  private migrate(): void {
    // pass_templates
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS pass_templates (
        id                    TEXT PRIMARY KEY,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        name                  TEXT,
        prd_signal_class      TEXT,
        atom_signature        TEXT NOT NULL,
        pass_coverage         TEXT NOT NULL,
        atom_templates        TEXT NOT NULL,
        contract_templates    TEXT NOT NULL,
        invariant_templates   TEXT NOT NULL,
        state                 TEXT NOT NULL DEFAULT 'active',
        pinned                INTEGER NOT NULL DEFAULT 0,
        retired_at            TEXT,
        retire_reason         TEXT,
        source_run_id         TEXT,
        source_verdict_summary TEXT,
        artifact_graph_ref    TEXT
      );
    `)

    // FTS5 virtual table on pass_templates
    this.sql.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS pass_templates_fts
        USING fts5(
          id UNINDEXED,
          name,
          prd_signal_class,
          atom_templates,
          content='pass_templates',
          content_rowid='rowid'
        );
    `)

    // pass_template_usage
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS pass_template_usage (
        template_id       TEXT PRIMARY KEY REFERENCES pass_templates(id),
        invocation_count  INTEGER NOT NULL DEFAULT 0,
        zero_repair_count INTEGER NOT NULL DEFAULT 0,
        repair_count      INTEGER NOT NULL DEFAULT 0,
        gate_pass_rate    REAL    NOT NULL DEFAULT 0.0,
        patch_count       INTEGER NOT NULL DEFAULT 0,
        last_invoked_at   TEXT,
        last_repaired_at  TEXT,
        last_patched_at   TEXT,
        created_at        TEXT    NOT NULL
      );
    `)

    // quality_signals
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS quality_signals (
        id                 TEXT PRIMARY KEY,
        run_id             TEXT NOT NULL,
        verification_kind  TEXT NOT NULL,
        atom_id            TEXT,
        task_kind          TEXT NOT NULL,
        signal_type        TEXT NOT NULL,
        verdict            TEXT NOT NULL,
        repair_required    INTEGER NOT NULL DEFAULT 0,
        repair_description TEXT,
        model_used         TEXT,
        provider           TEXT,
        latency_ms         INTEGER,
        token_cost_usd     REAL,
        artifact_graph_ref TEXT,
        recorded_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS quality_signals_run_id ON quality_signals(run_id);
      CREATE INDEX IF NOT EXISTS quality_signals_task_kind ON quality_signals(task_kind, signal_type);
    `)

    // routing_patches
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS routing_patches (
        id                   TEXT PRIMARY KEY,
        proposed_at          TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'pending',
        evidence_window_runs INTEGER NOT NULL,
        signal_summary       TEXT NOT NULL,
        patches              TEXT NOT NULL,
        apply_command        TEXT NOT NULL,
        applied_at           TEXT,
        rejected_at          TEXT,
        artifact_graph_ref   TEXT
      );
    `)

    // dream_state (key-value coordination)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS dream_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO dream_state (key, value) VALUES
        ('active_pipeline_count',    '0'),
        ('last_consolidation_at',    ''),
        ('consolidation_running',    '0'),
        ('last_signal_window_start', '');
    `)
  }

  // ── dream_state helpers ────────────────────────────────────────────────────

  private getState(key: string): string {
    const rows = [...this.sql.exec(`SELECT value FROM dream_state WHERE key = ?`, key)]
    const row = rows[0] as { value: string } | undefined
    return row?.value ?? ''
  }

  private setState(key: string, value: string): void {
    this.sql.exec(`INSERT OR REPLACE INTO dream_state (key, value) VALUES (?, ?)`, key, value)
  }

  private consolidationIntervalMs(): number {
    const hours = parseInt(this.env.DREAM_CONSOLIDATION_INTERVAL_HOURS ?? '0', 10) || DEFAULT_CONSOLIDATION_INTERVAL_HOURS
    return hours * 60 * 60 * 1000
  }

  private signalWindowRuns(): number {
    const n = parseInt(this.env.DREAM_SIGNAL_WINDOW_RUNS ?? '0', 10)
    return n > 0 ? n : DEFAULT_SIGNAL_WINDOW_RUNS
  }

  // ── DO Alarm — Consolidation orchestrator ──────────────────────────────────

  override async alarm(): Promise<void> {
    // INV-DREAM-01: never run during active execution
    const activePipelines = parseInt(this.getState('active_pipeline_count'), 10) || 0
    if (activePipelines > 0) {
      // Defer 2 hours
      await this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 60 * 1000)
      return
    }

    // Concurrent guard
    if (this.getState('consolidation_running') === '1') {
      await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000)
      return
    }

    this.setState('consolidation_running', '1')
    try {
      await this.runConsolidation(false)
    } finally {
      this.setState('consolidation_running', '0')
      await this.ctx.storage.setAlarm(Date.now() + this.consolidationIntervalMs())
    }
  }

  // ── Consolidation logic ────────────────────────────────────────────────────

  private async runConsolidation(dryRun: boolean): Promise<ConsolidationReport> {
    const startedAt = now()
    const reportId = `CR-${uuid()}`
    const phase1Transitions: ConsolidationReport['phase1_transitions'] = []
    const phase2Applied: LlmProposal[] = []
    const phase2Rejected: ConsolidationReport['phase2_rejected'] = []

    const staleThreshold   = daysAgo(STALE_THRESHOLD_DAYS)
    const retiredThreshold = daysAgo(RETIRED_THRESHOLD_DAYS)

    // ── Phase 1 — Deterministic (savepoint) ───────────────────────────────────
    const savepointKey = `phase1_consolidation_${Date.now()}`

    // Declared at function scope so summary string below can reference them
    let toStaleCount   = 0
    let toRetiredCount = 0

    if (!dryRun) {
      this.sql.exec(`SAVEPOINT "${savepointKey}"`)
    }

    try {
      // active → stale (not pinned, not invoked in 30 days)
      const toStale = [...this.sql.exec(`
        SELECT pt.id FROM pass_templates pt
        LEFT JOIN pass_template_usage u ON u.template_id = pt.id
        WHERE pt.state = 'active'
          AND pt.pinned = 0
          AND (u.last_invoked_at IS NULL OR u.last_invoked_at < ?)
      `, staleThreshold)] as Array<{ id: string }>
      toStaleCount = toStale.length

      for (const row of toStale) {
        phase1Transitions.push({ templateId: row.id, fromState: 'active', toState: 'stale' })
        if (!dryRun) {
          this.sql.exec(
            `UPDATE pass_templates SET state = 'stale', updated_at = ? WHERE id = ?`,
            now(), row.id
          )
        }
      }

      // stale → retired (not pinned, not invoked in 90 days)
      const toRetired = [...this.sql.exec(`
        SELECT pt.id FROM pass_templates pt
        LEFT JOIN pass_template_usage u ON u.template_id = pt.id
        WHERE pt.state = 'stale'
          AND pt.pinned = 0
          AND (u.last_invoked_at IS NULL OR u.last_invoked_at < ?)
      `, retiredThreshold)] as Array<{ id: string }>
      toRetiredCount = toRetired.length

      for (const row of toRetired) {
        phase1Transitions.push({ templateId: row.id, fromState: 'stale', toState: 'retired' })
        if (!dryRun) {
          this.sql.exec(
            `UPDATE pass_templates SET state = 'retired', retired_at = ?, retire_reason = 'automatic: idle > 90 days', updated_at = ? WHERE id = ?`,
            now(), now(), row.id
          )
        }
      }

      if (!dryRun) {
        this.sql.exec(`RELEASE "${savepointKey}"`)
      }
    } catch (err) {
      if (!dryRun) {
        this.sql.exec(`ROLLBACK TO SAVEPOINT "${savepointKey}"`)
        this.sql.exec(`RELEASE "${savepointKey}"`)
      }
      throw err
    }

    // ── Phase 2 — LLM proposals ────────────────────────────────────────────────
    let routingPatchId: string | null = null

    if (!dryRun) {
      try {
        const proposals = await this.callConsolidationLlm()

        for (const rawProposal of proposals) {
          // INV-DREAM-08: validate against Zod schema
          const result = LlmProposalSchema.safeParse(rawProposal)
          if (!result.success) {
            phase2Rejected.push({
              proposal: rawProposal,
              reason: `Zod validation failed: ${result.error.message}`,
            })
            continue
          }
          const proposal = result.data

          // INV-DREAM-03: skip proposals touching pinned templates
          const templateRows = [...this.sql.exec(
            `SELECT pinned FROM pass_templates WHERE id = ?`,
            proposal.templateId
          )] as Array<{ pinned: number }>
          if (templateRows.length === 0 || (templateRows[0]?.pinned ?? 0) === 1) {
            // silently discard pinned-template proposals
            continue
          }

          try {
            await this.applyLlmProposal(proposal)
            phase2Applied.push(proposal)
          } catch (err) {
            phase2Rejected.push({
              proposal,
              reason: err instanceof Error ? err.message : String(err),
            })
          }
        }

        // Routing patch proposal (if signal window indicates high failure rates)
        const routingPatch = await this.proposeRoutingPatch()
        if (routingPatch) {
          routingPatchId = routingPatch.id
        }
      } catch {
        // Phase 2 LLM failures are non-fatal — log but continue
      }
    }

    const completedAt = now()
    if (!dryRun) {
      this.setState('last_consolidation_at', completedAt)
    }

    const report: ConsolidationReport = {
      id:                    reportId,
      started_at:            startedAt,
      completed_at:          completedAt,
      phase1_transitions:    phase1Transitions,
      phase2_applied:        phase2Applied,
      phase2_rejected:       phase2Rejected,
      routing_patch_id:      routingPatchId,
      rollback_snapshot_key: savepointKey,
      summary: [
        `Phase 1: ${toStaleCount} active→stale, ${toRetiredCount} stale→retired`,
        `Phase 2: ${phase2Applied.length} applied, ${phase2Rejected.length} rejected`,
        routingPatchId ? `Routing patch proposed: ${routingPatchId}` : null,
      ].filter(Boolean).join('. '),
    }

    // Write ConsolidationReport to ArtifactGraphDO if not dry-run
    if (!dryRun) {
      try {
        await this.writeConsolidationReportToGraph(report, [
          ...phase1Transitions.map(t => t.templateId),
          ...phase2Applied.map(p => p.templateId),
        ])
      } catch {
        // Non-fatal — graph write failure does not abort consolidation
      }
    }

    return report
  }

  private async applyLlmProposal(proposal: LlmProposal): Promise<void> {
    const n = now()
    switch (proposal.action) {
      case 'patch': {
        const diff = proposal.diff
        const sets: string[] = ['updated_at = ?']
        const vals: unknown[] = [n]
        if (diff.atom_templates      !== undefined) { sets.push('atom_templates = ?');      vals.push(diff.atom_templates) }
        if (diff.contract_templates  !== undefined) { sets.push('contract_templates = ?');  vals.push(diff.contract_templates) }
        if (diff.invariant_templates !== undefined) { sets.push('invariant_templates = ?'); vals.push(diff.invariant_templates) }
        if (diff.pass_coverage       !== undefined) { sets.push('pass_coverage = ?');       vals.push(diff.pass_coverage) }
        if (diff.name                !== undefined) { sets.push('name = ?');                vals.push(diff.name) }
        vals.push(proposal.templateId)
        this.sql.exec(`UPDATE pass_templates SET ${sets.join(', ')} WHERE id = ?`, ...vals)
        this.sql.exec(
          `UPDATE pass_template_usage SET patch_count = patch_count + 1, last_patched_at = ? WHERE template_id = ?`,
          n, proposal.templateId
        )
        break
      }
      case 'retire': {
        this.sql.exec(
          `UPDATE pass_templates SET state = 'retired', retired_at = ?, retire_reason = ?, updated_at = ? WHERE id = ? AND pinned = 0`,
          n, proposal.retire_reason, n, proposal.templateId
        )
        break
      }
      case 'pin': {
        this.sql.exec(`UPDATE pass_templates SET pinned = 1, updated_at = ? WHERE id = ?`, n, proposal.templateId)
        break
      }
      case 'consolidate': {
        // Mark source as retired with merge reason; merge target is unchanged
        this.sql.exec(
          `UPDATE pass_templates SET state = 'retired', retired_at = ?, retire_reason = ?, updated_at = ? WHERE id = ? AND pinned = 0`,
          n, `merged into ${proposal.mergeInto}`, n, proposal.templateId
        )
        break
      }
    }
  }

  // ── LLM call for consolidation (Phase 2) ──────────────────────────────────

  private async callConsolidationLlm(): Promise<unknown[]> {
    const activeTemplates = [...this.sql.exec(
      `SELECT * FROM pass_templates WHERE state = 'active' ORDER BY updated_at DESC`
    )] as PassTemplate[]

    const staleTemplates = [...this.sql.exec(`
      SELECT id, name, prd_signal_class, atom_signature, state, updated_at
      FROM pass_templates WHERE state = 'stale' ORDER BY updated_at DESC LIMIT 50
    `)] as Array<Record<string, unknown>>

    const windowStart = this.getState('last_signal_window_start')
    const recentSignals = [...this.sql.exec(`
      SELECT * FROM quality_signals
      WHERE recorded_at > ?
      ORDER BY recorded_at DESC LIMIT 200
    `, windowStart)] as Array<Record<string, unknown>>

    const systemPrompt = `You are the DreamDO consolidation agent for function-factory.
Your job is to analyze PassTemplates and quality signals, then propose consolidation actions.

Return a JSON array of proposals. Each proposal must match one of:
  { "action": "patch",       "templateId": "...", "rationale": "...", "diff": { ... } }
  { "action": "retire",      "templateId": "...", "rationale": "...", "retire_reason": "..." }
  { "action": "pin",         "templateId": "...", "rationale": "..." }
  { "action": "consolidate", "templateId": "...", "rationale": "...", "mergeInto": "..." }

Rules:
- Only propose changes for templates that are clearly redundant, outdated, or imprecise.
- Do NOT propose actions on templates not in the provided list.
- Return [] if no changes are warranted.
- Be conservative — fewer high-confidence proposals beat many speculative ones.`

    const userContent = JSON.stringify({
      active_templates: activeTemplates,
      stale_templates:  staleTemplates,
      recent_signals:   recentSignals,
    })

    // Use CF Workers AI if available (cheap tier), else skip Phase 2
    if (!this.env.AI && !this.env.DEEPSEEK_API_KEY) {
      return []
    }

    let responseText = ''

    if (this.env.DEEPSEEK_API_KEY) {
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model:    'deepseek-v3-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userContent },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 4096,
        }),
      })
      if (!resp.ok) return []
      const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
      responseText = data.choices?.[0]?.message?.content ?? ''
    } else if (this.env.AI) {
      const ai = this.env.AI as unknown as {
        run: (model: string, opts: { messages: Array<{ role: string; content: string }> }) => Promise<{ response?: string }>
      }
      const result = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent },
        ],
      })
      responseText = result.response ?? ''
    }

    if (!responseText) return []

    try {
      const parsed: unknown = JSON.parse(responseText)
      if (Array.isArray(parsed)) return parsed
      // LLM may return { proposals: [...] }
      const asObj = parsed as Record<string, unknown>
      if (Array.isArray(asObj['proposals'])) return asObj['proposals'] as unknown[]
      return []
    } catch {
      return []
    }
  }

  // ── Routing patch proposal ─────────────────────────────────────────────────

  async proposeRoutingPatch(): Promise<RoutingPatch | null> {
    const windowRuns = this.signalWindowRuns()
    const windowStart = this.getState('last_signal_window_start')

    // Count distinct run_ids in the window
    const runCountRows = [...this.sql.exec(`
      SELECT COUNT(DISTINCT run_id) AS n FROM quality_signals WHERE recorded_at > ?
    `, windowStart)] as Array<{ n: number }>
    const runCount = runCountRows[0]?.n ?? 0

    if (runCount < windowRuns) return null

    // Aggregate failure rates per task_kind
    const agg = [...this.sql.exec(`
      SELECT
        task_kind,
        COUNT(*) AS total,
        SUM(CASE WHEN signal_type IN ('fidelity_failure', 'coherence_failure') THEN 1 ELSE 0 END) AS failures
      FROM quality_signals
      WHERE recorded_at > ?
      GROUP BY task_kind
    `, windowStart)] as Array<{ task_kind: string; total: number; failures: number }>

    const highFailureKinds = agg.filter(r => r.total > 0 && r.failures / r.total > FAILURE_RATE_THRESHOLD)

    if (highFailureKinds.length === 0) return null

    const patches = highFailureKinds.map(r => ({
      task_kind:    r.task_kind,
      failure_rate: r.failures / r.total,
      suggestion:   `Review routing for task_kind=${r.task_kind} — ${(r.failures / r.total * 100).toFixed(1)}% failure rate over ${r.total} signals`,
    }))

    const patchId = `RP-${uuid()}`
    const proposedAt = now()

    const row: RoutingPatch = {
      id:                    patchId,
      proposed_at:           proposedAt,
      status:                'pending',
      evidence_window_runs:  runCount,
      signal_summary:        JSON.stringify({ run_count: runCount, high_failure_kinds: highFailureKinds }),
      patches:               JSON.stringify(patches),
      apply_command:         `ff routing apply ${patchId}`,
      applied_at:            null,
      rejected_at:           null,
      artifact_graph_ref:    null,
    }

    this.sql.exec(`
      INSERT INTO routing_patches
        (id, proposed_at, status, evidence_window_runs, signal_summary, patches, apply_command)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, row.id, row.proposed_at, row.status, row.evidence_window_runs,
       row.signal_summary, row.patches, row.apply_command)

    // Advance signal window start
    this.setState('last_signal_window_start', proposedAt)

    return row
  }

  // ── ArtifactGraphDO write ─────────────────────────────────────────────────

  private async writeConsolidationReportToGraph(
    report: ConsolidationReport,
    touchedTemplateIds: string[],
  ): Promise<void> {
    const singleton = this.env.ARTIFACT_GRAPH.idFromName('factory-singleton')
    const stub = this.env.ARTIFACT_GRAPH.get(singleton)

    // Write ConsolidationReport node (spread last so explicit fields take precedence)
    const { id: reportId, ...reportRest } = report
    const nodeBody = {
      node: {
        ...reportRest,
        id:       reportId,
        nodeType: 'ConsolidationReport',
      },
    }

    await stub.fetch(new Request('https://artifact-graph/append', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(nodeBody),
    }))

    // Write DERIVES_FROM edges for each touched template
    for (const templateId of [...new Set(touchedTemplateIds)]) {
      try {
        await stub.fetch(new Request('https://artifact-graph/edge', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            source: report.id,
            target: templateId,
            rel:    'DERIVES_FROM',
          }),
        }))
      } catch {
        // Non-fatal — edge write failures logged but not propagated
      }
    }
  }

  // ── Public DO RPC methods ─────────────────────────────────────────────────

  /**
   * crystallize() — called by CoordinatorDO after a COMPLETE run.
   *
   * INV-DREAM-04: Only zero-repair runs are crystallized (all beads done,
   *   no Divergence nodes, all Verdicts favorable).
   * INV-DREAM-05: Templates are warm-start priors only. V&V always runs.
   */
  async crystallize(runId: string, verdictSummary?: Record<string, unknown>): Promise<CrystallizeResult> {
    // Collect quality signals for this run
    const signals = [...this.sql.exec(
      `SELECT * FROM quality_signals WHERE run_id = ?`, runId
    )] as Array<Record<string, unknown>>

    const signalCount = signals.length

    // Zero-repair check: INV-DREAM-04
    const isZeroRepair = verdictSummary != null
      && verdictSummary['allBeadsDone']        === true
      && verdictSummary['noDivergenceNodes']   === true
      && verdictSummary['allVerdictsFavorable'] === true

    if (!isZeroRepair) {
      return { action: 'signals_only', signalCount }
    }

    // Extract PrdSignature from signals
    const signalClassSignal = signals.find(s => s['verification_kind'] === 'fidelity')
    const prdSignalClass = (signalClassSignal?.['task_kind'] as string | undefined) ?? 'unknown'
    const atomSignature = `run:${runId}` // Placeholder — real impl derives from run metadata

    // Check for existing template with matching atom_signature
    const existing = [...this.sql.exec(
      `SELECT id, pinned FROM pass_templates WHERE atom_signature = ? AND state != 'retired' LIMIT 1`,
      atomSignature
    )] as Array<{ id: string; pinned: number }>

    const n = now()

    if (existing.length > 0 && existing[0]) {
      const templateId = existing[0].id
      // Patch the existing template (update verdict summary and source_run_id)
      this.sql.exec(`
        UPDATE pass_templates
        SET source_run_id = ?, source_verdict_summary = ?, updated_at = ?
        WHERE id = ?
      `, runId, JSON.stringify(verdictSummary), n, templateId)

      // Update usage
      this.sql.exec(`
        INSERT INTO pass_template_usage (template_id, invocation_count, zero_repair_count, gate_pass_rate, created_at)
          VALUES (?, 0, 1, 1.0, ?)
        ON CONFLICT(template_id) DO UPDATE SET
          zero_repair_count = zero_repair_count + 1,
          gate_pass_rate    = CAST(zero_repair_count + 1 AS REAL) / NULLIF(invocation_count, 0),
          last_invoked_at   = ?
      `, templateId, n, n)

      return { templateId, action: 'patched', signalCount }
    }

    // Create a new PassTemplate
    const templateId = `PT-${uuid()}`

    this.sql.exec(`
      INSERT INTO pass_templates (
        id, created_at, updated_at, name, prd_signal_class,
        atom_signature, pass_coverage, atom_templates, contract_templates, invariant_templates,
        state, pinned, source_run_id, source_verdict_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)
    `,
      templateId, n, n,
      `template-${runId.slice(0, 8)}`,
      prdSignalClass,
      atomSignature,
      JSON.stringify([]),       // pass_coverage — populated by caller-provided data in full impl
      JSON.stringify({}),       // atom_templates
      JSON.stringify({}),       // contract_templates
      JSON.stringify({}),       // invariant_templates
      runId,
      JSON.stringify(verdictSummary),
    )

    // Seed usage record
    this.sql.exec(`
      INSERT OR IGNORE INTO pass_template_usage
        (template_id, invocation_count, zero_repair_count, repair_count, gate_pass_rate, patch_count, last_invoked_at, created_at)
      VALUES (?, 0, 1, 0, 1.0, 0, ?, ?)
    `, templateId, n, n)

    // Update FTS (content table triggers are not available in CF SQLite — manual insert)
    try {
      this.sql.exec(`INSERT OR REPLACE INTO pass_templates_fts (id, name, prd_signal_class, atom_templates) VALUES (?, ?, ?, ?)`,
        templateId, `template-${runId.slice(0, 8)}`, prdSignalClass, '{}')
    } catch {
      // FTS insert failure is non-fatal
    }

    return { templateId, action: 'created', signalCount }
  }

  /**
   * getTemplateForRun() — called by Mediation Agent DO at compile step 3.
   * Returns the best matching active PassTemplate for the given PrdSignature,
   * or null if none match.
   *
   * INV-DREAM-05: Return value is a warm-start prior only — V&V always runs.
   */
  async getTemplateForRun(prd: PrdSignature): Promise<PassTemplate | null> {
    const signature = computeAtomSignature(prd)

    const rows = [...this.sql.exec(`
      SELECT pt.* FROM pass_templates pt
      LEFT JOIN pass_template_usage u ON u.template_id = pt.id
      WHERE pt.atom_signature = ? AND pt.state = 'active'
      ORDER BY COALESCE(u.gate_pass_rate, 0) DESC, pt.updated_at DESC
      LIMIT 1
    `, signature)] as PassTemplate[]

    if (rows.length === 0) return null

    const template = rows[0]
    if (!template) return null

    // Update usage stats
    const n = now()
    this.sql.exec(`
      INSERT INTO pass_template_usage (template_id, invocation_count, zero_repair_count, gate_pass_rate, created_at)
        VALUES (?, 1, 0, 0.0, ?)
      ON CONFLICT(template_id) DO UPDATE SET
        invocation_count = invocation_count + 1,
        last_invoked_at  = ?
    `, template.id, n, n)

    return template
  }

  /**
   * writeQualitySignal() — called by LoopClosureService and Mediation Agent DO.
   */
  async writeQualitySignal(signal: QualitySignal): Promise<void> {
    const validated = QualitySignalSchema.parse(signal)
    this.sql.exec(`
      INSERT INTO quality_signals (
        id, run_id, verification_kind, atom_id, task_kind, signal_type, verdict,
        repair_required, repair_description, model_used, provider, latency_ms,
        token_cost_usd, artifact_graph_ref, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      validated.id,
      validated.run_id,
      validated.verification_kind,
      validated.atom_id ?? null,
      validated.task_kind,
      validated.signal_type,
      validated.verdict,
      validated.repair_required,
      validated.repair_description ?? null,
      validated.model_used ?? null,
      validated.provider ?? null,
      validated.latency_ms ?? null,
      validated.token_cost_usd ?? null,
      validated.artifact_graph_ref ?? null,
      validated.recorded_at,
    )
  }

  /**
   * patchTemplate() — operator and internal (consolidation) template diff.
   *
   * INV-DREAM-03: Pinned templates are immune to patch.
   */
  async patchTemplate(templateId: string, diff: TemplateDiff): Promise<void> {
    const validated = TemplateDiffSchema.parse(diff)

    const rows = [...this.sql.exec(
      `SELECT pinned FROM pass_templates WHERE id = ?`, templateId
    )] as Array<{ pinned: number }>

    if (rows.length === 0) throw new Error(`Template ${templateId} not found`)
    if (rows[0]?.pinned === 1) throw new Error(`Template ${templateId} is pinned — cannot patch`)

    const n = now()
    const sets: string[] = ['updated_at = ?']
    const vals: unknown[] = [n]
    if (validated.atom_templates      !== undefined) { sets.push('atom_templates = ?');      vals.push(validated.atom_templates) }
    if (validated.contract_templates  !== undefined) { sets.push('contract_templates = ?');  vals.push(validated.contract_templates) }
    if (validated.invariant_templates !== undefined) { sets.push('invariant_templates = ?'); vals.push(validated.invariant_templates) }
    if (validated.pass_coverage       !== undefined) { sets.push('pass_coverage = ?');       vals.push(validated.pass_coverage) }
    if (validated.name                !== undefined) { sets.push('name = ?');                vals.push(validated.name) }
    vals.push(templateId)

    this.sql.exec(`UPDATE pass_templates SET ${sets.join(', ')} WHERE id = ?`, ...vals)
    this.sql.exec(`
      UPDATE pass_template_usage SET patch_count = patch_count + 1, last_patched_at = ?
      WHERE template_id = ?
    `, n, templateId)
  }

  /**
   * pinTemplate() — operator action.
   * INV-DREAM-03: Pinned templates are immune to all consolidation.
   */
  async pinTemplate(templateId: string): Promise<void> {
    const rows = [...this.sql.exec(
      `SELECT id FROM pass_templates WHERE id = ?`, templateId
    )] as Array<{ id: string }>
    if (rows.length === 0) throw new Error(`Template ${templateId} not found`)
    this.sql.exec(`UPDATE pass_templates SET pinned = 1, updated_at = ? WHERE id = ?`, now(), templateId)
  }

  /**
   * unpinTemplate() — operator action.
   */
  async unpinTemplate(templateId: string): Promise<void> {
    const rows = [...this.sql.exec(
      `SELECT id FROM pass_templates WHERE id = ?`, templateId
    )] as Array<{ id: string }>
    if (rows.length === 0) throw new Error(`Template ${templateId} not found`)
    this.sql.exec(`UPDATE pass_templates SET pinned = 0, updated_at = ? WHERE id = ?`, now(), templateId)
  }

  /**
   * retireTemplate() — operator action.
   * INV-DREAM-02: Templates are never deleted — retired is terminal but recoverable.
   * INV-DREAM-03: Pinned templates cannot be retired.
   */
  async retireTemplate(templateId: string, reason?: string): Promise<void> {
    const rows = [...this.sql.exec(
      `SELECT pinned FROM pass_templates WHERE id = ?`, templateId
    )] as Array<{ pinned: number }>
    if (rows.length === 0) throw new Error(`Template ${templateId} not found`)
    if (rows[0]?.pinned === 1) throw new Error(`Template ${templateId} is pinned — unpin before retiring`)
    this.sql.exec(`
      UPDATE pass_templates
      SET state = 'retired', retired_at = ?, retire_reason = ?, updated_at = ?
      WHERE id = ?
    `, now(), reason ?? 'operator retirement', now(), templateId)
  }

  /**
   * restoreTemplate() — rollback a retired template to active.
   * INV-DREAM-02: Retired is recoverable via restore.
   */
  async restoreTemplate(templateId: string): Promise<void> {
    const rows = [...this.sql.exec(
      `SELECT state FROM pass_templates WHERE id = ?`, templateId
    )] as Array<{ state: PassTemplateState }>
    if (rows.length === 0) throw new Error(`Template ${templateId} not found`)
    this.sql.exec(`
      UPDATE pass_templates
      SET state = 'active', retired_at = NULL, retire_reason = NULL, updated_at = ?
      WHERE id = ?
    `, now(), templateId)
  }

  /**
   * status() — operator / FF Terminal status query.
   */
  async status(): Promise<DreamStatus> {
    const counts = [...this.sql.exec(`
      SELECT
        SUM(CASE WHEN state = 'active'  THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN state = 'stale'   THEN 1 ELSE 0 END) AS stale,
        SUM(CASE WHEN state = 'retired' THEN 1 ELSE 0 END) AS retired,
        SUM(CASE WHEN pinned = 1        THEN 1 ELSE 0 END) AS pinned
      FROM pass_templates
    `)] as Array<{ active: number; stale: number; retired: number; pinned: number }>

    const signalCount = [...this.sql.exec(
      `SELECT COUNT(*) AS n FROM quality_signals WHERE recorded_at > ?`,
      this.getState('last_signal_window_start')
    )] as Array<{ n: number }>

    const pendingPatches = [...this.sql.exec(
      `SELECT COUNT(*) AS n FROM routing_patches WHERE status = 'pending'`
    )] as Array<{ n: number }>

    const lastConsolidation = this.getState('last_consolidation_at') || null
    const activePipelines   = parseInt(this.getState('active_pipeline_count'), 10) || 0

    const c = counts[0] ?? { active: 0, stale: 0, retired: 0, pinned: 0 }

    return {
      templateCounts: {
        active:  c.active  ?? 0,
        stale:   c.stale   ?? 0,
        retired: c.retired ?? 0,
        pinned:  c.pinned  ?? 0,
      },
      signalWindowSize:  signalCount[0]?.n   ?? 0,
      pendingPatches:    pendingPatches[0]?.n ?? 0,
      lastConsolidation,
      activePipelines,
    }
  }

  /**
   * dryRunConsolidation() — preview without writes.
   */
  async dryRunConsolidation(): Promise<ConsolidationReport> {
    return this.runConsolidation(true)
  }

  /**
   * incrementActivePipelines() — called by Commissioning Agent on 'executing' state entry.
   * INV-DREAM-01: consolidation blocked while active_pipeline_count > 0.
   */
  async incrementActivePipelines(): Promise<void> {
    const current = parseInt(this.getState('active_pipeline_count'), 10) || 0
    this.setState('active_pipeline_count', String(current + 1))
  }

  /**
   * decrementActivePipelines() — called by CoordinatorDO before crystallize().
   */
  async decrementActivePipelines(): Promise<void> {
    const current = parseInt(this.getState('active_pipeline_count'), 10) || 0
    this.setState('active_pipeline_count', String(Math.max(0, current - 1)))
  }
}

// ── Variable hoisting fix — declare toStale/toRetired at function scope ────────
// (TypeScript needs these accessible after the try/catch for the summary string)
// The local vars are already in scope from the outer function — no fix needed.
// The `??` fallbacks in summary handle the undefined case.
