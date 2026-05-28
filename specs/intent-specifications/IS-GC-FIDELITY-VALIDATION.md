---
id: IS-GC-FIDELITY-VALIDATION
version: 1
title: "Gas City Fidelity Validation — deterministic provider-evidence-to-verdict bijection, RELEASE webhook emission, and the convergence loop that drives revise"
sourceCapabilityId: BC-GC-FIDELITY-VALIDATION
sourceFunctionId: FP-GC-FIDELITY-VALIDATION
source_refs:
  - IS-GC-RUNTIME-PROVIDER-CONTRACT
  - GAS-CITY-ERA-ARCHITECTURE
  - GAS-CITY-HARNESS-RUNTIME-PROVIDER-ARCHITECTURE
  - FF-CODING-ARCHITECTURE
  - GOVD-GAS-CITY-PHASE1-INTEGRATION
  - IS-GC-EP-FORMULA-DISPATCH
  - IS-GC-DISPATCH-WIRE
  - ADR-010-gas-city-supersedes-nlah
explicitness: explicit
rationale: >
  IS-GC-RUNTIME-PROVIDER-CONTRACT specifies how a provider produces an execution
  response envelope and routes its evidence into "Gas City fidelity validation"
  (AC-EV1), then terminates in the Factory RELEASE webhook carrying
  `outcome: approved | revise` (AC-EV3). That IS deliberately scoped the validator
  itself out and recorded the gap as its open question Q1: "Where does Gas City
  fidelity validation live and how does it compute approved/revise from provider
  evidence?" This IS closes Q1.

  The architecture reference §Gaps states plainly: "There is no implemented
  fidelity-validator intake for provider evidence" and "There is no webhook proof
  from Gas City back into Factory for provider-backed molecule completion." This IS
  specifies the validator that consumes the response envelope, the deterministic
  bijection from one evidence set to exactly one verdict, the RELEASE webhook
  emission, and the convergence loop that re-runs a molecule on `revise` up to the
  configured amendment depth. It specifies behavior and interfaces only — no Go,
  no TypeScript. A CodingAgent implements against it without re-litigating any
  architecture decision recorded here.

  Residence (the load-bearing answer to Q1): Gas City owns fidelity validation. It
  runs inside the Gas City supervisor after a molecule step completes and before
  the RELEASE webhook is sent. It is NOT inside the provider (a provider cannot
  certify its own correctness — Ontology Constraint), NOT inside the Factory (the
  Factory only transcribes the verdict it receives — GAS-CITY-ERA §intro), and NOT
  an LLM call (GOVD D3: deterministic only). The validator is a pure function of the
  response envelope plus the step type plus the molecule's prior step verdicts.

  Reconciliation of GOVD D-NEW-1 vs GAS-CITY-ERA: D-NEW-1 (2026-05-20) placed
  "semantic judgment" in the Factory and "execution mechanism" in Gas City. The
  GAS-CITY-ERA architecture (2026-05-26, authoritative, "supersedes all
  synthesis-era lifecycle/fidelity design") resolves the apparent tension by
  collapsing the verdict to one bit produced on the Gas City side. The D-NEW-1
  llm_tension_resolution already foresaw this: Coherence Verification does the
  semantic work pre-dispatch (acceptance criteria faithfully represent the IS), so
  the post-execution verdict is a structural/deterministic bijection — exactly what
  this IS specifies. The Factory's "Fidelity Verification" remains a fail-closed
  transcription of the bit (webhook-receiver.ts). No contradiction survives:
  Gas City computes the bit deterministically; the Factory records it.
---

# Gas City Fidelity Validation

## JTBD

When a Gas City molecule step finishes and the runtime provider has returned its
execution response envelope, Gas City wants to decide — deterministically, with no
LLM and no provider self-certification — whether the step result is acceptable, so
that exactly one verdict (`approved` or `revise`) is produced from one evidence
set, the right verdict is carried to the Factory through the existing RELEASE
webhook, and a failing step is either re-run with actionable remediation or
escalated when the amendment depth is exhausted.

## Problem

IS-GC-RUNTIME-PROVIDER-CONTRACT ends mid-air. A provider runs a step, collects
evidence, and the response envelope is well specified (AC-RS1: `status`,
`provider_verdict`, `artifacts`, `artifact_manifest`, `policy_events`,
`model_usage`, `runtime_identity`, `session_archive_ref`, `verifier_report_ref`,
`error`). AC-EV1 then says that evidence "flows into Gas City fidelity validation"
and AC-EV3 says the RELEASE payload's `outcome` is "the molecule verdict from Gas
City fidelity validation." But nothing turns the envelope into `approved | revise`.
The provider verdict is explicitly NOT the molecule verdict (AC-RS2). The Factory
only transcribes (GAS-CITY-ERA §3, webhook-receiver.ts): it will record whatever
bit it receives without recomputing it. So the bit has no producer.

Without this validator:
- A step can complete (`status=completed`) and no verdict is emitted — the bead
  hangs with no RELEASE.
- "The agent says it is done" could leak through as success — the architecture
  Ontology Constraint that stop conditions be externally verifiable has no
  enforcement point on the Gas City side.
- The convergence loop has no input. There is no decision that says "re-run with
  this remediation" versus "this is done."
- A `revise` could be emitted with empty or vague remediation, defeating the
  amendment loop (FN-V2 chain) because the next attempt has nothing to act on.

This IS gives the bit a deterministic producer and specifies how that producer
connects to the convergence loop and to the RELEASE webhook the Factory already
accepts.

## Goal

1. A **fidelity validator** owned by Gas City that runs after a molecule step's
   provider response envelope is available and before the RELEASE webhook is sent.
   Deterministic, no LLM (GOVD D3). Provider cannot be its own validator
   (Ontology Constraint, AC-FC7).
2. A **verdict bijection**: a pure function from `(response envelope, step type,
   prior step verdicts in the molecule)` to exactly one `{ outcome, remediation }`,
   where `outcome ∈ {approved, revise}` and `remediation` is the empty string for
   `approved` and an actionable instruction for `revise`. Same inputs → same
   verdict, always (replay-reproducible).
3. A **required-check set** that every step must pass to be `approved`, plus
   **per-step-type checks** keyed to the FF-CODING-ARCHITECTURE pipeline stages
   (SEED, CONTRACT, MAP, PATCH, VERIFY, RELEASE).
4. A **gate-class mapping** from each check to the FF-CODING-ARCHITECTURE four-gate
   taxonomy (Pre-flight / Revision / Escalation / Abort), so the verdict and the
   remediation reflect whether a failure is repairable, terminal, or escalatable.
5. A **RELEASE webhook emission** that POSTs the exact payload shape the Factory's
   `POST /webhooks/gascity` handler accepts — no provider internals cross the
   boundary.
6. A **convergence loop** that, on `revise` and below the amendment-depth limit,
   re-runs the molecule with the remediation injected as context, increments
   `factory_attempt`, and on depth exhaustion emits a terminal `revise` whose
   remediation states the depth-exceeded condition (Factory then opens
   `INC-GC-AMENDMENT-DEPTH-*`).
7. A **fail-closed posture**: every ambiguity resolves to `revise`. A missing or
   uncomputable check is never treated as a pass.

## Scope

**In scope:**

- The fidelity validator's residence (Gas City supervisor, post-step,
  pre-RELEASE), trigger, and determinism contract.
