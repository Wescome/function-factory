# Factory Observability Architecture

Date: 2026-05-31
Status: Proposed
Scope: End-to-end observability for the Function Factory pipeline
Stack: Workers Analytics Engine (metrics) + Honeycomb (traces) — both free at current scale

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
| Metrics | Workers Analytics Engine | ~$0 (included in paid plan) |
| Distributed traces | Honeycomb free tier | $0 (< 20M events/mo) |
| Structured logs | Workers built-in + wrangler tail | $0 |
| Alerting | Honeycomb triggers | $0 (free tier) |

---

## 3. Trace Model

### 3.1 Trace boundary

One trace per molecule. Root span: `dispatch.formula`. Trace ID propagated through every hop.

```
dispatch.formula
├── gascity.dispatch          (ff-pipeline → Gas City CALL 1/2/3)
├── molecule.plan             (Gas City → pi-rpc)
├── molecule.code             (Gas City → pi-rpc)
├── molecule.verify           (Gas City → pi-rpc)
├── molecule.release          (Gas City local — fidelity validator)
│   └── fidelity.validate
└── webhook.receive           (Gas City → ff-pipeline webhook)
    └── lifecycle.transition
```

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

### WP-OBS-2: Structured event emission (ff-pipeline)

Add a `telemetry.ts` module in `workers/ff-pipeline/src/`:
- `emitEvent(event: FactoryEvent, env: PipelineEnv): void`
- Non-blocking (`ctx.waitUntil`)
- Dual-write: Workers Analytics Engine (metrics) + Honeycomb HTTP API (traces)
- Honeycomb API key stored as Worker secret `HONEYCOMB_API_KEY`
- Dataset: `function-factory`

Emit all §4.1 events from dispatch and webhook handlers.

### WP-OBS-3: Gas City startup telemetry (gascity)

Add structured log emission at every phase transition and adoption op timeout (§4.2 events). JSON to stderr — picked up by Container logs and optionally forwarded via Tail Worker.

Emit `city.start.dispatch_ready` with `elapsed_ms` on every startup (the metric WP-1 of the startup contention spec requires).

### WP-OBS-4: Molecule lifecycle telemetry (gascity)

Emit §4.3 events at molecule start/step start/step complete/fidelity/molecule complete. Carry `gc.trace_id` on every event. Write to stderr as structured JSON — same pattern as WP-OBS-3.

### WP-OBS-5: Tail Worker → Honeycomb bridge (function-factory)

Add `workers/ff-tail/` — a Cloudflare Tail Worker that:
- Receives all ff-pipeline + gascity Container logs
- Filters for structured JSON events (lines starting with `{`)
- Forwards to Honeycomb `/1/batch/function-factory`
- Handles backpressure (drop on Honeycomb unavailable — never block the main Worker)

This gives Gas City trace data in Honeycomb without modifying gc's transport.

### WP-OBS-6: Honeycomb boards + alerts

Once data flows:
- Board: molecule lifecycle (dispatch → approved p50/p95/p99)
- Board: startup duration by build version
- Board: fidelity verdict distribution over time
- Alert: `fidelity.verdict = fail_closed` rate > 10% in 1h window
- Alert: `city.startup.failed` fires
- Alert: molecule p99 duration > 600s

---

## 7. Rollout Order

1. **WP-OBS-1** — trace ID plumbing (no external dependency, no cost, immediate value)
2. **WP-OBS-2** — ff-pipeline event emission + Analytics Engine metrics
3. **WP-OBS-3** — Gas City startup telemetry (JSON stderr)
4. **WP-OBS-4** — Molecule lifecycle telemetry (JSON stderr)
5. **WP-OBS-5** — Tail Worker → Honeycomb bridge
6. **WP-OBS-6** — Boards + alerts (after data flows for 48h)

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
