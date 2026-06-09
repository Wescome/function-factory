# Crystallizer DSL Specification v0.1

## A language for intent anchors, pass probes, reconciliation behavior, remediation rules, and drift-memory semantics

## 0. Executive summary

The **Crystallizer DSL** is a declarative language for preserving intent across a multi-pass generative compiler.

Its purpose is simple:

> **Declare what must remain true about the original intent as the factory transforms it through compiler passes, agent stages, probes, remediation loops, and synthesis.**

A normal compiler preserves meaning through formal syntax and semantics. A generative compiler is different: it repeatedly asks models to transform ambiguous human intent into structured artifacts. Each transformation can subtly drift.

The Crystallizer DSL exists to control that drift.

It defines:

```text
1. Intent anchors
   The claims from the original signal that must survive transformation.

2. Pass probes
   Isolated yes/no checks applied to each compiler pass output.

3. Reconciliation behavior
   Deterministic rules for pass, warn, remediate, or escalate.

4. Remediation rules
   How violated anchors are fed back into the compiler safely.

5. Drift-memory semantics
   How the system records erosion, recurrent violations, and anchor reliability.
```

The DSL is not a prompt format. It is not a workflow language. It is not a generic agent harness.

It is a **fidelity language** for a generative compiler.

---

# 1. Background: why this DSL exists

Function-Factory transforms upstream signals into executable Functions through staged synthesis. That means the system does not merely run code; it compiles intent.

A simplified flow looks like:

```text
Signal
→ Pressure
→ Capability
→ Function Proposal
→ Compiler Passes
→ Synthesis
→ PR / deployment artifact
```

The weak point is not only code generation.

The weak point is **semantic erosion**.

A signal may begin as:

```text
“Block create actions on existing files to prevent destructive overwrites.”
```

After several transformation passes, the compiler may produce atoms that say:

```text
“Improve file writing behavior.”
```

That sounds related, but it has lost the decisive constraint:

```text
create-on-existing must be blocked
```

This is the “telephone game” problem in generative compilation.

The Crystallizer DSL solves this by declaring:

```text
This claim is an anchor.
This pass must preserve it.
This question checks it.
This answer means violation.
This violation blocks, warns, or logs.
This remediation feeds the violation back into the pass.
This drift must be remembered.
```

The core technical move is to convert fuzzy intent into **binary checkpoints** that can be probed after each pass.

The current repo already embodies this pattern. Intent crystallization decomposes a signal into 3–6 binary `IntentAnchor` checkpoints; each anchor includes a claim, probe question, violation signal, severity, counters, and optional applicable passes.  The probe engine is intentionally isolated: it uses a separate LLM call, sees only pass output plus yes/no questions, and does not see the compilation prompt, signal, or accumulated state.  The reconciliation gate is deterministic and emits `pass`, `warn`, `remediate`, or `escalate` based on probe violations and severity.

The DSL formalizes that pattern so coding agents can extend it without inventing parallel mechanisms.

---

# 2. Design goals

## 2.1 Preserve intent through transformation

The DSL must make original intent durable across compiler passes.

It must preserve:

```text
named concepts
scope boundaries
critical constraints
non-goals
target files / target artifacts
required behaviors
forbidden behaviors
acceptance-critical claims
```

## 2.2 Keep probes isolated

A probe must not share the same cognitive context as the generation pass.

The probe sees only:

```text
pass output delta
anchor questions
minimal probe instructions
```

It does not see:

```text
original generation prompt
full signal
prior chain of reasoning
compiler scratch state
accumulated conversation history
```

This avoids the model being cued by the same context that produced the possible drift.

## 2.3 Use binary questions

Probe questions should be yes/no.

The goal is state tracking, not open-ended judging.

Bad:

```text
“Explain whether the pass preserved the intent.”
```

Good:

```text
“Does any atom’s title, description, or verifies field mention create-on-existing file behavior?”
```

## 2.4 Make reconciliation deterministic

The model may generate anchors and answer probes, but the decision to continue, warn, remediate, or escalate must be code-level deterministic.

The gate must not ask an LLM whether to block.

## 2.5 Treat drift as memory

Every probe result should update drift memory.

The system needs to learn:

```text
which anchors are frequently violated
which passes erode intent
which remediation patterns work
which signals repeatedly produce weak anchors
which probe questions are unreliable
```

---

# 3. Core concepts

## 3.1 Signal

A **Signal** is the upstream change request, pressure, failure, or opportunity that enters the factory.

Example:

```yaml
signal:
  id: SIG-FILE-ACTION-SAFETY
  title: Block destructive file actions in Factory-generated PRs
  description: >
    Factory PRs must never delete files or create over existing files.
    Existing files may only be modified through explicit edit operations.
```

The Signal is the source of intent.

---

## 3.2 Intent anchor

