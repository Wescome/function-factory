---
id: IS-GC-RUNTIME-PROVIDER-CONTRACT
version: 1
title: "Gas City Harness Runtime Provider Contract — provider registry, request/response envelopes, lifecycle, fail-closed semantics, pi-rpc + cloudflare-sandbox providers"
sourceCapabilityId: BC-GC-RUNTIME-PROVIDER
sourceFunctionId: FP-GC-RUNTIME-PROVIDER-CONTRACT
source_refs:
  - GAS-CITY-HARNESS-RUNTIME-PROVIDER-ARCHITECTURE
  - ADR-010-gas-city-supersedes-nlah
  - FF-CODING-ARCHITECTURE
  - IS-GC-EP-FORMULA-DISPATCH
  - IS-GC-DISPATCH-WIRE
  - GOVD-GAS-CITY-PHASE1-INTEGRATION
explicitness: explicit
rationale: >
  GAS-CITY-HARNESS-RUNTIME-PROVIDER-ARCHITECTURE names this IS as the first of
  three immediate follow-on artifacts and lists seven acceptance criteria the
  spec must satisfy. This IS encodes the provider registry, the execution request
  and response envelopes, the eleven lifecycle methods, the fail-closed rules,
  the provider→Gas City→Factory evidence flow, the pi-rpc migration path, and the
  Harness Tuple (E,T,C,S,L,V,G,P) mapping for the two day-one providers.

  Architecture boundary (explicit, from ADR-010 §1 and the architecture
  reference §Decision): Factory dispatches coherent executable work to Gas City
  and never selects, calls, or depends on a provider directly. Gas City owns
  runtime selection and operation. The provider verdict is an execution-status
  signal only; the molecule verdict is produced by Gas City fidelity validation,
  which is the sole authority on whether a molecule result is acceptable.

  Two providers are required from day one: `pi-rpc` (extracted from the existing
  PI_CONTAINER + pi-container/server.mjs surface — the runtime that produces real
  code) and `cloudflare-sandbox` (extracted from the M0 control worker — setup and
  teardown steps only, not AI reasoning). This IS is the extraction and contract
  spec; it specifies behavior and interfaces, not implementation syntax. A
  CodingAgent implements against it without re-litigating any architecture
  decision recorded here.

  The current Gas City city.toml carries `provider = "cloudflare"` with an empty
  `AGENT_CMD`, so sessions boot but no agent runs. This IS supersedes that config:
  the coder agent moves to the `pi-rpc` provider so the Factory produces
  artifact-bearing agent execution rather than transport proofs.
---

# Gas City Harness Runtime Provider Contract

## JTBD

When a Gas City Formula step needs to execute under a declared purpose and
policy, Gas City wants to select a runtime provider from a registry by matching
the step's declared runtime requirements against provider capability
declarations, invoke that provider through one stable request/response envelope,
and collect execution evidence, so that a Factory-dispatched molecule produces
real artifacts (code, files, verification reports) whose acceptance is decided by
Gas City fidelity validation — not by the provider itself — and so that the
Factory sees only Gas City events, never provider internals.

## Problem

The repo has three partial runtime surfaces (`PI_CONTAINER` +
`pi-container/server.mjs`, the M0 Cloudflare control worker, and the generic
Cloudflare Sandbox path). All three are Factory-shaped: they speak `WorkerInput`,
harness stage names, R2 artifact prefixes, and Factory adapter names. None of
them is reachable as a Gas City runtime provider, and none of them exposes a
contract that separates execution status from molecule verdict.

The live Gas City supervisor has health and city listing but no proven city
lifecycle or runtime provider. Its `city.toml` selects `provider = "cloudflare"`
with `AGENT_CMD` empty, so the M0 control worker boots a Cloudflare Sandbox and
runs the demo echo command — no coding agent, no artifacts, no evidence. The
Factory is dispatching coherent executable work into a runtime that cannot
produce code.

There is no provider registry schema, no Gas City-owned request/response
envelope, no fail-closed enforcement of policy/verifier preconditions, and no
evidence pipeline from a provider into Gas City fidelity validation and then to
the Factory RELEASE webhook. This IS closes those gaps for two providers.

## Goal

1. A **provider registry** that selects a provider for a Formula step by matching
   the step's `runtime_requirements` against provider capability declarations.
   Missing provider → fail closed. No fallthrough, no default provider.
2. A **request envelope** (Gas City → provider) carrying lineage, purpose,
   inputs, declared outputs, runtime config, policy, verifier contract, and an
   idempotency key.
3. A **response envelope** (provider → Gas City) carrying execution status, the
   provider verdict (not the molecule verdict), artifacts, artifact manifest,
   logs, policy events, model usage, runtime identity, session archive reference,
   and a structured error.
4. **Eleven lifecycle methods** with per-method contracts and fail-closed
   semantics: `createSession`, `prepareWorkspace`, `executeStep`,
   `collectArtifacts`, `collectLogs`, `collectPolicyEvents`, `snapshot`,
   `restore`, `status`, `restart`, `destroy`.
5. **Fail-closed rules** for the six preconditions and runtime conditions named
   in the architecture reference.
6. An **evidence flow** that keeps provider evidence inside Gas City and exposes
   only the Gas City verdict + lineage to the Factory RELEASE webhook.
7. A **pi-rpc migration path**: the renames, extractions, and config changes that
   turn the Factory-shaped PI surface into a Gas City provider, plus the updated
   `city.toml`.
8. A **Harness Tuple mapping** (E,T,C,S,L,V,G,P) for `pi-rpc` and
   `cloudflare-sandbox`. A provider that covers only E is rejected at
   registration.

## Scope

**In scope:**

- The provider registry contract and selection algorithm (capability matching,
  fail-closed on no match).
- The execution request envelope and response envelope as Gas City-owned schemas.
- The eleven lifecycle method contracts.
- The fail-closed precondition and runtime rules.
- The provider→Gas City→Factory evidence boundary.
- The Harness Tuple slot mapping for `pi-rpc` and `cloudflare-sandbox`.
- The extraction of `pi-rpc` from the current PI surface (renames, field
  mappings, what moves vs what stays).
- The updated `city.toml` shape with `pi-rpc` as the coder provider.

**Out of scope:**

- The Gas City policy compiler (purpose + governance → provider-specific
  controls). That is the follow-on artifact `IS-GC-PROVIDER-POLICY-COMPILER`.
  This IS specifies the `policy` envelope field shape and the fail-closed rule,
  not the compiler that produces it.
