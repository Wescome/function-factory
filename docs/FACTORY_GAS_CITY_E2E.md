# Factory + Gas City: End-to-End Production Reference

**Status:** Authoritative — reflects deployed production as of 2026-05-28.
**Authority:** `GAS-CITY-ERA-ARCHITECTURE.md`, `ADR-010`, `GOVD-GAS-CITY-PHASE1-INTEGRATION`,
Gas City source `engdocs/architecture/`, `docs/reference/api.md`.

---

## System overview

Two systems. One closed loop.

**Factory** (`ff-pipeline.koales.workers.dev`) — Cloudflare Worker backed by ArangoDB. Governs
the full artifact lifecycle: Signal → Pressure → IS → ES → EP → FORM → VR → FN state. Compiles
intent into executable work. Receives execution verdicts. Maintains lineage.

**Gas City** (`gascity-supervisor.koales.workers.dev`) — external execution substrate running in
a Cloudflare Container. Manages agent sessions, durable work tracking (Beads), formula-driven
workflow execution, convergence loops, and health supervision. Consumes Factory-compiled Formula
TOMLs. Reports results back via HMAC-signed webhooks.

Factory is governance. Gas City is execution. Neither subsumes the other.

---

## Production topology

```
  Cloudflare edge
  ┌──────────────────────────────────────────────────────────────────────┐
  │  ff-pipeline Worker (TypeScript)                                     │
  │  · ArangoDB binding (lineage graph)                                  │
  │  · Cron trigger (governance + autonomy monitor)                      │
  └──────────────┬───────────────────────────────────────────────────────┘
                 │ HTTP (dispatch, webhooks, autonomy)
  ┌──────────────▼───────────────────────────────────────────────────────┐
  │  gascity-supervisor Worker (TypeScript auth proxy)                   │
  │  · Bearer token gate                                                 │
  │  · Injects X-GC-Request header on all mutations                      │
  └──────────────┬───────────────────────────────────────────────────────┘
                 │ proxy to localhost:9443
  ┌──────────────▼───────────────────────────────────────────────────────┐
  │  Gas City supervisor (Go binary in Container)                        │
  │  · gc supervisor run (port 9443)                                     │
  │  · Dolt SQL server (port 3306, internal)                             │
  │  · Beads provider: file (Phase 0) → bd/Dolt (production)            │
  │  · city.toml: workspace=factory, session.provider=cloudflare         │
  └──────────────┬───────────────────────────────────────────────────────┘
                 │ HTTP (session lifecycle API)
  ┌──────────────▼───────────────────────────────────────────────────────┐
  │  gascity-cloudflare-control-worker (TypeScript Worker)               │
  │  · Durable Objects: Sandbox, SessionRegistry, PoolReconciler         │
  │  · AGENT_CMD var — headless agent command (⚠ currently empty)       │
  │  · POST /session          boot Cloudflare Sandbox                    │
  │  · POST /session/:id/agent  exec AGENT_CMD in Sandbox                │
  │  · POST /session/:id/exec   run arbitrary command in Sandbox         │
  │  · GET  /session/:id/status  liveness                                │
  └──────────────┬───────────────────────────────────────────────────────┘
                 │ Sandbox SDK
  ┌──────────────▼───────────────────────────────────────────────────────┐
  │  Cloudflare Sandbox (Container per session)                          │
  │  · Isolated filesystem per session                                   │
  │  · Git clone of target repo on boot                                  │
  │  · Runs AGENT_CMD (Codex / Claude / etc.) — ⚠ not yet set           │
  │  · Work artifacts (diffs, plans, reports) produced here              │
  └──────────────────────────────────────────────────────────────────────┘
```

**Three layers, two gaps.** The supervisor Container (Gas City) and the control Worker (session
lifecycle) are both live. The Cloudflare Sandbox transport is proven (M0 verified). What is not
yet wired is the agent binary: `AGENT_CMD` is blank, so `POST /session/:id/agent` runs an empty
command. No real coding agent executes. No work artifacts are produced.

---

## Execution runtime: Cloudflare Sandbox transport

### What it is

Gas City's `city.toml` (at `stage/supervisor/factory/city.toml`) configures the coder agent
to use the Cloudflare Sandbox as its execution transport:

```toml
[workspace]
name = "factory"
start_command = "bash -lc 'echo [factory-probe] ready'"

[beads]
provider = "file"

[session]
provider = "cloudflare"

[session.cloudflare]
url = "https://gascity-cloudflare-control-worker.koales.workers.dev"

[[agent]]
name = "coder"
provider = "cloudflare"
min_active_sessions = 1
max_active_sessions = 3
```

The `cloudflare` session provider is the Go transport in `internal/runtime/cloudflare/` that
calls the control Worker. The control Worker boots a Cloudflare Sandbox per session and runs
the headless agent command inside it.

### Control Worker API

Live at `https://gascity-cloudflare-control-worker.koales.workers.dev`. This is the session
lifecycle surface — not the Gas City supervisor. Gas City's Go transport calls this, not the
supervisor's REST API.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/session` | Boot a Cloudflare Sandbox; optional `repo` git clone |
| POST | `/session/:id/agent` | Run `AGENT_CMD` in the Sandbox (the headless coding agent) |
| POST | `/session/:id/exec` | Run arbitrary command in Sandbox (`{ cmd }`) |
| POST | `/session/:id/nudge` | Append text to the Sandbox PTY |
| POST | `/session/:id/peek` | Read Sandbox scrollback |
| GET | `/session/:id/status` | Liveness + output |
| POST | `/session/:id/copy` | Upload file to Sandbox (base64, 1 MiB cap) |
| GET/POST/DELETE | `/session/:id/meta/:key` | Session metadata store |
| POST | `/session/:id/stop` | Best-effort shutdown |

### AGENT_CMD — the open gap

The control Worker has one var that determines what runs inside the Sandbox:

```jsonc
"vars": {
  "AGENT_CMD": "",   // ← empty; no agent binary bound
  ...
}
```

Right now `POST /session/:id/agent` executes an empty command. A live probe returns
`"ran": ""`. The Sandbox starts, the session lifecycle works end to end — but no coding
agent process runs and no work artifacts are produced.

**To bind a real agent**, set `AGENT_CMD` to a headless agent invocation, e.g.:
```
codex --dangerously-skip-permissions
```
or:
```
claude --dangerously-skip-permissions
```
The command runs non-interactively inside the Sandbox with the provisioned repo and env.

### What "artifact-producing run" requires

A true end-to-end run means the agent produces evidence inside the Sandbox:
- Code changes (tracked diff in the git repo)
- A plan file (e.g., `PLAN.md`) written by the agent
- Verification output (test results, report file)
- A signed RELEASE callback whose payload references those artifacts

Until `AGENT_CMD` is set, runs confirm control-plane wiring only. The governance loop
(Factory → dispatch → webhook → VR → lifecycle) works. The execution loop (agent reads task,
thinks, writes code, verifies) does not.

### M0 / M1 / M2 milestone status

| Milestone | What | Status |
|-----------|------|--------|
| M0 | Control Worker + Go provider skeleton; seam proven: `POST /session → /agent → /status` round-trip on live Sandbox | **Complete** (2026-05-22) |
| M1 | Provider contract reconciliation: transport vs agent-provider distinction; Gas City `internal/runtime/` interface shape | **Complete** (docs only) |
| M2 | Corrected RFC + in-tree `internal/runtime/cloudflare/provider.go` stub + GitHub issue filing artifact | **In progress** |
| M3 | Background-process API for long-running agents; R2-mounted work_dir (`r2_buckets` binding) | **Not started** |
| M4 | Governance middleware on `exec`; `AGENT_CMD` set to real coding agent; first artifact-producing run | **Not started** |

### Flagged items (require confirmation before relying on)

- **Snapshot API** — `POST /session/:id/snapshot` returns 501. Confirm at Cloudflare docs before using for session resume / fork.
- **R2-mounted work_dir** — `r2_buckets` binding in `wrangler.jsonc` is commented out. Wire per Cloudflare Sandbox guide before using persistent filesystem across sessions.
- **Background processes** — M0 uses `exec` (bounded, blocks until exit). Long-running agent processes require the Sandbox background-process API; confirm signature before adopting.
- **Sandbox base image tag** — Dockerfile pinned to `@cloudflare/sandbox` v0.8.9; must match installed SDK version.