An **IntentAnchor** is a durable checkpoint extracted from the signal.

It declares one claim that must survive compiler transformation.

Schema shape:

```yaml
anchors:
  - id: IA-FILE-ACTION-SAFETY-01
    claim: Factory PRs must not delete files.
    probe_question: Does the output mention that delete actions are blocked or forbidden?
    violation_signal: no
    severity: block
    applicable_passes:
      - decompose
      - invariant
      - validation
```

Fields:

| Field               | Meaning                                             |
| ------------------- | --------------------------------------------------- |
| `id`                | Stable anchor identifier                            |
| `claim`             | Human-readable intent claim                         |
| `probe_question`    | Binary yes/no question used to test a pass output   |
| `violation_signal`  | Which answer indicates violation: `yes` or `no`     |
| `severity`          | `block`, `warn`, or `log`                           |
| `applicable_passes` | Compiler passes where this anchor should be checked |
| `times_probed`      | Runtime counter, not usually authored manually      |
| `times_violated`    | Runtime counter, not usually authored manually      |

The repo’s current `IntentAnchor` type uses exactly these semantics: `claim`, `probe_question`, `violation_signal`, `severity`, counters, and optional applicable passes.

---

## 3.3 Pass probe

A **PassProbe** declares where and how anchors are tested against pass outputs.

The probe does not judge the whole program. It asks binary questions about a specific output.

Example:

```yaml
probes:
  - id: probe.decompose.intent_fidelity
    pass: decompose
    input_scope: pass_output_delta_only
    mode: batched_yes_no
    anchors:
      selector: applicable_to_pass
    output:
      type: probe_result_set
```

Probe result shape:

```yaml
probe_result:
  anchor_id: IA-FILE-ACTION-SAFETY-01
  answer: no
  is_violation: true
  explanation: Optional explanation
  pass_name: decompose
  timestamp: 2026-05-10T12:00:00Z
```

The current probe engine maps anchors to numbered yes/no questions, calls the model under task kind `probe`, parses JSON or fallback text, and converts each answer into `is_violation` using the anchor’s `violation_signal`.

---

## 3.4 Reconciliation gate

A **ReconciliationGate** is the deterministic decision function that converts probe results into a compiler control decision.

Verdicts:

```text
pass
warn
remediate
escalate
```

Core decision matrix:

| Condition                               | Verdict     |
| --------------------------------------- | ----------- |
| No violations                           | `pass`      |
| Only log violations                     | `pass`      |
| Warn violations and no block violations | `warn`      |
| Block violations and attempts remain    | `remediate` |
| Block violations and attempts exhausted | `escalate`  |

This mirrors the live `reconcile()` behavior in the repo.

---

## 3.5 Remediation rule

A **RemediationRule** declares what happens when a pass violates one or more block anchors.

Example:

```yaml
remediation:
  max_attempts_per_pass: 2
  feedback_policy:
    include:
      - violated_anchor_claims
      - failed_probe_questions
      - probe_answers
    exclude:
      - hidden_probe_reasoning
      - unrelated anchors
  retry:
    strategy: rerun_same_pass_with_violation_feedback
  on_exhausted:
    verdict: escalate
```

Remediation is not “try again harder.” It must be anchored to concrete failed claims.

---

## 3.6 Drift memory

**DriftMemory** records how intent changes across passes and across runs.

It should answer:

```text
Which anchors failed?
Which passes caused failures?
Which severities were involved?
How often did remediation repair the drift?
Which anchors are noisy?
Which compiler passes chronically erase key intent?
```

Example:

```yaml
drift_memory:
  ledgers:
    compilation_drift:
      collection: compilation_drift_ledger
      append_on:
        - pass
        - warn
        - remediate
        - escalate
    intent_anchors:
      collection: intent_anchors
  metrics:
    anchor_violation_rate: true
    pass_violation_rate: true
    remediation_success_rate: true
    erosion_detection: true
```

---

# 4. DSL structure

A Crystallizer DSL document has seven top-level sections:

```yaml
crystallizer_dsl: 0.1

metadata: {}

signal_binding: {}

anchor_policy: {}

probe_policy: {}

reconciliation: {}

remediation: {}

drift_memory: {}
```

Full shape:

```yaml
crystallizer_dsl: 0.1

metadata:
  id: crystallizer.file_action_safety.v1
  title: File Action Safety Crystallizer
  owner: function-factory
  status: active
  description: >
    Preserve file-action safety constraints through compilation.

signal_binding:
  signal_id: SIG-FILE-ACTION-SAFETY
  source_fields:
    title: required
    description: required
    spec_content: optional

anchor_policy:
  generation:
    mode: llm_assisted
    min_anchors: 3
    max_anchors: 6
    task_kind: crystallizer
  defaults:
    severity: log
    applicable_passes:
      - decompose
  anchors:
    - id: IA-FILE-ACTION-SAFETY-01
      claim: Factory-generated PRs must never delete files.
      probe_question: Does the output mention that delete actions are blocked or forbidden?
      violation_signal: no
      severity: block
      applicable_passes:
        - decompose
        - invariant
        - validation

probe_policy:
  isolation:
    separate_model_call: true
    input_scope: pass_output_delta_only
    forbid_context:
      - original_generation_prompt
      - full_signal
      - accumulated_state
      - prior_model_reasoning
  question_format: yes_no
  batching: all_applicable_anchors_per_pass
  truncation:
    max_output_tokens_estimate: 4000
    strategy: deterministic_json_array_truncation_then_raw_truncation
  fail_safe:
    on_probe_error:
      block_anchors: violated
      warn_anchors: optional
      log_anchors: optional

reconciliation:
  verdicts:
    - pass
    - warn
    - remediate
    - escalate
  rules:
    no_violations: pass
    log_only_violations: pass
    warn_only_violations: warn
    block_violations_with_attempts_remaining: remediate
    block_violations_attempts_exhausted: escalate

remediation:
  max_attempts_per_pass: 2
  feedback_policy:
    include:
      - violated_anchor_ids
      - violated_anchor_claims
      - failed_probe_questions
      - probe_answers
    exclude:
      - probe_hidden_reasoning
      - unrelated_signal_context
  retry_strategy: rerun_same_pass_with_violation_feedback
  on_exhausted: escalate

drift_memory:
  anchors_collection: intent_anchors
  ledger_collection: compilation_drift_ledger
  append_events:
    - probe_completed
    - gate_passed
    - gate_warned
    - remediation_requested
    - escalation_triggered
  metrics:
    anchor_violation_rate: true
    pass_violation_rate: true
    remediation_success_rate: true
    erosion_detection: true
```

---

# 5. Formal semantics

## 5.1 Core tuple

A Crystallizer specification is:

```text
Crystallizer = ⟨I, A, P, R, M, D⟩
```

Where:

```text
I = input signal binding
A = intent anchors
P = probe policy
R = reconciliation rules
M = remediation rules
D = drift-memory semantics
```

## 5.2 Intent anchor

```text
Anchor = ⟨id, claim, question, violation_signal, severity, applicable_passes⟩
```

Where:

```text
violation_signal ∈ {yes, no}
severity ∈ {block, warn, log}
```

## 5.3 Probe

```text
Probe(pass_output_delta, anchors) → ProbeResult[]
```

Each result:

```text
ProbeResult = ⟨anchor_id, answer, is_violation, pass_name, timestamp⟩
```

with:

```text
answer ∈ {yes, no}
is_violation = answer == violation_signal
```

## 5.4 Reconciliation

```text
Reconcile(ProbeResult[], Anchor[], attempt, max_attempts) → GateDecision
```

Where:

```text
GateDecision.verdict ∈ {pass, warn, remediate, escalate}
```

Decision semantics:

```text
if no violations:
  pass

else if violations only affect log anchors:
  pass

else if violations affect warn anchors and no block anchors:
  warn

else if violations affect block anchors and attempt < max_attempts:
  remediate

else:
  escalate
```

The current implementation follows this deterministic structure.

---

# 6. Anchor authoring rules

## 6.1 Anchors must be specific

Bad:

```yaml
claim: The output should preserve the user's intent.
probe_question: Does the output preserve the user's intent?
```

Good:

```yaml
claim: Existing files must be modified through edit operations, not recreated.
probe_question: Does the output mention modifying existing files through edit operations rather than creating them?
```

## 6.2 Anchors must be answerable from pass output alone

Bad:

```yaml
probe_question: Does the implementation actually block delete operations at runtime?
```

This may require code execution.

Good:

```yaml
probe_question: Does the validation atom mention blocking delete operations?
```

This can be answered from atom text.

## 6.3 Anchors should target compiler artifact fields

For atom-like outputs, good probes mention fields like:

```text
title
description
verifies
type
dependencies
invariants
validation_rules
target_files
```

Example:

```yaml
probe_question: Does any atom's title, description, or verifies field mention dependency targets by atom ID?
```

## 6.4 Avoid overly literal path probes

If compiler outputs use short names, do not require full paths unless the pass is expected to preserve full paths.

Bad:

```yaml
probe_question: Does any atom mention workers/ff-pipeline/src/index.ts?
```

Better:

```yaml
probe_question: Does any atom mention index.ts or Worker entry point?
```

The current crystallizer prompt explicitly warns against probes that are too literal about full paths when atoms use short filenames.

## 6.5 Severity should be meaningful

Use `block` when losing the claim invalidates the compiled artifact.

Use `warn` when losing the claim creates risk but may be recoverable downstream.

Use `log` when the difference is worth tracking but should not affect compilation.

