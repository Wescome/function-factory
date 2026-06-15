/**
 * GraphQL Subscription Resolvers — factory-graphql Worker
 *
 * Spec: Factory-Subscription-Replay-Contract-v1.md §7 (client reconnect flow)
 * Phase: ADR-0016 Phase 4 — factory-graphql Worker integration
 *
 * Transport: SSE via graphql-yoga async generators (not WebSocket).
 * The buffer DO owns hibernatable WebSocket fan-out internally; the Worker
 * polls the DO via HTTP (GET /replay) and streams events to external clients
 * as SSE. This is the correct CF Worker pattern — Workers cannot hold
 * WebSockets across hibernation; only DOs can.
 */

import type { GqlContext } from '../context.js'
import type { Env } from '../env.js'

/** Raw event shape returned from the buffer DO GET /replay endpoint. */
interface ReplayEvent {
  seq:       number
  kind:      string
  payload:   unknown
  terminal?: boolean
}

/** Response envelope from `GET /replay` (matches buffer-do.ts handleReplay contract). */
interface ReplayResponse {
  rows:     ReplayEvent[]
  tip_seq:  number
  terminal: boolean
}

/** Internal yield shape for pollBufferDO. seq=-1 signals REPLAY_UNAVAILABLE. */
interface PollEvent {
  seq:     number
  kind:    string
  payload: unknown
}

/**
 * Core polling loop: reads from SubscriptionEventBufferDO via KV liveness
 * probe + DO GET /replay until terminal or buffer gone.
 *
 * Contract (§7 steps 5-9):
 *  - Probe KV first (cheap, avoids waking the DO on a miss).
 *  - If KV miss → yield REPLAY_UNAVAILABLE sentinel (seq=-1) and stop.
 *  - If KV hit but no new events → wait 500ms and retry.
 *  - If KV hit with new events → fetch from DO /replay, yield each, advance cursor.
 *  - Respect the terminal flag in both the KV shadow and per-event payload.
 */
async function* pollBufferDO(
  env: Env,
  sessionId: string,
  fromSeq: number,
  streams: string[],
  runId?: string,
  assemblyId?: string,
): AsyncGenerator<PollEvent> {
  let lastSeq = fromSeq
  let terminal = false

  while (!terminal) {
    // 1. KV liveness probe (§3.3) — cheap, does not wake the DO.
    const kvEntry = (await env.SUB_BUFFER_KV.get(
      'sub-buffer:' + sessionId,
      'json',
    )) as { tip_seq: number; terminal: boolean } | null

    if (!kvEntry) {
      // Buffer gone. Stub: assume session is terminal for now.
      // Full implementation: query D1 factory-ops for session.status.
      yield {
        seq:  -1,
        kind: 'REPLAY_UNAVAILABLE',
        payload: {
          code:       'REPLAY_UNAVAILABLE',
          fromSeq:    lastSeq,
          guidance:   'Live replay buffer expired. Use gRPC FactoryGateway.ResumeStream.',
          grpcMethod: 'weops.factory.v1.FactoryGateway/ResumeStream',
        },
      }
      break
    }

    terminal = kvEntry.terminal

    if (kvEntry.tip_seq <= lastSeq) {
      // No new events yet — poll again after a short wait.
      await new Promise<void>(r => setTimeout(r, 500))
      continue
    }

    // 2. Fetch new events from the buffer DO via GET /replay (§2.3).
    const stub = env.SUB_BUFFER.get(
      env.SUB_BUFFER.idFromName('sub-buffer:' + sessionId),
    )
    const url = new URL('https://do/replay')
    url.searchParams.set('last_seq', String(lastSeq))
    url.searchParams.set('streams', streams.join(','))
    if (runId)      url.searchParams.set('run_id',      runId)
    if (assemblyId) url.searchParams.set('assembly_id', assemblyId)

    let events: ReplayEvent[] = []
    try {
      const res = await stub.fetch(new Request(url.toString()))
      if (res.ok) {
        const body = (await res.json()) as ReplayResponse
        events = body.rows
        // Respect terminal flag from the envelope even if no per-row terminal set
        if (body.terminal) terminal = true
      }
    } catch {
      // DO temporarily unavailable — retry next poll cycle.
      await new Promise<void>(r => setTimeout(r, 1000))
      continue
    }

    for (const ev of events) {
      yield { seq: ev.seq, kind: ev.kind, payload: ev.payload }
      lastSeq = ev.seq
      if (ev.terminal) {
        terminal = true
        break
      }
    }

    if (!terminal) {
      await new Promise<void>(r => setTimeout(r, 200))
    }
  }
}

// ── Subscription resolvers ────────────────────────────────────────────────────

export const subscriptionResolvers = {
  Subscription: {
    /**
     * sessionEvents(sessionId: ID!) — pipeline + bead + governance events.
     * Spec §4.1: one sub-buffer:{sessionId} DO per session.
     */
    sessionEvents: {
      subscribe: async function* (
        _: unknown,
        { sessionId }: { sessionId: string },
        ctx: GqlContext,
      ): AsyncGenerator<{ sessionEvents: unknown }> {
        for await (const ev of pollBufferDO(ctx.env, sessionId, 0, ['sessionEvents'])) {
          yield {
            sessionEvents: {
              sessionId,
              workOrderId: '',
              occurredAt:  new Date().toISOString(),
              kind:        ev.kind,
              payload:     ev.payload,
            },
          }
        }
      },
      resolve: (payload: unknown) => payload,
    },

    /**
     * artifactWrites(assemblyId: ID!) — artifact-written events for an assembly.
     * Phase 4 stub: resolves assemblyId as sessionId directly.
     * Full multi-session merge (GATE-SUB-3 Worker merge) is a Phase 4 followup.
     */
    artifactWrites: {
      subscribe: async function* (
        _: unknown,
        { assemblyId }: { assemblyId: string },
        ctx: GqlContext,
      ): AsyncGenerator<{ artifactWrites: unknown }> {
        // Stub: real implementation resolves the active sessionId for this assembly
        // from D1 factory-ops (sessions table WHERE assembly_id = ? AND status NOT IN terminals).
        // Full Worker merge across multiple concurrent sessions: GATE-SUB-3 followup.
        const sessionId = assemblyId
        for await (const ev of pollBufferDO(
          ctx.env,
          sessionId,
          0,
          ['artifactWrites'],
          undefined,
          assemblyId,
        )) {
          yield {
            artifactWrites: {
              artifactId:   '',
              kind:         ev.kind,
              sessionId,
              r2Path:       '',
              contentHash:  '',
              occurredAt:   new Date().toISOString(),
            },
          }
        }
      },
      resolve: (payload: unknown) => payload,
    },

    /**
     * beadUpdates(runId: ID!) — bead status changes for a coordinator run.
     * Spec §4.3: runId maps 1:1 to sessionId in SM1.
     */
    beadUpdates: {
      subscribe: async function* (
        _: unknown,
        { runId }: { runId: string },
        ctx: GqlContext,
      ): AsyncGenerator<{ beadUpdates: unknown }> {
        // In SM1 a run maps 1:1 to a session, so runId is the sessionId.
        const sessionId = runId
        for await (const ev of pollBufferDO(
          ctx.env,
          sessionId,
          0,
          ['beadUpdates'],
          runId,
        )) {
          yield {
            beadUpdates: {
              atomId:     '',
              runId,
              status:     'IN_PROGRESS',
              occurredAt: new Date().toISOString(),
            },
          }
        }
      },
      resolve: (payload: unknown) => payload,
    },
  },
}
