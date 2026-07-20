/**
 * @factory/subscription-buffer — SubscriptionEventBufferDO
 *
 * One Durable Object per session. Owns the hibernatable WebSocket fan-out and
 * the reconnect/replay contract for the active session window.
 *
 * DO naming: sub-buffer:{sessionId}
 *
 * Spec: Factory GraphQL Subscription Replay Contract v1 §2–§4
 */

import { DurableObject } from 'cloudflare:workers'
import { initSchema } from './schema.js'
import { verifyProducerToken } from './hmac.js'
import type { EventWrite, BufferedEvent, BufferMeta, Env } from './types.js'

// ── graphql-ws frame helpers ──────────────────────────────────────────────

/** graphql-ws keepalive frames for WebSocket auto-response. */
const GQL_PING_FRAME = JSON.stringify({ type: 'ping' })
const GQL_PONG_FRAME = JSON.stringify({ type: 'pong' })

/** Build a graphql-ws 'Next' message for a buffered event. */
function gqlWsNext(seq: number, stream: string, kind: string, payload: unknown): string {
  return JSON.stringify({
    type: 'next',
    id: '1',
    payload: {
      data: {
        [stream]: { seq, kind, ...((payload !== null && typeof payload === 'object') ? payload as Record<string, unknown> : { value: payload }) },
      },
    },
  })
}

// ── Tag encoding ─────────────────────────────────────────────────────────
// Tags array: [streams_csv, run_id_or_empty, assembly_id_or_empty]

interface WsTag {
  streams:    string[]
  runId:      string | null
  assemblyId: string | null
}

function encodeWsTags(streams: string[], runId: string | null, assemblyId: string | null): string[] {
  return [streams.join(','), runId ?? '', assemblyId ?? '']
}

function decodeWsTag(ws: WebSocket): WsTag {
  // CF hibernatable WS exposes deserialization tag API
  const tags = (ws as unknown as { getTags(): string[] }).getTags()
  const streamsTag = tags[0] ?? ''
  return {
    streams:    streamsTag ? streamsTag.split(',') : [],
    runId:      tags[1] != null && tags[1] !== '' ? tags[1] : null,
    assemblyId: tags[2] != null && tags[2] !== '' ? tags[2] : null,
  }
}

// ── Row shapes from sql.exec ───────────────────────────────────────────────

interface MetaRow {
  id:                  number
  session_id:          string
  run_id:              string | null
  assembly_id:         string | null
  next_seq:            number
  last_write_at:       number
  terminal_at:         number | null
  producer_token_hash: string | null
}

interface EventRow {
  seq:               number
  stream:            string
  kind:              string
  scope_run_id:      string | null
  scope_assembly_id: string | null
  payload:           string
  occurred_at:       number
  appended_at:       number
  terminal:          number
}

// ── SubscriptionEventBufferDO ─────────────────────────────────────────────

export class SubscriptionEventBufferDO extends DurableObject<Env> {
  private readonly sql: SqlStorage
  private _producerSecret: string | undefined

