# Factory GraphQL Subscription Replay Contract

**Status:** Draft v1 · **Date:** 2026-06-15 · **Author:** Architect (Koales.ai)
**Closes:** OPEN-Q-3 from `Factory-External-Interface-gRPC-GraphQL_v3.md`
**Companion to:** `Factory-External-Interface-gRPC-GraphQL_v3.md` §3.4
**Predecessor specs:** SPEC-FF-COORDINATOR-DO-001 · SPEC-FF-GEARS-001 §7b · ADR-0013 (ArtifactGraph DO) · ADR-0014 (D1 isolation deferred)

> This spec completes §3.4 of the external-interface spec. It does **not** change the storage substrate fixed by OPEN-Q-2 (CLOSED). It adds one new lightweight Durable Object — **SubscriptionEventBuffer DO** — that owns the live WebSocket fan-out and the reconnect contract during an active session. Replay of *completed* sessions remains served from the append-only D1 + ArtifactGraph DO sources already specified.

---

## §0 — Problem Restated

GraphQL Subscriptions (`graphql-ws` over WebSocket) expose three streams from the `factory-graphql` Worker:

- `sessionEvents(sessionId: ID!)` — pipeline + bead + governance events
- `artifactWrites(assemblyId: ID!)` — artifact-written events
- `beadUpdates(runId: ID!)` — bead status changes

The fundamental constraint: **a Cloudflare Worker cannot hold a WebSocket across hibernation.** Only a Durable Object can. Sessions run for minutes (atoms execute LLM loops), and CF DO hibernation can silently drop a subscriber's socket between events. A subscriber that disconnects mid-session must reconnect and resume *without missing events and without receiving duplicates it cannot detect*.

§3.4 left five questions open. This spec answers all five:

1. **Where are events buffered?** → SubscriptionEventBuffer DO SQLite (per session), monotonic `seq`.
2. **Reconnect contract?** → `last_seq` cursor as a connection query param; server replays `(last_seq, tip]`.
3. **Fan-out mechanism?** → one DO per session holds N WebSockets via the CF hibernatable-WebSocket API; producers POST events; DO appends then broadcasts.
4. **Replay window TTL?** → 30 minutes after last write (KV-shadowed), DO self-deletes its SQLite after a grace alarm.
5. **Reconnect after TTL?** → fall back to D1 + ArtifactGraph DO replay if the session is terminal; otherwise return `REPLAY_UNAVAILABLE` with guidance to use the gRPC `ResumeStream` RPC (`from_sequence`) which is the authoritative durable replay path.

---

## §1 — Architectural Ground

### 1.1 Why a new DO, not the existing ones

CoordinatorDO is per-**run** and owns the bead DAG; ArtifactGraph DO is per-**repo** and append-only; the Commissioning Agent workflow is per-**work-order**. None of them is keyed per **session**, and none should take on WebSocket ownership — coupling a hibernatable fan-out socket into the bead-DAG transaction loop would put subscriber liveness on the critical path of execution. The fundamental separation: **execution DOs must never block on, or be blocked by, an observer.**

Therefore the live fan-out lives in a dedicated, disposable DO whose only job is buffer-and-broadcast. It holds no governance authority. If it is lost, **nothing about the session's correctness changes** — only the live convenience stream is interrupted, and the client falls back to the durable replay paths (D1 / ArtifactGraph DO / gRPC `ResumeStream`). This is the timeless pattern: the cache/fan-out tier is strictly subordinate to the system of record.

### 1.2 Relationship to the durable replay source (OPEN-Q-2 CLOSED)

OPEN-Q-2 already fixed the **authoritative** replay source for completed events: `bead_audit` rows in D1 `factory-ops` (flushed by CoordinatorDO) and append-only nodes in ArtifactGraph DO. gRPC `ResumeStream(from_sequence)` (§2.1 of the parent spec) replays from those.

The SubscriptionEventBuffer DO is a **live tier in front of those durable sources**, not a replacement. Its sequence numbers are the same numbers `ResumeStream` uses, so a client can move between the WebSocket live stream and the gRPC durable stream without renumbering. The buffer is the only place that holds *in-flight* events for an *active* session before they are durably flushed; once flushed and once the session is terminal, the durable sources are sufficient and the buffer is disposable.