- The verdict bijection: inputs, the ordered required checks, the per-step-type
  checks, the precedence rule that selects the single reported failure, and the
  `{ outcome, remediation }` output schema.
- The mapping of each check to the four-gate taxonomy and what each gate class
  does to `outcome` and to the convergence loop.
- The remediation construction rules (actionable: which check failed + what the
  agent must do differently).
- The RELEASE webhook payload construction (sourcing lineage from bead labels)
  and the emission contract (HMAC, idempotency anchor, retry).
- The convergence loop: re-run condition, remediation injection, `factory_attempt`
  increment, depth limit, and the terminal-revise-at-depth behavior.
- The molecule-level verdict (RELEASE step) as the AND of all prior step verdicts.

**Out of scope:**

- The provider request/response envelope schema. Frozen by
  IS-GC-RUNTIME-PROVIDER-CONTRACT. This IS consumes the response envelope; it does
  not redefine it.
- The Factory-side webhook receiver. Frozen by GAS-CITY-ERA §3 and
  webhook-receiver.ts. This IS produces the payload that handler accepts; it does
  not change the handler.
- The Factory-side `GasCityFidelityVerificationReport` schema, lifecycle
  transitions, `completion_events`, `fidelity_verdicts`, `SIG-*` amendment signal,
  or `INC-GC-AMENDMENT-DEPTH-*`. Those are Factory artifacts produced when the
  webhook arrives (GAS-CITY-ERA §2, §4, §5). This IS specifies what triggers them
  (the emitted bit) but never their internal shape.
- The provider policy compiler (`IS-GC-PROVIDER-POLICY-COMPILER`). This IS reads
  `policy_events` from the envelope; it does not produce the `policy` that
  generated them.
- The durable replay/evidence manifest (`IS-GC-PROVIDER-EVIDENCE-ENVELOPE`). This
  IS requires only that the envelope fields needed to validate are present and
  Gas City-owned; it does not specify the durable manifest.
- Any LLM-driven re-scoring, "softening," or override of the deterministic verdict.
  Forbidden (GOVD D3; Non-negotiables).
- Coherence Verification. Stays in the Factory, pre-dispatch (GOVD D4,
  GAS-CITY-ERA). The post-execution verdict here does NOT re-evaluate IS claims
  from natural language (GOVD D-NEW-1 llm_tension_resolution).

## Architecture context (grounding, not re-litigation)

Settled upstream; restated only so the implementer does not redraw the boundary:

- **One bit crosses the boundary (GAS-CITY-ERA §intro).** "Gas City sends one bit:
  `outcome: approved | revise`. Factory's Fidelity Verification is therefore not a
  computation — it is a fail-closed transcription of an external authoritative
  verdict into a lineage-bearing artifact." Gas City fidelity validation is what
  PRODUCES that bit.
- **Provider verdict ≠ molecule verdict (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-RS2,
  AC-FC7; Ontology Constraint).** The provider reports `status ∈ {completed,
  failed, policy_violation, timeout, cancelled}` and a `provider_verdict`
  execution-outcome object. The molecule verdict (`approved | revise`) is computed
  here, by Gas City, never by the provider. A provider that ran internal
  verification supplies `verifier_report_ref` as evidence — that report is an
  input to this validator, not the verdict.
