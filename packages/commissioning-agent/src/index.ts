/**
 * @factory/commissioning-agent — CommissioningAgentDO
 *
 * Durable Object that orchestrates the I-layer commissioning lifecycle.
 * Extends Think<Env> for workspace access and LLM session management.
 *
 * Endpoint contracts:
 *   POST /signal             — CommissioningSignal → phases 1-3 → Mediation Agent
 *   POST /divergence         — DivergenceNotification → phases 4-5 → Amendment
 *   POST /workspace/write    — inject T2 spec skills before /signal
 *
 * Phase flow:
 *   pattern-appraisal → deliberation → workgraph-authoring (signal path)
 *   hypothesis-formation → amendment-proposal (divergence path)
 */

import { Think } from '@cloudflare/think'
import { Workspace } from '@cloudflare/shell'
import type { Session, SkillSource } from '@cloudflare/think'
import type { Env } from './env.js'
import { emitSubscriptionEvent } from '@factory/subscription-buffer'
import { resolveSkillRefs } from './skill-registry.js'
import {
  CommissioningSignalSchema,
  DivergenceNotificationSchema,
  WorkspaceWriteSchema,
} from './schemas.js'
import type {
  DomainProfile,
  Phase,
  SessionContext,
  HypothesisNode,
  CycleContext,
} from './schemas.js'
import {
  runPatternAppraisal,
  runDeliberation,
  runWorkGraphAuthoring,
  runHypothesisFormation,
  runAmendmentProposal,
} from './phases/index.js'
import { getCycleContext, invalidateCycleCache } from './cycle-awareness.js'
import { deriveAdvisoryMetrics, buildHealthSyncRequest, pushHealthDocument } from './health-document.js'
import { buildAdvisoryHypothesisSyncRequest } from './advisory-hypothesis-sync.js'
import { BUNDLED_SKILLS } from './bundled-skills-manifest.js'
import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import { gateway } from '@ai-sdk/gateway'

const ALARM_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

// ── Session context SQLite DDL ─────────────────────────────────────────────────

const SESSION_CONTEXT_DDL = `
CREATE TABLE IF NOT EXISTS session_context (
  org_id              TEXT PRIMARY KEY,
  current_phase       TEXT NOT NULL DEFAULT 'idle',
  domain_profile      TEXT NOT NULL DEFAULT '{"vertical":"generic","orgContext":"","constraints":[],"version":"1.0"}',
  active_run_id       TEXT,
  last_signal_at      TEXT,
  last_divergence_at  TEXT,
  updated_at          TEXT NOT NULL
);
`

// ── CommissioningAgentDO ──────────────────────────────────────────────────────

