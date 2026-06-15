/**
 * @module linear-bridge
 *
 * Cloudflare Worker: Linear webhook → WeOps Gateway signal bridge.
 *
 * Route: POST /webhook
 *
 * Processing flow:
 *   1. Verify Linear-Signature HMAC-SHA256 (webhook-verifier)
 *   2. Parse IssueComment action from payload
 *   3. Check for DISPOSITION: line in comment body (disposition-parser)
 *   4. Verify commenter authority in KV registry (authority-registry)
 *   5a. verb=reject → executeRejectionFlow
 *   5b. verb=override → processOverrideDisposition (two-person SM)
 *      5b-complete → continue to 6
 *      5b-pending  → acknowledge + exit
 *   6. Write ElucidationArtifact to ArtifactGraphDO (A9 enforcement)
 *   7. Issue WeOpsDispositionToken JWT (token-issuer)
 *   8. Build InboundSignal (signal-builder)
 *   9. POST /signals to WeOps Gateway with JWT Bearer (gateway-client)
 *  10. Post result comment to Linear (linear-client)
 *
 * A9 invariant: step 7 (JWT issuance) MUST NOT proceed if step 6 (ELC write) fails.
 *
 * Re-export ApprovalFlowDO for Durable Object binding.
 */

import type { Env, LinearWebhookPayload } from './types.js'
import { verifyLinearSignature } from './webhook-verifier.js'
import { parseDispositionComment, hasDispositionLine } from './disposition-parser.js'
import { checkAuthority } from './authority-registry.js'
import { writeElucidationArtifact, makeElucidationNodeId } from './elucidation-writer.js'
import { issueDispositionToken } from './token-issuer.js'
import { buildSignal } from './signal-builder.js'
import { deliverSignalToGateway } from './gateway-client.js'
import { processOverrideDisposition } from './approval-flow.js'
import { executeRejectionFlow } from './rejection-flow.js'
import { createComment } from './linear-client.js'
import { logBridgeError, logSecurityEvent } from './error-log.js'
import { VERB_TO_SCOPE, type DispositionElucidationArtifact } from './types.js'

