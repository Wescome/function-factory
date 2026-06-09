# Gas City Dispatch Architecture — Discussion Document

**Author:** GUV / Wislet J. Celestin  
**Date:** 2026-06-01  
**Status:** Draft — pending Architect/SE path proposals  
**Purpose:** Establish the two dispatch paths: production-today and future-scale

---

## 1. Current State

### 1.1 What works

The full molecule lifecycle is confirmed working end-to-end:

```
ff-pipeline Worker (stateless)
  → CALL 1: formula version probe
  → CALL 2: POST /beads → FactoryStore DO (SQLite)
  → CALL 3: POST /sling → Container picks up molecule
    → Plan → Code → Verify → Release
    → HMAC webhook → Fidelity Verification → outcome: approved
```

Smoke test passes. DO bead store live. ArangoDB artifacts untouched.

### 1.2 Current topology

```
ff-pipeline Worker (stateless, scales freely)
  → singleton-v28 DO  (1 instance, pinned by name)
    → GasCitySupervisor Container  (standard-1, max_instances=1)
      → control-dispatcher  (min=max=1, single serialized drain)
      → coder agent  (noop provider, max_active_sessions=3)
        → pi-rpc → ff-pipeline (AI reasoning via ofox.ai)
  → FactoryStore DO  (1 SQLite instance, name="factory")
  → ff-arango Container  (ArangoDB artifacts, shared)
```

### 1.3 Current concurrency ceiling

**~3 concurrent molecules. Roughly 3 repos.**

The binding constraints:
- One DO → one Container (max_instances=1)
- One control-dispatcher (min=max=1) serializes all bead draining
- Three coder sessions share one Container filesystem and one bead namespace
- FactoryStore SQLite queues concurrent writes — correct but serialized

### 1.4 Known bugs blocking even current ceiling

**BUG-1 — Keepalive race under concurrency**  
`webhook-receiver.ts` fires `POST /keepalive/stop` when ANY molecule's HMAC callback arrives. Keepalive is a single Container-wide boolean. With 3 concurrent molecules, the first to complete un-pins the Container for all. Molecules B and C can lose their keepalive mid-flight.  
Fix: refcount (increment on CALL 3, decrement on terminal webhook, clear at zero).

**BUG-2 — `/seed-dispatch-ep` is a bootstrap fixture, not a production seeder**  
Hardcodes `IS/ES-GC-DISPATCH-WIRE` IDs. Mints a synthetic `passed` coherence VR — bypassing real Coherence Verification. Not acceptable for real Functions.  
Fix: production EP seeding contract with real IS/ES bodies and true coherence VRs.

---

## 2. What Steady-State Dispatch Should Look Like

### 2.1 Three phases (currently conflated in `first-dispatch.sh`)

| Phase | Cadence | What it does |
|---|---|---|
| **Setup** | Once / on secret or code change | Token rotation, deploy, singleton bump, Container pre-warm |
| **Seed** | Once per Function | IS + ES → epId (must produce real coherence VR) |
| **Dispatch** | Every job | `POST /dispatch-formula {epId}` — nothing else |

### 2.2 Correct warm dispatch sequence

Container already running, tokens stable:

```bash
# 1. Health probe (fast)
GET /v0/city/factory/health → status: ok

# 2. Seed (once per Function — not per job)
POST /seed-dispatch-ep {fnId, isId, esId, isBody, esBody}
→ epId: EP-XXXXXX

# 3. Dispatch (every job)
POST /dispatch-formula {epId, factoryAttempt: 1}
→ outcome: dispatched, gc_bead_id, trace_id

# 4. Monitor (async)
watch-run.mjs <epId>  →  Plan → Code → Verify → Release → approved
```

No singleton rotation. No deploy. No token churn.

---

## 3. The Scale Problem

### 3.1 Why `max_active_sessions = 3` is not the real constraint

Raising the session count oversubscribes one `standard-1` Container. The real unit of scale is the **DO+Container pair**, not the session count inside one Container. More sessions per Container = more contention on one dispatcher, one filesystem, one bead namespace.

### 3.2 The keystone architectural fact

