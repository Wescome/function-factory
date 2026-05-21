---
id: IS-GC-EP-FORMULA-DISPATCH
version: 2
sourceCapabilityId: BC-GC-FORMULA-DISPATCH
sourceFunctionId: FP-GC-EP-FORMULA-DISPATCH
title: "Gas City Formula Compiler and Dispatch (IP-1)"
source_refs:
  - GOVD-GAS-CITY-PHASE1-INTEGRATION
  - ADR-010-gas-city-supersedes-nlah
  - ARCHITECTURE-ROADMAP-GAS-CITY-FACTORY
  - EXECUTION-PACKET
  - SE-Onto-Draft-1.1
explicitness: explicit
rationale: >
  Specifies the FormulaCompilation transformation (D-NEW-2 approved 2026-05-20)
  and the Factory→Gas City dispatch sequence (D-Q1C approved 2026-05-21).
  Covers Integration Point 1 (IP-1) of the Factory+Gas City architecture:
  Execution Packet → FormulaInstance (FORM-*) → Gas City dispatch via 3-call
  HTTP sequence → Bead with lineage labels confirmed.
  UncertaintyEntries UE-Q1C-1 through UE-Q1C-4 resolved from Gas City source
  2026-05-21 before this IS was authored. All acceptance criteria are grounded
  in confirmed Gas City API behavior, not assumed.
  V2 (2026-05-21): Six Architect MUST fixes + six SE MUST fixes applied.
  Two governance terms resolved: formula_version (not formula_version_hash —
  matches GC GET response field directly); parameters_json blob (not per-key
  flattening — decouples template from EP parameter schema). EP artifact ID
  transition note added. Elucidation record EL-D-Q1C-FORMULA-VERSION filed
  inline per GOVD-GAS-CITY-PHASE1-INTEGRATION D-Q1C.
---

# Gas City Formula Compiler and Dispatch (IP-1)

## JTBD

When Factory has compiled an Execution Packet (EP-*) for a Function whose
Coherence Verification has passed, Factory wants to compile the EP into a
parametric Gas City Formula instance (FORM-*) and dispatch it to Gas City,
so that Gas City can execute the specification and produce evidence for
Factory's Fidelity Verification.

## Problem

Factory governs specifications (IS → ES → EP) and Gas City executes them
(Formula → Molecule → VERIFY). Between these two systems there is no existing
bridge. After an Execution Packet is produced, it sits in Factory with nowhere
to go. Gas City cannot read ArangoDB. Factory cannot invoke Gas City.

Without this function:
- No EP ever reaches execution.
- No molecule.completed event ever fires.
- No Fidelity Verification ever runs.
- No Function ever exits the `designed` lifecycle state.

This function is the sole integration boundary between Factory governance and
Gas City execution. It is load-bearing for every downstream phase.

A secondary problem: Gas City's Formula TOML schema was confirmed (from source)
to have no HTTP upload endpoint. Formulas are filesystem-resident. A naive
design that compiled a unique per-ES TOML and attempted to POST it to Gas City
would not work. The function must accommodate this constraint without violating
the "zero Gas City contributions in Phase 1" rule and without requiring
non-HTTP transports unavailable in CF Workers.

## Goal

Implement a deterministic, LLM-free function that:

1. Takes a valid Execution Packet (EP-*) as input.
2. Performs a Coherence VR pre-check (AC-0).
3. Produces a FormulaInstance — a parametric specification comprising
   `(template_name, formula_version, vars, parameters_json)` — and persists
   it as a FORM-* artifact in ArangoDB with full lineage.
4. Writes a `dispatch_log` record to ArangoDB in the same stream transaction
   as FORM-* (AC-23).
5. Dispatches the FormulaInstance to Gas City via exactly three sequential
   HTTP calls: version probe → Bead create (with five lineage labels) →
   sling attach.
6. Updates the dispatch_log record with the outcome.

The function makes zero LLM calls. It reads the Execution Packet only (D1).
It calls Gas City once at dispatch time and waits for the RELEASE step
callback (D4 / SE Ontology §7).

## Constraints

### Ontology constraints