Examples:

```yaml
severity: block
claim: Delete actions must be blocked.

severity: warn
claim: The output should prefer modify+edits language.

severity: log
claim: The wording should use "file action gate" rather than "file guard."
```

---

# 7. Pass applicability

Not every anchor applies to every pass.

Example:

```yaml
anchors:
  - id: IA-001
    claim: Atoms must mention blocked delete actions.
    applicable_passes:
      - decompose

  - id: IA-002
    claim: Dependencies must connect validation atom before PR generation atom.
    applicable_passes:
      - dependency

  - id: IA-003
    claim: Invariants must protect against destructive file writes.
    applicable_passes:
      - invariant

  - id: IA-004
    claim: Validation rules must reject create-on-existing.
    applicable_passes:
      - validation
```

Pass applicability prevents nonsense probes.

Do not ask a dependency pass whether a code artifact implements a runtime check unless that pass is expected to include implementation details.

---

# 8. Probe isolation semantics

Probe isolation is mandatory.

The probe must not inherit the same context that generated the pass output.

Required isolation:

```yaml
probe_policy:
  isolation:
    separate_model_call: true
    input_scope: pass_output_delta_only
    forbid_context:
      - original_generation_prompt
      - full_signal
      - accumulated_state
      - prior_model_reasoning
```

Reason:

If the probe sees the original prompt or signal, it may answer based on what the output **should** have said, not what the pass output actually says.

The current repo’s probe engine explicitly enforces this design: the probe is a separate LLM call, with different context, and sees only pass output plus questions.

---

# 9. Probe response format

The standard response format is a JSON object keyed by question number:

```json
{
  "1": "yes",
  "2": "no",
  "3": "yes"
}
```

Rules:

```yaml
probe_response:
  format: json_object
  keys: numeric_question_indices
  values:
    - yes
    - no
```

Fallback parsing may support:

```text
1. yes
2: no
Question 3: yes
```

But the canonical output is JSON.

The repo’s current probe parser tries JSON first, strips code fences, and then falls back to regex-based yes/no extraction.

---

# 10. Probe truncation semantics

Pass outputs may be too large.

The DSL must declare truncation behavior.

```yaml
probe_policy:
  truncation:
    enabled: true
    max_output_tokens_estimate: 4000
    chars_per_token_estimate: 4
    strategy:
      - json_array_field_binary_search
      - raw_character_truncation_with_marker
    emits_signal: pipeline:probe-input-truncated
```

Recommended behavior:

1. Estimate output token size.
2. If over budget, try JSON-aware truncation.
3. Prefer truncating large array fields while preserving JSON shape.
4. If not JSON, raw truncate and append `[TRUNCATED]`.
5. Emit telemetry.

The current repo uses a 4,000-token estimate, assumes roughly four characters per token, and truncates pass output around 16,000 characters. It first tries JSON-aware truncation of array fields, then raw character truncation with a marker.

---

# 11. Failure semantics

## 11.1 Probe failure

If the probe fails, the system must not silently pass.

Recommended fail-safe:

```yaml
fail_safe:
  on_probe_error:
    block_anchors: violated
    warn_anchors: ignored
    log_anchors: ignored
```

This means a failed probe over block-severity anchors becomes a violation.

The current repo follows this pattern: on probe error, block-severity anchors are treated as violated.

## 11.2 Unknown anchor

If a probe result references an unknown anchor, ignore it for gating but log it.

```yaml
unknown_anchor_policy:
  gate_effect: ignore
  telemetry: log
```

The current reconciliation gate ignores violations for unknown anchors.

## 11.3 Empty anchors

If no anchors exist:

```yaml
empty_anchor_policy:
  gate_effect: pass
  telemetry: crystallizer_no_anchors
```

This avoids blocking the factory when crystallization fails open.

## 11.4 Anchor generation failure

If anchor generation fails:

```yaml
anchor_generation_failure:
  result: empty_anchor_set
  telemetry:
    - infra:crystallizer-call-failure
    - infra:crystallizer-parse-failure
  gate_effect: no_crystallizer_gate
```

The current crystallizer returns an empty anchor result when disabled, when AI binding is unavailable, or when crystallizer calls fail.

---

# 12. Reconciliation DSL

Canonical block:

```yaml
reconciliation:
  implementation: deterministic
  verdicts:
    pass:
      meaning: No blocking issue; compiler may continue.
    warn:
      meaning: Non-blocking drift exists; compiler may continue with advisory.
    remediate:
      meaning: Block-level drift exists and retry budget remains.
    escalate:
      meaning: Block-level drift persists after retry budget.

  rules:
    - name: no_violations
      when:
        violations.count: 0
      verdict: pass

    - name: log_only_violations
      when:
        violations.severities.only:
          - log
      verdict: pass

    - name: warn_only_violations
      when:
        violations.severities.includes:
          - warn
        violations.severities.excludes:
          - block
      verdict: warn
      advisory: true

    - name: block_with_attempts_remaining
      when:
        violations.severities.includes:
          - block
        remediation_attempt:
          lt: max_remediation_attempts
      verdict: remediate

    - name: block_attempts_exhausted
      when:
        violations.severities.includes:
          - block
        remediation_attempt:
          gte: max_remediation_attempts
      verdict: escalate
```