The bead store is **already sharded by city name**:
```typescript
// index.ts:170
env.FACTORY_STORE.idFromName(city)  // city = "factory" today
```

The Container is **not** sharded — everything pins to `idFromName("singleton-v28")`.

The path to dozens of repos = replace the singleton with a city-keyed namespace + raise `max_instances`.

### 3.3 Concurrency model options

**Option A — City-per-repo**  
Each repo gets its own city name → own DO → own Container → own dispatcher → own bead store.  
Full isolation. Clean blast radius. Scales by adding cities.  
Cost: one warm Container per active repo.

**Option B — City-per-team**  
Related repos share one city. Lighter Container cost, but shared dispatcher and bead namespace across repos in the same team.  
Less isolation. More complex blast radius.

**Option C — Queue-gated pool**  
Cap concurrent cities (e.g. 8–12). Excess jobs queue in a CF Queue, consumed by ff-pipeline when a city slot opens.  
Trades latency for Container cost control. Protects against cold-start storms and ofox.ai rate limits.

---

## 4. Open Decisions (Architecture Gates)

| # | Decision | Options | Gate |
|---|---|---|---|
| D1 | Sharding unit | City-per-repo vs city-per-team | Wes |
| D2 | Container pool model | Eager vs queue-gated | Wes |
| D3 | Production EP seeding contract | Synthesis-generated vs manual `seed.sh` | Wes |
| D4 | Keepalive refcount | Spec + implement BUG-1 fix | Architect + SE → Engineer |
| D5 | ff-arango HA | Defer vs invest now | Wes |

---

## 5. Adjacent Constraints

- **ofox.ai concurrency** — ff-pipeline doubles as the `pi-rpc` AI provider. Dozens of concurrent molecules = dozens of concurrent model calls. ofox.ai rate limits are the upstream ceiling, not Worker capacity.
- **WP-OBS gate** — observability (WP-OBS-1–4) is a hard gate before any new domain adapter goes to production. Per-step telemetry was reverted (gc binary pre-OBS-3/4). This must be resolved before domain expansion.
- **Formula version coupling** — `GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1 = "3"` is pinned in `wrangler.jsonc`. A Container redeploy changing formula version requires redeploying ff-pipeline. Operational coupling to document.

---

## 6. Proposed Work (pending path decision)

### Path A — Production Today

**Goal:** Real Functions dispatching against the single-Container topology. Accept ~3 concurrent molecules as a known ceiling. No architectural changes.

**Engineering work required: 1 session**

#### A.1 — Fix BUG-1: Keepalive refcount

All changes in `workers/gascity-supervisor/src/index.ts`.

Current boolean storage key `"keepalive_active"` at lines 29, 38, 45, 52. Replace with integer counter `"keepalive_refcount"`:

| Handler | Current | Change |
|---|---|---|
| `onActivityExpired()` line 29 | read boolean → renew if truthy | read int → renew if `> 0` |
| `onStop()` line 38 | `delete("keepalive_active")` | `delete("keepalive_refcount")` |
| `POST /keepalive/start` line 45 | `put("keepalive_active", true)` | read + `put(counter + 1)`, then `renewActivityTimeout()` |
| `POST /keepalive/stop` line 52 | `delete("keepalive_active")` | read + `put(Math.max(0, counter - 1))`. If result `> 0`, still call `renewActivityTimeout()` — remaining molecules stay pinned. |

**Increment point:** `formula-compiler.ts:1118` (fire-and-forget POST to `/v0/keepalive/start` after CALL 3 success) — no change needed, already fires per dispatch.

**Decrement point:** `webhook-receiver.ts:236` (fire-and-forget POST to `/v0/keepalive/stop` on every terminal webhook) — no change needed, already fires per molecule completion.

**Duplicate webhook safety:** `webhook-receiver.ts:102-106` already deduplicates on `bead_id` and returns early before reaching line 236. Over-decrement from retried webhooks is not a risk.

**Risk:** Under-decrement if a molecule crashes without firing its terminal webhook → counter never reaches 0 → Container billed indefinitely. Backstop: `sleepAfter = "30m"` at `index.ts:6` is a hard DO idle limit; the refcount only blocks `onActivityExpired`, it does not override the platform's sleep ceiling.