**FormulaCompilation is a registered Compilation Transformation (D-NEW-2).**
The transformation is procedural→procedural: Execution Packet (procedural
tier) → FormulaInstance (procedural tier, Gas City substrate format). The
transformation emits exactly one lineage edge: `compiled_from: EP-ID`.

**FORM-* is a parametric specification, not raw TOML (D-Q1C amendment).**
The FORM-* artifact captures `(template_name, formula_version, vars,
parameters_json)`. The TOML substrate is operator-managed config on the Gas
City host. FORM-* is the Factory's record of exactly what it told Gas City to
do and with which prompts. Raw TOML is not stored in Factory.

**EP-only input (D1).** The Formula compiler reads the Execution Packet and
no other upstream artifact. It does not re-read the Intent Specification,
Executable Specification, or ArchitectureCandidate at compile time.

**Pre-dispatch Coherence VR is a precondition.** Coherence VR must have
passed on the source ES before the EP was produced. See AC-0 for the lookup
contract.

### Platform constraints

**CF Worker context.** This function runs inside a Cloudflare Worker. It
has no filesystem access and no SSH client. All outbound calls to Gas City
are HTTP. Per-call timeout: 25 seconds (leaving CPU/response headroom within
the 30-second CF subrequest limit). Total sequential budget: ~75s for three
calls plus DB writes.

**Zero Gas City contributions in Phase 1 (ADR-010 §5).** No new Go code is
contributed to the Gas City repository. The function must work with Gas City's
existing HTTP API surface as confirmed from source.

**HTTP only — no shared storage (ARCHITECTURE-ROADMAP §1.2).** ArangoDB and
Dolt are never cross-written. This function writes to ArangoDB only. It never
writes to Dolt.

**EP artifact ID transition.** The canonical EP prefix is `EP-*` per
EXECUTION-PACKET.md and AGENTS.md. The current codebase schema
(`trellis-execution-packet.ts`) still uses `TEP-*`. Phase 1 build depends on
the EP-* rename landing in `@factory/schemas`. Until then, the Engineer must
accept both prefixes during transition and treat them as equivalent.

### Parametric template model (D-Q1C)

Each domain adapter has one canonical Formula template deployed to Gas City's
`formulas/` directory at city-init by the operator. The template name for the
coding domain adapter is `factory-coding-v1`. Templates are versioned by a
`version` field in the TOML that the function checks at dispatch time.

**Template selection.** The function selects the template name from a
deterministic mapping keyed on `EP.adapter.adapterId`:

| adapterId | template_name |
|-----------|--------------|
| `adapter.coding` | `factory-coding-v1` |

If no template is registered for the adapter ID, the function emits an
UncertaintyEntry and halts.

**Step-level lineage labels.** Labels do NOT propagate from the root Bead to
molecule-internal child Beads in Gas City (confirmed from source:
`molecule.go stepToBead` — labels come exclusively from the recipe step
definition). Therefore, the Formula template for each domain adapter MUST
declare lineage labels on every `[[steps]]` block:

```toml
[[steps]]
id = "seed"
labels = ["fn-id:{fn_id}", "is-id:{is_id}", "es-id:{es_id}", "form-id:{form_id}", "factory-attempt:{factory_attempt}"]
```

The Formula compiler does not verify step-level label declarations — this is
a template authorship invariant enforced at city-init by the operator.

### Auth constraints (D8)

All calls from Factory to Gas City carry `Authorization: Bearer <token>` from
the `GAS_CITY_BEARER_TOKEN` Worker secret. The HMAC secret for the GC→Factory
RELEASE step callback (`GAS_CITY_HMAC_SECRET`) is stored on the Gas City host
only — it is never sent from Factory to Gas City over the wire. The keyid
`"v1"` is the bootstrap value; key rotation is IP-4's concern.

### Idempotency constraints (UE-Q1C-4 resolution)

Gas City's sling endpoint does NOT support `Idempotency-Key` (confirmed from
source: `SlingInput` struct has no idempotency header; only `/beads` and
`/mail` do). The idempotency model is three-layer:

- **Durable barrier (dispatch_log):** Before CALL 1, the function checks
  ArangoDB `dispatch_log` for a row matching the idempotency key. If a
  `dispatched` row exists, the function returns early. If a `pending` row
  exists with non-null `gc_bead_id` and null `gc_workflow_id`, the function
  resumes at CALL 3 (see AC-24).