  /** Lazy-read and cache SUB_BUFFER_PRODUCER_SECRET (DO constructors cannot be async). */
  private async getProducerSecret(): Promise<string> {
    if (this._producerSecret === undefined) {
      this._producerSecret = await this.env.SUB_BUFFER_PRODUCER_SECRET.get()
    }
    return this._producerSecret
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql

    // Init schema and set up auto-response keepalive before first request.
    ctx.blockConcurrencyWhile(async () => {
      initSchema(this.sql)
      // Register Ping → Pong auto-response so hibernated DO answers without waking.
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair(GQL_PING_FRAME, GQL_PONG_FRAME)
      )
    })
  }

  // ── Fetch router ───────────────────────────────────────────────────────

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (req.method === 'POST' && url.pathname === '/event') {
      return this.handleEvent(req)
    }
    if (req.method === 'GET' && url.pathname === '/ws') {
      return this.handleWs(req)
    }
    if (req.method === 'GET' && url.pathname === '/replay') {
      return this.handleReplay(url)
    }
    if (req.method === 'GET' && url.pathname === '/head') {
      return this.handleHead()
    }
    if (req.method === 'POST' && url.pathname === '/terminate') {
      return this.handleTerminate()
    }
    if (req.method === 'POST' && url.pathname === '/open') {
      return this.handleOpen(req)
    }
    return new Response('Not found', { status: 404 })
  }

  // ── POST /event ────────────────────────────────────────────────────────

  private async handleEvent(req: Request): Promise<Response> {
    let body: EventWrite
    try {
      body = await req.json<EventWrite>()
    } catch {
      return new Response('Bad request: invalid JSON', { status: 400 })
    }

    // HMAC auth
    const valid = await verifyProducerToken(
      await this.getProducerSecret(),
      body.sessionId,
      body.producerToken
    )
    if (!valid) {
      return new Response('Unauthorized: invalid producerToken', { status: 401 })
    }

    const result = await this.appendEvent(body)
    return Response.json(result)
  }

  private async appendEvent(w: EventWrite): Promise<{ seq: number }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const meta = this.readMeta(w.sessionId)
      const seq  = meta.nextSeq

      this.sql.exec(
        `INSERT INTO buffered_events
           (seq, stream, kind, scope_run_id, scope_assembly_id, payload, occurred_at, appended_at, terminal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        seq,
        w.stream,
        w.kind,
        w.runId ?? null,
        w.assemblyId ?? null,
        JSON.stringify(w.payload),
        w.occurredAt,
        Date.now(),
        w.terminal ? 1 : 0
      )

      const now = Date.now()
      this.sql.exec(
        `UPDATE buffer_meta
         SET next_seq = ?, last_write_at = ?, terminal_at = COALESCE(terminal_at, ?)
         WHERE id = 0`,
        seq + 1,
        now,
        w.terminal ? now : null
      )

      this.armTtlAlarm()
      this.broadcast(seq, w)

      // Refresh KV shadow
      void this.refreshKvShadow(w.sessionId, seq, !!w.terminal)

      return { seq }
    })
  }

  // ── GET /ws ────────────────────────────────────────────────────────────

  private async handleWs(req: Request): Promise<Response> {
    const upgradeHeader = req.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    const url        = new URL(req.url)
    const lastSeqStr = url.searchParams.get('last_seq')
    const streamsStr = url.searchParams.get('streams') ?? 'sessionEvents'
    const runId      = url.searchParams.get('run_id')      ?? null
    const assemblyId = url.searchParams.get('assembly_id') ?? null

    const lastSeq = lastSeqStr != null ? parseInt(lastSeqStr, 10) : 0

    // Check if buffer is expired (no meta row at all)
    const metaRows = [...this.sql.exec('SELECT * FROM buffer_meta WHERE id = 0')] as unknown as MetaRow[]
    if (metaRows.length === 0) {
      return this.replayUnavailableResponse(lastSeq)
    }

    const streams = streamsStr.split(',').filter(Boolean)
    const { 0: client, 1: server } = new WebSocketPair()

    const tags = encodeWsTags(streams, runId, assemblyId)
    this.ctx.acceptWebSocket(server, tags)

    // Replay (last_seq, tip] before going live
    this.replayToSocket(server, lastSeq, streams, runId, assemblyId)

    return new Response(null, { status: 101, webSocket: client })
  }

  // ── GET /replay ────────────────────────────────────────────────────────

  private handleReplay(url: URL): Response {
    const lastSeqStr = url.searchParams.get('last_seq')
    const streamsStr = url.searchParams.get('streams') ?? 'sessionEvents'
    const lastSeq    = lastSeqStr != null ? parseInt(lastSeqStr, 10) : 0
    const streams    = streamsStr.split(',').filter(Boolean)

    // Check if buffer has expired
    const metaRows = [...this.sql.exec('SELECT * FROM buffer_meta WHERE id = 0')] as unknown as MetaRow[]
    if (metaRows.length === 0) {
      return this.replayUnavailableResponse(lastSeq)
    }

    const events = this.fetchEvents(lastSeq, streams, null, null)
    const tipSeq = events.length > 0 ? events[events.length - 1]!.seq : lastSeq
    const terminal = events.some(e => e.terminal)
    return Response.json({ rows: events, tip_seq: tipSeq, terminal })
  }

  // ── GET /head ──────────────────────────────────────────────────────────

  private handleHead(): Response {
    const metaRows = [...this.sql.exec('SELECT * FROM buffer_meta WHERE id = 0')] as unknown as MetaRow[]
    if (metaRows.length === 0) {
      return Response.json({ tip_seq: 0, terminal: false, last_write_at: 0 })
    }
    const meta = metaRows[0]!
    const tipSeq = meta.next_seq - 1
    return Response.json({
      tip_seq:       tipSeq,
      terminal:      meta.terminal_at !== null,
      last_write_at: meta.last_write_at,
    })
  }

  // ── POST /open ─────────────────────────────────────────────────────────

  private async handleOpen(req: Request): Promise<Response> {
    let body: { sessionId?: unknown }
    try {
      body = await req.json<{ sessionId?: unknown }>()
    } catch {
      return new Response('Bad request: invalid JSON', { status: 400 })
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null
    if (!sessionId) {
      return new Response('Bad request: missing sessionId', { status: 400 })
    }

    // Insert-if-absent: initializes buffer_meta for this session
    this.readMeta(sessionId)
    // Seed KV liveness: write tip_seq:0 so the session is discoverable immediately
    await this.refreshKvShadow(sessionId, 0, false)

    return Response.json({ ok: true })
  }

  // ── POST /terminate ────────────────────────────────────────────────────

  private async handleTerminate(): Promise<Response> {
    const metaRows = [...this.sql.exec('SELECT * FROM buffer_meta WHERE id = 0')] as unknown as MetaRow[]
    if (metaRows.length === 0) {
      return Response.json({ ok: true })
    }
    const meta    = metaRows[0]!
    const now     = Date.now()

    this.sql.exec(
      `UPDATE buffer_meta SET terminal_at = COALESCE(terminal_at, ?) WHERE id = 0`,
      now
    )
    // Arm terminal grace alarm
    await this.ctx.storage.setAlarm(now + 5 * 60_000)

    // Send graphql-ws Complete to all sockets
    this.closeAllSockets('SESSION_TERMINAL')

    void this.refreshKvShadow(meta.session_id, meta.next_seq - 1, true)

    return Response.json({ ok: true })
  }

  // ── Alarm (TTL disposal) ───────────────────────────────────────────────

  override async alarm(): Promise<void> {
    const metaRows = [...this.sql.exec('SELECT * FROM buffer_meta WHERE id = 0')] as unknown as MetaRow[]
    if (metaRows.length === 0) return

    const meta   = metaRows[0]!
    const now    = Date.now()
    const expiry = meta.terminal_at !== null
      ? meta.terminal_at + 5 * 60_000       // terminal grace
      : meta.last_write_at + 30 * 60_000    // sliding live window

    if (now < expiry) {
      // Not yet expired — re-arm at actual expiry time
      await this.ctx.storage.setAlarm(expiry)
      return
    }

    // Expired: close sockets, delete KV shadow, drop all storage
    this.closeAllSockets('REPLAY_WINDOW_EXPIRED')
    try {
      await this.env.SUB_BUFFER_KV.delete(`sub-buffer:${meta.session_id}`)
    } catch {
      // Non-fatal KV delete failure
    }
    await this.ctx.storage.deleteAll()
  }

  // ── WebSocket handlers (hibernatable API) ─────────────────────────────

  override webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    if (typeof msg !== 'string') return

    let frame: { type: string; id?: string; payload?: unknown }
    try {
      frame = JSON.parse(msg) as { type: string; id?: string; payload?: unknown }
    } catch {
      return
    }

    switch (frame.type) {
      case 'connection_init':
        ws.send(JSON.stringify({ type: 'connection_ack' }))
        break
      case 'subscribe':
        // Live-tail already set up via acceptWebSocket tags.
        // Replay is done at connection time in handleWs.
        // Nothing additional needed here — broadcast handles new events.
        break
      case 'complete':
        ws.close(1000, 'client_complete')
        break
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break
      default:
        break
    }
  }

  override webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): void {
    // Hibernatable API: the socket is removed from getWebSockets() automatically.
    // No additional bookkeeping required.
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  /**
   * Read or initialize buffer_meta.
   * If no row exists yet, inserts a seed row using the given sessionId.
   */
  private readMeta(sessionId: string): BufferMeta {
    const rows = [...this.sql.exec('SELECT * FROM buffer_meta WHERE id = 0')] as unknown as MetaRow[]

    if (rows.length === 0) {
      // First write: initialize the meta row
      const now = Date.now()
      this.sql.exec(
        `INSERT INTO buffer_meta (id, session_id, next_seq, last_write_at) VALUES (0, ?, 1, ?)`,
        sessionId,
        now
      )
      return {
        sessionId,
        runId:             null,
        assemblyId:        null,
        nextSeq:           1,
        lastWriteAt:       now,
        terminalAt:        null,
        producerTokenHash: null,
      }
    }

    const r = rows[0]!
    return {
      sessionId:         r.session_id,
      runId:             r.run_id,
      assemblyId:        r.assembly_id,
      nextSeq:           r.next_seq,
      lastWriteAt:       r.last_write_at,
      terminalAt:        r.terminal_at,
      producerTokenHash: r.producer_token_hash,
    }
  }

  /** (Re)arm the TTL disposal alarm at last_write_at + 30min. */
  private armTtlAlarm(): void {
    const rows = [...this.sql.exec(
      'SELECT last_write_at, terminal_at FROM buffer_meta WHERE id = 0'
    )] as unknown as { last_write_at: number; terminal_at: number | null }[]

    if (rows.length === 0) return
    const r      = rows[0]!
    const expiry = r.terminal_at !== null
      ? r.terminal_at + 5 * 60_000
      : r.last_write_at + 30 * 60_000

    void this.ctx.storage.setAlarm(expiry)
  }

  /** Broadcast a newly appended event to all matching attached sockets. */
  private broadcast(seq: number, w: EventWrite): void {
    const frame = gqlWsNext(seq, w.stream, w.kind, w.payload)

    for (const ws of this.ctx.getWebSockets()) {
      const tag = decodeWsTag(ws)

      if (!tag.streams.includes(w.stream)) continue
      if (w.stream === 'beadUpdates'    && tag.runId      !== w.runId)      continue
      if (w.stream === 'artifactWrites' && tag.assemblyId !== w.assemblyId) continue

      try {
        ws.send(frame)
      } catch {
        // Dying socket — webSocketClose will reap it
      }
    }
  }

  /** Fetch events from (lastSeq, tip] filtered by stream and optional scope. */
  private fetchEvents(
    lastSeq:    number,
    streams:    string[],
    runId:      string | null,
    assemblyId: string | null
  ): BufferedEvent[] {
    if (streams.length === 0) return []

    // Build parameterized IN clause
    const placeholders = streams.map(() => '?').join(', ')
    const query = `SELECT * FROM buffered_events WHERE seq > ? AND stream IN (${placeholders}) ORDER BY seq ASC`
    const params: (string | number)[] = [lastSeq, ...streams]

    const rows = [...this.sql.exec(query, ...params)] as unknown as EventRow[]

    return rows
      .filter(r => {
        if (r.stream === 'beadUpdates'    && runId      && r.scope_run_id      !== runId)      return false
        if (r.stream === 'artifactWrites' && assemblyId && r.scope_assembly_id !== assemblyId) return false
        return true
      })
      .map(r => ({
        seq:             r.seq,
        stream:          r.stream as BufferedEvent['stream'],
        kind:            r.kind,
        scopeRunId:      r.scope_run_id,
        scopeAssemblyId: r.scope_assembly_id,
        payload:         JSON.parse(r.payload) as unknown,
        occurredAt:      r.occurred_at,
        appendedAt:      r.appended_at,
        terminal:        r.terminal === 1,
      }))
  }

  /** Replay (lastSeq, tip] events to a WebSocket as graphql-ws Next frames. */
  private replayToSocket(
    ws:         WebSocket,
    lastSeq:    number,
    streams:    string[],
    runId:      string | null,
    assemblyId: string | null
  ): void {
    const events = this.fetchEvents(lastSeq, streams, runId, assemblyId)
    for (const ev of events) {
      try {
        ws.send(gqlWsNext(ev.seq, ev.stream, ev.kind, ev.payload))
      } catch {
        // Socket closed before replay finished
        break
      }
    }
  }

  /** Close all attached sockets with a graphql-ws Complete message. */
  private closeAllSockets(reason: string): void {
    const completeFrame = JSON.stringify({ type: 'complete', id: '1' })
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(completeFrame)
        ws.close(1000, reason)
      } catch {
        // Already closed
      }
    }
  }

  /** Opportunistically refresh the KV TTL shadow (§3.3). Non-fatal on error. */
  private async refreshKvShadow(
    sessionId: string,
    tipSeq:    number,
    terminal:  boolean
  ): Promise<void> {
    try {
      const expirationTtl = terminal ? 300 : 1800
      await this.env.SUB_BUFFER_KV.put(
        `sub-buffer:${sessionId}`,
        JSON.stringify({ tip_seq: tipSeq, terminal }),
        { expirationTtl }
      )
    } catch {
      // Non-fatal: KV shadow is a hint, not authority
    }
  }

  /** Return a 410 REPLAY_UNAVAILABLE response (§3.4). */
  private replayUnavailableResponse(fromSeq: number): Response {
    return new Response(
      JSON.stringify({
        code:       'REPLAY_UNAVAILABLE',
        fromSeq,
        guidance:   'Live replay buffer expired. Resume the durable stream via gRPC FactoryGateway.ResumeStream(session_id, from_sequence=' + fromSeq.toString() + '). GraphQL subscriptions are a live convenience tier; the gRPC stream is authoritative.',
        grpcMethod: 'weops.factory.v1.FactoryGateway/ResumeStream',
      }),
      { status: 410, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