The implementation must be pure deterministic logic.

Forbidden:

```yaml
reconciliation:
  implementation: llm_judge
```

Reason:

An LLM may help generate anchors and answer binary probes, but the gate itself is the system’s control law. It must be inspectable, deterministic, and testable.

---

# 13. Remediation DSL

Remediation is the controlled feedback path from violated anchors back into the pass.

Canonical block:

```yaml
remediation:
  max_attempts_per_pass: 2

  trigger:
    verdict: remediate

  feedback_packet:
    include:
      - pass_name
      - violated_anchor_ids
      - violated_anchor_claims
      - failed_probe_questions
      - observed_answers
      - required_answer_to_clear_violation
    exclude:
      - original_probe_system_prompt
      - unrelated_anchor_claims
      - hidden_model_reasoning

  retry:
    mode: rerun_same_pass
    preserve:
      - original_pass_input
      - compiler_state_before_pass
    add:
      - violation_feedback_packet

  stop_conditions:
    success:
      - reconciliation_verdict_in:
          - pass
          - warn
    failure:
      - remediation_attempts_exhausted
      - compiler_error
      - escalation_triggered

  on_exhausted:
    verdict: escalate
    emit:
      - intent_violation_escalation
```

Important rule:

> Remediation feedback must be narrow.

Do not dump the entire signal, entire compiler history, or all anchors into the retry. The remediation should say exactly which claims were violated.

---

# 14. Drift-memory DSL

Drift memory records both raw probe results and aggregate patterns.

Canonical block:

```yaml
drift_memory:
  enabled: true

  stores:
    intent_anchors:
      kind: document_collection
      key: anchor_id
      fields:
        - id
        - signal_id
        - claim
        - probe_question
        - violation_signal
        - severity
        - applicable_passes
        - times_probed
        - times_violated

    compilation_drift_ledger:
      kind: append_only_ledger
      key: generated
      fields:
        - signal_id
        - pass_name
        - anchor_id
        - claim
        - answer
        - is_violation
        - severity
        - gate_verdict
        - remediation_attempt
        - timestamp

  aggregate_metrics:
    anchor_violation_rate:
      formula: times_violated / times_probed

    pass_violation_rate:
      group_by:
        - pass_name

    remediation_success_rate:
      formula: remediated_to_pass / remediation_attempts

    erosion:
      compare:
        early_window: first_n_passes
        late_window: last_n_passes

  retention:
    raw_probe_results: 90d
    aggregate_anchor_stats: indefinite
```

Drift memory must support two modes:

```text
run-local memory
cross-run memory
```

Run-local memory answers:

```text
What happened in this compilation?
```

Cross-run memory answers:

```text
What patterns recur across compilations?
```

---

# 15. Event model

The Crystallizer DSL should emit typed events.

## 15.1 Event types

```yaml
events:
  - intent_crystallized
  - anchor_created
  - probe_started
  - probe_completed
  - probe_failed
  - probe_input_truncated
  - violation_detected
  - reconciliation_passed
  - reconciliation_warned
  - remediation_requested
  - remediation_completed
  - escalation_triggered
  - drift_ledger_appended
```

## 15.2 Event schema

```yaml
event:
  event_id: EVT-...
  event_type: violation_detected
  signal_id: SIG-...
  pass_name: decompose
  anchor_id: IA-...
  severity: block
  probe_answer: no
  violation_signal: no
  remediation_attempt: 1
  timestamp: 2026-05-10T12:00:00Z
```

## 15.3 Event-to-signal mapping

Some events should become factory signals:

```yaml
signal_mapping:
  probe_input_truncated:
    signal_type: pipeline:probe-input-truncated
    severity: warn

  probe_failed:
    signal_type: pipeline:probe-failure
    severity: block_if_block_anchor

  escalation_triggered:
    signal_type: synthesis:intent-violation
    severity: block

  recurrent_anchor_violation:
    signal_type: crystallizer:anchor-instability
    severity: warn

  recurrent_pass_violation:
    signal_type: compiler:pass-drift
    severity: warn
```

---

# 16. Full example: file-action safety

