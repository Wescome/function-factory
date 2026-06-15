/**
 * @factory/gears — CoordinatorDO
 *
 * One Durable Object per WorkGraph execution (GD-002: Option B).
 * runId = SHA-256(workGraphId + workGraphVersion) — deterministic, re-attachable.
 * DO key: coordinator:{runId}
 *
 * Step 5a: initRun() + writeAudit() wired. recordOutcome() is a stub (Step 5b).
 * writeAudit() is NOT a stub — D1 write fully implemented (BR-KSP-17).
 *
 * Critical ordering invariant (FR-06, BR-KSP-16):
 *   initRun() must be called before writeAudit() or recordOutcome() produce
 *   meaningful output. Guard `if (!this.runId || !this.orgId) return` enforces
 *   this without throwing.
 *
 * SPEC-FF-GEARS-001 §7b
 */

import { DurableObject } from 'cloudflare:workers'
import { LoopClosureService } from '@factory/loop-closure'
import {
  factoryDivergenceDetector,
  factoryHypothesisBuilder,
  factoryAmendmentVerifier,
  FactoryArtifactGraphDO,
  FactoryBeadGraphDO,
} from '@factory/factory-graph'
import { emitSubscriptionEvent } from '@factory/subscription-buffer'
import type { ExecutionBead } from './types.js'

type ConsentRecord = {
  id: string
  bead_id: string
  tool_name: string
  tool_call_id?: string
  timestamp: number
}

/** Full trace fragment written by the Conducting Agent workflow per execution attempt. */
export interface ConductingAgentTraceFragment {
  executionId:       string
  directiveId:       string
  atomRef:           string
  workGraphVersion:  string
  repoId:            string
  outcome:           'success' | 'failure' | 'timeout'
  rawOutput:         string
  sandboxOutputRef:  string | undefined
  durationMs:        number
  attemptNumber:     number
  producedAt:        string
  commitSha?:        string   // undefined if no git permission or no commit made
}

interface Env {
  D1_AUDIT:       D1Database
  ARTIFACT_GRAPH: DurableObjectNamespace<FactoryArtifactGraphDO>
  BEAD_GRAPH:     DurableObjectNamespace<FactoryBeadGraphDO>
  KV_KS:          KVNamespace
  MEDIATION_AGENT: DurableObjectNamespace  // POST /complete on run termination
  DREAM_DO?:       DurableObjectNamespace  // optional Dream notification hook
  SUB_BUFFER?:                 DurableObjectNamespace
  SUB_BUFFER_PRODUCER_SECRET?: string
}

