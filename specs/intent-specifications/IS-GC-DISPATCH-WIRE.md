---
id: IS-GC-DISPATCH-WIRE
version: 3
title: "Gas City Dispatch Wiring — POST /dispatch-formula route + PipelineEnv extensions"
sourceCapabilityId: BC-GC-FORMULA-DISPATCH
sourceFunctionId: FP-GC-EP-FORMULA-DISPATCH
source_refs:
  - IS-GC-EP-FORMULA-DISPATCH
  - GOVD-GAS-CITY-PHASE1-INTEGRATION
  - BC-GC-FORMULA-DISPATCH
  - FP-GC-EP-FORMULA-DISPATCH
explicitness: explicit
rationale: >
  IS-GC-EP-FORMULA-DISPATCH specified and proved the formula compiler logic (IP-1,
  Phase 1 gate PASS). That module is a pure function tested in isolation. This IS
  specifies the wiring layer: the Worker route that exposes it, the PipelineEnv
  extension that carries Gas City secrets, and the real ArangoDB adapter that
  replaces the test mocks. No new business logic. Pure integration.

  v2 (2026-05-20): Revised after Architect + SE review. Six Architect MUSTs and
  five SE MUSTs applied. Key changes: dispatch_log collection name corrected to
  singular (matching smoke evidence); AC-D5 downgraded from stream transaction to
  two sequential saves; GAS_CITY_* fields made optional on PipelineEnv with
  fail-closed validation at route entry; AC-D9 AbortSignal.timeout removed
  (compiler already sets it); AC-D3 query shape tightened; AC-R1 default for
  factoryAttempt added; ctx.waitUntil execution model specified; OPERATOR_CONTROL_TOKEN
  auth added; wrangler.jsonc secret/var split corrected.

  v3 (2026-05-22): AC-R9 amended after Critic review. Resolved spec contradiction
  between "compiler runs async in waitUntil" and "response body contains compiler
  results." Chose synchronous model (option B): compiler awaits before response,
  ctx.waitUntil is a no-op placeholder slot. Phase 1 scope is operator-triggered
  manual dispatch; automated scale requires Workflows migration.
---

# Gas City Dispatch Wiring (IP-1 wiring)

## JTBD

When the Factory Worker receives a `POST /dispatch-formula` request carrying an
EP id, it wants to invoke the `compileAndDispatchFormula` function with real
ArangoDB deps and real Gas City HTTP connectivity, so that an EP produced by
the synthesis pipeline can be dispatched to Gas City without a human manually
running the smoke script.

## Problem

`compileAndDispatchFormula` (formula-compiler.ts) is a pure function with
injected deps. It is proven correct by 43 unit tests and one live smoke run.
It is not reachable from the deployed Worker. No route exists. No real
`FormulaCompilerDeps` adapter exists. `PipelineEnv` carries no Gas City env
vars. The factory is shipping EPs into a dead end.

## Goal

1. Add Gas City env vars as optional fields to `PipelineEnv` in `types.ts`.
2. Implement a real `FormulaCompilerDeps` adapter that reads/writes via the
   existing `@factory/arango-client` instance.
3. Add `POST /dispatch-formula` route to `index.ts` following the
   `/trigger-harness` pattern, gated on OPERATOR_CONTROL_TOKEN.
4. Add non-secret Gas City vars to `wrangler.jsonc`; list secrets in the
   existing secrets comment block.

## Scope

**In scope:**
- `src/types.ts` — PipelineEnv extension (optional fields only)
- `src/index.ts` — new route
- `src/compilers/formula-compiler-adapter.ts` — new file: real deps adapter
- `wrangler.jsonc` — non-secret var stubs + secret comment additions

**Out of scope:**
- No changes to `formula-compiler.ts` (proven, frozen)
- No changes to `formula-compiler.test.ts`
- No synthesis pipeline auto-triggering (dispatch is operator-triggered for Phase 1)
- No IP-2 / IP-3 work

## Acceptance Criteria

### Route (AC-R*)

**AC-R1.** `POST /dispatch-formula` exists on the Worker and accepts:
```
{ epId: string; factoryAttempt?: number; priorEsId?: string }
```
When `factoryAttempt` is omitted, it defaults to `1`.

**AC-R2.** Missing or empty `epId` → 400 `{ error: "epId required" }`.

**AC-R3.** EP not found in ArangoDB `execution_packets` collection → 404
`{ error: "EP not found", epId }`.