```yaml
crystallizer_dsl: 0.1

metadata:
  id: crystallizer.file_action_safety.v1
  title: File Action Safety Crystallizer
  status: active
  description: >
    Preserve the safety constraint that Factory-generated PRs must not
    delete files or create over existing files.

signal_binding:
  signal_id: SIG-FILE-ACTION-SAFETY
  title: Block destructive file actions
  description: >
    Factory PRs must never delete files. Existing files must not be
    recreated with action=create. Existing files may only be modified
    through explicit edit operations.

anchor_policy:
  generation:
    mode: manual_seeded
    min_anchors: 3
    max_anchors: 6
  anchors:
    - id: IA-FILE-ACTION-SAFETY-01
      claim: Factory PRs must never delete files.
      probe_question: Does the output mention that delete actions are blocked or forbidden?
      violation_signal: no
      severity: block
      applicable_passes:
        - decompose
        - invariant
        - validation

    - id: IA-FILE-ACTION-SAFETY-02
      claim: Existing files must not be recreated with action=create.
      probe_question: Does the output mention blocking create actions when the target file already exists?
      violation_signal: no
      severity: block
      applicable_passes:
        - decompose
        - validation

    - id: IA-FILE-ACTION-SAFETY-03
      claim: Existing files must be changed through modify plus explicit edits.
      probe_question: Does the output mention using modify or explicit edit operations for existing files?
      violation_signal: no
      severity: warn
      applicable_passes:
        - decompose
        - validation

    - id: IA-FILE-ACTION-SAFETY-04
      claim: Large shrinkage of existing files should be guarded as destructive.
      probe_question: Does the output mention guarding against large shrinkage or destructive replacement of existing file content?
      violation_signal: no
      severity: warn
      applicable_passes:
        - invariant
        - validation

probe_policy:
  isolation:
    separate_model_call: true
    input_scope: pass_output_delta_only
    forbid_context:
      - original_generation_prompt
      - full_signal
      - accumulated_state
      - prior_model_reasoning
  question_format: yes_no
  batching: all_applicable_anchors_per_pass
  truncation:
    enabled: true
    max_output_tokens_estimate: 4000
    strategy:
      - json_array_field_binary_search
      - raw_character_truncation_with_marker
  fail_safe:
    on_probe_error:
      block_anchors: violated
      warn_anchors: ignored
      log_anchors: ignored

reconciliation:
  implementation: deterministic
  verdicts:
    - pass
    - warn
    - remediate
    - escalate
  rules:
    no_violations: pass
    log_only_violations: pass
    warn_only_violations: warn
    block_violations_with_attempts_remaining: remediate
    block_violations_attempts_exhausted: escalate

remediation:
  max_attempts_per_pass: 2
  feedback_packet:
    include:
      - violated_anchor_ids
      - violated_anchor_claims
      - failed_probe_questions
      - observed_answers
      - required_answer_to_clear_violation
  retry:
    mode: rerun_same_pass_with_violation_feedback
  on_exhausted:
    verdict: escalate
    emit:
      - synthesis:intent-violation

drift_memory:
  enabled: true
  stores:
    intent_anchors:
      collection: intent_anchors
    compilation_drift_ledger:
      collection: compilation_drift_ledger
  aggregate_metrics:
    anchor_violation_rate: true
    pass_violation_rate: true
    remediation_success_rate: true
    erosion_detection: true
```

---

# 17. Full example: dependency targets must use atom IDs

```yaml
crystallizer_dsl: 0.1

metadata:
  id: crystallizer.atom_dependency_identity.v1
  title: Atom Dependency Identity Crystallizer
  status: active
  description: >
    Preserve the requirement that dependency relationships must reference
    atom IDs, not file paths or natural-language labels.

signal_binding:
  signal_id: SIG-DEPENDENCY-ATOM-ID
  title: Ground dependency pass on atom IDs
  description: >
    Dependency pass outputs must use atom IDs such as atom-001 as from/to
    references. File paths must not be used as dependency targets.

anchor_policy:
  anchors:
    - id: IA-DEPENDENCY-ATOM-ID-01
      claim: Dependency from/to fields must use atom IDs.
      probe_question: Does the dependency output use atom IDs such as atom-001 in from or to fields?
      violation_signal: no
      severity: block
      applicable_passes:
        - dependency

    - id: IA-DEPENDENCY-ATOM-ID-02
      claim: Dependency targets must not be file paths.
      probe_question: Does the dependency output use file paths as dependency targets?
      violation_signal: yes
      severity: block
      applicable_passes:
        - dependency

    - id: IA-DEPENDENCY-ATOM-ID-03
      claim: A single-atom workgraph should have an empty dependency list.
      probe_question: If the output describes only one atom, does it use an empty dependency array?
      violation_signal: no
      severity: warn
      applicable_passes:
        - dependency

probe_policy:
  isolation:
    separate_model_call: true
    input_scope: pass_output_delta_only
  question_format: yes_no
  batching: all_applicable_anchors_per_pass

reconciliation:
  implementation: deterministic
  rules:
    no_violations: pass
    log_only_violations: pass
    warn_only_violations: warn
    block_violations_with_attempts_remaining: remediate
    block_violations_attempts_exhausted: escalate

remediation:
  max_attempts_per_pass: 2
  feedback_packet:
    include:
      - violated_anchor_claims
      - failed_probe_questions
      - required_answer_to_clear_violation
  retry:
    mode: rerun_same_pass_with_violation_feedback

drift_memory:
  enabled: true
  stores:
    intent_anchors:
      collection: intent_anchors
    compilation_drift_ledger:
      collection: compilation_drift_ledger
```

