/**
 * @factory/architect-agent — ArchitectAgentDO
 *
 * Durable Object that governs the Function Factory at the I-layer.
 * Singleton: idFromName('architect-agent:factory').
 *
 * This is a governance DO, NOT an LLM loop — it extends DurableObject<Env>
 * directly (NOT Think). All state lives in DO SQLite (ctx.storage.sql).
 *
 * HTTP API:
 *   POST /crd              — Coverage Reconciliation Directive (was POST /crp)
 *   POST /patch            — Patch governance propagation
 *   POST /register-repo    — Register a CommissioningAgentDO repo
 *   POST /deregister-repo  — Remove a repo
 *   GET  /health           — Factory health summary
 *   GET  /pipeline-config  — Active pipeline configuration
 *
 * Domains:
 *   D1 — Patch Governance (d1-patch-propagation.ts)
 *   D2 — CRD Resolution   (d2-crd-resolution.ts)
 *   D3 — Vertical Slice Policy (d3-vertical-slice-policy.ts)
 *   D4 — Pipeline Configuration (d4-pipeline-config.ts)
 *
 * Alarm: fires every ANOMALY_SCAN_INTERVAL_MS to scan for cross-repo anomalies.
 */

import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env.js'
import { migrate, ensureFactoryState } from './db/schema.js'
import { handlePatch, detectStalledPatches } from './domains/d1-patch-propagation.js'
import { handleCrd, getPendingCrdCount, getCrdRatePerHour } from './domains/d2-crd-resolution.js'
import { evaluateAndUpdateVslicePolicy } from './domains/d3-vertical-slice-policy.js'
import { getActivePipelineConfig } from './domains/d4-pipeline-config.js'
import type {
  PatchRequest,
  CrdRequest,
  RegisterRepoRequest,
  DeregisterRepoRequest,
  HealthResponse,
  RepoRow,
  FactoryStateRow,
  AnomalyClass,
} from './types.js'


// ── Anomaly thresholds ────────────────────────────────────────────────────────

const ANOMALY_THRESHOLDS = {
  passFailureRate: 0.15,     // D4 trigger: >15% failure rate for a pass across 3+ repos
  crdPerHour: 5,             // D2 triage: >5 coherence failures/hour across any repos
  patchStallMinutes: 30,     // D1 escalation: patch stalled >30 min
  atomRetryRate: 0.20,       // D3 trigger: >20% atoms retrying in a single WorkGraph
} as const

// ── ArchitectAgentDO ──────────────────────────────────────────────────────────

export class ArchitectAgentDO extends DurableObject<Env> {
  // ── Secrets Store cache (DO constructors cannot be async) ────────────────
  private _signingKey: string | null = null
  private _operatorControlToken: string | null = null

  private async signingKey(): Promise<string> {
    if (this._signingKey === null) {
      this._signingKey = await this.env.FF_AGENT_SIGNING_KEY.get()
    }
    return this._signingKey
  }

  private async operatorControlToken(): Promise<string> {
    if (this._operatorControlToken === null) {
      this._operatorControlToken = await this.env.OPERATOR_CONTROL_TOKEN.get()
    }
    return this._operatorControlToken
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize schema synchronously before any requests are handled
    void ctx.blockConcurrencyWhile(async () => {
      migrate(ctx.storage.sql)
      ensureFactoryState(ctx.storage.sql)
    })
  }

  // ── Fetch router ──────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { method, pathname } = { method: request.method, pathname: url.pathname }

    if (method === 'POST') {
      if (pathname === '/crd') return this.handleCrd(request)
      if (pathname === '/patch') return this.handlePatch(request)
      if (pathname === '/register-repo') return this.handleRegisterRepo(request)
      if (pathname === '/deregister-repo') return this.handleDeregisterRepo(request)
    }

    if (method === 'GET') {
      if (pathname === '/health') return this.handleHealth()
      if (pathname === '/pipeline-config') return this.handleGetPipelineConfig()
    }

