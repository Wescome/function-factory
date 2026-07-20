/**
 * @factory/commissioning-agent — CommissioningAgentDO
 *
 * Thin DurableObject stub per CA-INV-001.
 * No alarm handler. No phase state machine. No LLM loop.
 * Mastra workflow (ca-compiler-workflow) owns lifecycle state.
 *
 * Endpoint contracts:
 *   POST /signal             — CommissioningSignal → create Mastra run → 202 { sessionId, runId }
 *   GET  /signal/:sessionId  — rehydrate run from D1 → { phase, status, isNodeId? }
 *   POST /divergence         — DivergenceNotification → resume suspended run or hypothesis-formation
 *
 * CA-INV-001: DO is a thin stub.
 * CA-INV-007: human approval suspension is workflow.suspend(); DO does not implement its own.
 */

import { DurableObject } from 'cloudflare:workers'
import { RequestContext } from '@mastra/core/di'
import type { Agent } from '@mastra/core/agent'
import { buildPlannerAgent } from '@factory/gears'
import type { PlannerAgentEnv } from '@factory/gears'
import type { Env } from './env.js'
import {
  CommissioningSignalSchema,
  DivergenceNotificationSchema,
} from './schemas.js'
import type { Phase } from './schemas.js'
import { caCompilerWorkflow } from './workflow/ca-compiler-workflow.js'
import {
  runHypothesisFormation,
  runAmendmentProposal,
} from './phases/index.js'

// ── Sessions SQLite DDL ────────────────────────────────────────────────────────

