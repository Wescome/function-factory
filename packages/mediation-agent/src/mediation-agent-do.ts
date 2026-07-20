/**
 * MediationAgentDO — Cloudflare Durable Object
 *
 * One DO instance per org: key = `mediation-agent:{orgId}`.
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
import { z } from 'zod'
import type { CoordinatorDO } from '@factory/gears'
import type { FactoryArtifactGraphDO, FactoryBeadGraphDO } from '@factory/factory-graph'
import { emitSubscriptionEvent } from '@factory/subscription-buffer'
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

  // Subscription buffer (optional)
  SUB_BUFFER?:                 DurableObjectNamespace
  SUB_BUFFER_PRODUCER_SECRET?: SecretsStoreSecret
}

export class MediationAgentDO extends DurableObject<Env> {
  private sql: SqlStorage
  private _subBufferProducerSecret: string | undefined

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql)
    })
  }

  // ── Secret getter (lazy-cached) ───────────────────────────────────────

  private async getSubBufferProducerSecret(): Promise<string | undefined> {
    if (!this.env.SUB_BUFFER_PRODUCER_SECRET) return undefined
    if (this._subBufferProducerSecret === undefined) {
      this._subBufferProducerSecret = await this.env.SUB_BUFFER_PRODUCER_SECRET.get()
    }
    return this._subBufferProducerSecret
  }

  // ── Subscription event helper ─────────────────────────────────────────

  private async emitMA(
    sessionId: string,
    stream: 'sessionEvents' | 'artifactWrites',
    kind: string,
    payload: Record<string, unknown>,
    options: { runId?: string; terminal?: boolean } = {},
  ): Promise<void> {
    if (!this.env.SUB_BUFFER) return
    const secret = await this.getSubBufferProducerSecret()
    if (!secret) return
    void emitSubscriptionEvent(this.env.SUB_BUFFER, secret, {
      sessionId,
      stream,
      kind,
      payload,
      occurredAt: Date.now(),
      ...(options.runId    !== undefined ? { runId:    options.runId    } : {}),
      ...(options.terminal !== undefined ? { terminal: options.terminal } : {}),
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
    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      return jsonErr({ error: 'invalid JSON body' }, 400)
    }

    // Validation gate (R7 — SPEC-FF-CA-MEDIATION-ADAPTER-001):
    // Validate BEFORE any SQLite write. 400 = malformed request; 422 = compile failure.
    const CommissionRequestSchema = z.object({
      runId:                   z.string().min(1).startsWith('RUN-'),
      orgId:                   z.string().min(1),
      workGraphId:             z.string().min(1),
      workGraphVersion:        z.string().min(1),
      eluciationArtifactId:   z.string().min(1),
      d1ArtifactRefs:         z.array(z.unknown()),
      dispositionEventId:     z.string().min(1),
      stalenessThresholdHours: z.number().positive().optional(),
    })
    const parsed = CommissionRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      return jsonErr({ status: 'invalid_request', issues: parsed.error.issues }, 400)
    }
    const body: CommissionRequest = parsed.data as unknown as CommissionRequest

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

      // Emit VERIFICATION_PRODUCED (COHERENCE check passed) — step 4 succeeded
      void this.emitMA(body.runId, 'sessionEvents', 'VERIFICATION_PRODUCED', {
        kind:           'COHERENCE',
        passed:         true,
        verdictSummary: 'all coherence checks passed',
      }, { runId: body.runId })

      // Emit ARTIFACT_WRITTEN for each AtomDirective node written in step 6
      for (const [atomId] of result.directives) {
        void this.emitMA(body.runId, 'artifactWrites', 'ARTIFACT_WRITTEN', {
          artifactId: `ATOM-DIRECTIVE-${atomId}`,
          kind:       'AtomDirective',
          r2Path:     null,
        }, { runId: body.runId })
      }

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
        // Emit VERIFICATION_PRODUCED (COHERENCE check failed) when it's a coherence error
        if (err.reason === 'coherence_failure') {
          void this.emitMA(body.runId, 'sessionEvents', 'VERIFICATION_PRODUCED', {
            kind:           'COHERENCE',
            passed:         false,
            failedCriteria: err.message,
          }, { runId: body.runId })
        }
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