---

## Gas City: primitives

Gas City is built on five irreducible primitives and four derived mechanisms.

### Primitive 1 — Session

Starts, stops, prompts, and observes agent processes regardless of runtime provider. The
interface is `runtime.Provider`: Start, Stop, Interrupt, IsRunning, Peek, Nudge, GetLastActivity.

Providers in production:
- **tmux** — interactive pane (development)
- **subprocess** — local non-interactive process
- **exec** — script-backed launch
- **acp** — Agent Client Protocol (Anthropic Claude / Codex via ACP transport)
- **k8s** — Kubernetes pod
- **cloudflare** — CF Sandbox (M2, in progress)

Session names are stable and deterministic: same city + agent + template → same name always.
Config fingerprinting (SHA-256 of agent config) detects drift and triggers a drain + restart.

### Primitive 2 — Bead Store

Universal persistence substrate. Every unit of work in Gas City is a bead.

Bead struct:
```
ID, Title, Status (open|in_progress|closed), Type, Assignee, ParentID,
Ref, Needs (dependency IDs), Description, Labels, CreatedAt
```

Container types:
- **Molecule** — formula instantiated as root bead + step beads
- **Wisp** — ephemeral molecule, TTL-based GC (default 24 h)
- **Convoy** — set of beads expanded during sling dispatch
- **Epic** — ordinary bead acting as parent

Store interface: Create, Get, Update, Close, List, Ready, Children, ListByLabel, MolCook.

Production provider: **BdStore** (bd CLI over Dolt, git-backed JSONL). State survives agent
crashes because Beads live in Dolt, not in agent memory.

Labels are query keys: e.g., `pool:worker`, `fn-id:FN-*`, `order-run:lint`. The Factory uses
three lineage labels on every Bead it creates:
```
fn-id:FN-XXX      Factory Function ID
is-id:IS-XXX      Factory Intent Specification ID
es-id:ES-XXX      Factory Executable Specification ID
```

### Primitive 3 — Event Bus

Append-only, immutable pub/sub log. Every state change in Gas City emits an event.

Event struct:
```
Seq (monotonically increasing), Type, Ts, Actor, Subject, Message, Payload (JSON)
```

Storage: `.gc/events.jsonl` (JSONL, append-only). Errors are fire-and-forget (logged, never
returned to callers).

Selected event types:
```
bead.created / bead.updated / bead.closed
session.woke / session.stopped / session.crashed / session.idle_killed / session.draining
mail.sent / mail.archived
convoy.created / convoy.completed
order.fired / order.completed / order.failed
controller.tick / city.started / city.stopped
request.result.*
```

Factory receives these via the `POST /webhooks/gascity` bridge. The supervisor streams them as
SSE at `GET /v0/city/{city}/events/stream`.

### Primitive 4 — Config (city.toml)

Single TOML file with progressive activation. Features are enabled by section presence — no
feature flags.

Activation levels:
```
Level 0-1  [workspace] + [[agent]]         → sessions + tasks
Level 2    [daemon]                         → controller loop
Level 3    [agent.pool]                     → agent pools
Level 4    [mail]                           → messaging
Level 5    formula files + [formulas]       → formulas + molecules
Level 6    [daemon] health fields           → health monitoring
Level 7    orders/                          → scheduled orders
Level 8    all sections                     → full orchestration
```

Multi-layer override resolution: workspace packs → rig packs → rig config → patches. All
layers compose. Last definition wins per key.

### Primitive 5 — Prompt Templates

Markdown files with Go `text/template` syntax. They define everything an agent does. No role
names, no behavioral logic lives in Go code — only in template files. Zero Framework Cognition:
if a line of Go makes a judgment call, it is a design violation.

---

## Gas City: derived mechanisms

### Mechanism 1 — Formulas & Molecules

**Formula** — a `.formula.toml` file defining a workflow. Discovery layers (last wins):
```
Layer 0  embedded system-formulas in gc binary
Layer 1  city packs
Layer 2  city-level [formulas].dir
Layer 3  rig packs
Layer 4  rig-level [[rigs]].formulas_dir
```