- The full provider evidence/replay manifest. That is the follow-on artifact
  `IS-GC-PROVIDER-EVIDENCE-ENVELOPE`. This IS specifies the response-envelope
  evidence fields and their meaning, not the durable replay manifest schema.
- Providers beyond `pi-rpc` and `cloudflare-sandbox` (`openshell`, `codex`,
  `claude-code`, `aider`, `opencode`, `browser`, `docker`, `k8s-job`). They are
  named as registry-future families; this IS does not specify their internals.
- Moving Factory coherence verification into providers (forbidden — see
  Non-negotiables).
- Any change to the Factory dispatch path (`formula-compiler.ts`,
  `IS-GC-DISPATCH-WIRE`). The dispatch contract is frozen; this IS consumes its
  outputs and produces inputs to its webhook intake.
- Hermes as a Gas City session runtime. Hermes is evidence of what a CF-native
  coding agent looks like (REST/WebSocket API, AI Gateway routing, R2
  backup/restore, four-gate taxonomy and ToolGuardrail patterns adopted into
  FF-CODING-ARCHITECTURE) but it is NOT the Gas City session runtime. If a future
  city wants Hermes, it becomes a `hermes` provider family under this same
  contract — out of scope here.

## Architecture context (grounding, not re-litigation)

Settled upstream; restated only so the implementer does not redraw the boundary:

- **Two layers (ADR-010 §1).** Factory (CF Workers + ArangoDB) owns
  Signal→Pressure→IS→ES→VR→FN, Crystallizer probes, Coherence/Fidelity/Persistence
  Verification, lineage graph. Gas City (CF Container DO supervisor) owns
  sessions, beads, formulas, molecules, convergence, fidelity validation.
- **Dispatch is frozen (IS-GC-DISPATCH-WIRE, IS-GC-EP-FORMULA-DISPATCH).** Factory
  compiles an EP into a FORM-\* and dispatches it to Gas City via the 3-call HTTP
  sequence (version probe → bead create → sling). The FORM-\* `vars` carry lineage
  (`fn_id`, `is_id`, `es_id`, `ep_id`, `form_id`, `factory_attempt`) and the
  Factory webhook URL/HMAC key id. This IS does not touch that path.
- **Webhook intake is frozen (webhook-receiver.ts).** Gas City posts an
  HMAC-signed completion payload back to Factory. The accepted payload shape is
  `{ fn_id, is_id, es_id, ep_id, form_id, factory_attempt, bead_id, outcome
  ("approved"|"revise"), remediation? }`. This IS's evidence flow MUST terminate
  in exactly that payload — nothing provider-specific crosses the boundary.
- **Provider verdict ≠ molecule verdict (architecture reference §Provider
  Contract).** Providers report execution status. Gas City fidelity validation
  decides molecule acceptability. Worker and evaluator are structurally separate
  (architecture reference §Ontology Constraints): a provider cannot certify its
  own final correctness.

## Definitions

- **Provider** — a Gas City harness runtime that maps the full Harness Tuple
  `H = (E, T, C, S, L, V, G, P)` (architecture reference §Harness Tuple). It runs
  a Formula step under a declared purpose and policy and returns the response
  envelope. A surface that exposes only command execution (E) is an *executor
  backend*, not a provider, and MUST be rejected at registration.
- **Provider id** — stable string identifying a provider implementation. Day-one
  ids: `pi-rpc`, `cloudflare-sandbox`. Provider ids replace Factory adapter names
  at the Gas City boundary (architecture reference §Migration step 3).
- **Provider capability declaration** — the machine-readable manifest a provider
  registers, stating which Harness Tuple slots it covers and which
  `runtime_requirements` keys it can satisfy (e.g. `ai_reasoning`,
  `model_routing`, `workspace_write_scope`, `command_exec`, `file_materialize`, `workspace_init`,
  `dependency_prep`, `session_archive`, `snapshot_restore`).
- **`runtime_requirements`** — a Formula step field declaring required runtime
  capabilities WITHOUT naming Factory internals (architecture reference
  §Acceptance Criteria item 1). The registry matches these against capability
  declarations. The canonical capability-key set is the twelve keys settled in
  Open Question 4 and is the single normative source; every `runtime_requirements`
  value and every provider capability declaration in this IS draws ONLY from that
  set: `ai_reasoning`, `model_routing`, `workspace_write_scope`, `command_exec`,
  `file_materialize`, `workspace_init`, `dependency_prep`, `session_archive`,
  `snapshot_restore`, `contract_evaluation`, `tool_capability_probe`,
  `backup_restore`. No other key is valid.
- **Provider verdict** — execution-outcome signal in the response envelope. One
  of `completed | failed | policy_violation | timeout | cancelled`. NOT the
  molecule verdict.
- **Molecule verdict** — Gas City fidelity validation's decision on whether the
  molecule result is acceptable. Produced by Gas City, never by a provider.
- **Verifier contract** — the declaration of what constitutes a valid output for
  a step (declared-output match rules, optional internal-verification expectation).
  Mandatory in the request envelope; absence fails closed.
- **Session archive** — captured runtime session state (e.g. the pi session dir
  tarball, container scrollback) referenced by `session_archive_ref` for replay
  and audit. The provider produces it; Gas City owns the durable reference.

---

## Acceptance Criteria

The seven items in the architecture reference §Acceptance Criteria are mapped to
ACs below. Each AC is testable in isolation.

### Provider registry (AC-REG\*)

**AC-REG1.** A provider registry exists in Gas City that holds, for each
registered provider, its `provider_id` and a **provider capability declaration**.
The capability declaration MUST enumerate (a) which Harness Tuple slots the
provider covers, and (b) the set of `runtime_requirements` capability keys it can
satisfy.

**AC-REG2.** Provider selection for a Formula step is deterministic: given the
step's `runtime_requirements`, the city config's allowed providers, and current
capacity, the registry returns exactly one `provider_id` whose capability
declaration is a superset of `runtime_requirements`, or it fails closed. Selection
inputs are (step `runtime_requirements`, city config provider allow-list, provider
capacity from `status`). (Architecture reference §Acceptance item 2.)
`runtime_requirements` is declared on `[[steps]]` blocks of the operator-deployed
Formula template (e.g. `factory-coding-v1.toml`) and is read only inside Gas City
during selection. The Factory dispatch path neither reads nor validates formula step
fields: the Formula compiler dispatches the template opaquely by `template_name`
plus a `{version}` probe and an opaque `vars` map (IS-GC-EP-FORMULA-DISPATCH
§Parametric template model). Adding `runtime_requirements` to a formula step is
therefore a Gas City configuration change inside the Gas City boundary; it does NOT
touch the frozen Factory dispatch contract.

