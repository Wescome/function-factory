/**
 * @module factory-gateway/index
 *
 * Cloudflare Workers entry point for the Factory gRPC gateway.
 *
 * Implements the Connect protocol (buf.build/connect) over HTTP/1.1 — the
 * only gRPC transport compatible with CF Workers (see ADR-0015).
 *
 * Routes (Connect-JSON protocol, application/connect+json):
 *   POST /weops.factory.v1.FactoryGateway/SubmitSession       — server-streaming
 *   POST /weops.factory.v1.FactoryGateway/CancelSession       — unary
 *   POST /weops.factory.v1.FactoryGateway/AcknowledgeReview   — unary
 *   POST /weops.factory.v1.FactoryGateway/ResumeStream        — server-streaming
 *
 * Connect envelope framing:
 *   - Unary responses:        Content-Type: application/connect+json; body = raw JSON
 *   - Streaming responses:    Content-Type: application/connect+json (chunked)
 *                             Each frame: [flags:1][length:4][body:N]
 *                             flags 0x00 = data message, 0x02 = end-of-stream
 *
 * Note on generated types:
 *   The gen/ directory is produced by `buf generate` at CI time.
 *   Source files use plain TypeScript interfaces so `tsc --noEmit` passes
 *   without running buf first.
 */

import type { Env } from './env.js'
import { validateEnvelope } from './envelope-validator.js'
import { checkPermit } from './pdp-client.js'
import { routeToCommissioningAgent } from './session-router.js'
import { streamSessionEvents } from './stream-manager.js'

// ─── Local TS mirrors of the proto message shapes ────────────────────────────
// These are used in place of generated proto types until `buf generate` runs.

interface WGSPEnvelopeProto {
  envelope_schema_version: string
  actor_type: string
  purpose_id: string
  /** base64-encoded bytes of the work_graph JSON */
  work_graph?: string
  /** base64-encoded HMAC-SHA256 signature bytes */
  signature?: string
}

interface SubmitSessionRequest {
  envelope: WGSPEnvelopeProto
  stream_mode?: number
}

interface CancelSessionRequest {
  session_id: string
  reason?: string
}

interface AcknowledgeReviewRequest {
  session_id: string
  review_id: string
  decision: string
  note?: string
}

interface ResumeStreamRequest {
  session_id: string
  from_sequence?: number
  stream_mode?: number
}

// ─── Error codes (Connect protocol) ──────────────────────────────────────────

const Code = {
  InvalidArgument: 'invalid_argument',
  PermissionDenied: 'permission_denied',
  FailedPrecondition: 'failed_precondition',
  Internal: 'internal',
  NotFound: 'not_found',
  Unimplemented: 'unimplemented',
} as const

type ConnectCode = (typeof Code)[keyof typeof Code]

interface ConnectError {
  code: ConnectCode
  message: string
}

function connectError(code: ConnectCode, message: string): ConnectError {
  return { code, message }
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function unaryOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/connect+json' },
  })
}

function unaryErr(err: ConnectError): Response {
  return new Response(JSON.stringify(err), {
    status: errorStatus(err.code),
    headers: { 'Content-Type': 'application/connect+json' },
  })
}

function errorStatus(code: ConnectCode): number {
  switch (code) {
    case 'invalid_argument':
      return 400
    case 'permission_denied':
      return 403
    case 'failed_precondition':
      return 412
    case 'not_found':
      return 404
    case 'unimplemented':
      return 501
    default:
      return 500
  }
}

/**
 * Encodes a Connect streaming envelope frame.
 * flags 0x00 = data message, 0x02 = end-stream message.
 */
function encodeFrame(flags: number, body: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + body.byteLength)
  frame[0] = flags
  const view = new DataView(frame.buffer)
  view.setUint32(1, body.byteLength, false)
  frame.set(body, 5)
  return frame
}

function jsonFrame(value: unknown): Uint8Array {
  return encodeFrame(0x00, new TextEncoder().encode(JSON.stringify(value)))
}

function endStreamFrame(trailers?: Record<string, string>): Uint8Array {
  const body = trailers ? JSON.stringify(trailers) : '{}'
  return encodeFrame(0x02, new TextEncoder().encode(body))
}

// ─── Session id extraction ────────────────────────────────────────────────────

/**
 * Attempts to extract a session_id from the parsed work_graph bytes, falling
 * back to a crypto random uuid.
 *
 * The work_graph is canonical JSON of an OutboundEnvelope; we look for
 * `session_context.session_id` as specified in wgsp-envelope.ts.
 */
