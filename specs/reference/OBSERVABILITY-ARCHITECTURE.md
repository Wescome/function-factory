# Factory Observability Architecture

Date: 2026-05-31
Status: Approved — Architect + SE reviewed; transport and trace model revised
Scope: End-to-end observability for the Function Factory pipeline
Stack: Workers Analytics Engine (primary — metrics + events + boards + alerts, CF-native)

---

## 1. Problem Statement

The Factory has no structured observability. Failures surface as timeouts, silent hangs, or tailed logs. There is no way to answer:
- Is a molecule stuck or just slow?
- What is the p99 latency from dispatch to approved?
- Which step fails most often?
- Is Gas City startup regressing across deploys?

## 2. Observability Pillars

| Pillar | Tool | Cost |
|--------|------|------|
| Metrics + events | Workers Analytics Engine | ~$0 (included in paid plan) |
| Boards + queries | AE GraphQL API + CF dashboard | $0 |
| Alerting | Cloudflare Notifications | $0 |
| Structured logs | Workers built-in + wrangler tail | $0 |
| Distributed traces (optional) | Honeycomb (secondary, opt-in) | $0 free tier — requires `HONEYCOMB_API_KEY` secret; no-op if absent |

**Design decision:** Analytics Engine is the primary and only required sink. Honeycomb is
an optional secondary — the consumer already supports it but `HONEYCOMB_API_KEY` is not set.
Cloudflare does not have a native distributed tracing product; AE events carry `trace_id` and
can be correlated by query. If waterfall trace views are needed in future, set the secret.

---

## 3. Trace Model

### 3.1 Trace boundary

One `trace_id` per molecule. **Two root spans**, not one nested tree. The dispatch Worker invocation
and the molecule execution are temporally disjoint: CALL 1/2/3 completes synchronously (~175s),
then the Worker dies. Molecule steps execute later inside Gas City and report back via a separate
webhook invocation. A child span cannot outlive its parent, so parent-child across this boundary
is impossible.

```
── trace_id shared ────────────────────────────────────────────────────────
  [ff-pipeline invocation]
  dispatch.formula                          (root span, ends after CALL 3)
  └── gascity.dispatch

  [Gas City Container — separate process, later in time]
  molecule.execute                          (second root span, linked by trace_id)
  ├── molecule.plan
  ├── molecule.code
  ├── molecule.verify
  └── molecule.release
      └── fidelity.validate

  [ff-pipeline webhook invocation — separate invocation]
  webhook.receive                           (third root span, linked by trace_id)
  └── lifecycle.transition
```

In Honeycomb: all three root spans share `trace.trace_id`. Use trace linking (shared trace_id),
not `trace.parent_id`, across the async boundaries.

### 3.2 Trace ID propagation

- ff-pipeline generates `trace_id` (UUID) at `POST /dispatch-formula`
- Passes as `X-Trace-ID` header to Gas City on all 3 CALL requests
- Gas City stamps `gc.trace_id` on root bead metadata
- All downstream events carry `trace_id`

### 3.3 Span fields (every span)

```json
{
  "trace_id": "...",
  "span_id": "...",
  "parent_span_id": "...",
  "name": "molecule.plan",
  "service": "ff-pipeline | gascity | pi-rpc",
  "start_time_ms": 0,
  "duration_ms": 0,
  "outcome": "success | error | timeout",
  "error": null,
  "attrs": {}
}
```

---

## 4. Events Catalog

### 4.1 ff-pipeline events

| Event | Trigger | Key attrs |
|-------|---------|-----------|
| `dispatch.received` | POST /dispatch-formula | `ep_id`, `fn_id`, `factory_attempt` |
| `dispatch.compiled` | Formula compiler completes | `form_id`, `duration_ms`, `outcome` |
| `dispatch.sent` | CALL 3 to Gas City | `gc_bead_id`, `gc_workflow_id` |
| `dispatch.failed` | Any dispatch error | `reason`, `call_number` |
| `webhook.received` | POST /webhooks/gascity | `bead_id`, `outcome`, `fn_id` |
| `lifecycle.transition` | Webhook accepted | `lifecycle_state`, `fn_id`, `ep_id`, `factory_attempt` |
| `autonomy.run` | POST /gascity/autonomy/run | `trigger`, `duration_ms`, `ok` |

### 4.2 Gas City startup events