**AC-R4a.** Fresh dispatch success (`outcome: "dispatched"`, no prior durable
barrier hit) → 202 `{ accepted: true, outcome, form_id, dispatch_log_key, gc_bead_id?, gc_workflow_id? }`.

**AC-R4b.** Replay of already-dispatched EP (compiler durable barrier returns
`outcome: "dispatched"` immediately) → 200 with same body shape.
Distinguishable at the route because `compileAndDispatchFormula` returns
`outcome: "dispatched"` in both cases; use the presence of `gc_bead_id` in
the result AND elapsed time < 100ms as a heuristic, OR extend
`FormulaCompilerResult` with `replay: boolean` (see AC-R4b-impl).

**AC-R4b-impl.** Add `replay?: boolean` to `FormulaCompilerResult` in
`formula-compiler.ts`. Set `replay: true` when returning from the durable
barrier pre-check (line ~316 in formula-compiler.ts). This is the only
permitted change to `formula-compiler.ts` in this IS; it is additive and
does not break any existing test.

**AC-R5.** Compiler-controlled halt outcomes → 422 with the
`FormulaCompilerResult` body. Controlled halts are identified by the
following closed set of `error` values returned with `outcome: "failed"`:
- `"missing_coherence_vr"`
- `"unregistered_adapter"`
- `"reserved_key_collision"`
- `"resume_missing_form"`
- `"form_key_collision"`
- `"form_determinism_violation"`

All other `outcome` values (`timeout_call_1`, `timeout_call_2`,
`timeout_call_3`, `in_flight`, `rejected`, `version_mismatch`) are retryable
or informational → 202 with the result body so the caller can poll.

**AC-R6.** On uncaught exception (ArangoDB down, env var missing) → 500
`{ error: message }`.

**AC-R7.** Route is listed in the 404 fallback string.

**AC-R8.** Route requires `OPERATOR_CONTROL_TOKEN` authorization matching the
pattern used by other operator-facing routes in `index.ts` (bearer token in
`Authorization` header or `X-FF-Operator-Token`). Missing or invalid token →
401 before any ArangoDB or Gas City call.

**AC-R9.** The route awaits `compileAndDispatchFormula` synchronously and
returns the full result in the response body. `ctx.waitUntil(Promise.resolve())`
is called as a no-op placeholder — the slot is reserved for future async
post-response work (e.g., notification, telemetry) without requiring a route
signature change. The response body is pre-computed before returning (no
streaming). Phase 1 note: the compiler is I/O-bound (Gas City HTTP calls with
25s timeouts per call); CPU time is minimal. Worst-case wall-clock runtime
(CALL 1: 25s + CALL 2: 3×25s + CALL 3: 3×25s = 175s) exceeds the CF Worker
30s default; promote to Cloudflare Workflows or true fire-and-forget before
exposing to automated callers at production scale.

### PipelineEnv extension (AC-E*)

**AC-E1.** All Gas City fields are added to `PipelineEnv` as optional
(`?: string`). Exact fields:
```typescript
GAS_CITY_BASE_URL?: string
GAS_CITY_CITY_NAME?: string
GAS_CITY_BEARER_TOKEN?: string
GAS_CITY_AGENT_NAME?: string
GAS_CITY_RIG?: string
GAS_CITY_RIG_ROOT?: string
GAS_CITY_WEBHOOK_URL?: string
FACTORY_MAX_ITERATIONS?: string
GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1?: string
BUILD_GIT_SHA?: string
```
Rationale: making them required would break all existing `PipelineEnv`
test fixtures. The route handler validates presence before calling the
compiler (see AC-ENV below).

**AC-E2.** No existing `PipelineEnv` field is renamed or removed.

### Env-var validation at route entry (AC-ENV*)

**AC-ENV1.** Before calling the compiler, the route handler validates that
the following env vars are present and non-empty (empty string counts as
missing — CF wrangler.jsonc stubs write empty strings):
```
GAS_CITY_BASE_URL, GAS_CITY_CITY_NAME, GAS_CITY_BEARER_TOKEN,
GAS_CITY_AGENT_NAME, GAS_CITY_RIG, GAS_CITY_RIG_ROOT, GAS_CITY_WEBHOOK_URL
```
If any are missing/empty → 500 `{ error: "Gas City env vars not configured", missing: [...] }`.

**AC-ENV2.** `GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1` is NOT validated at
route entry. The compiler validates formula versions per-template; missing
version pin causes `version_mismatch` outcome (422, AC-R5). This is correct
behavior, not a configuration error.