---

#### A.2 — Fix BUG-2: Production EP seeding contract

Current synthetic VR at `workers/ff-pipeline/src/index.ts:2166-2178`:
```
kind: 'coherence', status: 'passed', notes: 'seeded by /seed-dispatch-ep for bootstrap dispatch'
```
This satisfies the dispatch gate at `formula-compiler.ts:433` (AQL: `vr.kind == "coherence" AND vr.status == "passed"` via `formula-compiler-adapter.ts:22`) with a fake verdict.

**Fix — two-part:**
1. **Env-gate the synthetic path immediately:** wrap lines 2166-2178 in `if (env.ENVIRONMENT !== 'production')`. This closes the trust hole without requiring the real CoV implementation to be ready.
2. **Real seeding contract (follow-up work):** replace the synthetic VR with an actual Coherence Verification pass. On failure, return the failed VR and refuse to dispatch — per AGENTS.md rule 6. Also fix the ES hash placeholder at line 2144 (`sha256-seed-${runId}` → real SHA-256 of ES body) and the `Seed*` kind markers at lines 2158/2197/2213 → production kinds (`IntentSpecification`, `ExecutableSpecification`, `Function`).

**Open flag:** The real CoV entry point is not yet located in the codebase. Must be identified before the full BUG-2 fix can be specced for an Engineer.

---

#### A.3 — Script split

Split `first-dispatch.sh` (267 lines) into three scripts by cadence:

| Script | Lines from first-dispatch.sh | Tokens needed |
|---|---|---|
| `setup.sh` | 26–149 (token gen, 6× secret put, ff-pipeline deploy, singleton rotation, supervisor deploy, Container pre-warm) | Writes all tokens to `/tmp/` |
| `seed.sh <IS> <ES>` | 151–178 (IS/ES read, seed payload, POST /seed-dispatch-ep, extract epId) | Reads `OPERATOR_TOKEN` from `/tmp/gc_token.txt`; writes `epId` to `/tmp/gc_ep_id.txt` |
| `dispatch.sh <epId>` | 180–205 (POST /dispatch-formula, parse outcome) | Reads `OPERATOR_TOKEN` from `/tmp/gc_token.txt` |

**Gap:** `GC_HMAC_SECRET` and `GC_BEARER_TOKEN` are generated in first-dispatch.sh but never written to disk (only `/tmp/gc_supervisor_token.txt` and `/tmp/gc_token.txt` are persisted, lines 32–33). `smoke-test.sh` can't access the HMAC secret and skips the webhook bridge step. `setup.sh` must also write these two secrets to disk.

Lines 207–267 (RELEASE webhook exercise + autonomy monitor) are smoke-test scaffolding — move to `smoke-test.sh` only, not into `dispatch.sh`.

---

#### A.4 — What dispatching a real Function looks like with Path A

```bash
# One time (or on secret/code change):
bash scripts/ops/setup.sh

# Once per real Function (IS + ES must exist):
bash scripts/ops/seed.sh specs/intent-specifications/IS-MY-FEATURE.md \
                         specs/executable-specifications/ES-MY-FEATURE.yaml
# → writes EP-XXXXXX to /tmp/gc_ep_id.txt

# Every job:
bash scripts/ops/dispatch.sh EP-XXXXXX
# → outcome: dispatched, bead: do-XXXX, trace_id: ...
```

Container stays running. No token rotation. No singleton bump. No deploy.

---

### Path B — Future Scale (Dozens of Repos)

**Goal:** City-per-repo sharding. Each repo gets its own Container, dispatcher, and bead store. Queue-gated to cap concurrent cold starts and ofox.ai load.

**Prerequisite:** Path A complete + WP-OBS-3/4 telemetry restored (observability gate).

**Engineering work: multiple sessions. Architecture gate must be cleared first.**

---

#### B.1 — Keystone change: city-keyed Container routing

**File:** `workers/gascity-supervisor/src/index.ts:186`

