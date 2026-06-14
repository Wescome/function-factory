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
}

interface Env {
  D1_AUDIT:       D1Database
  ARTIFACT_GRAPH: DurableObjectNamespace<FactoryArtifactGraphDO>
  BEAD_GRAPH:     DurableObjectNamespace<FactoryBeadGraphDO>
  KV_KS:          KVNamespace
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
  async initRun(runId: string, orgId: string): Promise<void> {
    this.runId = runId
    this.orgId = orgId
    await this.ctx.storage.put('runId', runId)
    await this.ctx.storage.put('orgId', orgId)
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
    try { await this.recordOutcome(beadId, agentId, result, 'done') } catch { /* BP3 non-fatal */ }
  }

  async failBead(beadId: string, agentId: string, result: string): Promise<void> {
    this.sql.exec(
      `UPDATE execution_beads SET status='failed', result=?, updated_at=?
       WHERE id=? AND assigned_to=?`,
      result, Date.now(), beadId, agentId
    )
    await this.writeAudit(beadId, agentId, 'failed')
    try { await this.recordOutcome(beadId, agentId, result, 'failed') } catch { /* BP3 non-fatal */ }
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
      if (url.pathname === '/seed')    return Response.json(await this.seedBeads(  body as Parameters<typeof this.seedBeads>[0]))
      if (url.pathname === '/consent') {
        const raw = body as { beadId: string; toolName: string; toolCallId?: string }
        const record: ConsentRecord = {
          id:        crypto.randomUUID(),
          bead_id:   raw.beadId,
          tool_name: raw.toolName,
          timestamp: Date.now(),
          ...(raw.toolCallId !== undefined ? { tool_call_id: raw.toolCallId } : {}),
        }
        return Response.json(await this.recordConsent(record))
      }
    }
    return new Response('Not found', { status: 404 })
  }
}