Formula step fields:
```toml
[[steps]]
id          = "map"
title       = "Map the codebase"
description = "{{task}}"          # variable substitution
needs       = []                  # dependency step IDs (DAG)
condition   = "env == 'prod'"     # optional guard
```

Advanced: `loop` (count iterations), `check` (retry: max_attempts + check script), `children`
(nested steps), `lanes` (parallel execution via graph.v2).

**Molecule** — a formula instantiated at runtime = root bead + one step bead per step. Created
via `bd mol wisp <formula>` (production) or `MolCook` (store interface). Molecule is complete
when all step beads are closed.

**Variable substitution** — `{{key}}` placeholders in step descriptions; resolved from formula
`[vars]` defaults or `--var key=value` overrides at dispatch time.

The Factory compiles an EP into a Formula TOML. The vars it injects:
```
es_id      → EP's Executable Specification ID
fn_id      → Factory Function ID
is_id      → Intent Specification ID
task       → human-readable task description
```

### Mechanism 2 — Dispatch (Sling)

Routing work to an agent session in one atomic operation:

```
find/spawn agent → select formula → create molecule → hook to agent → nudge → create convoy → emit event
```

**Sling query** (how work is routed to agent):
- Fixed agent: `bd update {} --assignee=<name>`
- Pool agent: `bd update {} --label=pool:<name>`

**Work query** (how agent finds its next task):
- Fixed agent: `bd ready --assignee=<name>`
- Pool agent: `bd ready --label=pool:<name> --unassigned --limit=1`

**GUPP** — Gas Town Universal Propulsion Principle: "If you find work on your hook, you run it."
No confirmation. No waiting. Hook discovery IS assignment. This is why Beads survive crashes:
the agent restarts, queries `bd ready`, finds the same bead, and continues. The Factory never
needs to re-dispatch after a crash.

**Auto-convoy** — single beads are automatically wrapped in convoy tracking unless they are
formulas or container types.

**Container expansion** — convoy beads expand to their open children; each child is routed
individually.

### Mechanism 3 — Health Patrol

Erlang/OTP supervision model. Controller (supervisor) drives workers (agents).

**Reconciliation loop** (every ~30 s, configurable via `patrol_interval`):
```
For each desired agent:
  not alive              → start
  alive + desired        → skip
  alive + not desired    → drain + close
  alive + config drifted → drain + restart
```

**Crash loop quarantine**: more than `max_restarts` within `restart_window` → stop retrying
until window expires.

**Idle kill**: no I/O activity within `idle_timeout` → kill + restart; records
`session.idle_killed` event.

**Config drift detection**: SHA-256 hash of agent config stored at start. Changed → drain +
restart on next tick.

**Order dispatch**: on every controller tick, evaluate all order trigger conditions (cooldown,
cron, condition, event-driven, manual). Fire eligible orders. Order tracking beads created
synchronously to prevent cooldown re-fire.

**Wisp GC**: closed molecules older than `wisp_ttl` (default 24 h) purged on
`wisp_gc_interval`.

### Mechanism 4 — Messaging (Mail)

Messages are beads with `Type: "message"`. Inbox = open message beads by assignee. Archive =
close the bead. Nudge = `runtime.Provider.Nudge(text)`. Uses only Bead Store + Session — no
new primitive required.

---

## Gas City: HTTP API

The supervisor exposes a REST API at port 9443. In production, the gascity-supervisor Worker
proxies all requests, injecting `X-GC-Request` (CSRF token required on all mutations) and
enforcing Bearer token auth.

### Key headers

| Header | Direction | Purpose |
|--------|-----------|---------|
| `Authorization: Bearer <token>` | request | Auth gate on the CF Worker proxy |
| `X-GC-Request: <token>` | request | CSRF token, injected by proxy on mutations |
| `X-GC-Request-Id` | response | Correlation ID on all responses |
| `X-GC-Index` | response | Current event log position |

### Endpoint families

**Supervisor / cities**
```
GET  /health                                        liveness
GET  /v0/readiness                                  readiness
GET  /v0/cities                                     list registered cities
POST /v0/city                                       register + start a city (async, 202)
GET  /v0/city/{name}                                city info
GET  /v0/city/{name}/status                         city status
POST /v0/city/{name}/stop                           stop city
POST /v0/city/{name}/unregister                     remove city
```