---

# 18. Compiler pass integration

A compiler pass integration should follow this lifecycle:

```text
1. Run pass.
2. Extract pass output delta.
3. Select anchors applicable to this pass.
4. Probe pass output against selected anchors.
5. Reconcile probe results.
6. If pass/warn: continue.
7. If remediate: rerun pass with violation feedback.
8. If escalate: stop compilation with intent violation.
9. Append drift ledger entry.
```

Pseudo-code:

```ts
async function runCrystallizedPass(passName, input, state, crystallizerSpec) {
  let attempt = 0

  while (attempt <= crystallizerSpec.remediation.max_attempts_per_pass) {
    const passOutput = await runPass(passName, input, state)

    const anchors = selectAnchors(
      crystallizerSpec.anchor_policy.anchors,
      passName,
    )

    const probeResults = await probeAnchors(
      stringifyPassDelta(passOutput),
      anchors,
      env,
      dryRun,
    )

    const decision = reconcile(
      probeResults,
      anchors,
      attempt,
      crystallizerSpec.remediation.max_attempts_per_pass,
    )

    await appendDriftLedger({
      passName,
      attempt,
      probeResults,
      decision,
    })

    if (decision.verdict === 'pass' || decision.verdict === 'warn') {
      return passOutput
    }

    if (decision.verdict === 'remediate') {
      input = addViolationFeedback(input, decision, anchors)
      attempt += 1
      continue
    }

    if (decision.verdict === 'escalate') {
      throw new IntentViolationEscalation(decision)
    }
  }
}
```

---

# 19. Runtime validation rules

A Crystallizer DSL validator must enforce:

## 19.1 Anchor rules

```text
Every anchor must have id, claim, probe_question, violation_signal, severity.
violation_signal must be yes or no.
severity must be block, warn, or log.
probe_question must be phrased as a yes/no question.
applicable_passes must reference known pass names.
```

## 19.2 Probe rules

```text
Probe input_scope must be pass_output_delta_only for production.
Probe question_format must be yes_no for production.
Probe must use separate_model_call=true for production.
```

## 19.3 Reconciliation rules

```text
Reconciliation implementation must be deterministic.
Verdicts must be limited to pass, warn, remediate, escalate.
Block violations must not pass unless explicitly waived by a signed policy exception.
```

## 19.4 Remediation rules

```text
max_attempts_per_pass must be finite.
Remediation feedback must include violated anchor claims.
Remediation feedback must not include hidden model reasoning.
Escalation must occur when block violations persist after max attempts.
```

## 19.5 Drift memory rules

```text
Probe results must be appendable to a ledger.
Anchor counters must be updateable.
Escalations must be queryable by signal_id and pass_name.
```

---

# 20. TypeScript type sketch

```ts
export type CrystallizerSeverity = 'block' | 'warn' | 'log'
export type ProbeAnswer = 'yes' | 'no'
export type GateVerdict = 'pass' | 'warn' | 'remediate' | 'escalate'

export interface CrystallizerSpec {
  crystallizer_dsl: '0.1'
  metadata: CrystallizerMetadata
  signal_binding: SignalBinding
  anchor_policy: AnchorPolicy
  probe_policy: ProbePolicy
  reconciliation: ReconciliationSpec
  remediation: RemediationSpec
  drift_memory: DriftMemorySpec
}

export interface IntentAnchorSpec {
  id: string
  claim: string
  probe_question: string
  violation_signal: ProbeAnswer
  severity: CrystallizerSeverity
  applicable_passes?: string[]
}

export interface ProbeResult {
  anchor_id: string
  answer: ProbeAnswer
  is_violation: boolean
  explanation?: string
  pass_name: string
  timestamp: string
}

export interface GateDecision {
  verdict: GateVerdict
  violated_anchors: string[]
  probe_results: ProbeResult[]
  remediation_attempt: number
  advisory_text?: string
}

export interface RemediationSpec {
  max_attempts_per_pass: number
  feedback_packet: {
    include: string[]
    exclude?: string[]
  }
  retry: {
    mode: 'rerun_same_pass_with_violation_feedback'
  }
  on_exhausted: {
    verdict: 'escalate'
    emit?: string[]
  }
}
```

---

# 21. JSON Schema sketch