### 1.3 DO identity (naming convention)

Consistent with existing Factory DO naming (`coordinator:{runId}`, `mediation-agent:{repoId}`, `factory:{orgId}:{runId}`):

```
sub-buffer:{sessionId}
```

`idFromName("sub-buffer:" + sessionId)`. One DO instance per session. `assemblyId`- and `runId`-scoped subscriptions resolve their `sessionId` first (via the existing `session(id)` / `sessionsByWorkOrder` resolvers) and connect to that session's buffer; see §4.3 for multi-scope fan-out.

---

## §2 — SubscriptionEventBuffer DO

### 2.1 Responsibilities

1. Hold the hibernatable WebSocket connection(s) for one session's subscribers.
2. Append every inbound event to DO SQLite under a monotonic per-session `seq`.
3. Broadcast each appended event to all currently-attached sockets that subscribe to that event's stream.
4. On (re)connect, replay buffered events strictly greater than the client's `last_seq`.
5. Expire the buffer after the TTL window and self-delete its SQLite.

It does **not**: validate governance, mint artifacts, or hold any data that is not already destined for (or already in) the durable stores. It is a write-through projection.

### 2.2 Data model — DO SQLite schema

```sql
-- One row per event, per session. seq is monotonic and gap-free per session.
CREATE TABLE IF NOT EXISTS buffered_events (
  seq          INTEGER PRIMARY KEY,      -- monotonic, assigned by DO (see §2.4)
  stream       TEXT    NOT NULL,         -- 'sessionEvents' | 'artifactWrites' | 'beadUpdates'
  kind         TEXT    NOT NULL,         -- SessionEventKind name OR artifact/bead event tag
  scope_run_id TEXT,                     -- runId for beadUpdates filtering (NULL for session-scope)
  scope_assembly_id TEXT,               -- assemblyId for artifactWrites filtering
  payload      TEXT    NOT NULL,         -- JSON — the GraphQL event body (FactorySessionEvent etc.)
  occurred_at  INTEGER NOT NULL,         -- epoch ms (producer-supplied, authoritative)
  appended_at  INTEGER NOT NULL,         -- epoch ms (DO clock, for TTL accounting)
  terminal     INTEGER NOT NULL DEFAULT 0 -- 1 on SESSION_COMPLETED/FAILED/CANCELLED
);

CREATE INDEX IF NOT EXISTS idx_buffered_stream ON buffered_events (stream, seq);

-- Singleton control row. id = 0 always.
CREATE TABLE IF NOT EXISTS buffer_meta (
  id              INTEGER PRIMARY KEY CHECK (id = 0),
  session_id      TEXT    NOT NULL,
  run_id          TEXT,                  -- bound on first event that carries one
  assembly_id     TEXT,
  next_seq        INTEGER NOT NULL DEFAULT 1,
  last_write_at   INTEGER NOT NULL,      -- drives TTL alarm
  terminal_at     INTEGER,               -- set when terminal event appended
  producer_token_hash TEXT               -- HMAC of the shared producer secret (see §5.2)
);
```

**Why DO SQLite and not KV:** the buffer needs gap-free monotonic sequencing and range queries `WHERE seq > ?`. KV gives neither. KV is used only as the **TTL shadow** (§3.3) so the `factory-graphql` Worker can answer "does a live buffer still exist for this session?" without waking the DO.

### 2.3 DO route surface

All routes are DO-internal (`https://do/...`), reached via `stub.fetch(...)`. Producers are other DOs/Workers inside the CF boundary; subscriber WebSockets arrive via the `factory-graphql` Worker.