**Beads**
```
POST   /v0/city/{city}/beads                        create bead
GET    /v0/city/{city}/beads                        list beads (query params: label, status, ...)
GET    /v0/city/{city}/beads/{id}                   get bead
PATCH  /v0/city/{city}/beads/{id}                   update bead
DELETE /v0/city/{city}/beads/{id}                   close bead
GET    /v0/city/{city}/beads/{id}/children          child beads
POST   /v0/city/{city}/beads/{id}/sling             attach molecule to agent session
POST   /v0/city/{city}/beads/{id}/hook              hook bead to session
```

**Sessions**
```
GET    /v0/city/{city}/sessions                     list sessions
POST   /v0/city/{city}/sessions                     create session
GET    /v0/city/{city}/sessions/{name}              session state
DELETE /v0/city/{city}/sessions/{name}              stop session
POST   /v0/city/{city}/sessions/{name}/prompt       send prompt
POST   /v0/city/{city}/sessions/{name}/resume       resume session
GET    /v0/city/{city}/sessions/{name}/transcript   session transcript
GET    /v0/city/{city}/agents/{agent}/output/stream SSE output stream
```

**Formulas & molecules**
```
GET  /v0/city/{city}/formulas                       list available formulas
GET  /v0/city/{city}/formulas/{name}                formula definition
POST /v0/city/{city}/molecules                      instantiate formula as molecule
GET  /v0/city/{city}/molecules/{id}                 molecule state
```

**Events**
```
GET /v0/city/{city}/events                          event log (paginated, after_seq param)
GET /v0/city/{city}/events/stream                   SSE event stream (Last-Event-ID for resume)
GET /v0/events                                      supervisor-scope event log
GET /v0/events/stream                               supervisor-scope SSE stream
```

### Factory dispatch uses three calls

The Factory's formula compiler executes this sequence on every `POST /dispatch-formula`:

```
CALL 1  GET  /version                                   version probe + auth check
CALL 2  POST /v0/city/{city}/beads                      create Bead with Formula TOML + lineage labels
         Body: { title, description, formula_content, labels: ["fn-id:FN-*", "is-id:IS-*", "es-id:ES-*"] }
         Header: Idempotency-Key: FORM-*
CALL 3  POST /v0/city/{city}/beads/{bead_id}/sling      attach Formula to agent session
```

CALL 2 uses `Idempotency-Key: FORM-*` as the primary dedup barrier. CALL 3 returns 409 if
already slung — detected and handled as success.

---

## Factory: production surfaces

### Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/version` | — | Worker version + deploy timestamp |
| GET | `/debug/health` | — | ArangoDB + AI binding liveness |
| POST | `/seed-dispatch-ep` | `OPERATOR_CONTROL_TOKEN` | Bootstrap: create EP from IS/ES/FN IDs |
| POST | `/dispatch-formula` | `OPERATOR_CONTROL_TOKEN` | Compile EP → Formula + dispatch to Gas City |
| POST | `/webhooks/gascity` | HMAC `X-GC-Signature` | Receive Gas City completion + operational events |
| GET | `/gascity/autonomy/status` | — | Lifecycle counts, VRs, open incidents, pressures |
| POST | `/gascity/autonomy/run` | `OPERATOR_CONTROL_TOKEN` | Trigger autonomy monitor manually |

### Secrets and configuration

