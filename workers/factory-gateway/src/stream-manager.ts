/**
 * @module stream-manager
 *
 * Bridges the SubscriptionEventBufferDO to the Connect streaming response.
 *
 * Phase 1 (this implementation): polling-style SSE/JSON-line streaming via
 * the DO's `GET /replay` endpoint.  Real WebSocket-to-gRPC bridging (Phase 2)
 * will replace the polling loop with a hibernatable WebSocket.
 *
 * Spec references:
 *   - Factory-Subscription-Replay-Contract-v1.md §2.3 (DO route surface)
 *   - ADR-0016 §Phase 1
 */

/** A single buffered event row returned by the SubBuffer DO replay endpoint. */
interface BufferedEventRow {
  seq: number
  stream: string
  kind: string
  payload: unknown
  occurred_at: number
  terminal: number
}

/** Response envelope from `GET /replay`. */
interface ReplayResponse {
  rows: BufferedEventRow[]
  tip_seq: number
  terminal: boolean
}

/**
 * Streams session events from the SubscriptionEventBufferDO to the caller
 * via the Connect response controller.
 *
 * Phase 1 behaviour:
 *   1. Check KV liveness of `sub-buffer:{sessionId}`.
 *   2. If live: replay events `(fromSeq, tip]` from the DO via `GET /replay`.
 *      Enqueue each row as a JSON-lines frame.
 *   3. If not live: return empty stream with a comment (D1 fallback is a later phase).
 *   4. Close the controller after a terminal event or at end of replay.
 *
 * @param bufferNamespace   SUB_BUFFER DO namespace.
 * @param bufferKv          SUB_BUFFER_KV namespace (liveness probe).
 * @param sessionId         The session to stream events for.
 * @param fromSeq           Replay events strictly after this sequence number.
 * @param controller        WritableStream controller to enqueue frames into.
 */
export async function streamSessionEvents(
  bufferNamespace: DurableObjectNamespace,
  bufferKv: KVNamespace,
  sessionId: string,
  fromSeq: number,
  controller: ReadableStreamDefaultController,
): Promise<void> {
  // Phase 1: check KV shadow for liveness
  const kvKey = `sub-buffer:${sessionId}`
  const liveness = await bufferKv.get(kvKey)

  if (liveness === null) {
    // Buffer not live — D1 fallback is a later phase.
    // Return empty stream with a status comment so callers can detect this.
    const frame = encodeJsonFrame({
      _comment: 'BUFFER_NOT_LIVE',
      sessionId,
      guidance:
        'SubscriptionEventBufferDO is not live for this session. ' +
        'Use gRPC ResumeStream for durable replay (D1 fallback not yet wired).',
    })
    controller.enqueue(frame)
    controller.close()
    return
  }

  // Fetch replay from the DO
  const stub = bufferNamespace.get(bufferNamespace.idFromName(kvKey))

  let replayData: ReplayResponse
  try {
    const replayResp = await stub.fetch(
      `https://do/replay?last_seq=${fromSeq}&streams=sessionEvents`,
    )
    if (!replayResp.ok) {
      controller.enqueue(
        encodeJsonFrame({
          _error: `SubBuffer replay returned HTTP ${replayResp.status}`,
        }),
      )
      controller.close()
      return
    }
    replayData = (await replayResp.json()) as ReplayResponse
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    controller.enqueue(encodeJsonFrame({ _error: `SubBuffer replay error: ${message}` }))
    controller.close()
    return
  }

  // Emit each buffered event as a JSON-lines frame
  let sawTerminal = false
  for (const row of replayData.rows) {
    controller.enqueue(
      encodeJsonFrame({
        seq: row.seq,
        stream: row.stream,
        kind: row.kind,
        payload: row.payload,
        occurred_at: row.occurred_at,
      }),
    )
    if (row.terminal === 1) {
      sawTerminal = true
      break
    }
  }

  // If the DO reports terminal (even if no rows carried terminal=1), close
  if (sawTerminal || replayData.terminal) {
    controller.close()
    return
  }

  // Phase 1: no live-tail — close after static replay.
  // Phase 2 will replace this with a WebSocket live-tail loop.
  controller.close()
}

// ─── Framing helper ──────────────────────────────────────────────────────────

/**
 * Encodes a value as a Connect streaming envelope frame.
 *
 * Connect framing:  1 byte flags (0x00 = data) + 4 byte big-endian length + body.
 */
function encodeJsonFrame(value: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(value) + '\n')
  const frame = new Uint8Array(5 + body.byteLength)
  // flags byte: 0x00 = normal data message
  frame[0] = 0x00
  // 4-byte big-endian message length
  const view = new DataView(frame.buffer)
  view.setUint32(1, body.byteLength, false /* big-endian */)
  frame.set(body, 5)
  return frame
}