| Event | Trigger | Key attrs |
|-------|---------|-----------|
| `city.start.phase.enter` | Phase transition | `city`, `phase`, `attempt`, `build_version`, `beads_provider` |
| `city.start.phase.exit` | Phase complete | `city`, `phase`, `duration_ms`, `outcome` |
| `city.start.phase.timeout` | Phase deadline exceeded | `city`, `phase`, `elapsed_ms`, `last_blocking_op` |
| `city.start.dispatch_ready` | City reaches dispatch-ready | `city`, `elapsed_ms`, `mode` (full/degraded) |
| `city.adoption.op.timeout` | Per-op adoption timeout | `city`, `session`, `op`, `timeout_ms` |
| `city.adoption.session.skipped` | Session skipped due to timeout | `city`, `session` |

### 4.3 Gas City molecule events

| Event | Trigger | Key attrs |
|-------|---------|-----------|
| `molecule.start` | Workflow root bead created | `trace_id`, `form_id`, `fn_id`, `factory_attempt` |
| `step.start` | Step bead dispatched | `trace_id`, `step`, `bead_id`, `provider` |
| `step.complete` | Step bead closed pass | `trace_id`, `step`, `bead_id`, `duration_ms`, `provider` |
| `step.fail` | Step bead closed fail | `trace_id`, `step`, `bead_id`, `failure_reason` |
| `step.timeout` | Step exceeds deadline | `trace_id`, `step`, `bead_id`, `elapsed_ms` |
| `fidelity.run` | Release step fidelity validator invoked | `trace_id`, `bead_id`, `prior_step_count` |
| `fidelity.verdict` | Fidelity validator exits | `trace_id`, `bead_id`, `verdict`, `duration_ms` |
| `molecule.complete` | Molecule root bead closed | `trace_id`, `form_id`, `outcome`, `total_duration_ms`, `factory_attempt` |

### 4.4 Provider events (pi-rpc)

| Event | Trigger | Key attrs |
|-------|---------|-----------|
| `provider.execute.start` | ExecuteStep called | `trace_id`, `step`, `provider_id`, `session_id` |
| `provider.execute.complete` | ExecuteStep returns | `trace_id`, `step`, `status`, `duration_ms` |
| `provider.execute.fail` | ExecuteStep error | `trace_id`, `step`, `error` |

---

## 5. Metrics (Workers Analytics Engine)

### 5.1 Molecule metrics

| Metric | Type | Dimensions |
|--------|------|------------|
| `molecule.dispatched` | counter | `fn_id`, `factory_attempt` |
| `molecule.completed` | counter | `fn_id`, `outcome` (approved/revise/fail_closed) |
| `molecule.duration_ms` | histogram | `fn_id`, `outcome` |
| `molecule.step.duration_ms` | histogram | `step`, `provider`, `outcome` |
| `fidelity.verdict` | counter | `verdict` (approved/revise/fail_closed) |

### 5.2 Startup metrics

| Metric | Type | Dimensions |
|--------|------|------------|
| `city.startup.duration_ms` | histogram | `city`, `mode` (full/degraded), `build_version` |
| `city.startup.phase.duration_ms` | histogram | `city`, `phase` |
| `city.startup.adoption.skipped` | counter | `city` |
| `city.startup.failed` | counter | `city`, `phase` |

### 5.3 Pipeline metrics

| Metric | Type | Dimensions |
|--------|------|------------|
| `dispatch.duration_ms` | histogram | `outcome` |
| `webhook.delivery.duration_ms` | histogram | `outcome` |
| `autonomy.run.duration_ms` | histogram | `ok` |

---

## 6. Implementation Work Packages

### WP-OBS-1: Trace ID propagation (ff-pipeline + gascity)

**ff-pipeline** (`workers/ff-pipeline/src/index.ts`):
- Generate `trace_id` at `POST /dispatch-formula` entry
- Pass as `X-Trace-ID` on CALL 1/2/3 to Gas City
- Include `trace_id` in dispatch_log row
- Pass `trace_id` in webhook callback verification context

**gascity** (`cmd/gc/`):
- Read `X-Trace-ID` from dispatch request headers
- Stamp `gc.trace_id` on root bead metadata at molecule creation
- Propagate to all child step beads as `gc.trace_id`

No Honeycomb dependency yet — just plumb the ID. Cost: zero.

### WP-OBS-2: Telemetry queue + consumer (ff-pipeline)

Add `TELEMETRY_QUEUE` consumer binding (batch size 25) and `FACTORY_METRICS` Analytics Engine
binding to ff-pipeline `wrangler.jsonc`. Add `observability/telemetry-consumer.ts` — a queue
consumer module routed by the existing `queue()` dispatcher (same pattern as `harness-dispatcher`).
Consumer acks immediately, fans out to AE (binding) and Honeycomb (fetch) with independent failure
isolation. `HONEYCOMB_API_KEY` as Worker secret. All bindings absent → no-op, never throws.