- **Primary barrier (CALL 2):** Bead create carries
  `Idempotency-Key: sha256(es_id + "|" + EP.instructionTuning.inputExecutableSpecificationHash + "|" + factory_attempt)`.
  Gas City dedupes within TTL. If the bead already exists, CALL 2 returns the
  existing bead ID.
- **Secondary barrier (CALL 3):** If the root bead already has a workflow
  attached, Gas City returns HTTP 409. The function treats 409 with a matching
  `workflow_id` (from the existing dispatch_log row) as success-on-replay.

ArangoDB `dispatch_log` must have a unique index on
`(idempotency_key, factory_attempt)` to prevent parallel-dispatch races
(see AC-21).

### Determinism constraint

Identical Execution Packet content (same EP-* with same field values) must
produce identical FORM-* content (same `vars`, same `parameters_json`, same
`template_name`). Determinism is load-bearing for FORM-* content-hash
stability and for Fidelity Verification's evidence-completeness check. No
randomness. No timestamps in the compiled output.

### Governance term elucidation

D-Q1C dispatch_flow referenced `formula_version_hash` (a content hash of the
on-disk template). This IS uses `formula_version` (the semantic version string
returned by `GET /v0/city/{name}/formulas/{name}` in the `version` field).
These are not the same field. Gas City's GET endpoint returns a structured
response with no raw TOML and no hash — only the declared `version` string
(UE-Q1C-1 confirmed). Therefore `formula_version` is the implementable term.
The D-Q1C GOVD entry should be amended via Elucidation Artifact to replace
`formula_version_hash` with `formula_version` everywhere.

## Environment dependencies

All must be present in `wrangler.toml` (secrets via `wrangler secret put`):

