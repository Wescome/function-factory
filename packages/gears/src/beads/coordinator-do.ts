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
import type { ExecutionBead } from './types.js'

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
}

interface Env {
  D1_AUDIT:       D1Database
  ARTIFACT_GRAPH: DurableObjectNamespace<FactoryArtifactGraphDO>
  BEAD_GRAPH:     DurableObjectNamespace<FactoryBeadGraphDO>
  KV:             KVNamespace
}

export class CoordinatorDO extends DurableObject<Env> {
  private sql:   SqlStorage
  private runId: string = ''
  private orgId: string = ''

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    ctx.blockConcurrencyWhile(async () => {
      // Restore persisted runId/orgId if DO was evicted
      this.runId = (await ctx.storage.get<string>('runId')) ?? ''
      this.orgId = (await ctx.storage.get<string>('orgId')) ?? ''
      this.migrate()
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
    `)
  }

  /** Called once from atom-execution.ts before first claimBead() (Gap 6). */
  async initRun(runId: string, orgId: string): Promise<void> {
    this.runId = runId
    this.orgId = orgId
    await this.ctx.storage.put('runId', runId)
    await this.ctx.storage.put('orgId', orgId)
  }

  override async alarm(): Promise<void> {
    const staleMs = 5 * 60 * 1000
    const cutoff  = Date.now() - staleMs
    this.sql.exec(
      `UPDATE execution_beads SET status='ready', assigned_to=NULL, updated_at=?
       WHERE status='in_progress' AND updated_at < ?`,
      Date.now(), cutoff
    )
    await this.ctx.storage.setAlarm(Date.now() + staleMs)
  }

  async claimBead(beadId: string, agentId: string): Promise<ExecutionBead | null> {
    const rows = [...this.sql.exec(
      `UPDATE execution_beads
       SET status='in_progress', assigned_to=?, attempt_count=attempt_count+1, updated_at=?
       WHERE id=? AND status='ready'
       RETURNING *`,
      agentId, Date.now(), beadId
    )]
    return rows.length > 0 ? rows[0] as unknown as ExecutionBead : null
  }

  async releaseBead(beadId: string, agentId: string, result: string): Promise<void> {
    this.sql.exec(
      `UPDATE execution_beads SET status='done', result=?, updated_at=?
       WHERE id=? AND assigned_to=?`,
      result, Date.now(), beadId, agentId
    )
    await this.writeAudit(beadId, agentId, 'done')
    await this.recordOutcome(beadId, agentId, result, 'done')  // Bridge Point 3 (stub in 5a)
  }

  async failBead(beadId: string, agentId: string, result: string): Promise<void> {
    this.sql.exec(
      `UPDATE execution_beads SET status='failed', result=?, updated_at=?
       WHERE id=? AND assigned_to=?`,
      result, Date.now(), beadId, agentId
    )
    await this.writeAudit(beadId, agentId, 'failed')
    await this.recordOutcome(beadId, agentId, result, 'failed')  // Bridge Point 3 (stub in 5a)
  }

  async getNextReady(moleculeId: string): Promise<ExecutionBead | null> {
    const rows = [...this.sql.exec(`
      SELECT b.* FROM execution_beads b
      WHERE b.molecule_id=? AND b.status='ready'
        AND NOT EXISTS (
          SELECT 1 FROM bead_edges e
          JOIN execution_beads p ON p.id=e.parent_id
          WHERE e.child_id=b.id AND p.status != 'done'
        )
      ORDER BY b.created_at ASC LIMIT 1
    `, moleculeId)]
    return rows.length > 0 ? rows[0] as unknown as ExecutionBead : null
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

    const trace  = JSON.parse(resultJson) as ConductingAgentTraceFragment
    const ns     = `factory:${this.orgId}:${this.runId}`

    const loopClosure = new LoopClosureService({
      artifactGraphDO: this.env.ARTIFACT_GRAPH.get(
        this.env.ARTIFACT_GRAPH.idFromName(ns)
      ) as unknown as InstanceType<typeof FactoryArtifactGraphDO>,
      beadGraphDO: this.env.BEAD_GRAPH.get(
        this.env.BEAD_GRAPH.idFromName(this.orgId)
      ) as unknown as InstanceType<typeof FactoryBeadGraphDO>,
      kvStore:           this.env.KV,
      detectDivergences: factoryDivergenceDetector,
      buildHypothesis:   factoryHypothesisBuilder,
      verifyAmendment:   factoryAmendmentVerifier,
    })

    await loopClosure.recordOutcome(
      beadId,   // used as sessionId proxy within this run
      beadId,   // executionBeadId
      {
        status:        verdict === 'done' ? 'SUCCESS' : 'FAILURE',
        summary:       trace.rawOutput?.slice(0, 500) ?? '',
        toolCallCount: 0,
      }
    )

    void agentId  // agentId captured in writeAudit; suppress unused param warning
  }

  override async fetch(req: Request): Promise<Response> {
    const url  = new URL(req.url)
    const body = () => req.json<unknown>()
    if (req.method === 'POST') {
      if (url.pathname === '/init')    return Response.json(await this.initRun(   ...(await body() as [string, string])))
      if (url.pathname === '/claim')   return Response.json(await this.claimBead( ...(await body() as [string, string])))
      if (url.pathname === '/release') return Response.json(await this.releaseBead(...(await body() as [string, string, string])))
      if (url.pathname === '/fail')    return Response.json(await this.failBead(  ...(await body() as [string, string, string])))
      if (url.pathname === '/next')    return Response.json(await this.getNextReady(await body() as string))
    }
    return new Response('Not found', { status: 404 })
  }
}