See `CODEX-HANDOFFS-WP-OBS.md` WP-OBS-2 for exact wrangler changes, type additions, and
Honeycomb field name mapping.

### WP-OBS-3: Gas City startup telemetry (Wescome/gascity + gascity-supervisor ingress)

**Part A (function-factory):** Add `TELEMETRY_QUEUE` producer binding to gascity-supervisor
`wrangler.jsonc`. Add `POST /internal/telemetry` route in the supervisor's top-level `default.fetch`
— validates `GC_SUPERVISOR_TOKEN`, enqueues batch, returns 200. Never forwarded to Container DO.

**Part B (Wescome/gascity):** Add `internal/telemetry/` package with `TelemetryEvent` struct and
`Emitter` (Emit/Flush, 3s timeout, fire-and-forget). Emit §4.2 startup events at every phase
transition using canonical phase names from `GAS-CITY-STARTUP-CONTENTION-ARCHITECTURE.md` §4.2.
Flush after `city.start.dispatch_ready`. Requires gc binary rebuild.

**Note:** Container stdout/stderr is NOT visible to Tail Workers. gc telemetry must flow over
authenticated HTTP to the supervisor, which enqueues it. Tail Workers are not used for traces.

### WP-OBS-4: Molecule lifecycle telemetry (Wescome/gascity)

Reuse WP-OBS-3 Emitter. Read `X-Trace-ID` from dispatch request, stamp on root bead metadata.
Emit §4.3 events at all molecule lifecycle call sites. Flush after `molecule.complete`.
`molecule.execute` is a second root span correlated via shared `trace_id` — do NOT set
`parent_span_id` pointing at the dispatch span (already closed). Requires gc binary rebuild.

### ~~WP-OBS-5~~ — DELETED

~~Tail Worker → Honeycomb bridge~~ is deleted. Cloudflare Tail Workers receive Worker invocation
events only — they cannot see Container stdout/stderr. Gas City telemetry flows via the
authenticated HTTP → TELEMETRY_QUEUE path established in WP-OBS-3.

### WP-OBS-5: Analytics Engine boards + alerts (CF-native)

All boards and alerts are built against Workers Analytics Engine via the Cloudflare dashboard
and Notifications. No external account required.

**Boards (AE GraphQL queries in CF dashboard):**
- Molecule lifecycle: `dispatch → approved` p50/p95/p99 — query `molecule.duration_ms` histogram by `outcome`
- Startup regression: `city.startup.duration_ms` histogram by `build_version`
- Fidelity distribution: `fidelity.verdict` counter by `verdict` (approved/revise/fail_closed) over time
- Step failure rate: `molecule.step.duration_ms` by `step` + `outcome`

**Alerts (Cloudflare Notifications → Workers Analytics Engine threshold alerts):**
- `fidelity.verdict = fail_closed` rate > 10% in 1h rolling window
- `city.startup.failed` fires (any occurrence)
- Molecule p99 `duration_ms` > 600,000ms (600s)

**Prerequisite:** AE dataset `factory-metrics` must be receiving events (telemetry stack live).

**Honeycomb:** Optional secondary. Set `HONEYCOMB_API_KEY` secret on ff-pipeline to enable.
No code changes needed — consumer already handles it. Not required for WP-OBS-5 completion.

---

## 7. Rollout Order

Create `telemetry-queue` and `telemetry-dlq` in CF dashboard before any deploy that references them.

1. **WP-OBS-1** + **WP-OBS-2** — can run in parallel. WP-OBS-1 is pure ff-pipeline plumbing; WP-OBS-2 is queue infrastructure. No gc dependency.
2. **WP-OBS-3 Part A** — supervisor ingress. Deploy after `telemetry-queue` exists.
3. **WP-OBS-3 Part B** + **WP-OBS-4** — gc changes, one binary rebuild. Deploy after Part A.
4. **WP-OBS-5** — Boards + alerts (after data flows for 48h)

---

## 8. SLOs (instrumented targets)

| Signal | Target |
|--------|--------|
| Molecule p99 dispatch → approved | < 600s |
| City startup p99 dispatch_ready | < 300s |
| Fidelity fail_closed rate | < 5% rolling 24h |
| Dispatch success rate | > 99% rolling 24h |

---

## 9. Non-Goals

- Replacing wrangler tail for ad-hoc debugging
- Application performance monitoring (APM) for pi-rpc provider internals
- Log archival beyond 30 days
- PII in traces (no IS/ES content, only IDs)