- **Stop conditions must be externally verifiable (Ontology Constraint).** "The
  agent says it is done" is not sufficient. The validator's required checks are the
  external verification: `status=completed` plus a fully `produced`
  `artifact_manifest` plus no unresolved policy violations.
- **Deterministic, no LLM (GOVD D3; D-NEW-1 llm_tension_resolution).** The verdict
  is structural. The semantic gap was closed pre-dispatch by Coherence
  Verification. The three D-NEW-1 deterministic checks (evidence completeness,
  acceptance-criteria verdict bijection, execution coverage) are the conceptual
  ancestors of the checks specified below.
- **Lineage is stamped at dispatch (IS-GC-EP-FORMULA-DISPATCH §step labels,
  AC-20).** Every Gas City step's bead carries labels `fn-id:`, `is-id:`, `es-id:`,
  `form-id:`, `factory-attempt:` (and `amendment-of:` for attempts ≥ 2). The
  validator reads these to populate the RELEASE payload's lineage fields. It does
  NOT invent or recompute lineage.
- **RELEASE is a step in the formula, not a Factory call (GOVD D8
  mechanism_correction).** Gas City has no native HTTP webhook emission. The
  RELEASE `[[step]]` in `factory-coding-v1.toml` performs the HTTP POST to the
  Factory webhook. This IS specifies what that step POSTs and when; it does not add
  a native webhook feature to Gas City.
- **Amendment is FN-V2 (GOVD D5).** A terminal `revise` becomes a Factory `SIG-*`
  and ultimately a successor Function. Gas City does not amend the Function; it
  emits the bit and the remediation. The Factory governs amendment.

## Definitions

- **Molecule step** — one `[[steps]]` block in the Gas City formula, executed by a
  provider via `executeStep` (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-LC3). Maps to a
  FF-CODING-ARCHITECTURE pipeline stage (SEED, CONTRACT, MAP, PATCH, VERIFY,
  RELEASE) by its `step_name` / `role_name`.
- **Step type** — the pipeline-stage classification of a step, derived
  deterministically from `step_name` (and `role_name` as a fallback). Determines
  which per-step-type checks apply.
- **Response envelope** — the provider's `executeStep` output
  (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-RS1). The validator's primary input.
- **Check** — a named, deterministic predicate over the validator's inputs that
  yields `pass | fail` plus, on fail, a remediation fragment and a gate class.
- **Gate class** — one of FF-CODING-ARCHITECTURE §5.1 {Pre-flight, Revision,
  Escalation, Abort}. Classifies what a failed check means for the verdict and the
  convergence loop.
- **Step verdict** — the validator's `{ outcome, remediation }` for a single step.
- **Molecule verdict** — the verdict the RELEASE step emits to the Factory. It is
  `approved` iff every prior step in the molecule is `approved` (FV-08); otherwise
  `revise`.
- **Remediation** — empty string when `approved`; otherwise a single actionable
  instruction string naming the failed check and what the agent must do
  differently. It is Factory-domain language — no provider internals (paths,
  container ids, model ids) leak (FV-15).
- **Amendment depth** — `factory_attempt`. Configured limit
  `GAS_CITY_MAX_AMENDMENT_DEPTH` (default 3, GOVD D9). Exhaustion → terminal
  `revise`.

---

## Acceptance Criteria

Each AC is testable in isolation. Numbered FV-\* (Fidelity Validation).

### Residence and trigger (FV-01..FV-04)

**FV-01 — Residence.** Fidelity validation runs inside the Gas City supervisor, as
a step of the molecule's execution path, after the provider's `executeStep`
response envelope is available for a given step and before the RELEASE webhook is
sent for the molecule. It is NOT a provider responsibility, NOT a Factory
responsibility, and NOT an LLM call. (Closes IS-GC-RUNTIME-PROVIDER-CONTRACT Q1;
GAS-CITY-ERA §intro; GOVD D3; Ontology Constraint AC-FC7.)

**FV-02 — Determinism.** The validator is a pure function:
`validate(response_envelope, step_type, prior_step_verdicts) → { outcome,
remediation }`. Given identical inputs it MUST return an identical verdict. No
clock, no randomness, no network read, no model call influences the verdict.
(GOVD D3; replay reproducibility.) Any input the validator needs beyond the three
named (e.g. the declared verifier contract) MUST be drawn from the already-computed
request/response envelope or the formula step definition, never re-fetched at
verdict time.