// ─── ApprovalFlowDO re-export (Durable Object class binding) ─────────────────
// The wrangler.jsonc binds APPROVAL_FLOW_DO → ApprovalFlowDO class.
// In this architecture the approval state is stored in BRIDGE_KV; the DO class
// binding is kept for future migration to a DO-backed state machine.
export { ApprovalFlowDO } from './approval-flow-do.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Webhook handler ─────────────────────────────────────────────────────────

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  // Read raw body once — needed for HMAC verification.
  const rawBody = await request.text()

  // 1. Verify Linear webhook signature.
  const signature = request.headers.get('Linear-Signature') ?? ''
  if (!signature) {
    await logSecurityEvent(env.BRIDGE_KV, {
      subtype: 'InvalidWebhookSignature',
      detail: 'Missing Linear-Signature header',
    })
    return json({ error: 'Missing Linear-Signature header' }, 401)
  }

  const signatureValid = await verifyLinearSignature(rawBody, signature, env.LINEAR_WEBHOOK_SECRET)
  if (!signatureValid) {
    await logSecurityEvent(env.BRIDGE_KV, {
      subtype: 'InvalidWebhookSignature',
      detail: 'HMAC-SHA256 signature mismatch',
    })
    return json({ error: 'Invalid webhook signature' }, 401)
  }

  // 2. Parse payload.
  let payload: LinearWebhookPayload
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Only process IssueComment create/update events.
  if (payload.type !== 'Comment' || payload.action !== 'create') {
    return json({ ok: true, skipped: true, reason: 'not a Comment create event' })
  }

  const commentBody = payload.data.body ?? ''
  const commentId = payload.data.id
  const commenter = payload.data.user
  const issue = payload.data.issue

  if (!commenter?.id || !issue?.id) {
    return json({ ok: true, skipped: true, reason: 'missing commenter or issue in payload' })
  }

  const linearUserId = commenter.id
  const linearIssueId = issue.id

  // 3. Check for DISPOSITION: line.
  if (!hasDispositionLine(commentBody)) {
    return json({ ok: true, skipped: true, reason: 'no DISPOSITION: line in comment' })
  }

  // 4. Parse disposition.
  const parseResult = parseDispositionComment(commentBody)
  if (!parseResult.ok) {
    await logBridgeError(env.BRIDGE_KV, 'Disposition parse failed', {
      reason: parseResult.reason,
      linearIssueId,
      linearUserId,
      commentId,
    })
    await createComment(
      env.LINEAR_API_KEY,
      linearIssueId,
      `**Bridge Error:** Could not parse DISPOSITION comment: ${parseResult.reason}`,
    )
    return json({ ok: false, error: parseResult.reason }, 400)
  }

  const { disposition } = parseResult

  // Extract escalation ID from issue — using issue identifier as escalation anchor.
  // Real escalationId comes from the EscalationEvent that created the issue; for now
  // we use the issue ID as the stable per-issue key.
  const escalationId = issue.id
  const repoId = (payload.data['repoId'] as string | undefined)
    ?? `repo:${issue.id}` // fallback; production escalations carry repoId in metadata

  // 5. Check authority.
  const authorityResult = await checkAuthority(env.BRIDGE_KV, linearUserId, disposition.verb)
  if (!authorityResult.permitted) {
    await logSecurityEvent(env.BRIDGE_KV, {
      subtype: 'UnknownAuthority',
      linearUserId,
      linearIssueId,
      escalationId,
      detail: authorityResult.reason ?? 'not permitted',
    })
    await createComment(
      env.LINEAR_API_KEY,
      linearIssueId,
      `**Bridge:** Disposition rejected — ${authorityResult.reason ?? 'insufficient authority'}.`,
    )
    return json({ ok: false, error: authorityResult.reason }, 403)
  }

  // 5a. Handle reject verb.
  if (disposition.verb === 'reject') {
    const cancelledStateId = (payload.data['cancelledStateId'] as string | undefined)
      ?? 'cancelled' // teams must configure their actual state ID via environment

    const rejectionResult = await executeRejectionFlow(
      disposition,
      escalationId,
      repoId,
      linearIssueId,
      commentId,
      linearUserId,
      cancelledStateId,
      env,
    )

    if (!rejectionResult.ok) {
      await logBridgeError(env.BRIDGE_KV, 'Rejection flow failed', {
        error: rejectionResult.error,
        escalationId,
        linearIssueId,
      })
    }

    return json({ ok: rejectionResult.ok, escalationId, verb: 'reject' })
  }

  // 5b. Handle override verb (two-person approval SM).
  if (disposition.verb === 'override') {
    const overrideResult = await processOverrideDisposition(
      env.BRIDGE_KV,
      escalationId,
      linearUserId,
      disposition,
    )

    if (overrideResult.state === 'DUPLICATE_APPROVER') {
      await logSecurityEvent(env.BRIDGE_KV, {
        subtype: 'DuplicateApprover',
        linearUserId,
        linearIssueId,
        escalationId,
        detail: overrideResult.reason,
      })
      await createComment(
        env.LINEAR_API_KEY,
        linearIssueId,
        `**Bridge:** ${overrideResult.reason}`,
      )
      return json({ ok: false, error: overrideResult.reason }, 409)
    }

    if (overrideResult.state === 'PENDING_SECOND_APPROVAL') {
      await createComment(
        env.LINEAR_API_KEY,
        linearIssueId,
        `**Bridge:** Override disposition received from \`${linearUserId}\`. Awaiting second approval from a different authority. This request expires at ${overrideResult.pending.expiresAt}.`,
      )
      return json({ ok: true, state: 'PENDING_SECOND_APPROVAL', escalationId })
    }

    if (overrideResult.state === 'NONE') {
      // Stale / no-entry state.
      return json({ ok: false, error: overrideResult.reason }, 400)
    }

    // state === 'COMPLETE' — proceed to signal flow.
    // Fall through to ELC write + JWT + signal delivery below.
  }

  // 6. Write ElucidationArtifact to ArtifactGraphDO (A9 enforcement).
  const elcNodeId = makeElucidationNodeId(escalationId)
  const elcArtifact: DispositionElucidationArtifact = {
    id: elcNodeId,
    nodeType: 'ElucidationArtifact',
    escalationId,
    repoId,
    linearIssueId,
    linearCommentId: commentId,
    commenterLinearId: linearUserId,
    dispositionVerb: disposition.verb,
    parsedArgs: {
      workGraphId: disposition.workGraphId,
      workGraphVersion: disposition.workGraphVersion,
      patchId: disposition.patchId,
      configChangeId: disposition.configChangeId,
      affectedRepoIds: disposition.affectedRepoIds,
      overrideDirective: disposition.overrideDirective,
      targetRepoId: disposition.targetRepoId,
    },
    producedAt: new Date().toISOString(),
    bridge: 'ff-linear-bridge',
  }

  const elcResult = await writeElucidationArtifact(elcArtifact, env.ARTIFACT_GRAPH, repoId)
  if (!elcResult.ok) {
    await logBridgeError(env.BRIDGE_KV, 'A9: ElucidationArtifact write failed', {
      error: elcResult.error,
      escalationId,
      repoId,
    })
    await createComment(
      env.LINEAR_API_KEY,
      linearIssueId,
      `**Bridge Error:** Could not record elucidation artifact. Disposition not forwarded (A9 enforcement). Error: ${elcResult.error}`,
    )
    return json({ ok: false, error: `A9 ELC write failed: ${elcResult.error}` }, 500)
  }

  // 7. Issue WeOpsDispositionToken JWT.
  const requiredScope = VERB_TO_SCOPE[disposition.verb]
  let jwt: string
  try {
    jwt = await issueDispositionToken(
      {
        sub: linearUserId,
        scope: [requiredScope],
        dispositionEventId: elcNodeId,
        elucidationArtifactId: elcNodeId,
      },
      env.WEOPS_SIGNING_KEY,
      env.BRIDGE_KV,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await logBridgeError(env.BRIDGE_KV, 'JWT issuance failed', { error: msg, escalationId })
    return json({ ok: false, error: `JWT issuance failed: ${msg}` }, 500)
  }

  // 8. Build InboundSignal.
  const signalResult = buildSignal(disposition, repoId, elcNodeId, elcNodeId)
  if (!signalResult.ok) {
    await logBridgeError(env.BRIDGE_KV, 'Signal build failed', {
      reason: signalResult.reason,
      escalationId,
    })
    return json({ ok: false, error: signalResult.reason }, 400)
  }

  const { signal } = signalResult

  // 9. POST signal to WeOps Gateway.
  const deliveryResult = await deliverSignalToGateway(signal, jwt, env.WEOPS_GATEWAY_URL)
  if (!deliveryResult.ok) {
    await logBridgeError(env.BRIDGE_KV, 'Gateway delivery failed', {
      error: deliveryResult.error,
      status: deliveryResult.status,
      escalationId,
      signalType: signal.signalType,
    })
    await createComment(
      env.LINEAR_API_KEY,
      linearIssueId,
      `**Bridge Error:** Disposition recorded but gateway delivery failed: ${deliveryResult.error}`,
    )
    return json({ ok: false, error: deliveryResult.error }, 502)
  }

  // 10. Post success comment to Linear.
  const successComment = [
    `**Bridge:** Disposition \`${disposition.verb}\` delivered to WeOps Gateway.`,
    `Signal type: \`${signal.signalType}\``,
    `Elucidation: \`${elcNodeId}\``,
    `Issued at: ${new Date().toISOString()}`,
  ].join('\n')

  await createComment(env.LINEAR_API_KEY, linearIssueId, successComment)

  return json({
    ok: true,
    escalationId,
    signalType: signal.signalType,
    elucidationArtifactId: elcNodeId,
  })
}

// ─── Worker export ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    try {
      if (method === 'POST' && url.pathname === '/webhook') {
        return handleWebhook(request, env)
      }

      if (method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, service: 'linear-bridge', timestamp: new Date().toISOString() })
      }

      return json({ error: 'Not found', routes: ['POST /webhook', 'GET /health'] }, 404)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error'
      console.error('linear-bridge: unhandled error:', message)
      return json({ error: message }, 500)
    }
  },
}