function extractSessionId(envelope: WGSPEnvelopeProto): string {
  try {
    if (envelope.work_graph) {
      // work_graph may be base64-encoded bytes or raw JSON string
      let json: string
      try {
        json = atob(envelope.work_graph)
      } catch {
        json = envelope.work_graph
      }
      const parsed = JSON.parse(json) as Record<string, unknown>
      const sessionCtx = parsed['session_context'] as Record<string, unknown> | undefined
      const id = sessionCtx?.['session_id']
      if (typeof id === 'string' && id.length > 0) return id
    }
  } catch {
    // fall through to random
  }
  return crypto.randomUUID()
}

/**
 * Attempts to extract the work_order_id from the envelope's work_graph
 * (governance_context.work_order_id).
 */
function extractWorkOrderId(envelope: WGSPEnvelopeProto): string {
  try {
    if (envelope.work_graph) {
      let json: string
      try {
        json = atob(envelope.work_graph)
      } catch {
        json = envelope.work_graph
      }
      const parsed = JSON.parse(json) as Record<string, unknown>
      const govCtx = parsed['governance_context'] as Record<string, unknown> | undefined
      const id = govCtx?.['work_order_id']
      if (typeof id === 'string' && id.length > 0) return id
    }
  } catch {
    // fall through
  }
  return crypto.randomUUID()
}

// ─── RPC handlers ─────────────────────────────────────────────────────────────

/**
 * POST /weops.factory.v1.FactoryGateway/SubmitSession
 *
 * 1. Validate WGSP envelope (structural + policy).
 * 2. Check PDP permit.
 * 3. Route to Commissioning Agent DO.
 * 4. Stream SessionEvents back from SubscriptionEventBufferDO.
 */
async function handleSubmitSession(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return unaryErr(connectError(Code.InvalidArgument, 'request body is not valid JSON'))
  }

  const req = body as SubmitSessionRequest
  const envelopeRaw = req.envelope

  if (!envelopeRaw || typeof envelopeRaw !== 'object') {
    return unaryErr(connectError(Code.InvalidArgument, 'envelope is required'))
  }

  // 1. Validate envelope
  const validation = validateEnvelope(envelopeRaw)
  if (!validation.valid) {
    return unaryErr(connectError(Code.InvalidArgument, validation.error ?? 'invalid envelope'))
  }

  // 2. Check PDP permit
  const sessionId = extractSessionId(envelopeRaw)
  const pdp = await checkPermit(
    env.PDP_URL,
    env.PDP_API_KEY,
    sessionId,
    envelopeRaw.actor_type,
    envelopeRaw.purpose_id,
  )
  if (!pdp.permitted) {
    return unaryErr(connectError(Code.PermissionDenied, pdp.reason ?? 'denied by PDP'))
  }

  // 3. Route to Commissioning Agent
  const workOrderId = extractWorkOrderId(envelopeRaw)
  const route = await routeToCommissioningAgent(
    env.COMMISSIONING_AGENT,
    sessionId,
    workOrderId,
    envelopeRaw,
  )
  if (!route.accepted) {
    return unaryErr(
      connectError(Code.FailedPrecondition, route.reason ?? 'commissioning agent rejected'),
    )
  }

  // 4. Stream session events (server-streaming response)
  const fromSeq = 0
  const streamMode = req.stream_mode ?? 1 // default: STREAM_MODE_ALL

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()

  // Kick off the event stream in the background — CF Workers streaming pattern.
  const streamPromise = (async () => {
    try {
      // Build a controller shim over the TransformStream writer
      const controller: ReadableStreamDefaultController = {
        enqueue: (chunk: Uint8Array) => {
          void writer.write(chunk)
        },
        close: () => {
          void writer.write(endStreamFrame())
          void writer.close()
        },
        error: (err: unknown) => {
          void writer.abort(err)
        },
        desiredSize: null,
      }

      await streamSessionEvents(
        env.SUB_BUFFER,
        env.SUB_BUFFER_KV,
        sessionId,
        fromSeq,
        controller,
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await writer.write(jsonFrame({ _error: message }))
      await writer.write(endStreamFrame())
      await writer.close()
    }
  })()

  // Attach streamMode to silence unused-variable warning
  void streamMode
  void streamPromise

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'application/connect+json' },
  })
}

/**
 * POST /weops.factory.v1.FactoryGateway/CancelSession
 */
