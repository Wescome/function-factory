# Codex Handoffs — Observability WP-OBS-1 through WP-OBS-4

Date: 2026-05-31  
Spec: `specs/reference/OBSERVABILITY-ARCHITECTURE.md`  
Architect review: completed — 8 gaps found, transport decision revised  
SE review: completed — 3 HIGH blockers resolved in these handoffs  

---

## Final topology (supersedes spec §6 WP-OBS-5)

```
gc (Go, Container)
  └─ POST /internal/telemetry  ──► gascity-supervisor Worker
                                       └─ env.TELEMETRY_QUEUE.send(events[])
                                              └─ telemetry-queue (CF Queue)
                                                     └─ ff-pipeline consumer
                                                            ├─ env.FACTORY_METRICS.writeDataPoint()
                                                            └─ fetch Honeycomb /1/batch
```

WP-OBS-5 (Tail Worker → Honeycomb) is **deleted**. Container stderr is not visible to Tail Workers.  
gc knows only the supervisor. ff-pipeline owns all sink logic.

---

## WP-OBS-1 — Trace ID plumbing (ff-pipeline + gascity)

### Repos affected
- `function-factory` — workers/ff-pipeline only

### What to build

**1. Add `trace_id` to `DispatchLogRow`**

File: `workers/ff-pipeline/src/compilers/formula-compiler.ts`  
Find: the `DispatchLogRow` interface (around line 99)  
Change: add field `trace_id: string`

**2. Thread `traceId` into `compileAndDispatchFormula`**

File: `workers/ff-pipeline/src/compilers/formula-compiler.ts`  
Find: the `compileAndDispatchFormula` function signature  
Change: add parameter `traceId: string` (or generate inside via `crypto.randomUUID()` if not passed)

Rule: generate once at the top of `handleDispatchFormula` in `index.ts` and thread down. Do not generate at multiple call sites.

**3. Pass `X-Trace-ID` header on CALL 1/2/3**

File: `workers/ff-pipeline/src/compilers/formula-compiler.ts`  
Find: `gasCityAuthHeaders(env)` function (around line 1292)  
Change: add parameter `traceId: string`, return `{ Authorization: ..., "X-GC-Request": ..., "X-Trace-ID": traceId }`  
Update all callers of `gasCityAuthHeaders` to pass `traceId`.

**4. Persist `trace_id` on the dispatch_log row write**

File: `workers/ff-pipeline/src/compilers/formula-compiler.ts`  
Find: where `DispatchLogRow` is constructed and written (around line 621)  
Change: include `trace_id: traceId` in the row object.

**5. Read `trace_id` back in the webhook handler**

File: `workers/ff-pipeline/src/gascity/webhook-receiver.ts`  
Find: the `gc_bead_id` → `dispatch_log` lookup (around lines 107-114)  
Change: SELECT `trace_id` from the matched dispatch_log row. Carry it into any telemetry events emitted from the webhook handler.  
Rule: do NOT require gc to echo `trace_id` back in the webhook payload — read it from dispatch_log by `gc_bead_id`.

### Run before editing

Tessera (`specs/reference/TESSERA-CF-DO-SPEC.md`) is not yet implemented. Until it is, use grep
as the fallback impact analysis for these hot-path symbols:

```bash
grep -rn "compileAndDispatchFormula" workers/ff-pipeline/src/ --include="*.ts"
grep -rn "gasCityAuthHeaders" workers/ff-pipeline/src/ --include="*.ts"
grep -rn "DispatchLogRow" workers/ff-pipeline/src/ --include="*.ts"
```

Report every call site found. If any caller is outside `formula-compiler.ts` and `index.ts`, stop and escalate before editing.

Once Tessera is live, replace the above with:
```
tessera_impact({ target: "compileAndDispatchFormula", direction: "upstream" })
tessera_impact({ target: "gasCityAuthHeaders", direction: "upstream" })
tessera_impact({ target: "DispatchLogRow", direction: "upstream" })
```

### Done when
- `trace_id` field exists on `DispatchLogRow` type
- Every CALL 1/2/3 outbound request carries `X-Trace-ID`
- dispatch_log row includes `trace_id`
- webhook handler reads `trace_id` from dispatch_log match
- Existing tests pass; add a unit test for `gasCityAuthHeaders` including `X-Trace-ID`

---

## WP-OBS-2 — Telemetry queue + consumer (ff-pipeline)

### Repos affected
- `function-factory` — workers/ff-pipeline only

### What to build

**1. Add `TELEMETRY_QUEUE` consumer binding to ff-pipeline wrangler.jsonc**