Current:
```typescript
const id = env.SUPERVISOR.idFromName("singleton-v28");
```

Change to:
```typescript
const m = url.pathname.match(/^\/v0\/city\/([^/]+)\//);
const cityName = m?.[1] ?? "factory";
const id = env.SUPERVISOR.idFromName(`city:${cityName}:v28`);
```

This mirrors the already-working bead store sharding pattern at `index.ts:170` (`FACTORY_STORE.idFromName(city)`). Default `"factory"` keeps existing traffic working.

**Note on singleton rotation:** The rotation script greps `singleton-v[0-9]*`. With the new key shape `city:factory:v28`, the grep pattern must be updated to match `city:${cityName}:v[0-9]*`.

---

#### B.2 — `max_instances`

**File:** `workers/gascity-supervisor/wrangler.jsonc:12`

Current: `"max_instances": 1`  
Change to: `"max_instances": 12` (starting cap — 8-12 concurrent cities)

---

#### B.3 — Per-request city threading (HARD — architecture gate)

`GAS_CITY_CITY_NAME` is currently a static env var in `ff-pipeline/wrangler.jsonc:113` (`"factory"`). For per-repo dispatch it must become per-request.

Changes required:
- Add `cityName` to the dispatch request body in `handleDispatchFormula` (`ff-pipeline/src/index.ts:2010`)
- Thread it through `FormulaCompilerEnv` type (`formula-compiler.ts:40-46`)
- `gasCityUrl()` (`formula-compiler.ts:1311-1316`) already reads from env — must read from the per-request value instead

**Open architecture gate:** The DO constructor (`index.ts:11-25`) has no request context, so `GC_BEAD_STORE_URL` (line 17) is hardcoded to `"...bead-store/factory"`. Each city's Container must know its own city name at boot to build the right bead-store URL. How the city name reaches the constructor is an unresolved architectural question — options are: (a) derive from the DO's own name at first request, (b) pass it in a one-time `/init` call before first molecule, (c) template the URL in the Container start command. **This must be resolved before any Path B code is written.**

Also needs updating: `city.toml:2` (`name = "factory"` baked into Container image — needs per-city templating or a generic name).

---

#### B.4 — Queue-gated dispatch

**Producer:** `ff-pipeline/src/index.ts` in `handleDispatchFormula` (line 2010). When active city count is at ceiling, enqueue `{epId, factoryAttempt, cityName}` to a new `dispatch-queue` rather than dispatching immediately.

**Consumer:** New branch in the existing ff-pipeline queue handler (`index.ts:1421`, alongside `telemetry-queue` and `harness-queue`). Calls `compileAndDispatchFormula` when a slot frees.

**Slot-freed signal:** `webhook-receiver.ts:236` (terminal webhook / keepalive/stop) is where a "city slot released" enqueue goes.

**Note:** ff-pipeline queue bindings must be confirmed in `wrangler.jsonc` before any queue work is specced.

---

#### B.5 — Sequencing (non-negotiable)

```
Path A complete (BUG-1 + BUG-2 + script split)
  ↓
WP-OBS-3/4 restored (telemetry gate)
  ↓
Architecture gate: DO constructor city-context problem resolved
  ↓
city threading (B.3)
  ↓
idFromName keystone + max_instances (B.1 + B.2)
  ↓
Queue-gated dispatch (B.4)
  ↓
Production test: 12 concurrent repos
```

Never raise `max_instances` before the city threading is complete. A higher cap on a singleton is just resource waste, not scale.

---

## 7. Open Flags (SE / Architect must resolve before Engineer hand-off)

| # | Flag | Blocks |
|---|---|---|
| F1 | Real CoV entry point not located in codebase | BUG-2 full fix |
| F2 | GC_HMAC_SECRET + GC_BEARER_TOKEN not written to disk in script split | smoke-test.sh webhook bridge step |
| F3 | DO constructor has no request context — city-specific bead-store URL unresolved | All of Path B |
| F4 | GAS_CITY_CITY_NAME is a static env var — must become per-request | Path B city threading |
| F5 | ff-pipeline wrangler.jsonc queue bindings not confirmed | Path B queue gate |