```json
{
  "$id": "https://function-factory.dev/schemas/crystallizer-dsl.schema.json",
  "type": "object",
  "required": [
    "crystallizer_dsl",
    "metadata",
    "signal_binding",
    "anchor_policy",
    "probe_policy",
    "reconciliation",
    "remediation",
    "drift_memory"
  ],
  "properties": {
    "crystallizer_dsl": {
      "const": "0.1"
    },
    "metadata": {
      "type": "object",
      "required": ["id", "title", "status"],
      "properties": {
        "id": { "type": "string" },
        "title": { "type": "string" },
        "status": {
          "enum": ["draft", "active", "deprecated"]
        },
        "description": { "type": "string" }
      }
    },
    "anchor_policy": {
      "type": "object",
      "required": ["anchors"],
      "properties": {
        "anchors": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": [
              "id",
              "claim",
              "probe_question",
              "violation_signal",
              "severity"
            ],
            "properties": {
              "id": { "type": "string" },
              "claim": { "type": "string" },
              "probe_question": { "type": "string" },
              "violation_signal": {
                "enum": ["yes", "no"]
              },
              "severity": {
                "enum": ["block", "warn", "log"]
              },
              "applicable_passes": {
                "type": "array",
                "items": { "type": "string" }
              }
            }
          }
        }
      }
    },
    "reconciliation": {
      "type": "object",
      "required": ["implementation", "rules"],
      "properties": {
        "implementation": {
          "const": "deterministic"
        }
      }
    }
  }
}
```

---

# 22. Relationship to PromptPacts and NLAH-style harnesses

The Crystallizer DSL is narrower than a full harness language.

A harness language defines:

```text
roles
stages
workers
artifacts
tools
state
release behavior
```

The Crystallizer DSL defines:

```text
intent fidelity constraints over compiler transformations
```

A PromptPact governs an agent role.

The Crystallizer DSL governs the transformation chain.

They should connect like this:

```text
PromptPact:
  “How should this agent behave?”

Crystallizer DSL:
  “What intent anchors must survive after this agent/pass transforms the artifact?”

Harness DSL:
  “What stages and roles execute?”

Runtime:
  “How are these executed, traced, and enforced?”
```

The Crystallizer DSL can be embedded inside a larger HarnessPact later, but it must remain independently executable.

---

# 23. Recommended file layout

```text
specs/
  crystallizer/
    crystallizer-dsl-v0.1.md
    examples/
      file-action-safety.crystallizer.yaml
      atom-dependency-identity.crystallizer.yaml
    schemas/
      crystallizer-dsl.schema.json

packages/
  schemas/
    src/
      crystallizer-dsl.ts

workers/
  ff-pipeline/
    src/
      stages/
        crystallize-intent.ts
        intent-probe.ts
        reconciliation-gate.ts
        violation-feedback.ts
```

---

# 24. Implementation roadmap

## Phase 1: Spec and validation

Deliver:

```text
Crystallizer DSL markdown spec
YAML examples
Zod schema
JSON Schema
validator tests
```

Success:

```text
Example DSL files validate.
Bad probe questions fail validation.
Invalid severity fails validation.
Production probe without isolation fails validation.
```

## Phase 2: Current-code projection

Deliver:

```text
function that exports current hardcoded crystallizer behavior into DSL form
```

Success:

```text
Current crystallizer runtime can be described by a DSL document.
No behavior changes.
```

## Phase 3: DSL-driven anchor selection

Deliver:

```text
selectAnchorsForPass(spec, passName)
```

Success:

```text
Only anchors applicable to a pass are probed.
Tests cover decompose/dependency/invariant/validation pass selection.
```

## Phase 4: DSL-driven reconciliation settings

Deliver:

```text
max remediation attempts
severity behavior
fail-safe behavior
```

Success:

```text
Reconciliation still deterministic.
Config changes affect policy without changing code.
```

## Phase 5: Drift-memory integration

Deliver:

```text
append drift events according to DSL memory policy
aggregate anchor/pass violation metrics
```

Success:

```text
A drift ledger can explain which pass eroded which anchor.
```

---

# 25. Non-goals

The Crystallizer DSL does not:

```text
generate implementation code
replace compiler passes
replace PromptPacts
replace WorkGraphs
replace deterministic tests
decide final PR merge safety
serve as a general-purpose workflow language
```

It only governs:

```text
intent preservation across compiler transformations
```

---

# 26. Final design law

Use this as the hard rule:

> **No compiler pass may silently transform intent. Every critical claim must either survive, trigger remediation, or produce an explicit escalation.**

That is the purpose of the Crystallizer DSL.

It is the language that lets Function-Factory say:

```text
This is what the signal meant.
This is where the compiler might lose it.
This is how we check.
This is how we respond.
This is what we remember.
```

That is the correct DSL layer for the current refactored Function-Factory.