| Secret / Var | Holder | Purpose |
|-------------|--------|---------|
| `GAS_CITY_BEARER_TOKEN` | ff-pipeline secret | Auth for all Factory → Gas City HTTP |
| `GAS_CITY_HMAC_SECRET_V1` | ff-pipeline secret | Verify inbound webhook signatures (key ID `v1`) |
| `GC_SUPERVISOR_TOKEN` | gascity-supervisor secret | Gate on Gas City supervisor proxy |
| `GAS_CITY_HMAC_SECRET` | gascity-supervisor secret | Sign outbound RELEASE callbacks (= `GAS_CITY_HMAC_SECRET_V1`) |
| `OPERATOR_CONTROL_TOKEN` | ff-pipeline secret | Gate on operator Factory routes |
| `GAS_CITY_BASE_URL` | ff-pipeline var | Gas City supervisor base URL |
| `GAS_CITY_CITY_NAME` | ff-pipeline var | City name in all Gas City API paths |
| `GAS_CITY_AGENT_NAME` | ff-pipeline var | Agent session name for sling |
| `GAS_CITY_RIG` | ff-pipeline var | Rig identifier |
| `GAS_CITY_RIG_ROOT` | ff-pipeline var | Root path inside the rig |
| `GAS_CITY_WEBHOOK_URL` | ff-pipeline var | Factory webhook URL sent to Gas City for RELEASE callbacks |
| `GAS_CITY_MAX_AMENDMENT_DEPTH` | ff-pipeline var | Max revision depth before INC-* escalation (default: 3) |

The BEARER token and HMAC secret are rotated together by `scripts/ops/first-dispatch.sh`. The
value set as `GAS_CITY_HMAC_SECRET` on the supervisor must equal `GAS_CITY_HMAC_SECRET_V1` on
ff-pipeline.

### ArangoDB collections (Gas City era)

| Collection | Type | Purpose |
|-----------|------|---------|
| `specs_functions` | document | Function lifecycle state |
| `dispatch_log` | document | One row per dispatch attempt |
| `formulas` | document | Compiled FORM-* artifacts |
| `completion_events` | document | Append-only; one row per bead completion |
| `fidelity_verdicts` | document | VR-* kind=fidelity, one per RELEASE callback |
| `lifecycle_transitions` | edge | `specs_functions/_key → specs_functions/_key` per transition |
| `webhook_rejections` | document | Failed HMAC / shape / lineage / orphan payloads |
| `specs_incidents` | document | INC-* artifacts |
| `specs_pressures` | document | PRS-OPS-GC-* escalated from recurring incidents |

---

## Function lifecycle

### States

| State | Meaning | Entered by |
|-------|---------|-----------|
| `proposed` | FunctionProposal exists, no spec | FP-* creation |
| `specified` | IS+ES+EP compiled, Coherence VR pass | Coherence VR `overall=pass` |
| `dispatched` | FORM-* sent to Gas City | Dispatch CALL 3 success |
| `accepted` | Gas City returned `outcome=approved` | Fidelity VR `overall=pass` |
| `rejected` | Gas City returned `outcome=revise` | Fidelity VR `overall=fail` |
| `monitored` | Autonomy monitor promoted `accepted` with fresh evidence | Cron |
| `regressed` | Freshness lapsed on a `monitored` Function | Cron |
| `retired` | Superseded or operator-killed | Operator / amendment |

```
proposed   → specified  | retired
specified  → dispatched | retired
dispatched → accepted   | rejected | retired
accepted   → monitored  | retired
rejected   → retired
monitored  → regressed  | retired
regressed  → monitored  | retired
retired    → (terminal)
```

Every transition writes a `lifecycle_transitions` edge with the evidence key that authorized it.

---

## End-to-end flow

### Step 1 — Compile and dispatch (Factory → Gas City)

**Route:** `POST /dispatch-formula` with `{ "epId": "EP-*", "factoryAttempt": 1 }`

Inside `formula-compiler.ts`:

1. Reads the EP from ArangoDB.
2. Derives a deterministic `FORM-*` key from `ep_id + factory_attempt`.
3. Checks `dispatch_log` for an existing `outcome=dispatched` row — idempotent return if found.
4. Writes `FORM-*` document and `dispatch_log` row (`outcome=pending`) **before** any Gas City
   call (durable barrier: if Gas City is unreachable, the EP is not lost).
5. Executes the 3-call Gas City HTTP sequence:
   - CALL 1: `GET /version` — version probe / auth check.
   - CALL 2: `POST /v0/city/{city}/beads` — creates root Bead with Formula TOML, injects
     `Idempotency-Key: FORM-*`, attaches lineage labels (`fn-id:FN-*`, `is-id:IS-*`,
     `es-id:ES-*`).
   - CALL 3: `POST /v0/city/{city}/beads/{bead_id}/sling` — attaches Formula to named agent
     session. 409 = already slung, treated as success.