**FV-03 — No self-certification.** The validator MUST NOT be executed by the same
provider session that produced the response envelope, and MUST NOT treat the
provider's `provider_verdict` as the molecule verdict. `provider_verdict=completed`
is one input among the required checks, not a verdict. (IS-GC-RUNTIME-PROVIDER-CONTRACT
AC-RS2, AC-FC7; Ontology Constraint "Worker and evaluator are structurally
separate.")

**FV-04 — Single verdict per step.** Each step produces exactly one step verdict.
Re-validating the same response envelope (same provider `idempotency_key`,
IS-GC-RUNTIME-PROVIDER-CONTRACT AC-RQ5) MUST yield the same step verdict and MUST
NOT double-emit. The molecule produces exactly one molecule verdict, emitted once
by the RELEASE step (subject to webhook retry, FV-19).

### Verdict bijection and output schema (FV-05..FV-08)

**FV-05 — Output schema.** The step verdict is exactly:
```
outcome      enum   approved | revise
remediation  string ""  when outcome=approved
                    actionable instruction when outcome=revise
```
No third outcome. No `null`, no `unknown`, no `pending`. (GAS-CITY-ERA: the bit is
binary.) An `approved` verdict MUST carry `remediation == ""`; a `revise` verdict
MUST carry a non-empty `remediation` (FV-14).

**FV-06 — Bijection.** Exactly one evidence set maps to exactly one verdict. The
validator evaluates the required checks (FV-09) and the per-step-type checks
(FV-11) in a fixed, documented order; the FIRST failing check (by the precedence
in FV-12) determines `outcome=revise` and supplies the remediation fragment. If no
check fails, `outcome=approved`. Two evidence sets that differ only in fields no
check reads MUST produce the same verdict (the verdict depends only on checked
fields). (GOVD D8 "verdict bijection.")

**FV-07 — Fail-closed default.** Any check whose result cannot be computed from the
available inputs (missing field the check requires, malformed manifest entry,
unreadable verifier report reference where the step type requires it) is treated
as a FAILED check, never as a pass. The validator never emits `approved` on
incomplete evidence. (Architecture §Fail-closed list; GAS-CITY-ERA "A VR is only
created if ALL intake_checks pass.")

**FV-08 — Molecule verdict is the AND of step verdicts.** The molecule's RELEASE
step emits `approved` if and only if every prior step in the molecule produced
`approved`. If any prior step produced `revise`, the molecule verdict is `revise`
and its remediation is the remediation of the earliest-failing step (lowest step
index). This is the RELEASE-step required check `all_prior_steps_approved`
(FF-CODING-ARCHITECTURE §1.1 RELEASE inputs; §5.2 RELEASE gates).

### Required checks for `approved` (FV-09..FV-10)

**FV-09 — Universal required checks.** For ANY step type, `outcome=approved`
requires ALL of the following to pass. Each is a deterministic predicate over the
response envelope:

1. **`provider_status_completed`** — `status == completed`. Any of `failed |
   policy_violation | timeout | cancelled` → fail. (IS-GC-RUNTIME-PROVIDER-CONTRACT
   AC-RS1; the provider did not finish cleanly.)
2. **`declared_outputs_produced`** — every entry of the request's
   `declared_outputs` appears in `artifact_manifest` with state `produced` and a
   computed checksum. Any `missing` declared output → fail. `extra` artifacts do
   NOT fail this check (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-RS3). This is the
   externally-verifiable stop condition: "agent says done" with a `missing`
   output is NOT a completion (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-FC5; Ontology
   Constraint).
3. **`no_unresolved_policy_violations`** — `policy_events` contains zero entries of
   kind `violation` that are not marked resolved. `allow` / `deny` / `escalation`
   events that did not become a `violation` do not fail this check. A `status` of
   `policy_violation` (check 1) and an unresolved `violation` event are
   consistent — both fail. (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-LC6, AC-FC4,
   AC-PI3.)
4. **`stop_condition_externally_verifiable`** — the completion was established by
   the manifest match (check 2), NOT solely by a provider self-report end-of-turn
   signal. If the envelope indicates completion was claimed without a
   manifest-backed produced set, fail. (Ontology Constraint; redundant with
   check 2 but stated separately so the remediation can name the principle.)

If all universal checks pass and all applicable per-step-type checks (FV-11) pass,
`outcome=approved`.

**FV-10 — `error` consistency on non-completed.** When `status != completed`, the
validator MUST emit `revise` and MUST construct remediation from the envelope's
structured `error` (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-RS4) `{ code, message }`,
translated into Factory-domain language (FV-15). The validator MUST NOT emit
`approved` for any non-`completed` status under any circumstance.

### Per-step-type checks (FV-11..FV-13)

**FV-11 — Step-type derivation.** The validator derives the step type from
`step_name` (primary) and `role_name` (fallback) against the
FF-CODING-ARCHITECTURE §1.1 stages. The mapping is exact and case-insensitive on
the stage token:
```
SEED      → SeedWorkspace setup step
CONTRACT  → IssueContract step      (role: Cartographer)
MAP       → RepoMap step            (role: Cartographer)
PATCH     → CandidatePatch step     (role: PatchWorker)
VERIFY    → VerifierReport step     (role: Verifier)
RELEASE   → FinalPatch/PRSummary    (role: ReleaseAgent)
```
A step whose name matches no known stage uses ONLY the universal checks (FV-09).
It is not failed for being unrecognized, but it gets no stage-specific gate.

**FV-12 — Per-step-type required checks and precedence.** In addition to the
universal checks, the following per-step-type checks apply. Checks are evaluated in
the listed order; the universal checks (FV-09, in their listed order 1→4) are
evaluated BEFORE the per-step-type checks. The first failing check in the combined
order determines the verdict (FV-06). The gate class governs the convergence
behavior (FV-13).

PATCH step:
- **`patch_non_empty`** — the CandidatePatch artifact has non-zero diff content.
  An empty patch → fail. Gate class: **Revision**. (FF-CODING-ARCHITECTURE §5.2
  PATCH `exists`.)
- **`patch_applies_cleanly`** — the verifier evidence / manifest indicates the diff
  applies without conflict to the seed workspace. Conflict → fail. Gate class:
  **Revision** (the canonical DEFECT-1 path). (FF-CODING-ARCHITECTURE §5.2,
  INV-CODING-01.)
- **`patch_in_declared_scope`** — every path touched by the diff is within the
  step's declared write scope. A touched path outside scope appears either as a
  `policy_events` violation (caught by FV-09 check 3) or as an `extra`
  forensic-stripped manifest entry. A genuine out-of-scope WRITE that reached the
  artifact set → fail. Gate class: **Revision** (Layer 1/2) or **Escalation** if a
  Layer 3 substrate boundary fired (FF-CODING-ARCHITECTURE §3.5: Layer 3 firing is
  a high-severity Signal). The validator distinguishes by the `policy_events`
  entry's source layer when present.

VERIFY step:
- **`verifier_report_present`** — `verifier_report_ref` is non-null and resolvable.
  Absent → fail. Gate class: **Pre-flight** (the report must exist before the
  verdict check). (FF-CODING-ARCHITECTURE §5.2 VERIFY `exists`; INV-CODING-03.)
- **`verifier_exit_code_zero`** — the verifier report indicates the critic accepted
  the patch (exit code 0 / `verifier_accepts_patch`). Non-zero / REJECT → fail.
  Gate class: **Abort** — "independent verification said no" is terminal for this
  attempt (FF-CODING-ARCHITECTURE §5.2 VERIFY `verifier_accepts_patch` = Abort if
  FAIL). A terminal Abort here produces `outcome=revise` at the molecule level
  (the attempt failed) but MUST NOT be re-run inside the same molecule by the
  convergence loop (FV-18); it goes back to the Factory as `revise` for the FN-V2
  amendment path.
- **`tests_support_claims`** — the verifier report contains a `## Tests run`
  section with captured command output (INV-CODING-03). Missing → fail. Gate
  class: **Revision** on first occurrence; **Abort** if persistently missing across
  the molecule's repair turns (FF-CODING-ARCHITECTURE §5.2
  `test_results_support_claims`).
- **`verifier_distinct_from_author`** — when the envelope carries the model
  identity for both PATCH and VERIFY (`model_usage.model_id`,
  IS-GC-RUNTIME-PROVIDER-CONTRACT AC-RS6), the VERIFY model MUST NOT equal the
  PATCH model (INV-CODING-04). Equal → fail. Gate class: **Escalation** — this is a
  configuration/governance violation, not an agent-repairable defect. When the
  envelope does not carry both model identities, this check is **not applicable**
  (it is a configuration invariant enforced at provider-selection time per
  IS-GC-RUNTIME-PROVIDER-CONTRACT §4.7), and the validator MUST NOT fabricate a
  failure from missing identity — it records the check as not-applicable, not
  fail. (This is the one exception to FV-07 fail-closed: a configuration invariant
  the envelope cannot witness is out of the validator's evidence scope; it does not
  manufacture a violation.)

RELEASE step:
- **`all_prior_steps_approved`** — every prior step verdict in the molecule is
  `approved` (FV-08). Any `revise` → fail. Gate class: **Pre-flight** (RELEASE must
  not emit `approved` over a failed prior stage). (FF-CODING-ARCHITECTURE §1.1
  RELEASE inputs.)
- **`final_patch_matches_verified_candidate`** — the FinalPatch artifact is diff-
  identical to the VERIFY-accepted CandidatePatch. Mismatch → fail. Gate class:
  **Abort** (FF-CODING-ARCHITECTURE §5.2 RELEASE `final_patch_matches_verified_candidate`
  = Abort if mismatched). Produces molecule `outcome=revise`, no in-molecule re-run.

SEED / CONTRACT / MAP steps:
- **`output_exists`** — the declared output (SeedWorkspace / IssueContract /
  RepoMap) is `produced` in the manifest. This is already covered by FV-09 check 2;
  it is named here only so the remediation can reference the stage output by name.
  Gate class: **Pre-flight**.
- MAP additionally: **`repo_map_content_adequate`** — the RepoMap names relevant
  files and test entrypoints (FF-CODING-ARCHITECTURE §5.2 MAP content checks). Only
  evaluable when the provider exposes a content-pattern result in its evidence;
  when not exposed, this check is **not applicable** (the universal `output_exists`
  still governs). Gate class: **Revision**.

**FV-13 — Gate class governs convergence, not the binary verdict.** Every failing
check yields `outcome=revise` at the step level. The gate class does NOT change the
binary verdict — it changes what the convergence loop does (FV-16..FV-18):
- **Revision** failures → eligible for in-molecule re-run if depth allows.
- **Pre-flight** failures → eligible for in-molecule re-run (cheap structural
  re-attempt) if depth allows; if the missing input is upstream, the earliest-
  failing-step rule (FV-08) attributes it to the producing step.
- **Abort** failures → NOT re-run in-molecule; emitted to the Factory as `revise`
  for the FN-V2 amendment path (the attempt is terminal).
- **Escalation** failures → NOT re-run in-molecule; emitted to the Factory as
  `revise` with remediation flagged for human/architect attention; the Factory
  records the `SIG-*` and (for a configuration/governance violation) the operator
  sweeper picks it up. The validator never pauses for a human itself — it emits the
  bit and the flagged remediation. (FF-CODING-ARCHITECTURE §5.1: Escalation is
  "never a default.")

### Remediation construction (FV-14..FV-15)

**FV-14 — Remediation is actionable and specific.** A `revise` remediation MUST
name (a) the specific check that failed and (b) what the agent must do
differently, in one or two sentences. It MUST be sufficient for the next attempt to
act without re-reading provider internals. Examples of the required SHAPE (not
literal text):
- `patch_applies_cleanly` fail → "The candidate patch did not apply to the seed
  workspace; regenerate the diff against the current file contents and ensure
  hunks match."
- `verifier_exit_code_zero` fail → "Independent verification rejected the patch:
  <verifier summary>. The implementation does not satisfy the acceptance criteria;
  a new attempt must address: <criteria>."
- `declared_outputs_produced` fail → "Declared output <name> was not produced.
  Produce <name> before completing the step."

**FV-15 — No provider internals in remediation.** The remediation MUST be expressed
in Factory-domain terms (declared outputs, acceptance criteria, the step purpose).
It MUST NOT contain provider-specific identifiers: container ids, R2 keys, pi
session paths, raw model ids, internal file-system absolute paths, or
provider-internal error codes. (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-EV2, AC-EV3 "no
provider internals.") Where a provider `error.code` is the trigger, it is
translated to a Factory-domain statement, not passed through verbatim.

### Convergence loop (FV-16..FV-18)

**FV-16 — Re-run condition.** When a step verdict is `revise` AND the failed
check's gate class is `Revision` or `Pre-flight` AND `factory_attempt <
GAS_CITY_MAX_AMENDMENT_DEPTH` (default 3, GOVD D9), Gas City MAY re-run the
molecule with the remediation injected as execution context. The re-run is a Gas
City-internal convergence iteration; it does NOT emit a RELEASE webhook for the
failed intermediate attempt. (GAS-CITY-ERA §4; FF-CODING-ARCHITECTURE §5.1 Revision
"max 3 iterations.")

**FV-17 — Remediation injection and attempt increment.** Each in-molecule re-run
injects the FV-14 remediation into the re-run's step context (the mechanism is the
provider request envelope's `inputs` / repair-context, IS-GC-RUNTIME-PROVIDER-CONTRACT
AC-PI4 repair-prompt injection). The convergence iteration counter advances per
re-run. The escalate-early rule applies: if the failing-check count does not
decrease across iterations, the loop escalates early to a terminal `revise` rather
than exhausting the full depth (FF-CODING-ARCHITECTURE §5.1 Revision "escalates
early if the issue count does not decrease").

**FV-18 — Terminal verdicts bypass the loop.** A step verdict whose failed check is
gate class `Abort` or `Escalation` (FV-13) is terminal for the attempt: Gas City
does NOT re-run the molecule in-loop. It proceeds to emit the RELEASE webhook with
`outcome=revise` and the corresponding remediation. The FN-V2 amendment path
(Factory side, GOVD D5) is the only continuation.

### Depth exhaustion (FV-19 covered under emission; depth here)

**FV-18a — Depth-exceeded terminal revise.** When a `revise` verdict would
otherwise be re-run (FV-16) but `factory_attempt >= GAS_CITY_MAX_AMENDMENT_DEPTH`,
Gas City does NOT re-run. It emits the RELEASE webhook with `outcome=revise` and a
remediation that (a) carries the underlying failed-check remediation AND (b)
appends a depth-exceeded notice naming the limit and the attempt count. The Factory
receives this, and because `factory_attempt > maxAmendmentDepth` it opens
`INC-GC-AMENDMENT-DEPTH-*` instead of writing a re-dispatch signal
(webhook-receiver.ts `writeAmendmentDepthIncident`; GAS-CITY-ERA §4
`MaxAmendmentDepth`). Note the Factory's own guard is `>` (strictly greater); Gas
City's loop guard is `>=` for the re-run decision. Both are satisfied because the
attempt that hits the limit is emitted, not re-run, and arrives at the Factory with
the limit-reaching `factory_attempt`.

### RELEASE webhook emission (FV-19..FV-22)

**FV-19 — Exact payload shape.** The RELEASE step POSTs to `GAS_CITY_WEBHOOK_URL`
exactly the payload the Factory's `POST /webhooks/gascity` handler accepts
(webhook-receiver.ts `GasCityCompletionPayload`; GAS-CITY-ERA §3):
```
fn_id            string   from formula var {{fn_id}}
is_id            string   from formula var {{is_id}}
es_id            string   from formula var {{es_id}}
ep_id            string   from formula var {{ep_id}} (injected via sling vars at dispatch)
form_id          string   from formula var {{form_id}}
bead_id          string   the Gas City bead id for this molecule
factory_attempt  integer (bare JSON number, no quotes)   from formula var {{factory_attempt}}
outcome          enum     approved | revise   (the molecule verdict, FV-08)
remediation      string   omitted/empty for approved; the FV-14 string for revise
```
No additional fields. No provider internals. (IS-GC-RUNTIME-PROVIDER-CONTRACT
AC-EV3.)

**FV-20 — Lineage sourced from formula vars.** `fn_id`, `is_id`, `es_id`, `ep_id`,
`form_id`, `factory_attempt` come from formula template substitution — they are
injected as sling vars at dispatch time by the Factory formula compiler
(IS-GC-EP-FORMULA-DISPATCH §sling dispatch; workers/ff-pipeline formula-compiler.ts).
The validator MUST NOT recompute or invent them; it transcribes the already-substituted
values that appear literally in the PAYLOAD heredoc. `factory_attempt` MUST be emitted
as a bare JSON integer (no surrounding quotes); the Factory schema requires
`Number.isInteger(payload.factory_attempt)` (webhook-receiver.ts `parsePayload`). A
formula var that is absent (empty string after substitution) or produces a non-integer
for `factory_attempt` is a fail-closed condition: do NOT emit a malformed payload;
instead emit a Gas City operational event (`molecule.failed`) so the bead does not
silently hang. *Q5 resolved-by-evidence: formula vars, not bead labels — confirmed
from factory-coding-v1.toml lines 273–284 and formula-compiler.ts sling call.*

**FV-21 — HMAC and headers.** The RELEASE POST is HMAC-signed: header
`X-GC-Signature: sha256=<hex>` over the raw request body bytes, and `X-GC-Key-ID:
v1` (webhook-receiver.ts `verifyGasCityHmac`; GAS-CITY-ERA §3 HMAC; GOVD D8). The
signing key id `v1` is carried from the dispatch vars (`ff_webhook_hmac_keyid`,
IS-GC-EP-FORMULA-DISPATCH). The body bytes signed MUST be byte-identical to the
bytes POSTed (the Factory verifies raw bytes before JSON parse). Canonical byte
construction: build the JSON body via a heredoc assigned to a shell variable
(`PAYLOAD=$(cat <<EOF … EOF)`); `$()` command substitution strips exactly one
trailing newline, so the variable contains no trailing newline. Sign with
`printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex` — `printf '%s'`
adds no newline, so the signed byte sequence is the exact content of `$PAYLOAD`.
POST with `curl … -d "$PAYLOAD"` — unquoted-in-double-quotes, same bytes. JSON field
order in the heredoc is load-bearing for HMAC reproducibility: `fn_id`, `is_id`,
`es_id`, `ep_id`, `form_id`, `factory_attempt`, `bead_id`, `outcome`
(plus `remediation` when present, appended last). Implementations MUST preserve this
field order; any reordering invalidates the HMAC.

**FV-22 — Idempotency and retry.** The Factory anchors idempotency on `bead_id`
(GAS-CITY-ERA §3; webhook-receiver.ts `completion_events._key = bead_id`). Gas City
MUST send the same `bead_id` for a given molecule completion so a retried POST is
recognized as a duplicate (Factory returns 200 `{duplicate:true}`). On a non-2xx
Factory response, Gas City retries the RELEASE POST at least once (GAS-CITY-ERA §3
"Gas City retries once on non-2xx — giving a slow dispatch_log write time to
land"). The retry carries the identical payload and HMAC. Gas City MUST NOT change
`outcome` between the original and the retry.

### Evidence retention (FV-23)

**FV-23 — Provider evidence stays in Gas City.** The provider evidence consumed by
the validator (`artifacts`, `logs`, `policy_events`, `model_usage`,
`runtime_identity`, `session_archive_ref`, `verifier_report_ref`) remains
addressable inside Gas City for replay and audit
(IS-GC-RUNTIME-PROVIDER-CONTRACT AC-EV4) and MUST NOT appear in the RELEASE
payload. The verdict and the remediation are the ONLY products that cross to the
Factory. The validator records, alongside its verdict, which checks it evaluated
and which one failed (for Gas City-side audit) — this record stays in Gas City
(it is the input to the future `IS-GC-PROVIDER-EVIDENCE-ENVELOPE` replay manifest).

---

## Verdict algorithm (normative)

The validator computes a step verdict as follows. Stated end to end so the
implementer has no ambiguity. This is the FV-06 / FV-09 / FV-12 algorithm.

1. Derive `step_type` from `step_name` (fallback `role_name`) per FV-11.
2. Build the ordered check list:
   a. The four universal checks (FV-09) in order 1→4.
   b. The per-step-type checks for `step_type` (FV-12) in their listed order.
   For the RELEASE step, prepend `all_prior_steps_approved` (it is the RELEASE
   pre-flight).
3. Evaluate checks in order. For each:
   - If a required input for the check is missing or uncomputable, the check FAILS
     (FV-07), EXCEPT the two explicitly-not-applicable cases
     (`verifier_distinct_from_author` without both model identities;
     `repo_map_content_adequate` without an exposed content result), which are
     recorded not-applicable and skipped.
   - Record `pass | fail | not-applicable`.
4. Select the verdict:
   - If every evaluated check is `pass` or `not-applicable` → `outcome=approved`,
     `remediation=""`.
   - Otherwise → `outcome=revise`. The FIRST `fail` in evaluation order supplies
     the remediation (FV-14) and the gate class (FV-13).
5. For the RELEASE step, additionally apply FV-08: if any prior step verdict is
   `revise`, the molecule verdict is `revise` with the earliest-failing step's
   remediation (this is `all_prior_steps_approved` failing in step 2c).
6. The convergence loop (FV-16..FV-18a) reads the gate class of the failing check
   to decide re-run vs terminal vs depth-exceeded BEFORE the RELEASE webhook is
   emitted.
7. The RELEASE webhook (FV-19..FV-22) is emitted exactly once per molecule
   completion (subject to retry), carrying the molecule verdict.

Determinism check: steps 1–7 read only `(response_envelope, step_type,
prior_step_verdicts, formula step definition, bead labels)`. No clock, no random,
no network read, no model call. Same inputs → same verdict (FV-02).

---

## Success Metrics

- A molecule step completes, the provider returns a response envelope, and Gas City
  produces exactly one `{ outcome, remediation }` from it deterministically
  (FV-01, FV-02, FV-05, FV-06).
- A step with a `missing` declared output never yields `approved`, even when the
  provider reports the agent finished (FV-09 check 2; Ontology Constraint).
- A VERIFY step with absent `verifier_report_ref` or non-zero verifier exit code
  yields `revise` (FV-12 VERIFY checks).
- A PATCH whose diff does not apply cleanly yields `revise` with a remediation that
  tells the agent to regenerate against current contents (FV-12, FV-14).
- The RELEASE step emits `approved` only when every prior step verdict is
  `approved` (FV-08).
- The emitted payload is byte-shape-identical to what `POST /webhooks/gascity`
  accepts and is HMAC-valid; the Factory transcribes it into a
  `GasCityFidelityVerificationReport` without recomputing the verdict (FV-19,
  FV-21; GAS-CITY-ERA §3).
- On `revise` with a Revision/Pre-flight gate class and depth remaining, Gas City
  re-runs the molecule with the remediation injected and does NOT emit an
  intermediate webhook (FV-16, FV-17).
- On an Abort/Escalation gate class, Gas City does NOT re-run; it emits `revise`
  for the FN-V2 amendment path (FV-18).
- At depth exhaustion, Gas City emits a terminal `revise` whose remediation names
  the depth limit, and the Factory opens `INC-GC-AMENDMENT-DEPTH-*` (FV-18a;
  webhook-receiver.ts).
- No provider internals ever appear in the remediation or the payload (FV-15,
  FV-23, FV-19).

## Non-negotiables

- **Deterministic, no LLM.** The verdict is a pure structural function. No model
  call, ever, at verdict time. (GOVD D3.)
- **Gas City owns the verdict; the Factory transcribes.** The bit is produced here;
  the Factory does not recompute it. (GAS-CITY-ERA §intro.)
- **Provider never certifies itself.** The validator is structurally separate from
  the provider session that produced the evidence. `provider_verdict` is an input,
  not the verdict. (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-FC7; Ontology Constraint.)
- **Stop conditions are externally verifiable.** "Agent says done" without a
  manifest-backed produced set is never `approved`. (FV-09 check 2/4; Ontology
  Constraint.)
- **Bijective.** One evidence set → exactly one verdict. (GOVD D8; FV-06.)
- **Binary outcome.** `approved | revise` only. No third state, no `null`. (FV-05.)
- **Fail-closed.** Any uncomputable required check is a fail; ambiguity resolves to
  `revise`. (FV-07.)
- **Actionable remediation.** A `revise` always carries a non-empty, actionable,
  Factory-domain remediation naming the failed check and the corrective action.
  (FV-14, FV-15.)
- **No provider internals cross the boundary.** Only `{ lineage, bead_id,
  factory_attempt, outcome, remediation }` reaches the Factory. (FV-19, FV-23;
  IS-GC-RUNTIME-PROVIDER-CONTRACT AC-EV2.)
- **Exact webhook contract.** The payload shape and HMAC are exactly what the
  frozen Factory receiver accepts; this IS does not change the receiver. (FV-19,
  FV-21; GAS-CITY-ERA §3.)
- **No Factory categories invented.** Lineage is transcribed from bead labels, not
  recomputed. (FV-20.)

## Open questions

1. **Re-run mechanism granularity — Gas City runtime capability confirmation needed.**
   FV-16 re-runs "the molecule" on a Revision/Pre-flight `revise`. FF-CODING-ARCHITECTURE
   §4.2 / §5.1 models repair as return to the PREVIOUS authoring stage (e.g. a failed
   VERIFY returns to PATCH), not a full molecule restart. *Recommendation (adopted):*
   return-to-authoring-stage — it matches the four-gate Revision semantics verbatim and
   avoids redoing deterministic setup (SEED/CONTRACT/MAP). This depends on Gas City
   holding intermediate stage outputs across the iteration. Gas City must confirm
   molecule re-entry capability before the convergence loop is built. This is a Gas City
   runtime question, not a Factory architecture decision.

2. **Gate-class table location.** *Resolved-by-reasoning:* ADR-010 §3 (ZFC — no Go
   code contains a judgment call) settles this. The check-to-gate-class mapping is a
   fixed table (no judgment), and the ZFC-faithful form is configuration. Gate classes
   live in city configuration, not Go code. Consistent with IS-GC-RUNTIME-PROVIDER-CONTRACT
   Q3. No further decision needed.

3. **`escalate_early` issue-count metric.** *Resolved-by-reasoning:* issue count =
   count of failing checks in the verdict algorithm. Deterministic, validator-local,
   already computed by FV-06. No coupling to verifier report shape. Implementation uses
   this definition.

4. **VERIFY `tests_support_claims` Revision-vs-Abort threshold.** *Resolved-by-recommendation:*
   reuse `GAS_CITY_MAX_AMENDMENT_DEPTH - 1`. The last available iteration treats a
   persistently missing `## Tests run` section as Abort. Single tunable knob.
   Implementation uses this rule.

5. **`ep_id` propagation.** *Resolved-by-evidence* (see FV-20 above): `ep_id` is a
   formula var (`{{ep_id}}`) injected via sling vars at dispatch. It is already present
   in the PAYLOAD heredoc in `factory-coding-v1.toml`. No bead-label stamp required.