| Name | Kind | Description |
|------|------|-------------|
| `GAS_CITY_BASE_URL` | var | Base URL of the Gas City HTTP API, no trailing slash (e.g. `http://localhost:8372` local, VPS URL in production) |
| `GAS_CITY_CITY_NAME` | var | Name of the Gas City city (e.g. `phase0-city`) |
| `GAS_CITY_BEARER_TOKEN` | secret | Bearer token for Factory→GC auth (D8) |
| `GAS_CITY_AGENT_NAME` | var | Target agent name for sling |
| `GAS_CITY_RIG` | var | Rig name for sling scope |
| `GAS_CITY_RIG_ROOT` | var | Working directory root path for the rig |
| `GAS_CITY_WEBHOOK_URL` | var | URL Gas City RELEASE step POSTs to (IP-4 handler) |
| `GAS_CITY_FORMULA_VERSION_{TEMPLATE}` | var | Pinned expected version for template. Derivation: `template_name.toUpperCase().replace(/-/g, '_')` prepended with `GAS_CITY_FORMULA_VERSION_`. For `factory-coding-v1`: `GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1`. |
| `FACTORY_MAX_ITERATIONS` | var | Default `"5"`. Passed to template as `max_iterations`. |
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_DB` | var | ArangoDB database name |
| `ARANGO_USER` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |

Note: Factory never holds `GAS_CITY_HMAC_SECRET`. That secret lives on the
Gas City host only and is used to sign GC→Factory webhook payloads.

## Storage dependencies

| Collection | Required indexes | Notes |
|------------|-----------------|-------|
| `formulas` | unique on `_key` | FORM-* artifacts |
| `dispatch_log` | unique on `(idempotency_key, factory_attempt)` | See AC-21 |
| `verification_reports` | index on `(source_refs, kind, status)` | Read by AC-0 |

## Execution sequence

The function executes in this order. Each step references the governing AC:

1. **Coherence VR check** (AC-0) — query `verification_reports`, halt if absent.
2. **Idempotency pre-check** (§Idempotency durable barrier) — query `dispatch_log`.
   If `dispatched` → return early. If `pending` with `gc_bead_id` set → jump to step 7.
3. **Template selection** (AC-1) — resolve template name from adapter ID, halt if unregistered.
4. **Var map construction** (AC-2, AC-3) — build deterministic var map from EP fields.
5. **FORM-* + dispatch_log stream transaction** (AC-5, AC-8, AC-22, AC-23):
   - Assign FORM-* key (AC-6).
   - Write FORM-* with `formula_version: "pending"` placeholder.
   - Write `dispatch_log` with `outcome: "pending"`.
   - Both writes in a single ArangoDB stream transaction. Abort on any failure.
6. **CALL 1 — Version probe** (AC-10) — GET formula, verify version, update FORM-* `formula_version` (AC-11).
7. **CALL 2 — Bead create** (AC-12, AC-13, AC-14) — POST /beads with 5 labels + Idempotency-Key.
8. **CALL 3 — Sling attach** (AC-15, AC-16, AC-17, AC-18) — POST /sling with full var map.
9. **dispatch_log update** (AC-9) — set `outcome: "dispatched"` (or failure outcome).

## Acceptance criteria

**AC-0 — Coherence VR precondition**

Before any other work, the function queries ArangoDB collection
`verification_reports` for a document where:
- `source_refs` array contains `EP.executableSpecificationId`, AND
- `kind == "coherence"`, AND
- `status == "passed"`.

The function selects the most recent such document (sorted descending by
`created_at`). If zero results are found, the function emits an
UncertaintyEntry with `blocking_for: ["dispatch"]` and halts without writing
FORM-* or dispatch_log.

**Compilation**

**AC-1** — Given an EP with `EP.adapter.adapterId == "adapter.coding"`, the
function selects template `factory-coding-v1`. Given an EP with an
unregistered adapter ID, the function emits an UncertaintyEntry with
`blocking_for: ["FORM-* creation"]` and halts without writing any FORM-* or
dispatch_log record.

**AC-2** — The function constructs the var map with the following fields
(all values are strings; non-string EP values are `JSON.stringify`-encoded):

| Var name | Source |
|----------|--------|
| `fn_id` | `EP.functionId` |
| `is_id` | `EP.intentSpecificationId` |
| `es_id` | `EP.executableSpecificationId` |
| `ep_id` | `EP.id` |
| `form_id` | FORM-* `_key` (assigned before var construction) |
| `factory_attempt` | dispatch attempt counter, stringified decimal, no leading zeros (e.g. `"1"`) |
| `ff_webhook_url` | `GAS_CITY_WEBHOOK_URL` env var |
| `ff_webhook_hmac_keyid` | literal `"v1"` |
| `rig_root` | `GAS_CITY_RIG_ROOT` env var |
| `max_iterations` | `FACTORY_MAX_ITERATIONS` env var (default `"5"`) |
| `parameters_json` | `JSON.stringify(EP.adapter.executionRequest.parameters)` |

Reserved var names (`fn_id`, `is_id`, `es_id`, `ep_id`, `form_id`,
`factory_attempt`, `ff_webhook_url`, `ff_webhook_hmac_keyid`, `rig_root`,
`max_iterations`, `parameters_json`) must not collide with adapter-specific
var names. If `EP.adapter.executionRequest.parameters` contains a key matching
any reserved name, the function emits an UncertaintyEntry and halts.

**AC-3** — The function resolves role prompts from `EP.roles[]`:
- For each `TrellisRoleInstruction` in `EP.roles`, the var name is derived
  from `roleId` directly (no prefix stripping): a role with `roleId: "planner"`
  produces vars `planner_prompt`, `planner_inputs`, `planner_outputs`.
- `{roleId}_prompt` = `role.instruction`
- `{roleId}_inputs` = `JSON.stringify(role.inputs)` (role.inputs is `string[]`)
- `{roleId}_outputs` = `JSON.stringify(role.outputs)` (role.outputs is `string[]`)
- Roles present in the registered template set (`planner`, `coder`, `verifier`)
  but absent from `EP.roles` are set to empty-string vars.
- Roles in `EP.roles` not in the registered template set are included in vars
  (the template will ignore unknown vars).

**AC-4** — Given identical EP content on two separate invocations, the
function produces byte-identical `vars` (including `parameters_json`).
Key ordering in `JSON.stringify` output is deterministic: keys are sorted
alphabetically before stringification.

**FORM-* persistence**

**AC-5** — The function writes a FORM-* artifact to ArangoDB `formulas`
collection with fields: `_key`, `kind: "FormulaArtifact"`, `tier: "procedural"`,
`template_name`, `formula_version` (initially `"pending"`, updated after CALL 1
per AC-11), `vars`, `parameters_json`, `source_refs: [EP-ID]`,
`explicitness: "explicit"`, `compiled_at`, `compiler` (module path
`workers/ff-pipeline/src/compilers/formula-compiler.ts` + git SHA injected
at build time via `CF_VERSION_METADATA` or `BUILD_GIT_SHA` env var).

**AC-6** — The FORM-* `_key` is derived as:
`"FORM-" + sha256(ep_id + "|" + factory_attempt).substring(0, 16).toUpperCase()`
(16 hex chars = 64-bit namespace; birthday collision at ~4B dispatches).

If a FORM-* already exists at the derived `_key`:
- If `source_refs[0] == EP.id` and `vars` is byte-equal (determinism replayed
  correctly): reuse the existing FORM-* and proceed.
- If `source_refs[0] != EP.id`: this is a hash collision. Emit UncertaintyEntry
  with `blocking_for: ["dispatch"]` and halt.

**AC-7** — FORM-* write and dispatch_log write happen in a single ArangoDB
stream transaction (see AC-23). If either write fails, the transaction is
aborted and neither artifact is persisted. The function halts without calling
Gas City.

**dispatch_log**

**AC-8** — The function writes a `dispatch_log` record in the same stream
transaction as FORM-* (AC-7 / AC-23) with fields: `_key` (UUID), `es_id`,
`ep_id`, `form_id`, `fn_id`, `is_id`, `factory_attempt`, `idempotency_key`
(the sha256 value from the Idempotency-Key header), `started_at`,
`outcome: "pending"`, `gc_bead_id: null`, `gc_workflow_id: null`,
`gc_workflow_root_bead_id: null`, `labels_sent: null`, `sling_request_hash: null`.

**AC-9** — After CALL 3 success, the function updates the dispatch_log record:
`outcome: "dispatched"`, `gc_bead_id`, `gc_workflow_id`,
`gc_workflow_root_bead_id`, `labels_sent` (the five-element label array
actually sent in CALL 2 body), `sling_request_hash` (sha256 of the CALL 3
request body JSON), `completed_at`. On any failure, `outcome` is set to one
of: `"failed"`, `"timeout_call_1"`, `"timeout_call_2"`, `"timeout_call_3"`,
`"version_mismatch"`, `"rejected"`, `"in_flight"` (see AC-9a). `error` field
populated with serialized error detail.

**AC-9a — Timeout outcome semantics.** If CALL 2 times out (function cannot
confirm whether Gas City created the bead), set dispatch_log
`outcome: "in_flight"`. Do NOT set `"failed"` — a bead may exist on the
Gas City side. On the next invocation, the idempotency pre-check sees
`"in_flight"` and treats it as a `"pending"` row for resume purposes
(same as AC-24 path).

**AC-9b — dispatch_log update failure.** If the final dispatch_log update
itself fails after CALL 3 succeeded, the function logs a warning at
`[DISPATCH_LOG_UPDATE_FAILED]` severity and returns. Gas City is running;
the dispatch_log row remains `"pending"` / `"in_flight"`. A separate
operational sweeper (out of scope for this IS) reconciles stale `pending`
rows.

**CALL 1 — Version probe**

**AC-10** — The function issues
`GET /v0/city/{GAS_CITY_CITY_NAME}/formulas/{template_name}?target={GAS_CITY_AGENT_NAME}&scope_kind=rig&scope_ref={GAS_CITY_RIG}` with
`Authorization: Bearer ${GAS_CITY_BEARER_TOKEN}` and a 25-second timeout.
(Query params `target`, `scope_kind`, `scope_ref` are required by the Gas City API; `scope_kind` is always `"rig"` for Phase 1.)
The response body's `version` field (string) is compared against the
`GAS_CITY_FORMULA_VERSION_{TEMPLATE}` env var (name derived per §Environment
dependencies). On match, compilation proceeds. On mismatch, the function
updates dispatch_log `outcome: "version_mismatch"`, emits an UncertaintyEntry,
and halts without proceeding to CALL 2. On HTTP error or timeout, set
`outcome: "timeout_call_1"` and halt.

**AC-11** — After CALL 1 succeeds, the function updates the FORM-* artifact's
`formula_version` field from `"pending"` to the value returned in the response
`version` field. This update is a separate ArangoDB write (not in the initial
stream transaction — the stream transaction completed in step 5 of the execution
sequence).

**CALL 2 — Bead create**

**AC-12** — The function issues `POST /v0/city/{GAS_CITY_CITY_NAME}/beads`
with a 25-second timeout and:
- Header `Authorization: Bearer ${GAS_CITY_BEARER_TOKEN}`
- Header `X-GC-Request: 1` (Gas City CSRF guard, required on all mutation endpoints)
- Header `Idempotency-Key: sha256(es_id + "|" + EP.instructionTuning.inputExecutableSpecificationHash + "|" + factory_attempt)` (lowercase hex)
- Body `labels: ["fn-id:{fn_id}", "is-id:{is_id}", "es-id:{es_id}", "form-id:{form_id}", "factory-attempt:{factory_attempt}"]`
- Body `metadata: { "ff.dispatch_id": <dispatch_log._key>, "ff.formula_name": <template_name>, "ff.formula_version": <formula_version>, "ff.dispatched_at": <ISO8601 timestamp>, "ff.webhook_url": <GAS_CITY_WEBHOOK_URL>, "ff.ep_id": <ep_id> }`
- Body `rig: <GAS_CITY_RIG>`, `title`, `description` per dispatch contract.

**AC-13** — On HTTP 201, capture the returned `id` as `gc_bead_id`. On HTTP
5xx, network error, or timeout (25s): set `outcome: "timeout_call_2"` or
`"in_flight"` (timeout) and halt; or retry up to 3 times with the same
`Idempotency-Key` on 5xx only (exponential backoff: 1s, 2s, 4s; 3 retries
after the original attempt). On HTTP 4xx (non-409), halt with
`outcome: "rejected"`.

**AC-14** — On HTTP 409 from CALL 2 (idempotency cache hit): read the
response body for the existing bead ID. If a prior dispatch_log row for this
`idempotency_key` exists with non-null `gc_bead_id` and the response bead ID
matches, treat as success-on-replay and proceed to CALL 3 with the existing
bead ID. If no prior dispatch_log row has a non-null `gc_bead_id`, treat 409
as hard failure with `outcome: "rejected"`.

**CALL 3 — Sling attach**

**AC-15** — The function issues `POST /v0/city/{GAS_CITY_CITY_NAME}/sling`
with a 25-second timeout and:
- Header `Authorization: Bearer ${GAS_CITY_BEARER_TOKEN}`
- Header `X-GC-Request: 1` (Gas City CSRF guard)
- Body `formula: <template_name>`
- Body `attached_bead_id: <gc_bead_id from CALL 2>`
- Body `bead: ""` (empty string — SlingInput.Bead field; not used for
  attached-bead-id dispatch, set to empty to satisfy the struct)
- Body `target: <GAS_CITY_AGENT_NAME>`
- Body `rig: <GAS_CITY_RIG>`
- Body `scope_kind: "city"`, `scope_ref: <GAS_CITY_CITY_NAME>` (Phase 1: agents are city-scoped; `scope_kind=rig` requires a rig-scoped agent which Phase 1 does not have)
- Body `force: false` (never force-override an existing workflow; idempotency
  via AC-17 instead)
- Body `vars: <full var map from AC-2 and AC-3>`

**AC-16** — On HTTP 200 with `status == "slung"`, proceed to AC-9 update.
Capture `workflow_id` if present; Gas City may return only `root_bead_id` (the
durable molecule handle). If `workflow_id` is absent, use `root_bead_id` as
the `gc_workflow_id` field in dispatch_log (confirmed from Gas City sling API).

**AC-17** — On HTTP 409 from CALL 3: read the response body. If it contains
a `workflow_id` matching the `gc_workflow_id` of an existing dispatch_log row
for the same `idempotency_key` with `outcome: "dispatched"`, treat as
success-on-replay and update dispatch_log. Any other 409 body is hard failure
with `outcome: "rejected"`.

**AC-18** — On HTTP 5xx, network error, or 25s timeout from CALL 3: retry
up to 3 times (same CALL 3 body, same `attached_bead_id` — do not re-issue
CALL 2). On timeout, set `outcome: "timeout_call_3"` and halt after exhausting
retries.

**Idempotency — ArangoDB unique constraint**

**AC-21** — The `dispatch_log` collection must have a unique index on
`(idempotency_key, factory_attempt)`. On parallel dispatch invocations for the
same `(es_id, factory_attempt)`, the first writer wins; the second writer
receives an ArangoDB unique-constraint error and halts immediately (no FORM-*
written, no Gas City calls). This is the correct behavior: only one dispatch
proceeds.

**FORM-* key and collision policy**

**AC-22** — FORM-* `_key` uses 16 hex chars (64-bit namespace; see AC-6).
Collision policy is specified in AC-6.

**Write atomicity**

**AC-23** — FORM-* artifact write and `dispatch_log` `pending` row write
execute inside a single ArangoDB stream transaction. If the transaction
aborts for any reason, neither artifact is persisted and the function halts
without calling Gas City. There is no partial-write cleanup path — the
transaction guarantees atomicity.

**Partition recovery (CALL 2 success / CALL 3 failure)**

**AC-24** — If the idempotency pre-check finds a `pending` (or `in_flight`)
dispatch_log row with non-null `gc_bead_id` and null `gc_workflow_id`, the
function skips steps 3–7 of the execution sequence (no FORM-* re-write, no
CALL 1, no CALL 2), resumes at CALL 3 using the stored `gc_bead_id`, and
updates the same dispatch_log row on completion.

**No-LLM invariant**

**AC-19** — The function makes zero LLM API calls. Every field in the FORM-*
artifact and the var map is derived deterministically from the Execution Packet
and environment configuration. Module: `workers/ff-pipeline/src/compilers/formula-compiler.ts`.
Forbidden imports: `providers.ts`, `callProvider`, `@anthropic-ai/sdk`,
`openai`, any package whose name contains `"ai"` and is not a utility library.

**Amendment dispatch (factory_attempt > 1)**

**AC-20** — When dispatching an amendment (`factory_attempt >= 2`), the
function adds a sixth label to CALL 2's bead: `"amendment-of:{prior_es_id}"`.
The var map includes `factory_attempt: "N"` (stringified decimal). The FORM-*
`_key` uses the same derivation with the updated `factory_attempt`.

## Validation obligations

The following must pass before the function can be promoted:

- **V1 (Determinism):** Given identical EP fixture, two runs produce
  byte-identical FORM-* `vars` and `parameters_json`.
- **V2 (No-LLM):** Static import analysis on module
  `workers/ff-pipeline/src/compilers/formula-compiler.ts` confirms zero
  imports from the forbidden list (AC-19). Tool: grep or AST-based import
  scanner in CI.
- **V3 (FORM-* before dispatch):** Mock Gas City; inject ArangoDB FORM-*
  write failure; assert zero Gas City calls fired.
- **V4 (dispatch_log before CALL 1):** Mock CALL 1 to check that
  dispatch_log `pending` row exists in ArangoDB before the mock fires.
- **V5 (Version mismatch halt):** Mock Gas City GET returning mismatched
  version; assert function sets `outcome: "version_mismatch"`, zero CALL 2/3.
- **V6 (Idempotency — bead 409):** Mock /beads returning 409; provide
  dispatch_log row with non-null `gc_bead_id` matching response; assert
  function proceeds to CALL 3.
- **V7 (Idempotency — sling 409):** Mock /sling returning 409 with
  matching `workflow_id` from an existing `dispatched` dispatch_log row;
  assert function treats as success and updates dispatch_log.
- **V8 (5-label Bead):** Assert CALL 2 request body `labels` array contains
  exactly five strings with correct `fn-id:`, `is-id:`, `es-id:`, `form-id:`,
  `factory-attempt:` prefixes.
- **V9 (Amendment label):** With `factory_attempt = 2` and `prior_es_id` set,
  assert CALL 2 body `labels` has six entries including `amendment-of:{prior_es_id}`.
- **V10 (Dispatch precondition — no Coherence VR):** Given an EP with no
  corresponding `verification_reports` document (kind=coherence, status=passed,
  source_refs contains ES-ID), assert function emits UncertaintyEntry and halts
  without writing FORM-* or dispatch_log.
- **V11 (FORM-* key collision — replay):** Given a pre-existing FORM-* with
  matching `_key` and byte-equal `vars`, assert function reuses it and proceeds.
- **V12 (FORM-* key collision — hard):** Given a pre-existing FORM-* with
  matching `_key` but different `source_refs[0]`, assert function emits
  UncertaintyEntry and halts.
- **V13 (Partition recovery):** Given a `pending` dispatch_log row with
  non-null `gc_bead_id` and null `gc_workflow_id`, assert function skips
  CALL 1 and CALL 2, fires CALL 3 with the stored bead ID.
- **V14 (Reserved-key collision in parameters):** Given an EP whose
  `executionRequest.parameters` contains key `"fn_id"`, assert function emits
  UncertaintyEntry and halts.

## Success metrics

**Phase 1 gate (from ARCHITECTURE-ROADMAP §3 Phase 1):**
- Compiler determinism test passes (V1).
- `gc formula show factory-coding-v1` exits 0 against pinned `GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1`.
- Bead labels confirmed via `bd list` (five labels on root Bead; template
  step-level labels on molecule-internal Beads — operator gate, not unit-testable).
- `dispatch_log` row written (V4).
- Idempotency proven under retry (V6, V7).
- Partition recovery proven (V13).
- Working-directory binding confirmed at rig root (template authorship
  requirement — gate condition, not this function's test).

**Operational:**
- Zero failed dispatches caused by version drift (version probe is the
  early-warning detector).
- dispatch_log `outcome: "version_mismatch"` rate: alert at any occurrence.
- FORM-* lineage completeness: every dispatched FORM-* queryable via
  `FOR f IN formulas FILTER f.source_refs ANY == EP-ID`.
- `outcome: "in_flight"` row count: alert if non-zero after 10 minutes
  (indicates stuck partition recovery).

## Out of scope

**Gas City execution.** Once CALL 3 returns HTTP 200, this function's
responsibility ends.

**RELEASE step callback handling.** The `POST /webhooks/gascity` endpoint is
IP-4.

**Formula template authorship.** `factory-coding-v1.toml` and its step-level
label declarations are a separate deliverable.

**Convergence parameters.** Set at Gas City dispatch time via converge API
(Phase 2).

**Fidelity Verification.** Factory's response to `molecule.completed` is IP-3
(Phase 2).

**Amendment loop orchestration.** The VR-fail → new IS → new EP → new dispatch
cycle is Phase 4 work. This IS covers dispatch of any EP regardless of
`factory_attempt` count.

**Non-coding domain adapters.** Only `factory-coding-v1` is in scope.

**Stale dispatch_log sweeper.** Reconciliation of `pending`/`in_flight` rows
older than a configurable TTL is a separate operational function.

## Uncertainty entries (resolved)

These UncertaintyEntries were filed for D-Q1C and resolved from Gas City
source before this IS was authored. They are recorded here for lineage.

- **UE-Q1C-1 (RESOLVED):** GET /formulas/{name} returns structured fields
  only — no raw TOML. Version probe uses `version` field equality. SHA
  verification is a CI/deploy-time check (`gc formula show` output hash),
  not a runtime dispatch check.

- **UE-Q1C-2 (RESOLVED):** Labels do NOT propagate from root Bead to
  molecule-internal child Beads. (`molecule.go stepToBead` confirmed — labels
  from recipe step definition only.) Requirement: template MUST declare
  lineage labels on every `[[steps]]` block. Compiler does not verify this;
  it is a template authorship invariant.

- **UE-Q1C-3 (RESOLVED):** HTTP sling and CLI `gc formula cook` use identical
  formula loading and parsing code path (both call
  `formula.CompileWithoutRuntimeVarValidation` via `DoSling →
  InstantiateSlingFormula`). Phase 0 TOML schema observations are authoritative
  for the HTTP dispatch path.

- **UE-Q1C-4 (RESOLVED):** Gas City sling has no Idempotency-Key support
  (confirmed: `SlingInput` struct has no idempotency header; only `/beads`
  and `/mail` do). Sling idempotency relies on 409 detection (AC-17). CALL 2
  bead Idempotency-Key is the primary barrier.