| Method · Path | Caller | Purpose |
|---|---|---|
| `POST /event` | CoordinatorDO, LoopClosureService, Commissioning Agent, ArtifactGraph writers | Append one event, assign `seq`, broadcast to attached sockets. Body: `EventWrite` (§2.5). Returns `{ seq }`. |
| `GET /ws?last_seq={n}&streams={csv}&run_id={id}` | `factory-graphql` Worker (WebSocket upgrade) | Accept a hibernatable subscriber socket; immediately replay `(last_seq, tip]` filtered to requested streams; then live-stream. |
| `GET /replay?last_seq={n}&streams={csv}` | `factory-graphql` Worker (non-WS fallback) | One-shot JSON replay of `(last_seq, tip]`. Used by clients that want a polling fallback. |
| `GET /head` | `factory-graphql` Worker | Returns `{ tip_seq, terminal, last_write_at }` without opening a socket. Cheap liveness probe. |
| `POST /terminate` | CoordinatorDO / Commissioning Agent on session terminal | Marks terminal, sends graphql-ws `Complete` to all sockets, arms the disposal grace alarm. |

The DO **rejects** any `POST /event` whose `producer_token` HMAC does not match `buffer_meta.producer_token_hash` (or the env-configured secret on first write) — see §5.2. This keeps producers loosely coupled (no service binding required from every producer to this DO class) while preventing arbitrary event injection.

### 2.4 Sequence assignment (ordering invariant)

`seq` is assigned **inside** the DO under `blockConcurrencyWhile`, never by the producer:

```ts
async appendEvent(w: EventWrite): Promise<{ seq: number }> {
  return this.ctx.blockConcurrencyWhile(async () => {
    const meta = this.readMeta();
    const seq  = meta.next_seq;
    this.sql.exec(
      `INSERT INTO buffered_events
         (seq, stream, kind, scope_run_id, scope_assembly_id, payload, occurred_at, appended_at, terminal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      seq, w.stream, w.kind, w.runId ?? null, w.assemblyId ?? null,
      JSON.stringify(w.payload), w.occurredAt, Date.now(), w.terminal ? 1 : 0
    );
    this.sql.exec(
      `UPDATE buffer_meta SET next_seq = ?, last_write_at = ?, terminal_at = COALESCE(terminal_at, ?) WHERE id = 0`,
      seq + 1, Date.now(), w.terminal ? Date.now() : null
    );
    this.armTtlAlarm();          // (re)arm 30-min disposal alarm
    this.broadcast(seq, w);      // fan out to attached sockets
    return { seq };
  });
}
```

Because the DO is single-threaded and `seq` is assigned under the concurrency block, **per-session ordering is total and gap-free** regardless of how many producers POST concurrently. This is the same `seq` space the gRPC `from_sequence` uses; the two replay paths are byte-aligned by sequence.

### 2.5 Producer event-write payload

```ts
interface EventWrite {
  sessionId:   string;
  stream:      'sessionEvents' | 'artifactWrites' | 'beadUpdates';
  kind:        string;          // SessionEventKind name OR 'ARTIFACT_WRITTEN' OR 'BEAD_UPDATE'
  runId?:      string;          // required for beadUpdates
  assemblyId?: string;          // required for artifactWrites
  payload:     unknown;         // the GraphQL event body, already in GraphQL shape
  occurredAt:  number;          // epoch ms — authoritative timestamp from the producer
  terminal?:   boolean;         // true on SESSION_COMPLETED/FAILED/CANCELLED
  producerToken: string;        // HMAC(secret, sessionId) — §5.2
}
```

### 2.6 Hibernation handling (CF hibernatable WebSocket API)

The DO uses the **hibernatable** WebSocket API so it can evict between events without dropping sockets and without billing for idle wall-clock:

- Accept via `this.ctx.acceptWebSocket(server, [tags])` — **not** `server.accept()`. Tags encode the subscribed streams and `runId`/`assemblyId` scope so a hibernation-woken DO can re-derive each socket's filter without holding it in memory.
- Implement `webSocketMessage(ws, msg)` for graphql-ws protocol frames (`ConnectionInit`, `Subscribe`, `Complete`, `Ping`/`Pong`).
- Implement `webSocketClose(ws, code, reason, wasClean)` to drop bookkeeping.
- On wake, recover attached sockets via `this.ctx.getWebSockets()`; their tags carry the filter, so no in-memory subscriber table is required.
- Use a WebSocket **auto-response** for graphql-ws keepalive Ping so a hibernated DO answers Pings without waking: `this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(pingFrame, pongFrame))`.

The disposal **alarm** (`ctx.storage.setAlarm`) is the only thing that wakes the DO when there is no traffic; it fires once at TTL expiry (§3).

---

## §3 — TTL Policy

### 3.1 Window

**Replay window: 30 minutes after the last write (`last_write_at`).** Rationale:

- Sessions run "minutes." 30 min comfortably covers a long atom loop plus a client's reconnect/backoff. It is well inside the **KV 1-day TTL ceiling** and the **DO SQLite** practical buffer size for a single session's event count (hundreds, not millions, of events).
- The window is a *sliding* window: each `POST /event` re-arms the alarm to `last_write_at + 30min`. An active session never expires its buffer; expiry only happens after activity stops.
- After a **terminal** event, the window collapses to a fixed **5-minute grace** (`terminal_at + 5min`) — long enough to deliver the final `Complete` and let in-flight reconnects drain, short enough to release the DO promptly. After grace, the DO drops its SQLite and deletes its KV shadow; further replay is served by the durable sources.

### 3.2 Disposal alarm

```ts
override async alarm(): Promise<void> {
  const meta = this.readMeta();
  const now  = Date.now();
  const expiry = meta.terminal_at
    ? meta.terminal_at + 5 * 60_000          // terminal grace
    : meta.last_write_at + 30 * 60_000;      // sliding live window
  if (now < expiry) { await this.ctx.storage.setAlarm(expiry); return; }  // not yet — re-arm
  // Expired: close any lingering sockets with a graphql-ws Complete + a CLOSE,
  // delete the KV shadow, then drop all DO storage so the DO is reclaimed.
  this.closeAllSockets('REPLAY_WINDOW_EXPIRED');
  await this.env.SUB_BUFFER_KV.delete(`sub-buffer:${meta.session_id}`);
  await this.ctx.storage.deleteAll();
}
```

### 3.3 KV TTL shadow (liveness without waking the DO)

On first write the DO writes a KV key `sub-buffer:{sessionId}` → `{ tip_seq, terminal }` with `expirationTtl` matching the window. This lets the `factory-graphql` Worker answer "is there a live buffer?" with a single KV read on a cold reconnect, **without waking the DO**. The DO refreshes this key opportunistically on writes. KV is a hint, not authority — the DO is authority for `tip_seq` when it is alive.

### 3.4 Reconnect after TTL expiry

When a client reconnects with a `last_seq` and the buffer is gone (KV miss / DO returns expired):

| Session state at reconnect | Server behavior |
|---|---|
| **Terminal** (COMPLETED/FAILED/CANCELLED) | Serve replay from the durable sources: D1 `bead_audit` + ArtifactGraph DO nodes, projected into the same event shapes and `seq` order. This is the gRPC `ResumeStream` path exposed over GraphQL. Stream then closes with `Complete`. |
| **Still active** but buffer expired (pathological — implies >30 min of silence on a live session) | Return GraphQL subscription error `REPLAY_UNAVAILABLE` with `extensions.guidance` instructing the client to resume via the gRPC `ResumeStream(from_sequence)` RPC, which reads the authoritative durable stream and re-establishes a live tail. Do **not** fabricate events. |

`REPLAY_UNAVAILABLE` is returned as a graphql-ws `Error` message on the subscription operation, carrying:

```json
{
  "code": "REPLAY_UNAVAILABLE",
  "fromSeq": 142,
  "guidance": "Live replay buffer expired. Resume the durable stream via gRPC FactoryGateway.ResumeStream(session_id, from_sequence=142). GraphQL subscriptions are a live convenience tier; the gRPC stream is authoritative.",
  "grpcMethod": "weops.factory.v1.FactoryGateway/ResumeStream"
}
```

---

## §4 — Fan-Out

### 4.1 One DO, many sockets

A single `sub-buffer:{sessionId}` DO holds N subscriber WebSockets concurrently (e.g. a dashboard, an audit consumer, and a developer CLI all watching one session). The DO broadcasts each appended event to every attached socket whose tag-filter matches the event's `stream` and scope (`runId` for `beadUpdates`, `assemblyId` for `artifactWrites`). Because all three subscription types for one session funnel through the same per-session DO, there is exactly one fan-out point and exactly one `seq` space per session — no cross-DO ordering problem.

### 4.2 Broadcast filter

```ts
private broadcast(seq: number, w: EventWrite): void {
  const frame = graphqlWsNext(seq, w);          // graphql-ws 'Next' message
  for (const ws of this.ctx.getWebSockets()) {
    const tag = wsTag(ws);                        // recovered from acceptWebSocket tags
    if (!tag.streams.includes(w.stream)) continue;
    if (w.stream === 'beadUpdates'   && tag.runId      !== w.runId)      continue;
    if (w.stream === 'artifactWrites'&& tag.assemblyId !== w.assemblyId) continue;
    try { ws.send(frame); } catch { /* socket dying; webSocketClose will reap it */ }
  }
}
```

### 4.3 Multi-scope subscriptions (`artifactWrites(assemblyId)`)

`artifactWrites` and `beadUpdates` are scoped to `assemblyId` / `runId`, which can span **multiple sessions**. Resolution rule:

- `beadUpdates(runId)` → a run maps 1:1 to a session in SM1; resolve `sessionId` from the run and connect to that session's buffer. Single buffer.
- `artifactWrites(assemblyId)` → an assembly can have several concurrent sessions. The `factory-graphql` Worker resolves the assembly's **active** session set and the Worker fans the client socket across each active session's buffer (the Worker holds the client socket; it opens internal `/ws` connections per active buffer and merges). New sessions started during the subscription are attached as the Worker observes them via the `sessions` resolver / a lightweight assembly-index DO. **Ordering guarantee across sessions is per-session only** — see §6.

This keeps the buffer DO single-purpose (per session) while still serving assembly-wide subscriptions through the Worker's merge layer.

---

## §5 — Event Routing (Producer → Buffer, Loosely Coupled)

### 5.1 Producers and their events

| Producer | Events it POSTs to `/event` | When |
|---|---|---|
| Commissioning Agent (Mastra Workflow T1) | `SESSION_SUBMITTED`, `CANDIDATE_SET_BUILT`, `APPROVAL_GRANTED`, `COMPILATION_STARTED/COMPLETE/FAILED`, `REVIEW_REQUIRED/RESOLVED`, `DEPLOYING`, `MONITORED`, terminals | On each SM1 state transition |
| CoordinatorDO | `BEAD_CLAIMED/RELEASED/FAILED/RESCUED` (stream `beadUpdates`), `CONSENT_BEAD_DENIED` | Inside `claimBead`/`releaseBead`/`failBead`/`alarm` |
| LoopClosureService | `VERIFICATION_PRODUCED` (FIDELITY), `DIVERGENCE_DETECTED`, `AMENDMENT_PROPOSED/ADOPTED/REJECTED`, `ARTIFACT_WRITTEN` (stream `artifactWrites`), `EXECUTION_COMPLETE/FAILED` | Inside `recordOutcome` / amendment lifecycle |
| Mediation Agent DO | `VERIFICATION_PRODUCED` (COHERENCE), `ARTIFACT_WRITTEN` for compile artifacts | During the nine-step compile sequence |

### 5.2 Loose coupling: best-effort POST, no service binding required from every producer

The existing Factory pattern (see `CoordinatorDO.checkRunComplete`, `writeGovernanceArtifact`) is **best-effort cross-DO POST, warn-on-failure, never throw**. The buffer adopts the same contract. Two integration options, in order of preference:

**Option A (recommended) — thin `emitSubscriptionEvent()` helper, fire-and-forget.**
A shared helper in `@factory/subscription-buffer` that producers call:

```ts
export async function emitSubscriptionEvent(
  ns: DurableObjectNamespace,          // SUB_BUFFER binding
  kv: KVNamespace,                     // SUB_BUFFER_KV, for producer-side HMAC secret? no — see below
  ev: EventWrite,
): Promise<void> {
  try {
    const stub = ns.get(ns.idFromName(`sub-buffer:${ev.sessionId}`));
    await stub.fetch('https://do/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev),
    });
  } catch (err) {
    // Non-fatal: the live tier is subordinate. The durable stores still get the
    // event via the normal flush path; the subscriber falls back on reconnect.
    console.warn(`[emitSubscriptionEvent] ${ev.kind} for ${ev.sessionId} failed`, err);
  }
}
```

The HMAC `producerToken` is computed by the producer from a **secret env binding** shared by all in-boundary producers (`SUB_BUFFER_PRODUCER_SECRET`), so the buffer can authenticate `/event` writes without each producer needing a typed service binding to the buffer's DO class. This is the loose-coupling mechanism: producers depend on a namespace + a secret, not on the buffer's internal interface.

**Why fire-and-forget is correct here:** the event is *already* on its way to the durable store as part of the producer's own transaction (e.g. CoordinatorDO writes `bead_audit` to D1; LoopClosureService writes ExecutionTrace to ArtifactGraph DO). The buffer POST is a **projection for live convenience**. If it fails, correctness is unaffected and the subscriber recovers via replay. The buffer must never be on the producer's critical path.

### 5.3 Catch-up flush (closing the projection gap)

Because `/event` is best-effort, a buffer could miss an event that the durable store recorded. To keep the buffer faithful for the *active* window, the `factory-graphql` Worker's `/ws` replay performs a **reconciliation read** on connect: it asks the buffer for its `tip`, and (only for the requested streams up to that tip) cross-checks against the durable sources for the same `seq` range, filling any gap before live-tailing. This bounds the projection gap to "events between two reconnects," and a fresh subscriber never sees a hole. For the steady-state live path, the fire-and-forget POST is sufficient.

---

## §6 — Invariants

**I-SUB-01 At-least-once delivery.** Every event a subscriber is entitled to (by `stream` + scope + `last_seq`) is delivered at least once across the live stream and replay. Duplicates are possible across a reconnect boundary; clients dedupe by `seq` (monotonic, gap-free per session). The contract is **at-least-once + client-side idempotency by `seq`**, not exactly-once. (Exactly-once over a hibernating WebSocket is not achievable without the cursor; the cursor is the mechanism.)

**I-SUB-02 Total per-session ordering.** Within one `sessionId`, `seq` is monotonic and gap-free. A subscriber that processes events in `seq` order observes the true causal order of the session. Across sessions (assembly-wide `artifactWrites`) ordering is per-session only; cross-session order is not guaranteed and clients must not assume it.

**I-SUB-03 No synthetic events.** The buffer never fabricates, infers, or interpolates events. It only stores and replays what producers POSTed (and, on replay reconciliation, what the durable sources actually recorded). On TTL expiry for an active session it returns `REPLAY_UNAVAILABLE` rather than inventing a resumption. This mirrors I-EXT-08 (deterministic replay) of the parent spec.

**I-SUB-04 Subordination to the system of record.** Loss of the buffer DO never changes session correctness or the durable event history. `seq` values are shared with gRPC `ResumeStream(from_sequence)`; the durable stream is authoritative and the buffer is a cache.

**I-SUB-05 Terminal closure.** After a terminal event, the buffer sends graphql-ws `Complete` to all sockets and accepts no further appends for that session (mirrors I-EXT-07: no events follow a terminal).

**I-SUB-06 Cursor honesty.** `last_seq = 0` replays from session start (within the live window) — identical semantics to gRPC `from_sequence = 0`. A client that has never connected uses `last_seq = 0`.

---

## §7 — Client Reconnect Flow (numbered sequence)

1. **Initial subscribe.** Client opens a `graphql-ws` WebSocket to the `factory-graphql` Worker and sends `Subscribe { sessionEvents(sessionId) }`. It tracks `last_seq`, initialized to `0`.
2. **Worker resolves the buffer.** The Worker computes `sub-buffer:{sessionId}` and upgrades to the DO via `GET /ws?last_seq=0&streams=sessionEvents`.
3. **Replay + live-tail.** The DO replays `(0, tip]` for the requested streams as graphql-ws `Next` messages, each carrying its `seq`, then live-tails new events. The client advances `last_seq` to the highest `seq` it has processed after each message.
4. **Disconnect.** CF hibernation, network drop, or DO eviction severs the socket. The client detects close (graphql-ws transport close / missed keepalive).
5. **Backoff + liveness probe.** Client reconnects with exponential backoff (e.g. 0.5s → 8s, jittered). On reconnect the Worker first reads KV `sub-buffer:{sessionId}` to check liveness cheaply.
6. **Reconnect with cursor.** Client re-sends `Subscribe` and the Worker upgrades to `GET /ws?last_seq={N}&streams=sessionEvents`, where `N` is the client's last processed `seq`.
7. **Resume.** The DO replays `(N, tip]` (reconciled against durable sources per §5.3), then live-tails. The client dedupes by `seq` (I-SUB-01) and continues.
8. **TTL-expired reconnect (terminal session).** If the buffer is gone and the session is terminal, the Worker serves the durable replay (D1 + ArtifactGraph DO) from `seq > N`, then sends `Complete`.
9. **TTL-expired reconnect (active session).** If the buffer is gone but the session is still active, the Worker returns `REPLAY_UNAVAILABLE` with guidance (§3.4). The client switches to the gRPC `ResumeStream(session_id, from_sequence=N)` RPC for the authoritative durable stream.
10. **Terminal.** On a terminal event (live or via replay) the client receives `Complete` and stops; no events follow (I-SUB-05 / I-EXT-07).

---

## §8 — Integration with the Parent Spec (§3.4 update)

Replace the parent spec's §3.4 final sentence ("Reconnection and replay contract is an open question (OPEN-Q-3).") and mark OPEN-Q-3 **CLOSED**, referencing this document. Suggested §3.4 replacement text:

> **§3.4 — Subscription transport.** GraphQL Subscriptions use WebSockets (graphql-ws protocol). Live fan-out and the reconnect/replay contract are owned by the **SubscriptionEventBuffer DO** (one per `sessionId`, `idFromName("sub-buffer:" + sessionId)`), specified in *Factory GraphQL Subscription Replay Contract v1*. Producers (CoordinatorDO, LoopClosureService, Commissioning Agent, Mediation Agent DO) POST events to the buffer best-effort; the buffer assigns a monotonic per-session `seq` (shared with gRPC `ResumeStream.from_sequence`), buffers in DO SQLite for a 30-minute sliding window, and broadcasts to attached hibernatable WebSockets. On reconnect, clients pass `last_seq`; the buffer replays `(last_seq, tip]`. After TTL expiry, terminal sessions replay from the durable sources (D1 `bead_audit` + ArtifactGraph DO), and active sessions return `REPLAY_UNAVAILABLE` directing the client to gRPC `ResumeStream`. See I-SUB-01..06.

And update §6 Open Questions:

> **OPEN-Q-3: CLOSED.** GraphQL subscription fan-out and reconnect/replay resolved by *Factory GraphQL Subscription Replay Contract v1* — SubscriptionEventBuffer DO (per session) owns hibernatable WebSocket fan-out, DO-SQLite buffering with monotonic `seq` shared with gRPC `ResumeStream`, 30-min sliding TTL (+5-min terminal grace), and D1/ArtifactGraph DO fallback on expiry.

---

## §9 — Architecture Gates

> All gates cleared 2026-06-15.

- **[GATE-SUB-1] TTL window values. CLOSED.** 30-min sliding live window + 5-min terminal grace accepted.
- **[GATE-SUB-2] Producer authentication. CLOSED.** Shared-secret HMAC (`SUB_BUFFER_PRODUCER_SECRET`) accepted. Loose coupling — producers bind a namespace + secret, no typed class reference required.
- **[GATE-SUB-3] Assembly-wide fan-out merge. CLOSED.** Worker merge accepted — `factory-graphql` Worker opens internal `/ws` connections per active session buffer and merges. No per-assembly index DO.
- **[GATE-SUB-4] Reconciliation depth. CLOSED.** Trust the fire-and-forget projection for the live window; reconcile against durable sources only on TTL-fallback reconnect.
- **[GATE-SUB-5] ADR-0014 D1 isolation. DEFERRED.** No action now. Tracked dependency — fallback resolver must select shard by `assembly_id` when ADR-0014 trigger fires.

---

## §10 — Implementation Plan (phased)

**Phase 1 — Buffer DO core.** New package `@factory/subscription-buffer`: DO class `SubscriptionEventBufferDO` (`cloudflare:workers` `DurableObject<Env>`), SQLite schema (§2.2), `POST /event` + `seq` assignment under `blockConcurrencyWhile` (§2.4), `GET /head`, disposal alarm (§3.2), KV shadow (§3.3). Unit tests with the existing `cloudflare-workers` mock pattern used by `@factory/loop-closure`.

**Phase 2 — Hibernatable WebSocket + replay.** `GET /ws` with `acceptWebSocket`/`webSocketMessage`/`webSocketClose`, tag-encoded filters, auto-response keepalive, `(last_seq, tip]` replay, broadcast filter (§4.2). graphql-ws frame encode/decode helpers.

**Phase 3 — Producer emission.** `emitSubscriptionEvent()` helper + HMAC token; wire CoordinatorDO (bead events), LoopClosureService (fidelity/amendment/artifact events), Commissioning Agent (SM1 transitions), Mediation Agent DO (coherence/compile artifacts). All fire-and-forget, warn-on-failure.

**Phase 4 — `factory-graphql` Worker integration.** Subscription resolvers open `/ws` to the per-session buffer; assembly-wide merge (§4.3); KV liveness probe; durable-fallback resolver (D1 `bead_audit` + ArtifactGraph DO projection) and `REPLAY_UNAVAILABLE` emission (§3.4).

**Phase 5 — Parent-spec update + ADR.** Apply §8 edits to `Factory-External-Interface-gRPC-GraphQL_v3.md`; record an ADR (`ADR-0015-subscription-event-buffer-do.md`) capturing the gate decisions once Wes clears them.

---

## §11 — Testing Strategy

- **Ordering/gap-free:** concurrent `POST /event` from simulated producers → assert `seq` is `1..N` with no gaps and matches insertion under the concurrency block.
- **Reconnect replay:** connect, consume to `seq=k`, drop, reconnect with `last_seq=k` → assert exactly `(k, tip]` delivered, no events `≤ k` (modulo at-least-once dup tolerance), client dedupe by `seq` yields the full ordered stream.
- **Hibernation:** force DO eviction between events (mock), assert woken DO recovers sockets via `getWebSockets()` and tag-filters still apply.
- **TTL expiry, terminal:** advance clock past terminal grace → assert buffer disposed, KV shadow gone, durable-fallback replay serves `seq > N` and closes with `Complete`.
- **TTL expiry, active:** advance clock past live window with session non-terminal → assert `REPLAY_UNAVAILABLE` with `grpcMethod` guidance, no synthetic events (I-SUB-03).
- **Best-effort isolation:** make `/event` POST fail → assert producer path (claim/release/recordOutcome) completes unaffected; subscriber recovers on reconnect via reconciliation (§5.3).

---

## §12 — Risk Assessment

| Risk | Mitigation |
|---|---|
| Projection gap (best-effort POST drops an event) | On-connect reconciliation against durable sources (§5.3); at-least-once + `seq` dedupe; correctness never depends on the buffer (I-SUB-04). |
| Long silent active session expires buffer | Sliding window re-armed on every write; if real silence > window, GATE-SUB-1 raises it; `REPLAY_UNAVAILABLE` + gRPC `ResumeStream` is a safe, honest fallback (no data loss — durable sources hold the truth). |
| Unauthorized `/event` injection | HMAC producer token (§5.2), GATE-SUB-2. |
| DO SQLite growth for a pathologically long session | Single-session event counts are bounded (hundreds); disposal alarm reclaims storage; no compaction needed (consistent with OPEN-Q-2 reasoning). |
| Assembly-wide subscription complexity | Confined to the Worker merge layer (§4.3); buffer DO stays single-purpose; GATE-SUB-3 can promote to an index DO if needed. |
| Drift from ADR-0014 sharding | GATE-SUB-5 tracks the dependency; fallback resolver selects shard by `assembly_id` when sharding lands. |

---

*End of Factory GraphQL Subscription Replay Contract v1.*