**AC-ENV3.** After validation passes, the route constructs a non-optional
`FormulaCompilerEnv` via assertion. This is the value passed to the compiler.

### Real deps adapter (AC-D*)

**AC-D1.** `buildFormulaCompilerDeps(db, env)` is exported from
`formula-compiler-adapter.ts` and returns a `FormulaCompilerDeps` object.

**AC-D2.** `fetchCoherenceVR(esId)` queries `verification_reports` collection:
```aql
FOR vr IN verification_reports
  FILTER vr.kind == "coherence" AND vr.status == "passed"
  FILTER @esId IN vr.source_refs
  SORT vr.created_at DESC
  LIMIT 1
  RETURN vr
```
Returns the first row or null.

**AC-D3.** `getDispatchLogByIdempotencyKey(idempotencyKey, factoryAttempt, excludeKey?)`:
```aql
FOR dl IN dispatch_log
  FILTER dl.idempotency_key == @idempotencyKey
    AND dl.factory_attempt == @factoryAttempt
    AND (@excludeKey == null OR dl._key != @excludeKey)
  SORT dl.started_at DESC
  LIMIT 1
  RETURN dl
```
Returns the first matching row or null. Note: the adapter returns the raw
row; the compiler applies additional `gc_bead_id` / `gc_workflow_id` /
`outcome` filters at each call site — do NOT filter on those in the adapter.

**AC-D4.** `getFormulaByKey(key)` reads `formulas` collection by `_key` via
`db.get("formulas", key)`. Returns null if not found.

**AC-D5.** `writeFormAndDispatchLog(form, dispatchLog)` does two sequential
`db.save()` calls:
1. `db.save("formulas", form)` — writes FORM-* artifact.
2. `db.save("dispatch_log", dispatchLog)` — writes the dispatch log row.

This matches the smoke-proven pattern. There is no stream transaction (the
`@factory/arango-client` package has no transaction primitive). On partial
failure (save 1 succeeds, save 2 throws), the dispatch log row is absent;
the compiler's idempotency re-entry on the next call will detect the existing
FORM-* via AC-D4 and proceed correctly (AC-24 resume path). The adapter MUST
NOT swallow errors from either save — propagate both.

On ArangoDB 409 (duplicate `_key`) from either save, the error is propagated
so the compiler's `try/catch` at line ~503 can return `outcome: "failed"`.

**AC-D6.** `updateFormulaVersion(formKey, version)` patches `formulas/{formKey}`
via `db.update("formulas", formKey, { formula_version: version })`.

**AC-D7.** `updateDispatchLog(key, patch)` patches `dispatch_log/{key}` via
`db.update("dispatch_log", key, patch)`.

**AC-D8.** `emitUncertaintyEntry(entry)` inserts into `uncertainty_entries`
collection via `db.save("uncertainty_entries", entry)`. Best-effort: if save
throws, log with `console.warn("[UNCERTAINTY_EMIT_FAILED]")` and swallow.
`uncertainty_entries` is a new collection; the adapter should call
`db.ensureCollection("uncertainty_entries")` on first use or document that
the collection must be created manually.

**AC-D9.** `httpFetch(url, init?)` delegates to `globalThis.fetch(url, init)`
unchanged. The adapter does NOT add headers, does NOT add `AbortSignal.timeout`
(the compiler already sets `signal: AbortSignal.timeout(25_000)` on every
call). Rationale: the smoke script's `httpFetch` is `(url, init) => fetch(url, init)`.

**AC-D10.** `now()` returns `new Date().toISOString()`.

**AC-D11.** `sleep(ms)` returns `new Promise(resolve => setTimeout(resolve, ms))`.

**AC-D-FAIL-1.** If `db.save` on the FORM-* write (first save in AC-D5) throws
for any reason, the adapter propagates the error. The dispatch_log write does
NOT fire.

**AC-D-FAIL-2.** If `db.save` on the dispatch_log write (second save in AC-D5)
throws, the adapter propagates. The already-written FORM-* row remains; the
compiler's idempotency resume path handles cleanup on next invocation.

### wrangler.jsonc (AC-W*)

**AC-W1.** Add the following non-secret vars to the `vars` block in
`wrangler.jsonc`:
```json
"FACTORY_MAX_ITERATIONS": "5",
"BUILD_GIT_SHA": ""
```
`BUILD_GIT_SHA` is populated at deploy time via `wrangler deploy --var BUILD_GIT_SHA:$(git rev-parse HEAD)` in the CI deploy step. Empty string is the safe default for local dev.