6. Updates `dispatch_log` to `outcome=dispatched`, records `gc_bead_id` + `gc_workflow_id`.
7. Writes or updates `specs_functions/FN-*` to `state=dispatched`.

Returns: `{ "outcome": "dispatched", "gc_bead_id": "gc-N", "form_id": "FORM-*" }`

### Step 2 — Execution (Gas City owns this entirely)

Gas City picks up the Bead via GUPP. The agent session finds the Bead on its hook, reads the
Formula TOML, and executes each molecule step. Gas City manages:

- **Convergence** — runs steps in dependency order per the `needs` DAG
- **Retries** — per-step `check` blocks with `max_attempts`
- **Stall detection** — Health Patrol emits `health.stall` if session goes idle
- **Crash recovery** — GUPP: agent restarts, queries `bd ready`, finds the same Bead, resumes
- **Idle kill** — session killed and restarted if `idle_timeout` exceeded

The Factory has no role during execution. It waits.

### Step 3 — RELEASE callback (Gas City → Factory)

When Gas City completes a Formula, it POSTs a signed payload to the Factory webhook URL:

**Route:** `POST /webhooks/gascity`

**Payload:**
```json
{
  "fn_id": "FN-*",
  "is_id": "IS-*",
  "es_id": "ES-*",
  "ep_id": "EP-*",
  "form_id": "FORM-*",
  "bead_id": "gc-N",
  "factory_attempt": 1,
  "outcome": "approved" | "revise",
  "remediation": "<optional revision instruction>"
}
```

**Signature headers:**
```
X-GC-Key-ID: v1
X-GC-Signature: sha256=<HMAC-SHA256(GAS_CITY_HMAC_SECRET_V1, rawBodyBytes)>
```

**Webhook handler steps (sequential, no LLM, deterministic):**

1. **HMAC gate** — verifies signature constant-time. Unknown key ID → 401, logged.
2. **Shape gate** — Zod validation. Missing fields → 400, logged.
3. **Idempotency gate** — checks `completion_events` for `bead_id`. Duplicate → 200
   `{ "duplicate": true, "vr_id": "VR-*" }`.
4. **Lineage gate** — queries `dispatch_log WHERE gc_bead_id == bead_id AND outcome == 'dispatched'`.
   Orphan → 409. Cross-checks `form_id`, `es_id`, `ep_id`. Mismatch → 409.
5. **Write** `completion_events` (keyed by `bead_id`).
6. **Build + write** `GasCityFidelityVerificationReport` (`VR-*`) to `fidelity_verdicts`:
   - `overall = "pass"` (approved) or `"fail"` (revise)
   - `verdict_authority = "gas-city-verify-stage"` — Factory never recomputes the verdict
   - `intake_checks`: hmac_valid, payload_wellformed, lineage_resolved all `true`
7. **Lifecycle transition:**
   - approved → `accepted`; revise → `rejected`
   - Writes `lifecycle_transitions` edge with evidence key.
8. **Amendment signal** (revise only) — writes `SIG-*` to `specs_signals`. Does not
   auto-dispatch. Amendment is a governed act.
9. Returns 202 `{ "accepted": true, "vr_id": "VR-*", "lifecycle_state": "..." }`.

**Operational events** — `health.stall`, `session.crash`, `molecule.failed`,
`convergence.evaluate` are also accepted at this route. They write `INC-*` artifacts and may
escalate to `PRS-OPS-GC-*` pressures. They do not produce Fidelity VRs.

### Step 4 — Autonomy monitoring (Factory cron)

Runs on Cloudflare cron alongside the governance cycle. Also triggerable at
`POST /gascity/autonomy/run`.

1. **Persistence VRs** — for every `accepted` or `monitored` Function, checks whether a fresh
   Fidelity VR exists within the freshness window (default 24 h). Writes a
   `PersistenceVerificationReport` either way.
2. **Promote `accepted` → `monitored`** — if fresh Fidelity evidence exists.
3. **Regress `monitored`** — if evidence is stale; creates `INC-*` incident.
4. **Stale dispatch** — finds `dispatch_log` rows stuck beyond stale window (default 60 min).
   Creates `INC-*`.