export class CoordinatorDO extends DurableObject<Env> {
  private sql:    SqlStorage
  private runId:  string = ''
  private orgId:  string = ''
  private repoId: string = ''

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    ctx.blockConcurrencyWhile(async () => {
      // Restore persisted runId/orgId/repoId if DO was evicted
      this.runId  = (await ctx.storage.get<string>('runId'))  ?? ''
      this.orgId  = (await ctx.storage.get<string>('orgId'))  ?? ''
      this.repoId = (await ctx.storage.get<string>('repoId')) ?? ''
      this.migrate()
    })
  }

  // ── Subscription event helper ─────────────────────────────────────────────

  private get _sessionId(): string {
    return (this.ctx.id.name ?? '').replace(/^coordinator:/, '')
  }

  private emit(kind: string, payload: Record<string, unknown>, terminal = false): void {
    if (!this.env.SUB_BUFFER || !this.env.SUB_BUFFER_PRODUCER_SECRET) return
    const sessionId = this._sessionId
    void emitSubscriptionEvent(this.env.SUB_BUFFER, this.env.SUB_BUFFER_PRODUCER_SECRET, {
      sessionId,
      stream: 'sessionEvents',
      kind,
      runId: sessionId,
      payload,
      occurredAt: Date.now(),
      terminal,
    })
  }

  private emitBeadUpdate(
    atomId: string,
    status: 'in_progress' | 'done' | 'failed' | 'ready',
  ): void {
    if (!this.env.SUB_BUFFER || !this.env.SUB_BUFFER_PRODUCER_SECRET) return
    const sessionId = this._sessionId
    void emitSubscriptionEvent(this.env.SUB_BUFFER, this.env.SUB_BUFFER_PRODUCER_SECRET, {
      sessionId,
      stream: 'beadUpdates',
      kind: 'BEAD_UPDATE',
      runId: sessionId,
      payload: { atomId, status },
      occurredAt: Date.now(),
    })
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS execution_beads (
        id            TEXT PRIMARY KEY,
        molecule_id   TEXT NOT NULL,
        gear_id       TEXT NOT NULL,
        node_id       TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'ready',
        assigned_to   TEXT,
        attempt_count INTEGER DEFAULT 0,
        payload       TEXT,
        result        TEXT,
        created_at    INTEGER,
        updated_at    INTEGER
      );
      CREATE TABLE IF NOT EXISTS bead_edges (
        parent_id TEXT NOT NULL,
        child_id  TEXT NOT NULL,
        PRIMARY KEY (parent_id, child_id)
      );
      CREATE TABLE IF NOT EXISTS consent_audit (
        id           TEXT PRIMARY KEY,
        bead_id      TEXT NOT NULL,
        tool_name    TEXT NOT NULL,
        tool_call_id TEXT,
        timestamp    INTEGER NOT NULL
      );
    `)
  }

  /** Called once from atom-execution.ts before first claimBead() (Gap 6). */
  async initRun(runId: string, orgId: string, repoId?: string): Promise<void> {
    this.runId  = runId
    this.orgId  = orgId
    this.repoId = repoId ?? orgId  // fall back to orgId if repoId not supplied (1:1 systems)
    await this.ctx.storage.put('runId',  runId)
    await this.ctx.storage.put('orgId',  orgId)
    await this.ctx.storage.put('repoId', this.repoId)
    // Arm the stale-bead rescue alarm here (not in seedBeads) so repeated
    // seedBeads() calls cannot push the rescue indefinitely into the future.
    await this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000)
  }

  /**
   * Seed the execution beads + dependency edges for a molecule.
   *
   * The DO instance *is* the run — runId lives in this.runId (set by initRun()),
   * so it is intentionally absent from the argument.
   *
   * Idempotent: INSERT OR IGNORE on both tables means a retried seed (e.g. after
   * a transient failure mid-seed) is a no-op for already-inserted rows. The whole
   * operation runs inside blockConcurrencyWhile so a concurrent claim/next cannot
   * observe a half-seeded molecule. created_at is captured once so re-seed and
   * tie-breaking ordering stay deterministic.
   */
  async seedBeads(molecule: {
    moleculeId: string
    beads: Array<{
      id:        string
      gearId:    string
      nodeId:    string
      payload:   string    // JSON-serialized AtomDirective
      dependsOn: string[]  // parent bead IDs
    }>
  }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now()
      for (const bead of molecule.beads) {
        this.sql.exec(
          `INSERT OR IGNORE INTO execution_beads
             (id, molecule_id, gear_id, node_id, status, attempt_count, payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ready', 0, ?, ?, ?)`,
          bead.id, molecule.moleculeId, bead.gearId, bead.nodeId, bead.payload, now, now
        )
        for (const parentId of bead.dependsOn) {
          this.sql.exec(
            `INSERT OR IGNORE INTO bead_edges (parent_id, child_id) VALUES (?, ?)`,
            parentId, bead.id
          )
        }
      }
    })
  }

  override async alarm(): Promise<void> {
    const staleMs = 5 * 60 * 1000
    const cutoff  = Date.now() - staleMs
    // Capture rescued beads before the update so we can emit per-bead events
    const rescuedRows = [...this.sql.exec(
      `SELECT id FROM execution_beads WHERE status='in_progress' AND updated_at < ?`,
      cutoff
    )] as Array<{ id: string }>
    this.sql.exec(
      `UPDATE execution_beads SET status='ready', assigned_to=NULL, updated_at=?
       WHERE status='in_progress' AND updated_at < ?`,
      Date.now(), cutoff
    )
    for (const row of rescuedRows) {
      this.emit('BEAD_RESCUED', { atomId: row.id })
      this.emitBeadUpdate(row.id, 'ready')
    }
    // Only re-arm if there are still non-terminal beads.
    const activeRows = [...this.sql.exec(
      `SELECT COUNT(*) AS n FROM execution_beads WHERE status NOT IN ('done','failed')`
    )]
    const active = (activeRows[0] as { n: number }).n
    if (active > 0) {
      await this.ctx.storage.setAlarm(Date.now() + staleMs)
    } else if (this.runId) {
      // Race-safety: if checkRunComplete() hasn't fired yet for some reason, drive it now.
      try { await this.checkRunComplete() } catch { /* non-fatal */ }
    }
  }

  async claimBead(beadId: string, agentId: string): Promise<ExecutionBead | null> {
    const rows = [...this.sql.exec(
      `UPDATE execution_beads
       SET status='in_progress', assigned_to=?, attempt_count=attempt_count+1, updated_at=?
       WHERE id=? AND status='ready'
       RETURNING *`,
      agentId, Date.now(), beadId
    )]
    if (rows.length > 0) {
      this.emit('BEAD_CLAIMED', { atomId: beadId, agentId, runId: this._sessionId })
      this.emitBeadUpdate(beadId, 'in_progress')
    }
    return rows.length > 0 ? rows[0] as unknown as ExecutionBead : null
  }

  async releaseBead(beadId: string, agentId: string, result: string): Promise<void> {
    const startMs = Date.now()
    this.sql.exec(
      `UPDATE execution_beads SET status='done', result=?, updated_at=?
       WHERE id=? AND assigned_to=?`,
      result, startMs, beadId, agentId
    )
    const durationMs = Date.now() - startMs
    this.emit('BEAD_RELEASED', { atomId: beadId, agentId, durationMs })
    this.emitBeadUpdate(beadId, 'done')
    await this.writeAudit(beadId, agentId, 'done')
    try { await this.recordOutcome(beadId, agentId, result, 'done') } catch { /* BP3 non-fatal */ }
    try { await this.checkRunComplete() } catch { /* non-fatal */ }
  }

  async failBead(beadId: string, agentId: string, result: string): Promise<void> {
    this.sql.exec(
      `UPDATE execution_beads SET status='failed', result=?, updated_at=?
       WHERE id=? AND assigned_to=?`,
      result, Date.now(), beadId, agentId
    )
    this.emit('BEAD_FAILED', { atomId: beadId, agentId, errorCode: result })
    this.emitBeadUpdate(beadId, 'failed')
    await this.writeAudit(beadId, agentId, 'failed')
    try { await this.recordOutcome(beadId, agentId, result, 'failed') } catch { /* BP3 non-fatal */ }
    try { await this.checkRunComplete() } catch { /* non-fatal */ }
  }

  async getNextReady(moleculeId: string): Promise<ExecutionBead | null> {
    // Distinguish "no beads seeded yet" from "all beads done". The caller in
    // atom-execution.ts treats null as run-complete; an unseeded run must fail
    // visibly rather than masquerade as finished.
    const count = [...this.sql.exec('SELECT COUNT(*) as n FROM execution_beads WHERE molecule_id = ?', moleculeId)]
    if ((count[0] as { n: number }).n === 0) throw new Error(`molecule ${moleculeId} has no beads — call seedBeads() before dispatching`)
    const rows = [...this.sql.exec(`
      SELECT b.* FROM execution_beads b
      WHERE b.molecule_id=? AND b.status='ready'
        AND NOT EXISTS (
          SELECT 1 FROM bead_edges e
          JOIN execution_beads p ON p.id=e.parent_id
          WHERE e.child_id=b.id AND p.status NOT IN ('done', 'failed')
        )
      ORDER BY b.created_at ASC LIMIT 1
    `, moleculeId)]
    // Design invariant (SM-6 / CONDITION-4):
    //   'failed' is a terminal state per SDD SM-6. A failed parent bead does NOT
    //   block downstream siblings — partial molecule execution is intentional so
    //   non-critical beads can still complete. The atom-results consumer is
    //   responsible for aggregating partial outcomes and surfacing the failure
    //   to the caller. If all-or-nothing semantics are needed for a specific
    //   molecule, the caller must gate on molecule-level status before dispatching.
    return rows.length > 0 ? rows[0] as unknown as ExecutionBead : null
  }

  /**
   * GAP-006: Check whether all beads for this run are in a terminal state.
   * If so, cancel the rescue alarm, call POST /complete on MediationAgentDO,
   * and fire an optional Dream notification (non-fatal if absent or failing).
   */
  private async checkRunComplete(): Promise<void> {
    if (!this.runId) return

    const rows = [...this.sql.exec(`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('done','failed')) AS active_count,
        COUNT(*) FILTER (WHERE status = 'failed')               AS failed_count,
        GROUP_CONCAT(id) FILTER (WHERE status = 'failed')       AS failed_ids
      FROM execution_beads
    `)]
    const row = rows[0] as { active_count: number; failed_count: number; failed_ids: string | null }
    if (row.active_count > 0) return  // still executing

    // Cancel rescue alarm — no point rescuing a completed run.
    await this.ctx.storage.deleteAlarm()

    const outcome: 'all_done' | 'partial_failure' = row.failed_count > 0 ? 'partial_failure' : 'all_done'
    const failedAtomIds = row.failed_ids ? row.failed_ids.split(',') : []

    // Notify MediationAgentDO (spec SEEDED → COMPLETE transition).
    const repoId = this.repoId || this.orgId
    const mediationStub = this.env.MEDIATION_AGENT.get(
      this.env.MEDIATION_AGENT.idFromName(`mediation-agent:${repoId}`)
    )
    try {
      await mediationStub.fetch('https://do/complete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ runId: this.runId, outcome, failedAtomIds }),
      })
    } catch (err) {
      // Non-fatal: MediationAgentDO can reconcile via /health poll.
      console.error(`[CoordinatorDO] POST /complete to MediationAgentDO failed: runId=${this.runId}`, err)
    }

    // Optional Dream notification hook — present only when DREAM_DO binding is provisioned.
    if (this.env.DREAM_DO) {
      try {
        const dreamStub = this.env.DREAM_DO.get(
          this.env.DREAM_DO.idFromName(`dream:${repoId}`)
        )
        await dreamStub.fetch('https://do/notify', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ event: 'run_complete', runId: this.runId, outcome, failedAtomIds }),
        })
      } catch (err) {
        // Non-fatal: Dream is a side-channel notification, not a required gate.
        console.warn(`[CoordinatorDO] Dream notification failed: runId=${this.runId}`, err)
      }
    }
  }

  /**
   * GAP-006: HTTP entry point for /complete.
   * Marks all remaining non-terminal molecule beads as done (idempotent cleanup),
   * records a completion timestamp, and drives checkRunComplete().
   * Called by external orchestrators that want to force-close a run.
   */
  private async handleComplete(body: { moleculeId?: string }): Promise<{ ok: boolean; completedAt: number }> {
    const completedAt = Date.now()
    if (body.moleculeId) {
      this.sql.exec(
        `UPDATE execution_beads SET status='done', updated_at=?
         WHERE molecule_id=? AND status NOT IN ('done','failed')`,
        completedAt, body.moleculeId
      )
    } else {
      this.sql.exec(
        `UPDATE execution_beads SET status='done', updated_at=?
         WHERE status NOT IN ('done','failed')`,
        completedAt
      )
    }
    await this.checkRunComplete()
    return { ok: true, completedAt }
  }

  /**
   * Gap 1: wired D1 write — NOT a stub (BR-KSP-17).
   * Inserts a record into the cross-run bead audit log.
   */
  private async writeAudit(beadId: string, agentId: string, verdict: string): Promise<void> {
    if (!this.runId || !this.orgId) return  // initRun() not yet called — skip
    const rows = [...this.sql.exec('SELECT * FROM execution_beads WHERE id = ?', beadId)]
    if (rows.length === 0) return
    const bead = rows[0] as unknown as ExecutionBead

    await this.env.D1_AUDIT.prepare(
      `INSERT INTO bead_audit (run_id, bead_id, gear_id, agent_id, verdict, attempt, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      this.runId,
      beadId,
      bead.gear_id,
      agentId,
      verdict,
      bead.attempt_count,
      Date.now()
    ).run()
  }

  /**
   * GAP-THINK-02: persist consent audit record for I4 enforcement.
   * consent_audit table is created in migrate().
   */
  private async recordConsent(record: ConsentRecord): Promise<{ ok: boolean }> {
    this.sql.exec(
      `INSERT INTO consent_audit (id, bead_id, tool_name, tool_call_id, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      record.id, record.bead_id, record.tool_name, record.tool_call_id ?? null, record.timestamp
    )
    return { ok: true }
  }

  /**
   * Gap 1+5: KSP loop closure Bridge Point 3 (Step 5b, Step 41).
   * Wires LoopClosureService to write BuildOutcomeBead and ExecutionTrace node.
   */
  private async recordOutcome(
    beadId:     string,
    agentId:    string,
    resultJson: string,
    verdict:    'done' | 'failed'
  ): Promise<void> {
    if (!this.runId || !this.orgId) return  // initRun() not yet called — skip

    // Guard: resultJson may be raw LLM text (from ThinkExecutor) rather than a
    // ConductingAgentTraceFragment. Fall back to a synthetic fragment so BP3
    // still fires instead of silently swallowing a SyntaxError.
    let trace: ConductingAgentTraceFragment
    try {
      const parsed = JSON.parse(resultJson) as unknown
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as ConductingAgentTraceFragment).executionId !== 'string'
      ) {
        throw new Error('not a ConductingAgentTraceFragment')
      }
      trace = parsed as ConductingAgentTraceFragment
    } catch (parseErr) {
      console.warn(
        `[CoordinatorDO] recordOutcome: resultJson is not a ConductingAgentTraceFragment` +
        ` (beadId=${beadId}); using synthetic fragment. parseErr=${String(parseErr)}`
      )
      trace = {
        executionId:      beadId,
        directiveId:      beadId,
        atomRef:          beadId,
        workGraphVersion: '',
        repoId:           '',
        outcome:          verdict === 'done' ? 'success' : 'failure',
        rawOutput:        resultJson,
        sandboxOutputRef: undefined,
        durationMs:       0,
        attemptNumber:    1,
        producedAt:       new Date().toISOString(),
      }
    }
    const ns     = `factory:${this.orgId}:${this.runId}`

    const artifactGraphStub = this.env.ARTIFACT_GRAPH.get(
      this.env.ARTIFACT_GRAPH.idFromName(ns)
    ) as unknown as InstanceType<typeof FactoryArtifactGraphDO>

    const beadGraphStub = this.env.BEAD_GRAPH.get(
      this.env.BEAD_GRAPH.idFromName(this.orgId)
    ) as unknown as InstanceType<typeof FactoryBeadGraphDO>

    // Seed synthetic KV session so LoopClosureService.recordOutcome can find it.
    // beadId doubles as sessionId proxy for this run (per SPEC-FF-GEARS-001 §7b).
    if (!this.env.KV_KS) {
      console.warn(`[CoordinatorDO] recordOutcome: KV_KS binding is not provisioned — BP3 bridge skipped (beadId=${beadId})`)
      return
    }
    const activeSpecId = await (artifactGraphStub as any).getActiveSpecification(ns, 'conducting-agent')
    await this.env.KV_KS.put(`session:${beadId}`, JSON.stringify({
      sessionId:              beadId,
      orgId:                  this.orgId,
      roleId:                 'conducting-agent',
      agentId,
      ksRetrievedAt:          Date.now(),
      activeSpecificationId:  activeSpecId,
      autonomyFloor:          'EXECUTE_FULL',
    }), { expirationTtl: 86400 })

    const loopClosure = new LoopClosureService({
      artifactGraphDO:   artifactGraphStub,
      beadGraphDO:       beadGraphStub,
      kvStore:           this.env.KV_KS,
      detectDivergences: factoryDivergenceDetector,
      buildHypothesis:   factoryHypothesisBuilder,
      verifyAmendment:   factoryAmendmentVerifier,
      // exactOptionalPropertyTypes: never pass `undefined` for optional fields —
      // spread the binding only when it is actually present.
      ...(this.env.SUB_BUFFER !== undefined
        ? { subBuffer: this.env.SUB_BUFFER }
        : {}),
      ...(this.env.SUB_BUFFER_PRODUCER_SECRET !== undefined
        ? { subBufferSecret: this.env.SUB_BUFFER_PRODUCER_SECRET }
        : {}),
    })

    await loopClosure.recordOutcome(
      beadId,   // sessionId proxy — seeded above
      beadId,   // executionBeadId
      {
        status:        verdict === 'done' ? 'SUCCESS' : 'FAILURE',
        summary:       trace.rawOutput?.slice(0, 500) ?? '',
        toolCallCount: 0,
      }
    )
  }

  override async fetch(req: Request): Promise<Response> {
    const url  = new URL(req.url)
    if (req.method === 'POST') {
      const body = await req.json<unknown>()
      if (url.pathname === '/init')    return Response.json(await this.initRun(   ...(body as [string, string])))
      if (url.pathname === '/claim')   return Response.json(await this.claimBead( ...(body as [string, string])))
      if (url.pathname === '/release') return Response.json(await this.releaseBead(...(body as [string, string, string])))
      if (url.pathname === '/fail')    return Response.json(await this.failBead(  ...(body as [string, string, string])))
      if (url.pathname === '/next') {
        try {
          return Response.json(await this.getNextReady(body as string))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return Response.json({ error: msg }, { status: 422 })
        }
      }
      if (url.pathname === '/next-ready') {
        // GAP-THINK-03: return ALL ready beads for this run (run-scoped, no argument).
        // The DO instance IS the run — coordinator:{runId} — so no moleculeId needed.
        const rows = [...this.sql.exec(
          `SELECT id, payload AS atomSpec FROM execution_beads WHERE status='ready' ORDER BY created_at ASC`
        )] as Array<{ id: string; atomSpec: string | null }>
        const beads = rows.map(r => ({
          id:       r.id,
          atomSpec: r.atomSpec ? JSON.parse(r.atomSpec) : null,
        }))
        return Response.json(beads)
      }
      if (url.pathname === '/seed')     return Response.json(await this.seedBeads(  body as Parameters<typeof this.seedBeads>[0]))
      if (url.pathname === '/complete') return Response.json(await this.handleComplete(body as { moleculeId?: string }))
      if (url.pathname === '/consent') {
        const raw = body as { beadId: string; toolName: string; toolCallId?: string; verdict?: string }
        const record: ConsentRecord = {
          id:        crypto.randomUUID(),
          bead_id:   raw.beadId,
          tool_name: raw.toolName,
          timestamp: Date.now(),
          ...(raw.toolCallId !== undefined ? { tool_call_id: raw.toolCallId } : {}),
        }
        const result = await this.recordConsent(record)
        if (raw.verdict === 'denied') {
          this.emit('CONSENT_BEAD_DENIED', {
            beadId:     raw.beadId,
            toolName:   raw.toolName,
            toolCallId: raw.toolCallId ?? null,
          })
        }
        return Response.json(result)
      }
    }
    if (req.method === 'GET') {
      // GET /beads — return all execution_beads for this CoordinatorDO instance
      if (url.pathname === '/beads') {
        const rows = [...this.sql.exec(`SELECT * FROM execution_beads ORDER BY created_at ASC`)]
        return Response.json(rows)
      }

      // GET /amendments — amendments are stored in ArtifactGraphDO, not CoordinatorDO.
      // CoordinatorDO only has execution_beads, bead_edges, and consent_audit tables.
      // Return empty array; the caller (CoordinatorDataSource) handles [] gracefully.
      if (url.pathname === '/amendments') {
        return Response.json([])
      }
    }

    return new Response('Not found', { status: 404 })
  }
}