**AC-W2.** Add to the secrets comment block at the bottom of `wrangler.jsonc`
(matching the existing `// Secrets (set via wrangler secret put): ...` pattern):
```
GAS_CITY_BASE_URL, GAS_CITY_CITY_NAME, GAS_CITY_BEARER_TOKEN,
GAS_CITY_AGENT_NAME, GAS_CITY_RIG, GAS_CITY_RIG_ROOT,
GAS_CITY_WEBHOOK_URL, GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1
```

**AC-W3.** No existing `wrangler.jsonc` vars are removed or renamed.

### Tests (AC-T*)

**AC-T1.** `src/compilers/formula-compiler-adapter.test.ts` tests
`buildFormulaCompilerDeps` with a mock `@factory/arango-client` instance.
Covers:
- AC-D2 query shape (AQL string contains correct FILTER and SORT clauses)
- AC-D3 query shape and excludeKey filtering
- AC-D5 sequential saves + error propagation (AC-D-FAIL-1 and AC-D-FAIL-2)
- AC-D8 best-effort swallow on uncertainty_entries save failure

**AC-T2.** `src/dispatch-formula-route.test.ts` tests the route handler with a
mock `compileAndDispatchFormula` function (no live compiler). Covers:
- AC-R1: epId present, factoryAttempt default=1
- AC-R2: missing epId → 400
- AC-R3: EP not found → 404
- AC-R4a: fresh dispatch → 202
- AC-R4b: replay → 200 (mocked compiler returns `replay: true`)
- AC-R5: each halt error code → 422
- AC-R6: uncaught exception → 500
- AC-R7: not tested (string check, not needed)
- AC-R8: missing/invalid token → 401
- AC-ENV1: missing env var → 500 with `missing` list

**AC-T3.** All existing tests continue to pass (`npx vitest run`).

## Collection names (smoke-confirmed)

## Success Metrics

The `POST /dispatch-formula` route is reachable in the Worker, rejects unauthorized or malformed requests before side effects, validates required Gas City environment configuration before constructing compiler dependencies, and returns status codes matching the closed outcome mapping in the acceptance criteria.

The real ArangoDB adapter preserves the proven formula compiler behavior: FORM-* lookup, FORM-* write, `dispatch_log` write/update, Coherence Verification lookup, and best-effort UncertaintyEntry emission all use the documented collection names.

The route wiring preserves IP-1 scope boundaries: no synthesis auto-triggering, no IP-2/IP-3 event bridge behavior, no LLM calls, and no changes to frozen formula compiler semantics beyond the additive replay marker required by this Intent Specification.

All route, adapter, and existing ff-pipeline tests pass, and the deployed Worker exposes enough structured response data for an operator to confirm FORM-* identity, dispatch log identity, and Gas City Bead/workflow identity.

| Purpose | Collection | Status |
|---------|-----------|--------|
| Coherence VRs | `verification_reports` | Smoke-confirmed |
| FORM-* artifacts | `formulas` | Smoke-confirmed |
| Dispatch log | `dispatch_log` | Smoke-confirmed (singular) |
| Uncertainty entries | `uncertainty_entries` | New — create if absent |

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `GAS_CITY_BASE_URL` | secret | Gas City HTTP API base URL |
| `GAS_CITY_CITY_NAME` | secret | City name (e.g. `phase0-city`) |
| `GAS_CITY_BEARER_TOKEN` | secret | Auth bearer token |
| `GAS_CITY_AGENT_NAME` | secret | Agent name for formula scope |
| `GAS_CITY_RIG` | secret | Rig ref |
| `GAS_CITY_RIG_ROOT` | secret | Rig filesystem root |
| `GAS_CITY_WEBHOOK_URL` | secret | Factory callback URL for RELEASE step (IP-2) |
| `GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1` | secret | Pinned formula version |
| `FACTORY_MAX_ITERATIONS` | var (default "5") | Max convergence iterations |
| `BUILD_GIT_SHA` | var (set at deploy via --var) | Stamped into FORM-*.compiler |

## Non-negotiables

- `formula-compiler.ts` is NOT modified except for the additive `replay?: boolean` field on `FormulaCompilerResult` (AC-R4b-impl).
- No LLM calls in the route handler or adapter.
- Fail closed: missing/empty env var → 500 before any Gas City call (AC-ENV1).
- The adapter MUST NOT swallow ArangoDB errors except `emitUncertaintyEntry` (AC-D8).
- `ctx.waitUntil()` is mandatory — do not block the response on compiler completion (AC-R9).