5. **Recurring incident escalation** — more than `GAS_CITY_RECURRING_INCIDENT_THRESHOLD`
   (default 3) open incidents on a Function → writes `PRS-OPS-GC-*` operational pressure.

`GET /gascity/autonomy/status` returns the current summary without triggering a run:
```json
{
  "ok": true,
  "function_states": { "dispatched": 0, "accepted": 0, "monitored": 1 },
  "latest_persistence_vr": { "id": "VR-GC-PERSIST-*", "overall": "pass" },
  "open_incidents": [],
  "operational_pressures": []
}
```

---

## Amendment loop

When Gas City returns `outcome=revise`:

1. Webhook writes `SIG-*` amendment signal; Function → `rejected`.
2. Operator (Phase 1) or autonomous Architect agent (Phase 4+) authors successor Function
   (`FN-V2`) with revised IS + ES.
3. `FN-V1` → `retired` once `FN-V2` reaches `specified`.
4. New `POST /dispatch-formula` restarts the cycle with a new EP.
5. `GAS_CITY_MAX_AMENDMENT_DEPTH` (default 3) — exceeding it writes
   `INC-GC-AMENDMENT-DEPTH-*` and stops amendment signal emission for that Function.

---

## Production smoke (first-dispatch.sh)

`scripts/ops/first-dispatch.sh` exercises the full end-to-end path:

```
[1] Generate GC_BEARER_TOKEN, OPERATOR_TOKEN, GC_HMAC_SECRET (openssl rand -hex 32 each)
[2] Set secrets on both Workers (GC_SUPERVISOR_TOKEN, GAS_CITY_BEARER_TOKEN,
    GAS_CITY_HMAC_SECRET, GAS_CITY_HMAC_SECRET_V1, OPERATOR_CONTROL_TOKEN)
[3] Deploy ff-pipeline (wrangler deploy, fail-fast on error)
[4] POST /seed-dispatch-ep   → create EP-* for FN-GC-DISPATCH-WIRE
[5] POST /dispatch-formula   → compile Formula, dispatch to Gas City → gc_bead_id
[6] POST /webhooks/gascity   → signed RELEASE callback (approved) → VR-* created
[7] POST /gascity/autonomy/run → monitor run (timeout-tolerant)
    GET  /gascity/autonomy/status → assert ok=true
```

Exit 0 = all seven gates passed.

---

## Cron jobs

Two jobs run on the same Cloudflare scheduled trigger:

- `runGovernanceCycle(env, 'cron')` — Factory governance (Pressures, IS/ES pipeline)
- `runGasCityAutonomyMonitor(env, 'cron')` — Gas City persistence monitoring

---

## What is not yet implemented (V1 backlog)

| Gap | Severity | Description |
|-----|----------|-------------|
| `AGENT_CMD` not set | **Critical** | `POST /session/:id/agent` runs empty command. No coding agent executes. No artifacts produced. Transport is wired; execution is not. |
| R2 work_dir not mounted | **Critical** | Sandbox filesystem is ephemeral per session. Work artifacts are lost on session end. `r2_buckets` binding in wrangler.jsonc is commented out. |
| Background-process API unconfirmed | **High** | M0 uses bounded `exec`. Long-running agents (Codex/Claude) need the Sandbox background-process API; signature not confirmed. |
| Convergence gate | **High** | `POST /verify/coherence/{es-id}` — Crystallizer gate callable from Gas City convergence loop. Not yet built. |
| Autonomous amendment | **High** | Amendment is operator-triggered in Phase 1. Autonomous loop is Phase 4+. |
| CI gate | **Medium** | No automated gate blocking deploys on test/smoke failure. V1 Goal 1. |
| Dispatch retry/backoff | **Medium** | No explicit retry strategy for transient Gas City failures. V1 Goal 2. |
| Webhook replay hardening | **Medium** | No replay-window / nonce dedup beyond `bead_id` idempotency. V1 Goal 3. |
| FormulaCompilation in ontology | **Low** | `FF-ONTOLOGY-v0.2.md` Compilation Transformations section missing `FormulaCompilation` entry. |
| ADR-010 RELEASE step | **Low** | ADR-010 §4 still says "Six integration points"; RELEASE callback mechanism not documented there. |