export class CommissioningAgentDO extends Think<Env> {
  /** Cached session context — reloaded from SQLite on each handler entry. */
  private _sessionCtx: SessionContext | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Ensure workspace is backed by DO SQLite (Think default)
    this.workspace = new Workspace({ sql: ctx.storage.sql, name: () => this.name })
    // Initialize session_context table synchronously via blockConcurrencyWhile
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(SESSION_CONTEXT_DDL)
    })
  }

  // ── orgId ───────────────────────────────────────────────────────────────────

  private get orgId(): string {
    // DO is stubbed: idFromName('commissioning-agent:{orgId}')
    const n = this.name ?? ''
    const prefix = 'commissioning-agent:'
    return n.startsWith(prefix) ? n.slice(prefix.length) : n || 'unknown'
  }

  // ── Subscription event helper ────────────────────────────────────────────────

  private emitCA(
    sessionId: string,
    kind: string,
    payload: Record<string, unknown>,
    terminal = false,
  ): void {
    if (!this.env.SUB_BUFFER || !this.env.SUB_BUFFER_PRODUCER_SECRET) return
    void emitSubscriptionEvent(this.env.SUB_BUFFER, this.env.SUB_BUFFER_PRODUCER_SECRET, {
      sessionId,
      stream: 'sessionEvents',
      kind,
      payload,
      occurredAt: Date.now(),
      terminal,
    })
  }

  // ── Think<Env> overrides ────────────────────────────────────────────────────

  override getModel(): LanguageModel {
    return gateway('anthropic/claude-sonnet-4-6')
  }

  override getSystemPrompt(): string {
    return this._buildSoulPrompt(
      (this._sessionCtx?.domainProfile ?? {
        vertical: 'generic',
        orgContext: '',
        constraints: [],
        version: '1.0',
      }) as DomainProfile,
    )
  }

  override async configureSession(session: Session): Promise<Session> {
    const ctx = await this.restoreSessionContext()
    const profile = ctx.domainProfile

    return session
      .withContext('org-context', {
        description: 'Organisation context for this commissioning session',
        maxTokens: 800,
        provider: {
          get: async () =>
            `Vertical: ${profile.vertical}\nOrg: ${profile.orgContext || '(not set)'}`,
        },
      })
      .withContext('domain-constraints', {
        description: 'Domain constraints for this commissioning session',
        maxTokens: 1200,
        provider: {
          get: async () => {
            if (profile.constraints.length === 0) return 'No domain constraints.'
            return profile.constraints
              .map((c) => `[${c.severity.toUpperCase()}] ${c.id}: ${c.description}`)
              .join('\n')
          },
        },
      })
  }

  override async getSkills(): Promise<SkillSource[]> {
    const ctx = await this.restoreSessionContext()
    const phase = ctx.currentPhase
    const profile = ctx.domainProfile

    const refs = resolveSkillRefs(
      profile.vertical,
      phase === 'idle' ? 'pattern-appraisal' : phase,
      profile.additionalSkillRefs ?? [],
    )

    // Build an in-memory SkillSource from bundled refs
    const bundledRefs = refs.filter((r) => r.startsWith('bundled:'))
    const bundledSource = buildBundledSkillSource(bundledRefs)

    // workspace: refs are served from the Think workspace filesystem
    const workspaceRefs = refs.filter((r) => r.startsWith('workspace:'))
    const workspaceSource = buildWorkspaceSkillSource(workspaceRefs, this.workspace)

    return [bundledSource, workspaceSource]
  }

  override async beforeTurn(_ctx: import('@cloudflare/think').TurnContext): Promise<import('@cloudflare/think').TurnConfig | void> {
    const ctx = await this.restoreSessionContext()
    // Hypothesis-formation requires Claude Opus (CA-INV-003)
    if (ctx.currentPhase === 'hypothesis-formation') {
      return { model: gateway('anthropic/claude-opus-4-6') }
    }
  }

  // ── fetch router ─────────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST') {
      if (url.pathname === '/signal') {
        return this.handleSignal(request)
      }
      if (url.pathname === '/divergence') {
        return this.handleDivergence(request)
      }
      if (url.pathname === '/workspace/write') {
        return this.handleWorkspaceWrite(request)
      }
    }

    return super.fetch(request)
  }

  // ── Endpoint handlers ────────────────────────────────────────────────────────

  private async handleSignal(request: Request): Promise<Response> {
    const body = await request.json()
    const parse = CommissioningSignalSchema.safeParse(body)
    if (!parse.success) {
      return new Response(JSON.stringify({ error: 'invalid-signal', issues: parse.error.issues }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const signal = parse.data
    // Use dispositionEventId as per-commission sessionId for subscription events
    const caSessionId = signal.dispositionEventId

    // Emit SESSION_SUBMITTED on incoming signal
    this.emitCA(caSessionId, 'SESSION_SUBMITTED', { orgId: this.orgId, dispositionEventId: signal.dispositionEventId })

    // Persist domain profile before phase execution
    await this.persistSessionContext({
      currentPhase: 'pattern-appraisal',
      domainProfile: signal.domainProfile,
      lastSignalAt: new Date().toISOString(),
    })

    // ── Phase 1: Pattern Appraisal ──
    await this.setPhase('pattern-appraisal')
    const appraisal = await runPatternAppraisal(
      (prompt) => this._generateText(prompt),
      signal,
    )
    if (!appraisal.matches) {
      await this.setPhase('idle')
      return jsonResponse({ status: 'archived', reason: appraisal.reason })
    }

    // ── Phase 2: Deliberation ──
    await this.setPhase('deliberation')
    const candidateSet = await runDeliberation(
      (prompt) => this._generateText(prompt),
      signal,
    )
    if (!candidateSet) {
      await this.setPhase('idle')
      return jsonResponse({ status: 'rejected', reason: 'deliberation-failed' })
    }

    // Emit CANDIDATE_SET_BUILT after deliberation succeeds
    this.emitCA(caSessionId, 'CANDIDATE_SET_BUILT', { orgId: this.orgId })

    // Human approval gate (per SPEC-FF-ILAYER-EXEC-001 §1)
    // In v1 the gateway enforces this — the DO logs it as advisory.
    if (signal.requireHumanApproval) {
      console.log(`[CommissioningAgentDO:${this.orgId}] human approval gate — not enforced by DO in v1`)
      // Emit APPROVAL_GRANTED (advisory in v1 — gateway enforces in production)
      this.emitCA(caSessionId, 'APPROVAL_GRANTED', { orgId: this.orgId, advisory: true })
    }

    // ── Phase 3: WorkGraph Authoring ──
    await this.setPhase('workgraph-authoring')
    const workGraph = await runWorkGraphAuthoring(
      (prompt) => this._generateText(prompt),
      signal,
      candidateSet,
      this.orgId,
    )
    if (!workGraph) {
      await this.setPhase('idle')
      return jsonResponse({ status: 'rejected', reason: 'workgraph-authoring-failed' })
    }

    // ── Commission: POST to Mediation Agent ──
    const mediationId = this.env.MEDIATION_AGENT.idFromName(`mediation-agent:${this.orgId}`)
    const mediationStub = this.env.MEDIATION_AGENT.get(mediationId)
    let commissionResp: Response

    // Emit COMPILATION_STARTED before calling Mediation Agent
    this.emitCA(caSessionId, 'COMPILATION_STARTED', { orgId: this.orgId, workGraphId: workGraph.id })

    try {
      commissionResp = await mediationStub.fetch(
        new Request('https://mediation-agent/commission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workGraph,
            orgId: this.orgId,
            dispositionEventId: signal.dispositionEventId,
          }),
        }),
      )
    } catch (err) {
      await this.setPhase('idle')
      const errMsg = err instanceof Error ? err.message : String(err)
      this.emitCA(caSessionId, 'COMPILATION_FAILED', { orgId: this.orgId, reason: errMsg })
      return jsonResponse(
        { status: 'commission-failed', error: errMsg },
        500,
      )
    }

    // Emit COMPILATION_COMPLETE or COMPILATION_FAILED based on response
    if (commissionResp.ok) {
      this.emitCA(caSessionId, 'COMPILATION_COMPLETE', { orgId: this.orgId, workGraphId: workGraph.id })
    } else {
      this.emitCA(caSessionId, 'COMPILATION_FAILED', { orgId: this.orgId, status: commissionResp.status })
    }

    // Arm 6h alarm for cycle advisory surfacing (first commission only)
    await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS)

    await this.setPhase('idle')
    // Emit MONITORED (terminal) on session complete
    this.emitCA(caSessionId, 'MONITORED', { orgId: this.orgId }, true)

    // Proxy the mediation agent response
    const commissionBody = await commissionResp.text()
    return new Response(commissionBody, {
      status: commissionResp.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async handleDivergence(request: Request): Promise<Response> {
    const body = await request.json()
    const parse = DivergenceNotificationSchema.safeParse(body)
    if (!parse.success) {
      return new Response(
        JSON.stringify({ error: 'invalid-divergence', issues: parse.error.issues }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const divergence = parse.data
    // Use runId from divergence notification as sessionId for subscription events
    const divSessionId = divergence.runId

    await this.persistSessionContext({
      currentPhase: 'hypothesis-formation',
      lastDivergenceAt: new Date().toISOString(),
    })

    const ctx = await this.restoreSessionContext()

    // ── Phase 4: Hypothesis Formation (Claude Opus) ──
    await this.setPhase('hypothesis-formation')
    const hypothesis = await runHypothesisFormation(
      (prompt) => this._generateText(prompt),
      divergence,
      this.orgId,
      ctx.domainProfile.vertical,
    )
    if (!hypothesis) {
      await this.setPhase('idle')
      return jsonResponse({ status: 'failed', reason: 'hypothesis-formation-failed' }, 500)
    }

    // Persist Hypothesis to ArtifactGraphDO
    await this.writeHypothesisToArtifactGraph(hypothesis)

    // ── Phase 5: Amendment Proposal ──
    await this.setPhase('amendment-proposal')
    const amendment = await runAmendmentProposal(
      (prompt) => this._generateText(prompt),
      hypothesis,
      this.orgId,
    )
    if (!amendment) {
      await this.setPhase('idle')
      return jsonResponse({ status: 'failed', reason: 'amendment-proposal-failed' }, 500)
    }

    // Persist Amendment to ArtifactGraphDO
    await this.writeAmendmentToArtifactGraph(amendment)

    // Emit AMENDMENT_PROPOSED after amendment is written
    this.emitCA(divSessionId, 'AMENDMENT_PROPOSED', {
      amendmentId: amendment.id,
      divergenceId: divergence.divergenceId,
      specificationId: divergence.specificationId,
    })

    await this.setPhase('idle')
    return jsonResponse({ status: 'proposed', amendmentId: amendment.id })
  }

  private async handleWorkspaceWrite(request: Request): Promise<Response> {
    const body = await request.json()
    const parse = WorkspaceWriteSchema.safeParse(body)
    if (!parse.success) {
      return new Response(
        JSON.stringify({ error: 'invalid-body', issues: parse.error.issues }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const { path, content } = parse.data
    await this.workspace.writeFile(path, content)
    return jsonResponse({ status: 'written' })
  }

  // ── Phase transition ──────────────────────────────────────────────────────────

  private async setPhase(phase: Phase): Promise<void> {
    await this.persistSessionContext({ currentPhase: phase })
  }

  // ── SQLite session context ────────────────────────────────────────────────────

  private async restoreSessionContext(): Promise<SessionContext> {
    if (this._sessionCtx) return this._sessionCtx

    const rows = this.ctx.storage.sql
      .exec<{
        org_id: string
        current_phase: string
        domain_profile: string
        active_run_id: string | null
        last_signal_at: string | null
        last_divergence_at: string | null
        updated_at: string
      }>('SELECT * FROM session_context WHERE org_id = ?', this.orgId)
      .toArray()

    if (rows.length === 0) {
      const defaultCtx: SessionContext = {
        orgId: this.orgId,
        currentPhase: 'idle',
        domainProfile: {
          vertical: 'generic',
          orgContext: '',
          constraints: [],
          version: '1.0',
        },
        activeRunId: null,
        lastSignalAt: null,
        lastDivergenceAt: null,
        updatedAt: new Date().toISOString(),
      }
      this._sessionCtx = defaultCtx
      return defaultCtx
    }

    const row = rows[0]
    if (!row) {
      throw new Error('unexpected: rows.length > 0 but rows[0] is undefined')
    }
    const ctx: SessionContext = {
      orgId: row.org_id,
      currentPhase: row.current_phase as Phase,
      domainProfile: JSON.parse(row.domain_profile) as DomainProfile,
      activeRunId: row.active_run_id,
      lastSignalAt: row.last_signal_at,
      lastDivergenceAt: row.last_divergence_at,
      updatedAt: row.updated_at,
    }
    this._sessionCtx = ctx
    return ctx
  }

  private async persistSessionContext(patch: Partial<SessionContext>): Promise<void> {
    const current = await this.restoreSessionContext()
    const updated: SessionContext = { ...current, ...patch, updatedAt: new Date().toISOString() }
    this._sessionCtx = updated

    this.ctx.storage.sql.exec(
      `INSERT INTO session_context
         (org_id, current_phase, domain_profile, active_run_id, last_signal_at, last_divergence_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         current_phase      = excluded.current_phase,
         domain_profile     = excluded.domain_profile,
         active_run_id      = excluded.active_run_id,
         last_signal_at     = excluded.last_signal_at,
         last_divergence_at = excluded.last_divergence_at,
         updated_at         = excluded.updated_at`,
      updated.orgId,
      updated.currentPhase,
      JSON.stringify(updated.domainProfile),
      updated.activeRunId,
      updated.lastSignalAt,
      updated.lastDivergenceAt,
      updated.updatedAt,
    )
  }

  // ── Soul prompt builder ───────────────────────────────────────────────────────

  private _buildSoulPrompt(profile: DomainProfile): string {
    const blocking = profile.constraints
      .filter((c) => c.severity === 'blocking')
      .map((c) => `  - [${c.id}] ${c.description}`)
    const advisory = profile.constraints
      .filter((c) => c.severity === 'advisory')
      .map((c) => `  - [${c.id}] ${c.description}`)

    return [
      `You are CommissioningAgentDO for organisation "${this.orgId}".`,
      `You produce governance artifacts for the Function Factory I-layer.`,
      ``,
      `Vertical: ${profile.vertical}`,
      profile.orgContext ? `Organisation context: ${profile.orgContext}` : '',
      ``,
      blocking.length > 0
        ? `Blocking constraints (MUST NOT be violated):\n${blocking.join('\n')}`
        : '',
      advisory.length > 0 ? `Advisory constraints:\n${advisory.join('\n')}` : '',
      ``,
      `Every artifact you produce MUST carry:`,
      `  - producedBy: CommissioningAgentDO:${this.orgId}`,
      `  - producedAt: (ISO timestamp)`,
      ``,
      `Never assume unstated constraints. When a constraint is ambiguous, surface it as advisory.`,
      `Never propose WorkGraph amendments without fault attribution grounded in Divergence evidence.`,
    ]
      .filter((l) => l !== '')
      .join('\n')
  }

  // ── alarm() — cycle-boundary advisory surfacing ───────────────────────────────

  override async alarm(): Promise<void> {
    const ctx = await this.restoreSessionContext()

    // Do not surface advisories if a phase is active — re-arm and return
    if (ctx.currentPhase !== 'idle') {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS)
      return
    }

    // Step 1: get cycle context (non-fatal)
    let cycle: CycleContext | null = null
    try {
      cycle = await getCycleContext(this.env.LINEAR_TEAM_ID, this.env.FACTORY_LINEAR_KV, this.env.LINEAR_API_KEY)
    } catch (err) {
      console.warn('[CommissioningAgentDO] getCycleContext failed:', err)
    }

    // Step 2: load pending advisory hypotheses
    const allHypotheses = await this.loadAllHypotheses()
    const pending = allHypotheses.filter((h) => h.severity === 'advisory' && !h.surfaced)

    // Step 3: surface advisories when in last 2 days of cycle (or no cycle)
    for (const hyp of pending) {
      if (!cycle || cycle.isLastTwoDays) {
        await this.surfaceAdvisoryHypothesis(hyp, cycle)
        await this.markHypothesisSurfaced(hyp.id)
      }
    }

    // Step 4: push health document to LinearSyncService (non-fatal)
    const metrics = deriveAdvisoryMetrics(allHypotheses)
    const healthRequest = buildHealthSyncRequest(this.orgId, ctx, cycle, metrics)
    await pushHealthDocument(this.env.LINEAR_SYNC_URL, healthRequest)

    // Step 5: cycle-end reconciliation + cache invalidation
    if (cycle?.isCycleEnd) {
      await this.runCycleReconciliation(cycle)
      // Invalidate KV cache so next alarm picks up the fresh cycle
      await invalidateCycleCache(this.env.LINEAR_TEAM_ID, this.env.FACTORY_LINEAR_KV)
    }

    // Re-arm alarm
    await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS)
  }

  // ── Alarm helpers ─────────────────────────────────────────────────────────────

  /**
   * Load all hypothesis nodes for this org from ArtifactGraphDO.
   * Returns empty array on failure (non-fatal).
   */
  private async loadAllHypotheses(): Promise<HypothesisNode[]> {
    try {
      const artifactId = this.env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${this.orgId}`)
      const stub = this.env.ARTIFACT_GRAPH.get(artifactId)
      const resp = await stub.fetch(
        new Request(
          'https://artifact-graph/query/hypothesis?status=CANDIDATE',
        ),
      )
      if (!resp.ok) return []
      return (await resp.json()) as HypothesisNode[]
    } catch {
      return []
    }
  }

  private async surfaceAdvisoryHypothesis(
    hyp: HypothesisNode,
    cycle: CycleContext | null,
  ): Promise<void> {
    try {
      const syncRequest = buildAdvisoryHypothesisSyncRequest(this.orgId, hyp, cycle)
      await fetch(`${this.env.LINEAR_SYNC_URL}/sync/advisory-hypothesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(syncRequest),
      })
    } catch (err) {
      console.warn('[CommissioningAgentDO] surfaceAdvisoryHypothesis failed:', err)
    }
  }

  private async runCycleReconciliation(cycle: CycleContext): Promise<void> {
    // Label carried-over open advisory Linear issues and append VerdictClosureRecord
    try {
      const recurring = await this.findRecurringAdvisories(2)
      if (recurring.length > 0) {
        // Notify Architect Agent DO of recurring advisories
        console.log(
          `[CommissioningAgentDO:${this.orgId}] cycle ${cycle.cycleName}: ${recurring.length} recurring advisories`,
          recurring.map((h) => h.id),
        )
      }

      // Append VerdictClosureRecord to ArtifactGraphDO
      const artifactId = this.env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${this.orgId}`)
      const stub = this.env.ARTIFACT_GRAPH.get(artifactId)
      await stub.fetch(
        new Request('https://artifact-graph/verdict-closure-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: this.orgId,
            cycleId: cycle.cycleId,
            cycleName: cycle.cycleName,
            recurringAdvisoryCount: recurring.length,
            reconciledAt: new Date().toISOString(),
          }),
        }),
      )
    } catch (err) {
      console.warn('[CommissioningAgentDO] runCycleReconciliation failed:', err)
    }
  }

  private async findRecurringAdvisories(minSurfacedCycleCount: number): Promise<HypothesisNode[]> {
    try {
      const artifactId = this.env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${this.orgId}`)
      const stub = this.env.ARTIFACT_GRAPH.get(artifactId)
      const resp = await stub.fetch(
        new Request(
          `https://artifact-graph/query/hypothesis?status=CANDIDATE&severity=advisory&minSurfacedCycleCount=${minSurfacedCycleCount}`,
        ),
      )
      if (!resp.ok) return []
      return (await resp.json()) as HypothesisNode[]
    } catch {
      return []
    }
  }

  private async markHypothesisSurfaced(hypothesisId: string): Promise<void> {
    try {
      const artifactId = this.env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${this.orgId}`)
      const stub = this.env.ARTIFACT_GRAPH.get(artifactId)
      await stub.fetch(
        new Request(`https://artifact-graph/hypothesis/${hypothesisId}/mark-surfaced`, {
          method: 'POST',
        }),
      )
    } catch (err) {
      console.warn(`[CommissioningAgentDO] markHypothesisSurfaced(${hypothesisId}) failed:`, err)
    }
  }

  // ── ArtifactGraph helpers ─────────────────────────────────────────────────────

  private async writeHypothesisToArtifactGraph(hyp: HypothesisNode): Promise<void> {
    try {
      const artifactId = this.env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${this.orgId}`)
      const stub = this.env.ARTIFACT_GRAPH.get(artifactId)
      await stub.fetch(
        new Request('https://artifact-graph/hypothesis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hyp),
        }),
      )
    } catch (err) {
      console.warn('[CommissioningAgentDO] writeHypothesisToArtifactGraph failed:', err)
    }
  }

  private async writeAmendmentToArtifactGraph(
    amendment: import('./schemas.js').Amendment,
  ): Promise<void> {
    try {
      const artifactId = this.env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${this.orgId}`)
      const stub = this.env.ARTIFACT_GRAPH.get(artifactId)
      await stub.fetch(
        new Request('https://artifact-graph/amendment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(amendment),
        }),
      )
    } catch (err) {
      console.warn('[CommissioningAgentDO] writeAmendmentToArtifactGraph failed:', err)
    }
  }

  // ── Internal text generation shim ────────────────────────────────────────────
  /**
   * Thin adapter so phase runners can call `generate(prompt)` without needing
   * direct access to the Think session API. Uses `runFiber` for durability.
   * Each call creates an ephemeral fiber that resolves to the model's text.
   */
  private async _generateText(prompt: string): Promise<{ text: string }> {
    const { text } = await generateText({
      model: this.getModel(),
      prompt,
    })
    return { text }
  }
}