**AC-REG3.** **Fail-closed on no match.** If no registered provider's capability
declaration satisfies `runtime_requirements`, the registry returns a structured
selection error (`no_provider_for_requirements`) and the step does NOT execute.
There is no default provider and no fallthrough. (Architecture reference
§Acceptance item 4; §Non-Goals.)

**AC-REG4.** **Tuple-completeness gate at registration.** The gate reads the
`harness_slots` list on the provider's `city.toml` block (registry lives in city
config — Q3). A provider whose `harness_slots` does not contain all eight slots
`E, T, C, S, L, V, G, P` MUST be rejected at registration with
`incomplete_harness_tuple`. The gate is a config read, not a runtime probe: the
live `runtime.Provider.Capabilities()` returns only `{CanReportAttachment,
CanReportActivity}` and carries no slot information, so tuple-completeness is
asserted from the declared `harness_slots` field. Example shape for a `city.toml`
provider block: `harness_slots = ["E","T","C","S","L","V","G","P"]`.
(Architecture reference §Harness Tuple: "A provider that only exposes command
execution is not a Gas City harness runtime provider.")

**AC-REG5.** The two day-one providers `pi-rpc` and `cloudflare-sandbox` are both
registered. Every key below is drawn from the canonical twelve-key set anchored in
the `runtime_requirements` definition (Definitions) — no other key is valid.
`pi-rpc` declares `ai_reasoning`, `model_routing`, `workspace_write_scope`,
`contract_evaluation`, `tool_capability_probe`, `session_archive`.
`cloudflare-sandbox` declares `command_exec`, `file_materialize`, `workspace_init`,
`dependency_prep`, `backup_restore` and explicitly does NOT declare `ai_reasoning`.
Their capability declarations are further specified in the Harness Tuple mapping
section. (Architecture reference §Non-Goals: do not make pi the only provider.)

**AC-REG6.** When a Formula step declares `runtime_requirements` including
`ai_reasoning`, the registry MUST NOT select `cloudflare-sandbox` (it does not
declare that capability). When a step declares only setup/teardown capabilities
(`command_exec`, `file_materialize`, `workspace_init`, `dependency_prep`), the registry
MAY select `cloudflare-sandbox`.

### Request envelope (AC-RQ\*)

**AC-RQ1.** Gas City sends a provider exactly one **execution request envelope**
per Formula step. The envelope is a Gas City-owned schema with these fields
(architecture reference §Provider Contract "Minimum execution request envelope"):

```
city_id            string
session_id         string
formula_id         string
formula_version    string
molecule_id        string
bead_id            string
step_name          string
role_name          string
purpose            string
inputs             object   (input artifacts / refs)
declared_outputs   array    (declared output names)
runtime_config     object   (provider-specific config block)
policy             object   (tool allowlist, network policy, filesystem scope)
context_refs       object   (lineage pointers: fn_id, is_id, es_id, ep_id)
verifier_contract  object   (valid-output rules; mandatory)
idempotency_key    string
```

**AC-RQ2.** `context_refs` carries the lineage pointers `fn_id`, `is_id`,
`es_id`, `ep_id`. These are sourced from the FORM-\* `vars` Gas City received at
dispatch (IS-GC-EP-FORMULA-DISPATCH AC-2). The provider treats `context_refs` as
opaque purpose-binding (`P`) — it MUST carry them through to evidence and MUST NOT
interpret them as Factory categories.

**AC-RQ3.** `purpose` is a narrowed natural-language statement of what THIS step
must accomplish, derived from the bead/molecule purpose. Provider permissions
narrow with purpose (architecture reference §Ontology Constraints: "Purpose
narrows across decomposition"). A provider MUST NOT broaden its tool/network/fs
scope beyond what `policy` grants for this `purpose`.

**AC-RQ4.** `runtime_config` is the only provider-specific block. Its shape is
defined per provider (pi-rpc: model route + candidates, repair budget, execution
surface; cloudflare-sandbox: command, repo, env). Gas City populates it during
selection. The envelope schema treats it as an opaque object so the envelope is
stable across providers.

**AC-RQ5.** `idempotency_key` is supplied by Gas City and is stable for a given
(molecule, step, attempt). A provider receiving the same `idempotency_key` for an
already-completed execution MUST return the prior response envelope (or a
reference to it) rather than re-executing — mirroring the Factory dispatch
idempotency discipline (IS-GC-EP-FORMULA-DISPATCH §Idempotency). The
`idempotency_key` is derived as a stable function of `(molecule_id, step_name,
attempt_index)`, where `attempt_index` advances by one on each convergence repair
iteration (IS-GC-FIDELITY-VALIDATION FV-16/FV-17). A re-run therefore carries a
distinct `idempotency_key` and is a fresh execution, never a replay of the prior
failed attempt.

### Response envelope (AC-RS\*)

**AC-RS1.** A provider returns exactly one **execution response envelope** per
`executeStep`. The envelope is a Gas City-owned schema with these fields
(architecture reference §Provider Contract "Minimum execution response
envelope"):

```
status                              enum     completed | failed | policy_violation | timeout | cancelled
provider_verdict                    object   execution outcome (NOT molecule verdict)
artifacts                           array    produced outputs: { path, size, checksum }
artifact_manifest                   object   declared outputs matched against produced
logs                                object   { stdout_ref, stderr_ref, trace_spans }
policy_events                       array    allow | deny | escalation | violation events
model_usage                         object   { tokens, cost, model_id } (from ofox.ai / AI Gateway) | null
runtime_identity                    object   { provider_id, version, image_digest }
session_archive_ref                 string   R2 or Dolt reference to captured session state | null
verifier_report_ref                 string   if provider ran internal verification | null
error                               object   structured error on non-completed status | null
completion_claimed_without_manifest boolean  true iff completion was claimed by a provider end-of-turn
                                             self-report rather than by a manifest-backed produced set;
                                             the externally-verifiable stop-condition flag read by Gas
                                             City fidelity validation (FV-09 check 4, IS-GC-FIDELITY-VALIDATION)
step_outputs                        object   domain-adapter-normalized per-step evidence map (opaque to
                                             the envelope kernel; dot-path addressable by the configured
                                             fidelity checks in fidelity-checks.toml); the sole channel
                                             for step-type-specific evidence — the validator never reads
                                             any top-level envelope field for domain-specific checks,
                                             keeping the contract kernel domain-neutral
```

**AC-RS2.** **`provider_verdict` is not the molecule verdict.** The provider MUST
report only execution outcome. It MUST NOT emit `approved`/`revise`, MUST NOT emit
a Factory coherence/fidelity verdict, and MUST NOT claim molecule acceptance. The
molecule verdict is computed by Gas City fidelity validation downstream.
(Architecture reference §Provider Contract; §Non-Goals; §Ontology Constraints
"Worker and evaluator are structurally separate.")

**AC-RS3.** `artifact_manifest` maps each entry of the request's
`declared_outputs` to one of `{ produced, missing, extra }`. A declared output
with no matching produced artifact is `missing`. A produced artifact not in
`declared_outputs` is `extra` (it does not fail the provider; the forensic write
scope handles unauthorized paths per AC-PI3). The manifest is the externally
verifiable stop-condition input (architecture reference §Ontology Constraints:
"Stop conditions must be externally verifiable").

**AC-RS4.** When `status != completed`, `error` MUST be a structured object with
at least `{ code, message }`. `provider_verdict`, `artifacts`, and
`artifact_manifest` MUST still be populated with whatever partial state exists so
Gas City can diagnose. `logs` MUST reference whatever was captured before the
failure.

**AC-RS5.** `runtime_identity` MUST always be present and MUST include
`provider_id` and `version`. `image_digest` is present when the provider runs in
a container with a known image digest. For `pi-rpc` this maps to the
container build id / worker version metadata
(`pi-container/server.mjs::containerRuntimeIdentity`). This is the replay-identity
anchor (architecture reference §Gaps: "no replay manifest tying runtime identity
... together").

**AC-RS6.** `model_usage` is populated for providers that perform model inference
(`pi-rpc`: token counts and model id from the pi observation `totalUsage` plus the
ofox.ai-routed model id). It is `null` for providers that do no inference
(`cloudflare-sandbox`).

**AC-RS7.** `session_archive_ref` is a Gas City-owned reference (R2 key or Dolt
ref), not the raw archive bytes. The provider produces the archive bytes; Gas City
stores them and the envelope carries the reference. (Architecture reference
§Migration step 7: "Gas City owns the evidence envelope.")

### Provider lifecycle methods (AC-LC\*)

The eleven methods from the architecture reference §Provider Contract. Each AC
states inputs, outputs, when called, and what fail-closed means.

**AC-LC1 — `createSession`.** Input: `{ city_id, session_id, formula_id,
molecule_id?, bead_id? }`. Output: `{ session_handle, status }`. Called once per
Gas City session before any step executes. Fail-closed: if the provider cannot
allocate a session (no capacity, unhealthy runtime), it returns a non-OK status;
Gas City does NOT proceed to `prepareWorkspace`. For `pi-rpc` this maps to
ensuring the singleton/bounded PI container is ready
(`pi-container.ts::ensureContainerReady`). For `cloudflare-sandbox` this maps to
`POST /session` on the control worker (non-blocking boot, 202).

**AC-LC2 — `prepareWorkspace`.** Input: `{ session_handle, inputs, policy,
context_refs }`. Output: `{ status, prepared_refs? }`. Called after
`createSession`, before `executeStep`. Materializes input artifacts, dependency
state, credentials (scoped to purpose), and applies the policy's filesystem
scope. Fail-closed: if a required input is missing, if a credential the policy
demands is unavailable, or if the filesystem scope cannot be enforced, it returns
non-OK and Gas City does NOT call `executeStep`. (Architecture reference
§Ontology Constraints: "Provisioning is bounded by purpose.")

**AC-LC3 — `executeStep`.** Input: the full request envelope (AC-RQ1). Output:
the full response envelope (AC-RS1). Called once per Formula step (and once per
repair/convergence iteration, each with a distinct `idempotency_key`). This is
the only method that runs the agent/job loop (`E`). Fail-closed: the four
precondition rules (AC-FC1..3) are checked by Gas City BEFORE this is called;
inside, a policy violation stops execution and sets `status=policy_violation`
(AC-FC4); "agent says it is done" without an artifact-manifest match is NOT a
valid completion (AC-FC5).

**AC-LC4 — `collectArtifacts`.** Input: `{ session_handle, declared_outputs }`.
Output: `{ artifacts, artifact_manifest }`. Called by Gas City after
`executeStep` (or as part of the same response — see AC-PI6). Returns produced
files with `{ path, size, checksum }` and the declared-vs-produced manifest.
Fail-closed: a checksum that cannot be computed marks that artifact `missing` in
the manifest rather than reporting a false `produced`.

**AC-LC5 — `collectLogs`.** Input: `{ session_handle }`. Output: `{ stdout_ref,
stderr_ref, trace_spans }`. Returns logs, stderr, stdout, trace spans, and
model/tool usage. For `pi-rpc` this maps to the stderr ring buffer and the pi
observation event stream (`server.mjs` `observation.events`, `stderrTail`). For
`cloudflare-sandbox` this maps to the exec stdout/stderr/exitCode.

**AC-LC6 — `collectPolicyEvents`.** Input: `{ session_handle }`. Output:
`{ policy_events }`. Returns allow/deny/escalation/violation events. For `pi-rpc`
the path-guard rejection events (`server.mjs::enforceSeedWorkspacePatchGuard`,
`[PATH-GUARD] blocked path`) and tool-capability outcomes are policy events. A
provider with no policy surface returns an empty array — it MUST NOT return null.
(Architecture reference §Ontology Constraints: "Governance evaluation is not the
same thing as quality evaluation. Both surfaces must be available.")

**AC-LC7 — `snapshot`.** Input: `{ session_handle }`. Output: `{ snapshot_ref }`
or `{ unsupported: true }`. Called when Gas City wants to capture runtime state
for replay/continuation. A provider that does not support snapshots returns
`{ unsupported: true }` — it MUST NOT throw. For `pi-rpc` the session archive
capture (`server.mjs::captureSessionArchive`) is the snapshot primitive.

**AC-LC8 — `restore`.** Input: `{ session_handle, snapshot_ref }`. Output:
`{ status }` or `{ unsupported: true }`. Called when replay or continuation is
allowed. A provider that does not support restore returns `{ unsupported: true }`.

**AC-LC9 — `status`.** Input: `{ session_handle? }`. Output: `{ healthy,
ready, provider_version, image_digest?, capacity }`. Reports health, readiness,
provider version, image digest, and remaining capacity. The registry reads
`capacity` during selection (AC-REG2). For `pi-rpc` this maps to
`pi-container.ts::statusResponse` (running, desiredBuildId, startedBuildId, queue
depth). For `cloudflare-sandbox` this maps to `GET /session/:id/status` plus
`GET /pool/status`.

**AC-LC10 — `restart`.** Input: `{ session_handle, reason }`. Output:
`{ status }`. Restarts a failed or stale runtime. For `pi-rpc` this maps to the
build-version-mismatch restart (`pi-container.ts::restartContainer`) and to GUPP
(ADR-010 §3): a restarted runtime resumes the bead on its hook. Fail-closed: a
restart that cannot bring the runtime healthy returns non-OK; Gas City treats the
step as `timeout`/`failed` and the bead stays open for retry (AC-FC6).

**AC-LC11 — `destroy`.** Input: `{ session_handle }`. Output: `{ status }`.
Releases runtime resources and revokes temporary permissions/credentials granted
in `prepareWorkspace`. Called at session end. Fail-closed for credentials:
`destroy` MUST revoke any scoped credential it minted even if the runtime is
already gone, so a leaked credential cannot outlive the session. For
`cloudflare-sandbox` this maps to `POST /session/:id/stop` (registry delete).

### Interface binding (AC-LC ↔ runtime.Provider)

The eleven AC-LC obligations above are the Gas City provider-contract façade. They
are NOT Go `runtime.Provider` method names. The live `runtime.Provider`
(`stage/internal/runtime/cloudflare/provider.go`, ~20 PTY/session methods:
`Start`/`Stop`/`Interrupt`/`IsRunning`/`IsAttached`/`Attach`/`ProcessAlive`/
`Nudge`/`SetMeta`/`GetMeta`/`RemoveMeta`/`Peek`/`ListRunning`/`GetLastActivity`/
`ClearScrollback`/`CopyTo`/`SendKeys`/`RunLive`/`Capabilities`) is a terminal-
session orchestration surface. No new Go method is introduced by this IS. Gas City
binds each AC-LC obligation to one or more real methods:

| AC-LC obligation    | `runtime.Provider` method(s) |
| ---                 | --- |
| `createSession`     | `Start(ctx, name, Config)` — allocates the session; readiness via `IsRunning(name)` / `ProcessAlive(name, processNames)` |
| `prepareWorkspace`  | `CopyTo(name, src, relDst)` for input materialization; `RunLive(name, Config)` for dependency/setup; `SetMeta` to record scoped state |
| `executeStep`       | `Nudge(name, content)` (or `SendKeys`) delivers the step prompt; completion observed via `GetLastActivity`/`IsRunning`/`ProcessAlive`; scrollback via `Peek(name, lines)`. The response envelope (AC-RS1) is assembled by Gas City from these reads plus the artifact mirror — it is not returned by a single Go call. For an RPC-native provider (`pi-rpc`) the same obligation is satisfied by the pi JSONL RPC turn; the façade is identical across both providers. |
| `collectArtifacts`  | produced-file set read from the session filesystem / R2 mirror; `CopyTo` is the inbound primitive; checksums and the declared-vs-produced manifest are computed by Gas City |
| `collectLogs`       | `Peek(name, lines)` (scrollback / stderr tail); `GetLastActivity` for the activity anchor |
| `collectPolicyEvents` | derived by Gas City from scrollback (`Peek`) and filesystem write-scope checks; the cloudflare transport has no native policy event stream so an empty array (never null) is contract-valid (AC-LC6) |
| `snapshot`          | `ClearScrollback` is NOT a snapshot; cloudflare transport returns `{ unsupported: true }` (AC-LC7) |
| `restore`           | `{ unsupported: true }` for the cloudflare transport (AC-LC8) |
| `status`            | `IsRunning`, `ProcessAlive`, `GetLastActivity`, and `Capabilities()` together populate `{ healthy, ready, provider_version, capacity }` |
| `restart`           | `Stop(name)` then `Start(ctx, name, Config)` |
| `destroy`           | `Stop(name)` plus `RemoveMeta` for any scoped state; credential revocation (AC-LC11) is a Gas City obligation layered above the Go interface |

**Binding limitation (surfaced, not hidden):** the live `runtime.Provider` has no
single execute-and-return-evidence method. `executeStep` and `collectArtifacts` are
therefore Gas City compositions over PTY/session primitives plus the artifact mirror,
not 1:1 Go calls. A provider whose runtime is RPC-native (`pi-rpc`) satisfies the
same façade through its RPC turn. The façade is the stable contract; the Go interface
is one implementation substrate beneath it.

### Fail-closed rules (AC-FC\*)

The six conditions from the architecture reference §Acceptance and the task fail-
closed list. These are enforced by Gas City around the provider, except where a
condition is intrinsically inside `executeStep`.

**AC-FC1.** **Missing provider → no execution.** If selection returns
`no_provider_for_requirements` (AC-REG3), Gas City does not execute. Surfaced as a
422-class failure on the Gas City step.

**AC-FC2.** **Missing `verifier_contract` → no execution.** If the request
envelope would carry no `verifier_contract` (or an empty one), Gas City does NOT
call `executeStep`. 422-class. (Architecture reference §Acceptance item 4.) A
provider that receives a request with no `verifier_contract` MUST reject it
(defense in depth) rather than execute.

**AC-FC3.** **Missing `policy` → no execution.** If the request envelope would
carry no `policy`, Gas City does NOT call `executeStep`. 422-class. The provider
also rejects on receipt (defense in depth).

**AC-FC4.** **Policy violation during execution → stop.** If the provider detects
a policy violation while running (e.g. a write outside the filesystem scope, a
disallowed tool, a disallowed network egress), it stops execution, emits the
violation into `policy_events`, and returns `status=policy_violation`. For
`pi-rpc` the path-guard block (`enforceSeedWorkspacePatchGuard`) is the canonical
example: today it throws `PI_PATH_GUARD_BLOCKED`; under this contract that becomes
`status=policy_violation` with a `policy_events` entry. (Architecture reference
§Fail-closed list.)

**AC-FC5.** **"Agent says it is done" is not a stop condition.** A provider MUST
NOT report `status=completed` unless `artifact_manifest` shows every
`declared_output` as `produced`. An agent emitting an end-of-turn signal
(pi `agent_end`) with one or more declared outputs still `missing` yields
`status=failed` with `error.code=declared_outputs_missing`, never `completed`.
When the provider's completion was established by a self-report end-of-turn signal
rather than by a manifest-backed produced set, the provider MUST set
`completion_claimed_without_manifest=true` on the response envelope (AC-RS1) so Gas
City fidelity validation can fail the stop-condition check independently of the
manifest (IS-GC-FIDELITY-VALIDATION FV-09 check 4).
(Architecture reference §Ontology Constraints: "Stop conditions must be externally
verifiable.")

**AC-FC6.** **Provider timeout → archive + bead stays open.** On timeout, the
provider returns `status=timeout`, Gas City stores the session archive (if any),
and the bead stays open for retry. GUPP (ADR-010 §3) re-runs the bead on its hook;
no operator action is required. (Architecture reference §Fail-closed list; the
`pi-container.ts` `CONTAINER_EXECUTE_TIMEOUT_MS` → `container_execute_timed_out`
event is the existing timeout signal to re-map.)

**AC-FC7.** **No provider self-certification.** A provider MUST NOT be both the
worker and the final evaluator for the same step. A provider MAY run internal
verification and report `verifier_report_ref`, but that report is evidence for Gas
City fidelity validation, not the molecule verdict. (Architecture reference
§Non-Goals; §Ontology Constraints "Evaluators are evaluated.")

### Evidence flow (AC-EV\*)

**AC-EV1.** Provider evidence (`artifacts`, `logs`, `policy_events`,
`model_usage`, `session_archive_ref`, `verifier_report_ref`) flows from the
response envelope into **Gas City fidelity validation**. Gas City fidelity
validation consumes that evidence and emits the molecule verdict SEPARATELY from
the provider execution status. (Architecture reference §Acceptance item 6.)

**AC-EV2.** The Factory sees **only Gas City events** — never pi-rpc artifacts,
never Sandbox file paths, never provider `policy_events`. The boundary is the
existing webhook intake (webhook-receiver.ts). (Architecture reference §Acceptance
item 7; §Non-Goals.)

**AC-EV3.** The Gas City → Factory RELEASE payload MUST be exactly the shape the
webhook receiver already accepts:

```
{ fn_id, is_id, es_id, ep_id, form_id, bead_id, factory_attempt,
  outcome ("approved"|"revise"), remediation? }
```

`outcome` is the molecule verdict from Gas City fidelity validation (AC-EV1), not
the provider verdict. `remediation` (when `outcome="revise"`) is Gas City's
guidance, derived from provider evidence but expressed in Factory-domain terms —
no provider internals. Lineage fields are carried through from `context_refs`
(AC-RQ2), which Gas City sourced from the FORM-\* vars at dispatch.

**AC-EV4.** Provider evidence remains addressable inside Gas City for replay and
audit (`session_archive_ref`, `logs`, `runtime_identity`), but is NOT included in
the RELEASE payload. The replay manifest that ties these together is the follow-on
artifact `IS-GC-PROVIDER-EVIDENCE-ENVELOPE`; this IS requires only that the
response-envelope fields needed to build it are present and Gas City-owned.

### pi-rpc migration path (AC-PI\*)

Grounded in the architecture reference §Migration and the actual source
(`pi-container.ts`, `server.mjs`).

**AC-PI1 — Field renames at the Gas City boundary** (architecture reference
§Migration step 3). The following Factory-shaped fields are renamed to
provider-contract fields. The renames apply at the envelope boundary; the
pi-container internals MAY retain the old names temporarily but the request/response
envelopes Gas City sees MUST use the new names:

```
WorkerInput            → execution request envelope (AC-RQ1)
input.stageName        → request.step_name
input.roleName         → request.role_name
input.runId            → request.session_id (or a Gas-City-owned run handle)
input.context          → request.inputs + request.context_refs
input.declaredOutputs  → request.declared_outputs
input.outputContracts  → request.verifier_contract (the contract list becomes the verifier contract)
HarnessState           → provider session state / city session state
Factory adapter name   → provider_id "pi-rpc"
```

**AC-PI2 — What stays in pi-container vs what moves to the envelope.**
- STAYS inside pi-container (`server.mjs`): the pi RPC protocol (spawn
  `pi --mode rpc`, `PI_INIT_DELAY_MS`, wait for `agent_end`), model failover loop,
  tool-capability probe, contract materialization, contract evaluation, repair
  turns, path guard, session archive capture, stderr ring buffer. These are
  provider-internal mechanics (`E`, parts of `T`/`C`/`V`/`G`).
- MOVES to the response envelope: the existing `observation` block is decomposed
  into envelope fields — `observation.totalUsage` → `model_usage`;
  `observation.events` / `stderrTail` → `logs`; path-guard blocks / tool-probe
  outcomes → `policy_events`; `containerRuntime` → `runtime_identity`;
  `sessionArchive` → `session_archive_ref` (after Gas City stores the bytes);
  contract-evaluation pass/fail per artifact → `artifact_manifest`.

**AC-PI3 — Path guard becomes a policy event, not a hard throw.** Today
`enforceSeedWorkspacePatchGuard` throws `PI_PATH_GUARD_BLOCKED`. Under this
contract, a blocked path produces a `policy_events` entry
(`{ kind: "violation", rule: "filesystem_scope", path }`) and the step returns
`status=policy_violation` (AC-FC4). The three-layer write scope (FF-CODING-ARCHITECTURE
§3) maps as: Layer 1 preventive (tool wrapper) and Layer 3 substrate (DO write
boundary) produce `policy_events`; Layer 2 forensic (sanitizer) produces `extra`
manifest entries (AC-RS3), not provider failure.

**AC-PI4 — `WorkerInput` → formula step execution input.** The Formula step's
`runtime_config` for `pi-rpc` carries: `{ model_route, model_candidates,
max_repair_rounds, execution_surface ("rpc") }`. These populate what
`resolveDispatchModels` / `handleExecute` read from `input` today. The step's
`inputs` carry the input artifacts (today `input.context.inputArtifacts`,
including `SeedWorkspace`). The step's `verifier_contract` carries the contract
list (today `input.outputContracts`).

**AC-PI5 — R2 artifact writes map to `collectArtifacts`.** Today the PiContainer
DO mirrors `/workspace` + `/artifacts` to R2 under `runs/{runId}/artifacts/`
(`pi-container.ts::drainLogs` and the DO write boundary in FF-CODING-ARCHITECTURE
§3.4 `writeStageArtifact`). Under this contract, those writes are the provider's
`collectArtifacts` implementation: the provider returns `{ path, size, checksum }`
for each produced file, and Gas City — not the provider — decides the durable
storage location and owns the `session_archive_ref`/artifact references. The
existing R2 prefix is an implementation store (architecture reference §Migration
step 7: "Cloudflare R2 may remain an implementation store, but Gas City owns the
evidence envelope").

**AC-PI6 — Response synchrony.** `executeStep` MAY return artifacts inline in the
response envelope (as `server.mjs::handleExecute` does today via
`artifactContents`) OR return references that Gas City resolves via
`collectArtifacts`. Either is contract-valid. The artifact-manifest match
(AC-RS3) is computed before `status=completed` is set regardless.

**AC-PI7 — Updated `city.toml`.** The coder agent moves to the `pi-rpc` provider.
The session provider for the coder is `pi-rpc`, pointing at the PI runtime
(PI_CONTAINER reached through its DO binding), not the M0 cloudflare control
worker. The `cloudflare-sandbox` provider remains available for setup/teardown
steps. The required shape (behavioral, not literal syntax):

```
[[agent]]
name = "coder"
provider = "pi-rpc"          # was "cloudflare" with empty AGENT_CMD
min_active_sessions = 1
max_active_sessions = 3

[provider.pi-rpc]            # runtime config block for the pi-rpc provider
# binds the PI runtime; model routing is kimi-k2 via ofox.ai (memory: ofox stays for cost)
# capability declaration: ai_reasoning, model_routing, workspace_write_scope,
#   contract_evaluation, tool_capability_probe, session_archive

[provider.cloudflare-sandbox]
# the M0 control worker; setup/teardown only — NOT ai_reasoning
url = "https://gascity-cloudflare-control-worker.koales.workers.dev"
# capability declaration: command_exec, file_materialize, workspace_init,
#   dependency_prep, backup_restore
```

The existing `[session] provider = "cloudflare"` with `[session.cloudflare] url`
is superseded for the coder: AI-reasoning steps select `pi-rpc`; only
setup/teardown steps select `cloudflare-sandbox`. The empty `AGENT_CMD` is no
longer the path by which the coder runs.

**AC-PI8 — Compatibility provider first** (architecture reference §Migration step
1). `pi-rpc` is registered and proven as the first provider before any other
runtime surface is folded into live city execution. NLAH/harness dispatch paths
are retired only after Formula execution, provider evidence, fidelity validation,
and Factory webhook intake are proven end to end (architecture reference §Migration
step 8).

### Harness Tuple mapping (AC-HT\*)

Each provider maps all eight slots. (Architecture reference §Harness Tuple. A
provider covering only E is rejected — AC-REG4.)

**AC-HT1 — `pi-rpc` tuple mapping.**

| Slot | `pi-rpc` implementation |
| --- | --- |
| `E` Execution loop | `pi --mode rpc` subprocess per step; JSONL RPC; `handleExecute` orchestration; repair turns. |
| `T` Tool registry | pi tool set under path guard + tool-capability probe; filesystem scope from `policy`; model routes via ofox.ai (kimi-k2). |
| `C` Context manager | prompt assembly (`buildPrompt`), SeedWorkspace prep (`prepareSeedWorkspace`), input-artifact materialization, repair-prompt injection. |
| `S` State store | pi session dir + workspace tmpdir → session archive (`captureSessionArchive`); bound to Gas City bead via `bead_id` / `session_id`. |
| `L` Lifecycle hooks | `createSession`/`status`/`restart`/`destroy` map to `ensureContainerReady`, `statusResponse`, `restartContainer`, container stop; backpressure (`BoundedSerialQueue`), execute timeout. |
| `V` Evaluation interface | contract evaluation (`evaluateContracts`) + artifact manifest → `artifact_manifest`; optional internal verification → `verifier_report_ref`. Evidence only; not the molecule verdict. |
| `G` Governance interface | path guard, tool-capability gate, policy events; build-version restart guard; audit via `policy_events` + `runtime_identity`. |
| `P` Purpose binding | `purpose` + `context_refs` (`fn_id`/`is_id`/`es_id`/`ep_id`) carried through to evidence; scope narrows with bead/step. |

**AC-HT2 — `cloudflare-sandbox` tuple mapping.**

| Slot | `cloudflare-sandbox` implementation |
| --- | --- |
| `E` Execution loop | `POST /session/:id/exec` (command run); NO AI reasoning loop. |
| `T` Tool registry | shell command surface only; filesystem under `/workspace`; copy/file-materialize; NO model routes. |
| `C` Context manager | input-file materialization via `POST /session/:id/copy`; git clone via session boot `repo`. |
| `S` State store | Cloudflare Sandbox container FS; backup/restore handle (R2). Bound to Gas City bead via `session_id`. |
| `L` Lifecycle hooks | `POST /session` (boot), `GET /session/:id/status`, `POST /session/:id/stop`, pool reconciler; cold-start retry. |
| `V` Evaluation interface | exec exit code + stdout/stderr → `provider_verdict` + `artifact_manifest` (produced-file existence). Evidence only. |
| `G` Governance interface | path-traversal guard on `copy` (already in M0 worker); `policy_events` for denied paths; NO governance reasoning. |
| `P` Purpose binding | `purpose` + `context_refs` carried through; the M0 worker stores a session record and metadata it can echo back. |

**AC-HT3.** `cloudflare-sandbox` intentionally does NOT cover `ai_reasoning`. Its
`V` slot is existence/exit-code only — it cannot evaluate code quality and MUST
NOT be selected for steps requiring `ai_reasoning` (AC-REG6). This is the
architecture reference §Provider Families statement: cloudflare-sandbox is "for
command/file execution ... NOT for AI reasoning."

---

## Provider selection algorithm (normative)

Gas City selects a provider for a Formula step as follows. This is the AC-REG2 /
AC-REG3 algorithm stated end to end so the implementer has no ambiguity:

1. Read the step's `runtime_requirements` (a set of capability keys; never Factory
   internals — AC-REG/architecture item 1).
2. Read the city config's allowed-provider list for this agent/role.
3. For each allowed provider, read its capability declaration and its current
   `capacity` (via `status`, AC-LC9).
4. Filter to providers whose declared capability set ⊇ `runtime_requirements`
   AND whose `capacity > 0`.
5. If the filtered set is empty → return `no_provider_for_requirements`; the step
   does not execute (AC-FC1). No default, no fallthrough (AC-REG3).
6. If exactly one remains → select it.
7. If more than one remains → select deterministically by city config preference
   order (the order providers are listed for the agent). Determinism is required
   so replay is reproducible.

Before `executeStep`, Gas City asserts the three preconditions (AC-FC1..3):
verifier_contract present, policy present, provider selected. Any missing → 422-class,
no execution.

---

## Success Metrics

- A Formula step declares `runtime_requirements` (capability keys, no Factory
  internals) and Gas City selects a provider from the registry using formula,
  policy, city config, and capacity (AC-REG1, AC-REG2).
- A step requiring `ai_reasoning` selects `pi-rpc`; a setup/teardown-only step may
  select `cloudflare-sandbox`; neither falls through to a default (AC-REG5,
  AC-REG6, AC-FC1).
- Missing provider, missing verifier contract, or missing policy fails closed
  before any execution (AC-FC1, AC-FC2, AC-FC3).
- The selected provider runs in an isolated runtime (pi container / cloudflare
  sandbox) and returns a response envelope whose `provider_verdict` is an
  execution-status signal distinct from the molecule verdict (AC-RS1, AC-RS2).
- Provider evidence includes execution logs, artifact manifest, policy events,
  runtime identity, and model usage where applicable (AC-RS1, AC-EV1).
- Gas City fidelity validation consumes provider evidence and emits the molecule
  verdict separately from provider execution status (AC-EV1).
- The Factory RELEASE payload carries only `{ fn_id, is_id, es_id, ep_id, form_id,
  bead_id, factory_attempt, outcome, remediation? }` — no provider internals
  (AC-EV2, AC-EV3) — and is accepted by the existing webhook receiver.
- `pi-rpc` is registered, tuple-complete (AC-REG4), and proven as the first
  compatibility provider with the coder agent moved off the empty-`AGENT_CMD`
  cloudflare path (AC-PI7, AC-PI8).
- Every provider maps all eight Harness Tuple slots; a provider covering only E is
  rejected at registration (AC-REG4, AC-HT1, AC-HT2).

## Non-negotiables

- **Factory never calls a provider directly.** Gas City owns selection and
  operation. (Architecture reference §Decision; ADR-010 §1.)
- **`pi-rpc` is not the only provider.** `cloudflare-sandbox` is registered from
  day one for setup/teardown. (Architecture reference §Non-Goals.)
- **No Factory coherence verification inside providers.** Coherence Verification
  stays in the Factory. (Architecture reference §Non-Goals.)
- **No NLAH.** No NLAH code, schema, or dispatch path is preserved. (ADR-010 §1;
  architecture reference §Non-Goals.)
- **Provider-local success is not molecule success.** `provider_verdict=completed`
  does not mean the molecule is accepted; only Gas City fidelity validation
  decides (AC-RS2, AC-EV1). (Architecture reference §Non-Goals.)
- **Worker and evaluator are structurally separate.** A provider cannot certify
  its own final correctness (AC-FC7). (Architecture reference §Ontology
  Constraints.)
- **Fail closed.** Missing provider / verifier_contract / policy → no execution;
  policy violation → stop + `policy_violation`; "agent says done" without manifest
  match → not completed; timeout → archive + bead stays open (AC-FC1..6).
- **No Factory categories inside providers.** Coding concepts (repos, branches,
  diffs, PRs, CI, deployments) belong to the coding Domain Adapter, not the
  provider kernel. The provider carries `context_refs` as opaque purpose-binding
  and never interprets them (AC-RQ2, AC-RQ3).
- **No LLM vocabulary leaks into the contract.** The envelope is Gas City domain
  language (provider, capability, purpose, policy, verifier contract); it does not
  name LLM-provider-specific concepts in the schema.

## Open questions

1. **Fidelity validation residence.** *Resolved-by-artifact:* `IS-GC-FIDELITY-VALIDATION`
   (committed 2026-05-28) fully specifies this. Gas City-native, deterministic,
   no LLM, no Factory round-trip. AC-EV1/AC-EV3 are satisfied.

2. **`pi-rpc` session model under Gas City.** *Resolved-by-decision (2026-05-28):*
   Keep singleton/bounded model. PI_CONTAINER remains a warm bounded DO; `pi-rpc`
   maps Gas City `session_id` → `RunRequestMeta`. Preserves proven warm-container
   behavior and backpressure. One PI container per Gas City session is not adopted.

3. **Where the registry and selection live.** *Resolved-by-reasoning:* ADR-010 §3
   (ZFC) + "ZERO hardcoded roles" settles this. Registry and capability declarations
   live in city configuration (`city.toml` provider blocks), not Go code. Consistent
   with IS-GC-FIDELITY-VALIDATION Q2 (gate-class table also in config). No judgment
   enters Go.

4. **`runtime_requirements` vocabulary.** *Resolved-by-decision (2026-05-28):*
   Approved with two domain-agnosticity amendments: `git_clone` → `workspace_init`
   (provider initializes a work environment from any source reference, not just VCS)
   and `path_guard` → `workspace_write_scope` (provider enforces write-scope
   restrictions to a defined workspace boundary, not coding-specific). Final key set:
   `ai_reasoning`, `model_routing`, `workspace_write_scope`, `command_exec`,
   `file_materialize`, `workspace_init`, `dependency_prep`, `session_archive`,
   `snapshot_restore`, `contract_evaluation`, `tool_capability_probe`, `backup_restore`.

5. **ofox.ai vs AI Gateway for `model_usage`.** *Resolved-by-evidence:* ofox.ai
   stays for the pi container (cost decision, retained from 2026-05-17). `pi-rpc`
   `model_usage` comes from the pi observation `totalUsage` + ofox.ai-routed model
   id. AI Gateway analytics are not required for the day-one envelope.