async function handleCancelSession(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return unaryErr(connectError(Code.InvalidArgument, 'request body is not valid JSON'))
  }

  const req = body as CancelSessionRequest
  if (!req.session_id) {
    return unaryErr(connectError(Code.InvalidArgument, 'session_id is required'))
  }

  // Route cancel to the CA DO — derive workOrderId from sessionId by convention.
  // In this phase we use the sessionId itself as the DO key; the CA can cross-reference.
  const stub = env.COMMISSIONING_AGENT.get(
    env.COMMISSIONING_AGENT.idFromName(`commissioning-agent:${req.session_id}`),
  )

  let response: Response
  try {
    response = await stub.fetch('https://do/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: req.session_id, reason: req.reason ?? '' }),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return unaryErr(connectError(Code.Internal, `commissioning agent unreachable: ${message}`))
  }

  if (response.ok) {
    return unaryOk({ accepted: true, reason: '' })
  }

  let reason = `HTTP ${response.status}`
  try {
    const rb = (await response.json()) as { reason?: string }
    reason = rb.reason ?? reason
  } catch {
    // ignore
  }
  return unaryOk({ accepted: false, reason })
}

/**
 * POST /weops.factory.v1.FactoryGateway/AcknowledgeReview
 */
async function handleAcknowledgeReview(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return unaryErr(connectError(Code.InvalidArgument, 'request body is not valid JSON'))
  }

  const req = body as AcknowledgeReviewRequest
  if (!req.session_id || !req.review_id || !req.decision) {
    return unaryErr(
      connectError(Code.InvalidArgument, 'session_id, review_id, and decision are required'),
    )
  }

  const stub = env.COMMISSIONING_AGENT.get(
    env.COMMISSIONING_AGENT.idFromName(`commissioning-agent:${req.session_id}`),
  )

  let response: Response
  try {
    response = await stub.fetch('https://do/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: req.session_id,
        reviewId: req.review_id,
        decision: req.decision,
        note: req.note ?? '',
      }),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return unaryErr(connectError(Code.Internal, `commissioning agent unreachable: ${message}`))
  }

  if (response.ok) {
    return unaryOk({ accepted: true, reason: '' })
  }

  let reason = `HTTP ${response.status}`
  try {
    const rb = (await response.json()) as { reason?: string }
    reason = rb.reason ?? reason
  } catch {
    // ignore
  }
  return unaryOk({ accepted: false, reason })
}

/**
 * POST /weops.factory.v1.FactoryGateway/ResumeStream
 *
 * Reattach to an existing session's event stream from a given sequence number.
 */
async function handleResumeStream(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return unaryErr(connectError(Code.InvalidArgument, 'request body is not valid JSON'))
  }

  const req = body as ResumeStreamRequest
  if (!req.session_id) {
    return unaryErr(connectError(Code.InvalidArgument, 'session_id is required'))
  }

  const fromSeq = req.from_sequence ?? 0

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()

  const streamPromise = (async () => {
    try {
      const controller: ReadableStreamDefaultController = {
        enqueue: (chunk: Uint8Array) => {
          void writer.write(chunk)
        },
        close: () => {
          void writer.write(endStreamFrame())
          void writer.close()
        },
        error: (err: unknown) => {
          void writer.abort(err)
        },
        desiredSize: null,
      }

      await streamSessionEvents(
        env.SUB_BUFFER,
        env.SUB_BUFFER_KV,
        req.session_id,
        fromSeq,
        controller,
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await writer.write(jsonFrame({ _error: message }))
      await writer.write(endStreamFrame())
      await writer.close()
    }
  })()

  void streamPromise

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'application/connect+json' },
  })
}

// ─── Main dispatch ────────────────────────────────────────────────────────────

const ROUTES: Record<string, (req: Request, env: Env) => Promise<Response>> = {
  '/weops.factory.v1.FactoryGateway/SubmitSession': handleSubmitSession,
  '/weops.factory.v1.FactoryGateway/CancelSession': handleCancelSession,
  '/weops.factory.v1.FactoryGateway/AcknowledgeReview': handleAcknowledgeReview,
  '/weops.factory.v1.FactoryGateway/ResumeStream': handleResumeStream,
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Connect protocol requires POST.
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const url = new URL(request.url)
    const handler = ROUTES[url.pathname]

    if (!handler) {
      return unaryErr(
        connectError(Code.Unimplemented, `unknown method: ${url.pathname}`),
      )
    }

    try {
      return await handler(request, env)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return unaryErr(connectError(Code.Internal, `internal error: ${message}`))
    }
  },
}
