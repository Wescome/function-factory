// Commissioning Agent — stateless CF Worker
// SPEC-COMMISSIONING-AGENT-001
// One instance per repo. All governance state in ArangoDB.

import type { CommissioningSignal, EscalationEvent } from './types.js'

export type Env = {
  ARANGO_URL: string
  ARANGO_DB: string
  ARANGO_TOKEN: string
  MEDIATION_AGENT: DurableObjectNamespace
  WEOPS_GATEWAY_URL: string
  HARNESS_BRIDGE_URL: string
  AUTO_SUSPEND_THRESHOLD_CYCLES: string
  POLL_INTERVAL_ACTIVE_MS: string
  POLL_INTERVAL_IDLE_MS: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    if (method === 'POST' && url.pathname === '/commission') return handleCommission(request, env)
    if (method === 'POST' && url.pathname === '/resume') return handleResume(request, env)
    if (method === 'POST' && url.pathname === '/override') return handleOverride(request, env)
    if (method === 'GET'  && url.pathname.startsWith('/health/')) return handleHealth(request, env)

    return new Response('Not found', { status: 404 })
  },
}

// ── R1: Commission flow ─────────────────────────────────────────────────────

async function handleCommission(request: Request, env: Env): Promise<Response> {
  const signal = await request.json() as CommissioningSignal

  // TODO: validate WeOpsDispositionToken (SPEC-WEOPS-GATEWAY-BOUNDARY-001 §4)
  // TODO: verify Coherence Verdict on WG-* in ArangoDB
  // TODO: produce ElucidationArtifact (A9 — Axiom A9)
  // TODO: write CommissionRecord to ArangoDB

  // Commission the Mediation Agent DO
  const doId = env.MEDIATION_AGENT.idFromName(`mediation-agent:${signal.repoId}`)
  const doStub = env.MEDIATION_AGENT.get(doId)

  const doResponse = await doStub.fetch('https://do/commission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workGraphId: signal.workGraphId,
      workGraphVersion: signal.workGraphVersion,
      arangoLineageRefs: [signal.workGraphId],
    }),
  })

  const result = await doResponse.json() as { status: string; policyBeadId?: string }

  if (result.status !== 'commissioned') {
    // TODO: escalate to We-layer (CommissionFail)
    return Response.json({ status: 'error', reason: result.status }, { status: 502 })
  }

  // TODO: write VCR to ArangoDB
  // TODO: start polling loop (CF Workflow or Cron Trigger)

  return Response.json({ status: 'commissioned', commissionRecordId: `CMR-${signal.repoId}-${Date.now()}` })
}

// ── R5: Resume ──────────────────────────────────────────────────────────────

async function handleResume(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { repoId: string; newWorkGraphId?: string; newWorkGraphVersion?: string; authorizedBy: string; dispositionArtifactId: string }

  // Resume always triggers a new Commission flow
  const commissionSignal: CommissioningSignal = {
    signalType: 'CommissioningSignal',
    repoId: body.repoId,
    workGraphId: body.newWorkGraphId ?? '',
    workGraphVersion: body.newWorkGraphVersion ?? '',
    commissionedBy: body.authorizedBy,
    dispositionEventId: body.dispositionArtifactId,
    elucidationArtifactId: body.dispositionArtifactId,
    issuedAt: new Date().toISOString(),
  }

  const fakeRequest = new Request('https://internal/commission', {
    method: 'POST',
    body: JSON.stringify(commissionSignal),
  })
  return handleCommission(fakeRequest, env)
}

// ── Override (Architect Agent emergency) ───────────────────────────────────

async function handleOverride(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { repoId: string; action: string; authorizedBy: string }

  // TODO: validate elevated WeOpsDispositionToken scope (we-layer:override)

  const doId = env.MEDIATION_AGENT.idFromName(`mediation-agent:${body.repoId}`)
  const doStub = env.MEDIATION_AGENT.get(doId)

  if (body.action === 'force-suspend') {
    await doStub.fetch('https://do/suspend', { method: 'POST', body: JSON.stringify(body) })
  }

  return Response.json({ status: 'override-applied' })
}

// ── Health ──────────────────────────────────────────────────────────────────

async function handleHealth(request: Request, env: Env): Promise<Response> {
  const repoId = new URL(request.url).pathname.split('/health/')[1]

  const doId = env.MEDIATION_AGENT.idFromName(`mediation-agent:${repoId}`)
  const doStub = env.MEDIATION_AGENT.get(doId)

  const stateResponse = await doStub.fetch('https://do/state')
  const state = await stateResponse.json()

  return Response.json(state)
}

// ── R3: Hypothesis formation ────────────────────────────────────────────────
// Invoked from polling loop (CF Workflow — not in this Worker)
// Model: Claude Opus via @factory/harness-bridge

export async function formHypothesis(
  divergenceId: string,
  repoId: string,
  env: Env
): Promise<string> {
  // TODO: read Divergence from ArangoDB
  // TODO: call harness-bridge with Claude Opus for structured Hypothesis output
  // TODO: write HYP-* artifact to ArangoDB with lineage edges
  // TODO: if blocking: trigger proposeAmendment()
  return `HYP-${repoId}-${Date.now()}`
}

// ── R4: Amendment proposal ─────────────────────────────────────────────────
// Model: GPT-5.5 via @factory/harness-bridge

export async function proposeAmendment(
  hypothesisId: string,
  repoId: string,
  env: Env
): Promise<string> {
  // TODO: translate Hypothesis corrective response into WorkGraph diff
  // TODO: write AMD-* artifact to ArangoDB
  // TODO: submit to compiler for Coherence Verification
  // TODO: on favorable: trigger commission flow with successor WG-*
  // TODO: on unfavorable: escalate to We-layer
  return `AMD-${repoId}-${Date.now()}`
}

// ── R5: Escalation ─────────────────────────────────────────────────────────

export async function escalateToWeLayer(
  event: EscalationEvent,
  env: Env
): Promise<void> {
  // TODO: write ESC-* to ArangoDB before send
  await fetch(`${env.WEOPS_GATEWAY_URL}/escalations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
}
