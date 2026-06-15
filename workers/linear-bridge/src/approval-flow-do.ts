/**
 * @module approval-flow-do
 *
 * ApprovalFlowDO — Durable Object stub class for the two-person override
 * approval state machine.
 *
 * In v1 the approval state is persisted in BRIDGE_KV (approval-flow.ts).
 * This DO class exists to satisfy the wrangler.jsonc binding requirement and
 * to provide a migration path to DO-backed storage without changing the
 * external interface.
 *
 * The DO exposes no HTTP routes in v1 — it is a placeholder binding.
 * State management happens entirely in approval-flow.ts via BRIDGE_KV.
 */

import { DurableObject } from 'cloudflare:workers'
import type { Env } from './types.js'

export class ApprovalFlowDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Health check.
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(
        JSON.stringify({ ok: true, class: 'ApprovalFlowDO' }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ ok: false, error: 'ApprovalFlowDO v1: no routes active' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