File: `workers/ff-pipeline/wrangler.jsonc`  
Find: the `"queues"` block (line 54)  
In `"consumers"` array, add:
```json
{ "queue": "telemetry-queue", "max_batch_size": 25, "max_retries": 3, "dead_letter_queue": "telemetry-dlq" },
{ "queue": "telemetry-dlq", "max_batch_size": 10, "max_retries": 1 }
```
Note: `max_batch_size: 25` — intentional. Telemetry events are small and cheap; batch them unlike the `max_batch_size: 1` heavy-dispatch queues.

**2. Add `FACTORY_METRICS` Analytics Engine binding to ff-pipeline wrangler.jsonc**

File: `workers/ff-pipeline/wrangler.jsonc`  
Add a top-level block (alongside `"queues"`, `"durable_objects"`, etc.):
```json
"analytics_engine_datasets": [
  { "binding": "FACTORY_METRICS", "dataset": "factory-metrics" }
]
```

**3. Add new fields to `PipelineEnv`**

File: `workers/ff-pipeline/src/types.ts`  
Add to `PipelineEnv` interface:
```typescript
/** CF Queue consumer for telemetry events from Gas City */
TELEMETRY_QUEUE?: Queue
/** Workers Analytics Engine dataset for Factory metrics */
FACTORY_METRICS?: AnalyticsEngineDataset
/** Honeycomb API key for trace export */
HONEYCOMB_API_KEY?: string
```

**4. Create `workers/ff-pipeline/src/observability/telemetry-consumer.ts`**

This is a new file. It must export:
```typescript
export async function handleTelemetryBatch(
  batch: MessageBatch,
  env: PipelineEnv,
  ctx: ExecutionContext
): Promise<void>
```

The function:
- Iterates `batch.messages`
- For each message: calls `message.ack()` (ack immediately — never retry on sink failure, observability is best-effort)
- Emits to Analytics Engine via `env.FACTORY_METRICS?.writeDataPoint(...)` — no-op if binding absent
- Emits to Honeycomb via `ctx.waitUntil(postToHoneycomb(events, env))` — fire-and-forget, swallow errors, never throw
- If `HONEYCOMB_API_KEY` is absent, skips Honeycomb silently
- `postToHoneycomb`: one `fetch` to `https://api.honeycomb.io/1/batch/function-factory` with `X-Honeycomb-Team: env.HONEYCOMB_API_KEY`, body = JSON array of events mapped to Honeycomb field names (see §5 below)

**5. Honeycomb field name mapping**

The spec's §3.3 field names do NOT match Honeycomb's trace magic fields. Use these exact keys when POSTing to Honeycomb:

| Internal field | Honeycomb field |
|---|---|
| `trace_id` | `trace.trace_id` |
| `span_id` | `trace.span_id` |
| `parent_span_id` | `trace.parent_id` |
| `name` | `name` |
| `duration_ms` | `duration_ms` |
| `service` | `service.name` |
| `outcome` | `outcome` |
| `error` | `error` |
| all `attrs` fields | spread at top level |

**6. Define the `TelemetryEvent` type**

File: `workers/ff-pipeline/src/observability/telemetry-consumer.ts` (or a new `workers/ff-pipeline/src/observability/telemetry-types.ts`)

```typescript
export interface TelemetryEvent {
  trace_id: string        // crypto.randomUUID() format
  span_id: string
  parent_span_id?: string
  name: string            // e.g. "molecule.plan", "city.start.phase.enter"
  service: string         // "ff-pipeline" | "gascity"
  start_time_ms: number
  duration_ms: number
  outcome: "success" | "error" | "timeout"
  error?: string
  attrs: Record<string, string | number | boolean>
}
```

**7. Wire into the top-level `queue()` dispatcher**

File: `workers/ff-pipeline/src/index.ts`  
Find: the `queue(batch, env, ctx)` handler (line 1386)  
Add a branch at the top of the existing if-chain:
```typescript
if (batch.queue === 'telemetry-queue' || batch.queue === 'telemetry-dlq') {
  await handleTelemetryBatch(batch, env, ctx)
  return
}
```

