/**
 * MediationAgentDO — Cloudflare Durable Object
 *
 * One DO instance per repo: key = `mediation-agent:{repoId}`.
 * Multiple runs share the same DO instance; the compiled_molecules
 * table is keyed on (atom_id, run_id).
 *
 * Lifecycle state machine:
 *   UNINITIALIZED → COMPILING → SEEDED → COMPLETE
 *   UNINITIALIZED → COMPILING → FAILED
 *
 * HTTP endpoints:
 *   POST /commission  — nine-step compile sequence
 *   POST /complete    — lifecycle terminal acknowledgment
 *   GET  /health      — lifecycle status
 *
 * SPEC-FF-ILAYER-EXEC-001 §3
 */

import { DurableObject } from 'cloudflare:workers'
import type { CoordinatorDO } from '@factory/gears'
import type { FactoryArtifactGraphDO, FactoryBeadGraphDO } from '@factory/factory-graph'
import { migrate, META_KEYS } from './db/schema.js'
import { runCompileSequence, CompileError } from './compile/compile-sequence.js'
import type {
  CommissionRequest,
  CommissionResponse,
  CompleteRequest,
  CompleteResponse,
  HealthResponse,
  MediationLifecycle,
} from './types.js'

export interface Env {
  // Durable Objects
  COORDINATOR_DO:  DurableObjectNamespace<CoordinatorDO>
  ARTIFACT_GRAPH:  DurableObjectNamespace<FactoryArtifactGraphDO>
  BEAD_GRAPH:      DurableObjectNamespace<FactoryBeadGraphDO>

  // Queues
  ATOM_EXECUTION_QUEUE: Queue

  // D1
  D1_AUDIT: D1Database

  // KV
  KV_KS: KVNamespace
}

export class MediationAgentDO extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql)
    })
  }

  // ── Lifecycle helpers ─────────────────────────────────────────────────

  private getMetaValue(key: string): string | null {
    const rows = [...this.sql.exec(`SELECT value FROM meta WHERE key = ?`, key)]
    const row = rows[0] as { value: string } | undefined
    return row?.value ?? null
  }

  private setMetaValue(key: string, value: string): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
      key,
      value,
    )
  }

  private getLifecycle(): MediationLifecycle {
    return (this.getMetaValue(META_KEYS.lifecycle) as MediationLifecycle | null) ?? 'UNINITIALIZED'
  }

  private setLifecycle(lifecycle: MediationLifecycle): void {
    this.setMetaValue(META_KEYS.lifecycle, lifecycle)
  }

  // ── Idempotency check ─────────────────────────────────────────────────

  /**
   * Returns a cached success response if this runId was already fully compiled
   * and seeded. Second POST /commission with same runId is a no-op.
   */
  private checkIdempotency(runId: string): CommissionResponse | null {
    const storedRunId = this.getMetaValue(META_KEYS.runId)
    const lifecycle   = this.getLifecycle()

    if (storedRunId === runId && lifecycle === 'SEEDED') {
      const atomCountRaw = this.getMetaValue(META_KEYS.atomCount)
      const workGraphVersion = this.getMetaValue(META_KEYS.workGraphVersion) ?? ''
      return {
        status:           'seeded',
        runId,
        atomCount:        atomCountRaw !== null ? parseInt(atomCountRaw, 10) : 0,
        workGraphVersion,
      }
    }

    return null
  }

  // ── POST /commission ──────────────────────────────────────────────────

  private async handleCommission(req: Request): Promise<Response> {
    let body: CommissionRequest
    try {
      body = await req.json<CommissionRequest>()
    } catch {
      return jsonErr({ error: 'invalid JSON body' }, 400)
    }

    // Idempotency: same runId + SEEDED → return cached success
    const cached = this.checkIdempotency(body.runId)
    if (cached !== null) {
      return jsonOk(cached)
    }

    // Transition → COMPILING
    this.setLifecycle('COMPILING')
    this.setMetaValue(META_KEYS.runId,                body.runId)
    this.setMetaValue(META_KEYS.orgId,                body.orgId)
    this.setMetaValue(META_KEYS.workGraphId,          body.workGraphId)
    this.setMetaValue(META_KEYS.workGraphVersion,     body.workGraphVersion)
    this.setMetaValue(META_KEYS.eluciationArtifactId, body.eluciationArtifactId)
    this.setMetaValue(META_KEYS.lastCommissionAt,     new Date().toISOString())

    try {
      const result = await runCompileSequence(
        body,
        {
          COORDINATOR_DO:       this.env.COORDINATOR_DO,
          ARTIFACT_GRAPH:       this.env.ARTIFACT_GRAPH,
          D1_AUDIT:             this.env.D1_AUDIT,
          KV_KS:                this.env.KV_KS,
          ATOM_EXECUTION_QUEUE: this.env.ATOM_EXECUTION_QUEUE,
        },
        this.sql,
      )

      const atomCount = result.directives.size
      this.setMetaValue(META_KEYS.atomCount, String(atomCount))
      this.setLifecycle('SEEDED')

      const response: CommissionResponse = {
        status:           'seeded',
        runId:            body.runId,
        atomCount,
        workGraphVersion: body.workGraphVersion,
      }
      return jsonOk(response)

    } catch (err) {
      this.setLifecycle('FAILED')

      if (err instanceof CompileError) {
        const response: CommissionResponse = {
          status:  'failed',
          reason:  err.reason,
          details: err.message,
        }
        return jsonErr(response, 422)
      }

      // Unexpected error — surface as coherence_failure for deterministic shape
      const message = err instanceof Error ? err.message : String(err)
      const response: CommissionResponse = {
        status:  'failed',
        reason:  'coherence_failure',
        details: `Unexpected compile error: ${message}`,
      }
      return jsonErr(response, 422)
    }
  }

  // ── POST /complete ────────────────────────────────────────────────────

  private async handleComplete(req: Request): Promise<Response> {
    let body: CompleteRequest
    try {
      body = await req.json<CompleteRequest>()
    } catch {
      return jsonErr({ error: 'invalid JSON body' }, 400)
    }

    // Write terminal lifecycle state
    this.setLifecycle('COMPLETE')
    this.setMetaValue(META_KEYS.runId, body.runId)

    console.log(
      `[mediation-agent] runId=${body.runId} outcome=${body.outcome}` +
      (body.failedAtomIds.length > 0
        ? ` failedAtoms=${body.failedAtomIds.join(',')}`
        : ''),
    )

    const response: CompleteResponse = { status: 'acknowledged' }
    return jsonOk(response)
  }

  // ── GET /health ───────────────────────────────────────────────────────

  private handleHealth(): Response {
    const atomCountRaw = this.getMetaValue(META_KEYS.atomCount)
    const response: HealthResponse = {
      lifecycle:        this.getLifecycle(),
      runId:            this.getMetaValue(META_KEYS.runId),
      lastCommissionAt: this.getMetaValue(META_KEYS.lastCommissionAt),
      atomCount:        atomCountRaw !== null ? parseInt(atomCountRaw, 10) : null,
    }
    return jsonOk(response)
  }

  // ── fetch() router ────────────────────────────────────────────────────

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (req.method === 'POST') {
      if (url.pathname === '/commission') return this.handleCommission(req)
      if (url.pathname === '/complete')   return this.handleComplete(req)
    }

    if (req.method === 'GET') {
      if (url.pathname === '/health') return this.handleHealth()
    }

    return new Response('Not found', { status: 404 })
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jsonErr(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