    return jsonError('Not found', 404)
  }

  // ── D1: Patch ─────────────────────────────────────────────────────────────

  private async handlePatch(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('invalid JSON body', 400)
    }

    const req = body as PatchRequest
    if (!req.changedArtifactId || !req.changeDescription || !req.authorizedBy || !req.urgency) {
      return jsonError('missing required fields: changedArtifactId, changeDescription, authorizedBy, urgency', 400)
    }
    if (req.urgency !== 'normal' && req.urgency !== 'emergency') {
      return jsonError('urgency must be "normal" or "emergency"', 400)
    }

    const repos = this.loadRepos()
    const artifactGraph = this.getArtifactGraphStub()

    const result = await handlePatch(req, {
      sql: this.ctx.storage.sql,
      artifactGraph,
      repos,
      patchPropagationTimeoutMs: parseInt(this.env.PATCH_PROPAGATION_TIMEOUT_MS ?? '1800000', 10),
    })

    return jsonOk(result)
  }

  // ── D2: CRD ───────────────────────────────────────────────────────────────

  private async handleCrd(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('invalid JSON body', 400)
    }

    const req = body as CrdRequest
    if (!req.repoId || !req.amendmentId || !req.coherenceVerdictDetail || !req.hypothesisId) {
      return jsonError(
        'missing required fields: repoId, amendmentId, coherenceVerdictDetail, hypothesisId',
        400,
      )
    }
    if (!Array.isArray(req.divergenceIds)) {
      return jsonError('divergenceIds must be an array', 400)
    }

    const repos = this.loadRepos()
    const artifactGraph = this.getArtifactGraphStub()

    const result = await handleCrd(req, {
      sql: this.ctx.storage.sql,
      artifactGraph,
      repos,
      weopsGatewayUrl: this.env.WEOPS_GATEWAY_URL,
      crdResolutionTimeoutMs: parseInt(this.env.CRD_RESOLUTION_TIMEOUT_MS ?? '600000', 10),
    })

    return jsonOk(result)
  }

  // ── Repo registry ─────────────────────────────────────────────────────────

  private async handleRegisterRepo(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('invalid JSON body', 400)
    }

    const req = body as RegisterRepoRequest
    if (!req.repoId || !req.commissioningAgentUrl || !req.mediationAgentDoKey) {
      return jsonError('missing required fields: repoId, commissioningAgentUrl, mediationAgentDoKey', 400)
    }

    const now = new Date().toISOString()
    this.ctx.storage.sql.exec(
      `INSERT INTO repos (repo_id, commissioning_agent_url, mediation_agent_do_key, health_status, registered_at)
       VALUES (?, ?, ?, 'unknown', ?)
       ON CONFLICT(repo_id) DO UPDATE SET
         commissioning_agent_url = excluded.commissioning_agent_url,
         mediation_agent_do_key = excluded.mediation_agent_do_key,
         health_status = 'unknown'`,
      req.repoId,
      req.commissioningAgentUrl,
      req.mediationAgentDoKey,
      now,
    )

    return jsonOk({ status: 'registered', repoId: req.repoId })
  }

  private async handleDeregisterRepo(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('invalid JSON body', 400)
    }

    const req = body as DeregisterRepoRequest
    if (!req.repoId) {
      return jsonError('missing required field: repoId', 400)
    }

    // Remove from repos
    this.ctx.storage.sql.exec('DELETE FROM repos WHERE repo_id = ?', req.repoId)

    // Cancel active patches: remove repoId from pending_repo_ids (mark as skipped)
    // v1: just log — full JSON array manipulation deferred (GAP-012 open item)
    console.info(
      `[ArchitectAgentDO] deregistered repo ${req.repoId}; active patches may still reference it`,
    )

    return jsonOk({ status: 'deregistered', repoId: req.repoId })
  }

  // ── Health ────────────────────────────────────────────────────────────────

  private handleHealth(): Response {
    const sql = this.ctx.storage.sql

    const repos = this.loadRepos()

    const reposByHealth: Record<string, number> = {
      healthy: 0,
      degraded: 0,
      suspended: 0,
      unknown: 0,
    }
    for (const repo of repos) {
      const key = repo.health_status in reposByHealth ? repo.health_status : 'unknown'
      reposByHealth[key] = (reposByHealth[key] ?? 0) + 1
    }

    const pendingCrdCount = getPendingCrdCount(sql)

    const activePatchRows = [...sql.exec(
      `SELECT COUNT(*) as cnt FROM patches WHERE status = 'propagating'`,
    )] as unknown as Array<{ cnt: number }>
    const activePatchCount = activePatchRows[0]?.cnt ?? 0

    const fsRows = [...sql.exec('SELECT * FROM factory_state WHERE factory_id = ?', 'factory')] as unknown as FactoryStateRow[]
    const fs = fsRows[0]

    const health: HealthResponse = {
      lifecycleState: fs?.lifecycle_state ?? 'ACTIVE',
      activeRepoCount: repos.length,
      reposByHealth: reposByHealth as HealthResponse['reposByHealth'],
      pendingCrdCount,
      activePatchCount,
      activePipelineConfigId: fs?.active_pipeline_cfg ?? null,
      activeVsliceConfigId: fs?.active_vslice_cfg ?? null,
    }

    return jsonOk(health)
  }

  // ── Pipeline config ───────────────────────────────────────────────────────

  private handleGetPipelineConfig(): Response {
    const config = getActivePipelineConfig(this.ctx.storage.sql)
    if (!config) {
      return jsonError('No active pipeline config', 404)
    }
    return jsonOk(config)
  }

  // ── Alarm: anomaly scanner ────────────────────────────────────────────────

  override async alarm(): Promise<void> {
    const sql = this.ctx.storage.sql
    const intervalMs = parseInt(this.env.ANOMALY_SCAN_INTERVAL_MS ?? '900000', 10)

    try {
      await this.runAnomalyScan(sql)
    } catch (err) {
      console.error('[ArchitectAgentDO] alarm: anomaly scan failed:', err)
    }

    // Re-arm alarm
    await this.ctx.storage.setAlarm(Date.now() + intervalMs)
  }

  private async runAnomalyScan(sql: SqlStorage): Promise<void> {
    const artifactGraph = this.getArtifactGraphStub()
    const repos = this.loadRepos()
    const now = new Date().toISOString()

    // ── D1: Patch stall detection ─────────────────────────────────────────
    const stallThresholdMs = ANOMALY_THRESHOLDS.patchStallMinutes * 60 * 1000
    const stalledPatches = detectStalledPatches(sql, stallThresholdMs)
    for (const stall of stalledPatches) {
      this.insertAnomaly(sql, 'PATCH_STALL', 'D1', {
        patchId: stall.patchId,
        issuedAt: stall.issuedAt,
        affectedRepoCount: stall.affectedRepoCount,
        appliedRepoCount: stall.appliedRepoCount,
      }, now)
    }

    // ── D2: CRD rate anomaly ──────────────────────────────────────────────
    const crdRate = getCrdRatePerHour(sql)
    if (crdRate > ANOMALY_THRESHOLDS.crdPerHour) {
      this.insertAnomaly(sql, 'AMENDMENT_COHERENCE', 'D2', {
        crdPerHour: crdRate,
        threshold: ANOMALY_THRESHOLDS.crdPerHour,
      }, now)
    }

    // ── D3/D4: Execution trace pass failure rates ─────────────────────────
    // Query ArtifactGraphDO for factory-wide pass failure summary
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const resp = await artifactGraph.fetch(
        new Request(
          `https://artifact-graph/query/execution-traces/summary?since=${encodeURIComponent(oneHourAgo)}`,
        ),
      )
      if (resp.ok) {
        const traces = (await resp.json()) as Array<{
          passId: string
          failureCount: number
          totalCount: number
        }>

        // Count repos with high failure rates per pass
        const highFailurePasses = traces.filter(
          (t) => t.totalCount >= 3 && t.failureCount / t.totalCount > ANOMALY_THRESHOLDS.passFailureRate,
        )
        for (const pass of highFailurePasses) {
          this.insertAnomaly(sql, 'PASS_FAILURE_RATE', 'D4', {
            passId: pass.passId,
            failureRate: pass.failureCount / pass.totalCount,
            failureCount: pass.failureCount,
            totalCount: pass.totalCount,
            threshold: ANOMALY_THRESHOLDS.passFailureRate,
          }, now)
        }

        // D3: high atom retry rate across traces
        const highRetryTraces = traces.filter(
          (t) => t.totalCount > 0 && t.failureCount / t.totalCount > ANOMALY_THRESHOLDS.atomRetryRate,
        )
        if (highRetryTraces.length > 0) {
          this.insertAnomaly(sql, 'SEQUENTIAL_FAILURE', 'D3', {
            passesWithHighRetry: highRetryTraces.map((t) => t.passId),
            threshold: ANOMALY_THRESHOLDS.atomRetryRate,
          }, now)
        }
      }
    } catch {
      // Non-fatal — scanner skips on fetch error
    }

    // ── Update factory_state last_anomaly_at if anomalies found ──────────
    const unresolvedCount = (
      [...sql.exec('SELECT COUNT(*) as cnt FROM anomaly_records WHERE resolved = 0')] as unknown as Array<{ cnt: number }>
    )[0]?.cnt ?? 0
    if (unresolvedCount > 0) {
      sql.exec(
        `UPDATE factory_state SET last_anomaly_at = ?, updated_at = ? WHERE factory_id = 'factory'`,
        now,
        now,
      )
    }

    // ── D3: Evaluate vslice policy in response to D3 anomalies ───────────
    await evaluateAndUpdateVslicePolicy('anomaly-scan', {
      sql,
      artifactGraph,
      repos,
    })

    // Log summary
    console.info(
      `[ArchitectAgentDO] anomaly scan complete: stalledPatches=${stalledPatches.length} crdRate=${crdRate}/h unresolvedAnomalies=${unresolvedCount}`,
    )
  }

  private insertAnomaly(
    sql: SqlStorage,
    anomalyClass: AnomalyClass,
    domain: 'D1' | 'D2' | 'D3' | 'D4',
    evidence: Record<string, unknown>,
    now: string,
  ): void {
    const anomalyId = `ANOMALY-${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    try {
      sql.exec(
        `INSERT OR IGNORE INTO anomaly_records (anomaly_id, anomaly_class, domain, evidence, triggered_at, resolved)
         VALUES (?, ?, ?, ?, ?, 0)`,
        anomalyId,
        anomalyClass,
        domain,
        JSON.stringify(evidence),
        now,
      )
    } catch (err) {
      console.warn('[ArchitectAgentDO] insertAnomaly failed:', err)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private loadRepos(): RepoRow[] {
    return [...this.ctx.storage.sql.exec('SELECT * FROM repos ORDER BY registered_at ASC')] as unknown as RepoRow[]
  }

  private getArtifactGraphStub(): DurableObjectStub {
    const id = this.env.ARTIFACT_GRAPH.idFromName('artifact-graph:factory')
    return this.env.ARTIFACT_GRAPH.get(id)
  }
}

// ── JSON response helpers ─────────────────────────────────────────────────────

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