// ── Skill source builders ──────────────────────────────────────────────────────

/**
 * Build an in-memory SkillSource from bundled .md files.
 * Only serves refs that have content in the BUNDLED_SKILLS map.
 */
function buildBundledSkillSource(refs: string[]): SkillSource {
  const skillNames = refs
    .filter((r) => r.startsWith('bundled:'))
    .map((r) => r.slice('bundled:'.length))

  return {
    id: 'bundled-skills',
    fingerprint: skillNames.sort().join(','),
    async list() {
      return skillNames
        .map((name) => {
          const content = BUNDLED_SKILLS[name]
          if (!content) return null
          return { name, description: `Bundled skill: ${name}`, sourceId: 'bundled-skills' }
        })
        .filter((d): d is NonNullable<typeof d> => d !== null)
    },
    async load(name: string) {
      const content = BUNDLED_SKILLS[name]
      if (!content) return null
      return {
        name,
        description: `Bundled skill: ${name}`,
        body: content,
        rawContent: content,
        sourceId: 'bundled-skills',
      }
    },
  }
}

/**
 * Build a SkillSource that loads workspace: prefixed skills from the
 * Think workspace filesystem (.agents/skills/{name}/SKILL.md).
 */
function buildWorkspaceSkillSource(
  refs: string[],
  workspace: import('@cloudflare/think').WorkspaceLike,
): SkillSource {
  const skillNames = refs
    .filter((r) => r.startsWith('workspace:'))
    .map((r) => r.slice('workspace:'.length))

  return {
    id: 'workspace-skills',
    fingerprint: `ws:${skillNames.sort().join(',')}`,
    async list() {
      return skillNames.map((name) => ({
        name,
        description: `Workspace skill: ${name}`,
        sourceId: 'workspace-skills',
      }))
    },
    async load(name: string) {
      if (!skillNames.includes(name)) return null
      const paths = [
        `.agents/skills/${name}/SKILL.md`,
        `/spec/skills/${name}/SKILL.md`, // T2 injected via /workspace/write
      ]
      for (const p of paths) {
        const content = await workspace.readFile(p)
        if (content) {
          return {
            name,
            description: `Workspace skill: ${name}`,
            body: content,
            rawContent: content,
            sourceId: 'workspace-skills',
          }
        }
      }
      return null
    },
  }
}

// ── JSON response helper ──────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