const SESSIONS_DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  sessionId   TEXT PRIMARY KEY,
  runId       TEXT NOT NULL,
  orgId       TEXT NOT NULL,
  isNodeId    TEXT,
  status      TEXT NOT NULL DEFAULT 'running',
  createdAt   TEXT NOT NULL
)
`

// ── CommissioningAgentDO ──────────────────────────────────────────────────────

export class CommissioningAgentDO extends DurableObject<Env> {
  private sql: SqlStorage
  private doCtx: DurableObjectState

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.doCtx = ctx
    this.sql = ctx.storage.sql
    void ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(SESSIONS_DDL)
    })
  }

  // ── fetch router ─────────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    if (request.method === 'POST' && pathname === '/signal') {
      return this.handleSignal(request)
    }

    if (request.method === 'GET' && pathname.startsWith('/signal/')) {
      const sessionId = pathname.slice('/signal/'.length)
      return this.handlePoll(sessionId)
    }

    if (request.method === 'POST' && pathname === '/divergence') {
      return this.handleDivergence(request)
    }

    return new Response('not found', { status: 404 })
  }

  // ── POST /signal ──────────────────────────────────────────────────────────────

  private async handleSignal(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('invalid-json', 400)
    }

    const parse = CommissioningSignalSchema.safeParse(body)
    if (!parse.success) {
      return jsonError('invalid-signal', 400, parse.error.issues)
    }
    const signal = parse.data

    // Build RequestContext so workflow steps can access Cloudflare bindings
    const rc = new RequestContext<{ env: Env }>([['env', this.env]])

    // Create run — get runId before starting so we can insert session immediately
    const run = await caCompilerWorkflow.createRun()
    const runId = run.runId

    // Persist session immediately so poll works from the first request
    this.sql.exec(
      `INSERT OR REPLACE INTO sessions (sessionId, runId, orgId, isNodeId, status, createdAt)
       VALUES (?, ?, ?, NULL, 'running', ?)`,
      signal.sessionId,
      runId,
      signal.orgId,
      new Date().toISOString(),
    )

    // Keep DO alive until workflow completes; update session status when done
    const sessionId = signal.sessionId
    const sql = this.sql
    this.doCtx.waitUntil(
      run.start({ inputData: signal, requestContext: rc })
        .then((result) => {
          if (result.status === 'success') {
            sql.exec(
              'UPDATE sessions SET status = ?, isNodeId = ? WHERE sessionId = ?',
              'completed',
              (result.result as { isNodeId?: string }).isNodeId ?? null,
              sessionId,
            )
          } else if (result.status === 'suspended') {
            sql.exec('UPDATE sessions SET status = ? WHERE sessionId = ?', 'suspended', sessionId)
          } else {
            sql.exec('UPDATE sessions SET status = ? WHERE sessionId = ?', 'failed', sessionId)
          }
        })
        .catch(() => {
          sql.exec(
            'UPDATE sessions SET status = ? WHERE sessionId = ?',
            'failed',
            sessionId,
          )
        }),
    )

    return jsonResponse({ status: 'commissioned', sessionId: signal.sessionId, runId, orgId: signal.orgId }, 202)
  }

  // ── GET /signal/:sessionId ─────────────────────────────────────────────────────

  private async handlePoll(sessionId: string): Promise<Response> {
    type SessionRow = { sessionId: string; runId: string; orgId: string; isNodeId: string | null; status: string }
    const rows = [...this.sql.exec<SessionRow>(
      'SELECT sessionId, runId, orgId, isNodeId, status FROM sessions WHERE sessionId = ?',
      sessionId,
    )]

    if (rows.length === 0) {
      return jsonError('session-not-found', 404)
    }

    const row = rows[0]!
    const phase = mapDbStatusToPhase(row.status ?? 'running')
    const isNodeId = row.isNodeId ?? null

    return jsonResponse({
      sessionId,
      runId: row.runId,
      phase,
      status: 'ok',
      isNodeId,
    })
  }

  // ── POST /divergence ──────────────────────────────────────────────────────────

  private async handleDivergence(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('invalid-json', 400)
    }

    const parse = DivergenceNotificationSchema.safeParse(body)
    if (!parse.success) {
      return jsonError('invalid-divergence', 400, parse.error.issues)
    }
    const notification = parse.data

    // Look up session by runId
    type SessionRow = { sessionId: string; runId: string; orgId: string; isNodeId: string | null }
    const rows = [...this.sql.exec<SessionRow>(
      'SELECT sessionId, runId, orgId, isNodeId FROM sessions WHERE runId = ?',
      notification.runId,
    )]

    if (rows.length > 0) {
      const row = rows[0]!
      const state = await caCompilerWorkflow.getWorkflowRunById(row.runId)

      if (state?.status === 'suspended') {
        // Resume the suspended workflow
        const rc = new RequestContext<{ env: Env }>([['env', this.env]])

        // Re-create the run object to get a handle for resume
        const run = await caCompilerWorkflow.createRun({ runId: row.runId })
        void run.resumeAsync({
          resumeData: notification,
          step: 'human-approval-gate',
          requestContext: rc,
        })

        return jsonResponse({ status: 'acknowledged', action: 'resumed' }, 202)
      }
    }

    // No suspended workflow — run hypothesis-formation handler directly
    const orgId = rows.length > 0 ? rows[0]!.orgId : notification.runId

    // CA-INV-005: all LLM calls go through buildPlannerAgent.
    const plannerEnv: PlannerAgentEnv = {
      DB: this.env.DB,
      CLOUDFLARE_ACCOUNT_ID: this.env.CLOUDFLARE_ACCOUNT_ID,
      CF_API_TOKEN: this.env.CF_API_TOKEN ? await this.env.CF_API_TOKEN.get() : '',
    }
    const plannerAgent = buildPlannerAgent('planner', plannerEnv)
    const generate = async (prompt: string): Promise<{ text: string }> => {
      const result = await plannerAgent.generate(prompt)
      return { text: result.text ?? '' }
    }

    const hypothesis = await runHypothesisFormation(generate, notification, orgId)

    if (!hypothesis) {
      return jsonError('hypothesis-formation-failed', 500)
    }

    const amendment = await runAmendmentProposal(generate, hypothesis, orgId)

    if (!amendment) {
      return jsonError('amendment-proposal-failed', 500)
    }

    return jsonResponse({ status: 'acknowledged', amendmentId: amendment.id }, 202)
  }
}

// ── Status → Phase mapping ────────────────────────────────────────────────────

function mapDbStatusToPhase(status: string): Phase {
  switch (status) {
    case 'suspended':  return 'suspended-approval'
    case 'running':    return 'commissioning'
    case 'completed':  return 'idle'
    case 'failed':     return 'idle'
    default:           return 'idle'
  }
}

// ── Response helpers ──────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jsonError(error: string, status: number, details?: unknown): Response {
  return new Response(JSON.stringify({ error, ...(details !== undefined ? { details } : {}) }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