**8. Secrets — no new wrangler secret needed for TELEMETRY_QUEUE (it's a binding). Add:**
- `wrangler secret put HONEYCOMB_API_KEY --name ff-pipeline`
- Document in the wrangler.jsonc secrets comment block (around line 120)

### Done when
- `telemetry-queue` and `telemetry-dlq` consumers registered in wrangler.jsonc
- `FACTORY_METRICS` AE binding in wrangler.jsonc
- `PipelineEnv` has `TELEMETRY_QUEUE`, `FACTORY_METRICS`, `HONEYCOMB_API_KEY`
- `telemetry-consumer.ts` handles batch, acks immediately, fans out to AE + Honeycomb
- Both sinks wrapped independently — Honeycomb failure cannot drop AE write
- Queue dispatcher in `index.ts` routes `telemetry-queue` to the new handler
- Unit test: `handleTelemetryBatch` with absent bindings is a no-op (never throws)
- Unit test: Honeycomb field mapping produces correct magic field names

---

## WP-OBS-3 — Gas City startup telemetry (Wescome/gascity)

### Repos affected
- `Wescome/gascity` — Go source only
- `function-factory` — workers/gascity-supervisor only (ingress endpoint)

### Part A: supervisor ingress (function-factory)

**1. Add `TELEMETRY_QUEUE` producer binding to gascity-supervisor wrangler.jsonc**

File: `workers/gascity-supervisor/wrangler.jsonc`  
Add a top-level block:
```json
"queues": {
  "producers": [
    { "binding": "TELEMETRY_QUEUE", "queue": "telemetry-queue" }
  ]
}
```

**2. Add `TELEMETRY_QUEUE` to the supervisor's env type**

File: `workers/gascity-supervisor/src/index.ts`  
Find: the `Env` interface  
Add: `TELEMETRY_QUEUE?: Queue`

**3. Add `POST /internal/telemetry` route**

File: `workers/gascity-supervisor/src/index.ts`  
Find: the top-level `default.fetch` handler where `/internal/bead-store/` is handled  
Add a new branch before the Container DO forward:

```
if (url.pathname === '/internal/telemetry' && request.method === 'POST') {
  // 1. Validate GC_SUPERVISOR_TOKEN (same check as other /internal/ routes)
  // 2. Parse body as TelemetryEvent[] (max 50 events per batch — reject 400 if over)
  // 3. If TELEMETRY_QUEUE is bound: await env.TELEMETRY_QUEUE.send(events)
  // 4. Return 200 {} — always, even if queue unbound (silent no-op)
  // 5. Never forward to Container DO
}
```

Rule: `TELEMETRY_QUEUE` absent → return 200 silently. Observability never blocks the supervisor.

### Part B: gc emitter (Wescome/gascity)

**Go struct — `TelemetryEvent`**

Define in a new file `internal/telemetry/types.go`:

```go
type TelemetryEvent struct {
    TraceID      string                 `json:"trace_id"`
    SpanID       string                 `json:"span_id"`
    ParentSpanID string                 `json:"parent_span_id,omitempty"`
    Name         string                 `json:"name"`
    Service      string                 `json:"service"`
    StartTimeMS  int64                  `json:"start_time_ms"`
    DurationMS   int64                  `json:"duration_ms"`
    Outcome      string                 `json:"outcome"` // "success" | "error" | "timeout"
    Error        string                 `json:"error,omitempty"`
    Attrs        map[string]interface{} `json:"attrs"`
}
```

**Emitter — `internal/telemetry/emitter.go`**

```go
type Emitter struct {
    supervisorURL string  // e.g. "https://gascity-supervisor.koales.workers.dev"
    token         string  // GC_SUPERVISOR_TOKEN
    batch         []TelemetryEvent
    mu            sync.Mutex
    client        *http.Client  // timeout: 3s
}

func (e *Emitter) Emit(event TelemetryEvent)  // appends to batch, non-blocking
func (e *Emitter) Flush() error               // POSTs batch to /internal/telemetry, clears batch
```

Rules:
- `Flush()` is fire-and-forget from gc's perspective. Caller does not check error in hot paths.
- HTTP client timeout: 3 seconds. On any error: log to stderr (for Container log visibility), return, do NOT retry from the emitter. CF Queue handles retry.
- Batch cleared after every Flush regardless of HTTP response code.
- `Emit()` is safe to call from multiple goroutines.
- If supervisor URL or token is empty string: `Emit` and `Flush` are no-ops.

**Emission sites — startup phases**

File: wherever startup phase transitions are logged today (check `internal/city/startup.go` or equivalent)

Emit `city.start.phase.enter` at the start of each phase:
```go
emitter.Emit(TelemetryEvent{
    TraceID:     cityTraceID,  // generated once at city startup
    SpanID:      newSpanID(),
    Name:        "city.start.phase.enter",
    Service:     "gascity",
    StartTimeMS: nowMS(),
    DurationMS:  0,
    Outcome:     "success",
    Attrs: map[string]interface{}{
        "city":            cityName,
        "phase":           phaseName,  // must be one of the canonical phase names from startupPhaseOrder
        "attempt":         attempt,
        "build_version":   buildVersion,
        "beads_provider":  beadsProvider,
    },
})
```

Emit `city.start.phase.exit` on phase completion with `duration_ms` filled.  
Emit `city.start.phase.timeout` on phase deadline exceeded, with `last_blocking_op` in attrs.  
Emit `city.start.dispatch_ready` when city reaches dispatch-ready state, with `elapsed_ms` and `mode` (`"full"` or `"degraded"`).  
Emit `city.adoption.op.timeout` on per-op adoption timeout.

Call `emitter.Flush()` after `city.start.dispatch_ready` — this is the natural batch flush point for startup.

**Canonical phase names** (from `GAS-CITY-STARTUP-CONTENTION-ARCHITECTURE.md` §4.2):  
`loading_config`, `starting_bead_store`, `resolving_formulas`, `adopting_sessions`, `starting_agents`, `running`

### Done when
- supervisor `/internal/telemetry` accepts `POST`, validates token, enqueues, returns 200
- supervisor returns 200 (no-op) when `TELEMETRY_QUEUE` not bound
- gc `Emitter` type exists with `Emit/Flush` semantics as above
- Startup phase events emitted at every transition using canonical phase names
- `city.start.dispatch_ready` always emitted with `elapsed_ms`
- gc binary rebuilt and `workers/gascity-supervisor/gc-linux-amd64` updated

---

## WP-OBS-4 — Molecule lifecycle telemetry (Wescome/gascity)

### Repos affected
- `Wescome/gascity` — Go source only (reuses Emitter from WP-OBS-3)

### Emission sites — molecule lifecycle

Reuse the `Emitter` from WP-OBS-3. The `trace_id` for a molecule comes from the `X-Trace-ID` header on the dispatch request (set by ff-pipeline in WP-OBS-1). gc must read this header when the molecule is created and store it on the root bead metadata as `gc.trace_id`. All child step events carry the same `trace_id`.

**`molecule.start`** — when workflow root bead is created:
```
name: "molecule.start"
attrs: { form_id, fn_id, factory_attempt, gc_trace_id }
```

**`step.start`** — when a step bead is dispatched:
```
name: "step.start"
attrs: { step, bead_id, provider, gc_trace_id }
```

**`step.complete`** — when a step bead closes pass:
```
name: "step.complete"
duration_ms: filled
attrs: { step, bead_id, provider, gc_trace_id }
```

**`step.fail`** — when a step bead closes fail:
```
name: "step.fail"
outcome: "error"
attrs: { step, bead_id, failure_reason, gc_trace_id }
```

**`step.timeout`** — when a step exceeds its deadline (distinct from fail):
```
name: "step.timeout"
outcome: "timeout"
attrs: { step, bead_id, elapsed_ms, gc_trace_id }
```

**`fidelity.run`** — when release step invokes fidelity validator:
```
name: "fidelity.run"
attrs: { bead_id, prior_step_count, gc_trace_id }
```

**`fidelity.verdict`** — when fidelity validator exits:
```
name: "fidelity.verdict"
duration_ms: filled
attrs: { bead_id, verdict, gc_trace_id }
```

**`molecule.complete`** — when molecule root bead closes:
```
name: "molecule.complete"
duration_ms: total molecule elapsed
attrs: { form_id, outcome, factory_attempt, gc_trace_id }
```

Call `emitter.Flush()` after `molecule.complete` — batch flush point for each molecule.

### Trace boundary note
The molecule execution trace (`molecule.start` through `molecule.complete`) is a **second root span** in Honeycomb, correlated to the ff-pipeline dispatch trace via shared `trace_id`. Do NOT set `parent_span_id` pointing at the dispatch span — that span is already closed. In Honeycomb, link via `trace.trace_id` equality. Document this in a code comment at the `molecule.start` emission site.

### Done when
- `X-Trace-ID` header read from dispatch request and stored on root bead metadata
- All 7 molecule lifecycle events emitted at correct call sites
- `gc.trace_id` carried on every event attrs
- `emitter.Flush()` called after `molecule.complete`
- gc binary rebuilt and `workers/gascity-supervisor/gc-linux-amd64` updated

---

## Build order

1. **WP-OBS-1** first — establishes `trace_id` on dispatch_log. No external deps.
2. **WP-OBS-2** in parallel with WP-OBS-1 — queue infrastructure, no gc dependency.
3. **WP-OBS-3 Part A** (supervisor ingress) can ship with WP-OBS-2 deploy (needs `TELEMETRY_QUEUE` queue to exist).
4. **WP-OBS-3 Part B** + **WP-OBS-4** together — both are gc changes, one binary rebuild.

Queue `telemetry-queue` must be created in CF dashboard before any deploy that references it.

---

## What's NOT in scope for Codex

- Honeycomb boards and alerts (WP-OBS-6) — manual setup after data flows 48h
- `molecule.stuck` detector — requires a scheduled cron sweep of open molecules in dispatch_log; separate spec needed
- RunEventLog reconciliation — existing `run-event-log.ts` is the old harness run model (R2-backed, keyed on `runId`). Leave it untouched. This is a separate subsystem.
