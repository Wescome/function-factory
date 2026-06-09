# Instruction Tuning Specification

**Status:** Active specification draft
**Date:** 2026-05-10
**Source references:** `DOMAIN-FACTORY-KERNEL.md`,
`TRELLIS-EXECUTION-PACKET.md`, `TRELLIS-REFACTOR-FIRST-CUT.md`,
`.agent/memory/semantic/DECISIONS.md`

Instruction Tuning is the compiler transformation that projects a Coherence
Verification-passed Executable Specification into a Execution Packet.

It is not model fine-tuning. It is deterministic instruction shaping: role
projection, context selection, tool-policy binding, adapter binding, evidence
planning, repair policy construction, and packet certification.

## Position In The Factory

```
Intent Specification
  -> compiler transformations
  -> Coherence Verification
  -> Executable Specification
  -> ArchitectureCandidate selection
  -> Runtime admission
  -> Instruction Tuning
  -> Execution Packet
  -> Factory execution layer
  -> Evidence
  -> Fidelity / Persistence Verification
```

Instruction Tuning runs only after Coherence Verification has passed and an
Executable Specification has been assembled. If Coherence Verification fails,
Instruction Tuning must not run.

## Inputs

Required inputs:

- Executable Specification.
- Intent Specification identity and source lineage.
- Selected ArchitectureCandidate.
- Runtime admission artifact.
- Domain Adapter Contract.
- RuntimeProfile.
- Verification obligations derived from invariants and validations.
- Runtime policy constraints.

Optional inputs:

- Prior execution evidence for the same Function.
- Prior repair lessons.
- Domain-specific rendering hints from the adapter.
- Model/provider constraints from the runtime profile.

Instruction Tuning must fail closed when required inputs are missing. It must
emit typed UncertaintyEntry refs and blocking diagnostics instead of guessing.

## Output Union

Instruction Tuning returns a typed result union.

```ts
type InstructionTuningResult =
  | {
      status: 'emitted'
      packet: ExecutionPacket
      diagnostics: InstructionTuningDiagnostic[]
    }
  | {
      status: 'blocked'
      diagnostics: InstructionTuningDiagnostic[]
      uncertaintyEntries: string[]
    }

interface InstructionTuningDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'blocking'
  blocking: boolean
  source_refs: string[]
  message: string
  packetField?: string
}
```

Rules:

- Certification failure returns `status: 'blocked'`.
- Blocking diagnostics must be persisted or attached to a persisted
  UncertaintyEntry.
- A blocked result must never include a partial executable packet.
- Advisory diagnostics may accompany an emitted packet.

## Transformation Steps

### 1. Packet Scope Selection

Determine the execution attempt scope:

- target Function
- source Intent Specification
- source Executable Specification
- selected ArchitectureCandidate
- runtime admission artifact
- target Domain Adapter
- execution mode
- lifecycle pathway

Output:

- `EP-*` artifact identity inputs
- source refs
- adapter binding seed
- lifecycle pathway seed

Fail-closed conditions:

- missing Function identity
- missing Executable Specification identity
- missing selected ArchitectureCandidate
- missing runtime admission artifact
- missing adapter contract
- unsupported execution mode

### 2. Executable Node Projection

Project Executable Specification nodes through the selected ArchitectureCandidate
into harness-executable work units.

Output:

- role candidates
- executable node refs
- dependency candidates
- parallelization hints

Rules:

- One Executable Specification node may map to one or more execution roles.
- Multiple nodes may map to one role only when their dependencies and tool
  authority are compatible.
- Projection must preserve dependency ordering.
- Projection must not create new functional obligations.
- Projection must cite the ArchitectureCandidate fields that shaped topology.

Fail-closed conditions:

- dangling dependency
- cyclic role graph without explicit repair policy
- node with no executable role projection
- topology conflict between Executable Specification and ArchitectureCandidate

### 3. Role Instruction Synthesis

Generate a role instruction for each projected role.

Each instruction must include:

- objective
- inputs
- outputs
- tool binding refs
- evidence obligations
- stop conditions
- escalation conditions
- role-local instruction text
- provenance refs

Rules:

- Role-local instruction text must be derived from executable nodes,
  invariants, validations, ArchitectureCandidate fields, runtime profile fields,
  or adapter contract fields.
- Role-local instruction text must not include hidden state references.
- Role-local instruction text must not ask a role to self-author its own
  authority.
- Tool authority comes only from packet tool policy.

Fail-closed conditions:

- role without output
- role without stop condition
- role with write/execute work but no explicit tool binding
- role obligation without evidence path

### 4. Context Bundle Selection

Select the bounded context each role and the overall packet may receive.

Output:

- intent summary
- executable summary
- invariant list
- validation refs
- domain context refs
- memory refs
- omitted context ledger
- provenance refs

Rules:

- Context must be explicit.
- Context must be source-referenced.
- Context omissions must be recorded.
- Adapter-local context must not leak into kernel fields.

Fail-closed conditions:

- required invariant omitted
- required validation omitted
- required adapter contract omitted
- context dependency with no source ref
- derived context summary with no provenance

### 5. Tool Policy Binding

Bind role instructions to the available tool catalog, runtime profile, and
Domain Adapter capabilities.

Output:

- default-deny tool policy
- typed tool bindings
- operation-level authority
- parameter and scope schemas
- evidence requirements for tool calls

Rules:

- Read, write, and execute authority are separate.
- Write and execute tools require explicit scope.
- Tool scopes must be adapter-local where substrate-specific.
- Runtime-denied tool calls must be captured as evidence.
- The role instruction cannot override tool policy.

Fail-closed conditions:

- role requires a tool missing from the catalog
- role needs write/execute authority with empty scope
- adapter does not support a required effector or evidence source
- ambiguous tool mapping
- missing parameter or scope schema

### 6. Evidence Plan Synthesis

Map validations, invariants, expected outputs, runtime traces, and adapter
evidence sources into evidence obligations.

Output:

- required evidence items
- producing roles
- adapter evidence source refs
- Fidelity Verification input refs
- Persistence Verification input refs

Rules:

- Every validation must map to evidence or uncertainty.
- Every evidence item must have a producer.
- Evidence for Fidelity Verification and Persistence Verification must be
  distinguishable.
- Evidence obligations must be present before execution starts.
- Substrate-specific commands and observation rules remain adapter-bound.

Fail-closed conditions:

- validation with no evidence path
- evidence item with no producing role
- required evidence that depends on a denied tool
- Persistence obligation with no observation rule
- evidence item without hash/retention/audit fields

### 7. Repair Policy Construction

Construct bounded repair rules for Factory execution layer.

Output:

- max repair attempts
- structured failure taxonomy
- retryability policy
- patch authority
- escalation target
- recertification requirements

Rules:

- Repair policy must be narrower than or equal to initial execution authority.
- Repair attempts must produce evidence.
- Repair cannot bypass missing required evidence.
- Repair cannot promote lifecycle state.
- Repair that changes executable intent requires recertification.

Fail-closed conditions:

- repair path grants broader authority without explicit justification
- nonretryable invariant failure marked retryable
- no escalation target for terminal failure
- repair path lacks evidence output

### 8. Completion Contract Construction

Define the execution completion output contract.

Output:

- success status
- failure statuses
- required outputs
- required evidence
- ExecutionResult schema ref
- lifecycle pathway

Rules:

- Completion returns evidence, not lifecycle promotion.
- Success requires all required outputs and evidence items.
- Failure must be structured enough for feedback and remediation.
- `accepted -> monitored` must be represented as a Persistence Verification
  pathway, not a one-shot execution outcome.

Fail-closed conditions:

- missing execution result schema
- success status without required evidence
- lifecycle pathway not supported by the Factory lifecycle graph

### 9. Packet Audit And Certification

Validate the packet before returning it.

Certification checks:

- all source refs resolve or are explicitly virtual compiler refs
- packet ID uses `EP-*`
- all role graph references resolve
- all tools are policy-bound
- all write/execute scopes are non-empty
- all tool bindings have parameter and scope schemas
- all evidence items have producers
- all required validations have evidence
- every derived field has source coverage
- no unmapped Executable Specification refs remain
- no substrate-specific terms appear outside adapter-bound fields
- packet hash is deterministic

If any certification check fails, Instruction Tuning must return a blocked
result with diagnostics and typed UncertaintyEntry refs.

## Determinism

Instruction Tuning must be deterministic for the same inputs. If an LLM is used
to draft instruction text, the transformation still needs deterministic
normalization and certification before packet emission.

At minimum:

- arrays are canonically ordered
- hashes use the canonical serialization rules in `TRELLIS-EXECUTION-PACKET.md`
- role IDs are deterministic
- packet IDs are deterministic from Function ID, Executable Specification ID,
  selected ArchitectureCandidate ID, runtime admission ID, and packet version
- `generatedAt` is excluded from packet hash
- omitted context reasons are deterministic
- diagnostics are deterministic

Non-deterministic drafting may be allowed only before certification.
Certification is the boundary that turns a draft into a compiler output.

## Uncertainty Handling

Instruction Tuning emits typed UncertaintyEntry refs instead of guessing when it
cannot map:

- an executable node to a role
- a validation to evidence
- a tool need to a tool policy
- a domain action to an adapter capability
- a context dependency to a source ref
- a runtime profile capability to a packet field
- a failure mode to repair/escalation policy

Uncertainty blocks packet emission when it affects executability, authority, or
verification evidence.

## Implementation Slices

Recommended implementation order:

1. Add `EP-*` artifact prefix support and a `ExecutionPacket` Zod
   schema/parser.
2. Add `InstructionTuningResult`, `InstructionTuningDiagnostic`, and blocked
   result tests.
3. Add deterministic canonical serialization and packet hashing helpers.
4. Add pure Instruction Tuning module that accepts an Executable Specification,
   selected ArchitectureCandidate, runtime admission artifact, Domain Adapter
   Contract, and RuntimeProfile.
5. Add packet certification tests before runtime integration.
6. Add compiler orchestration after Executable Specification Assembly.
7. Thread packet into the existing coordinator.
8. Make coordinator execution consume the packet and record packet ID/hash on
   DomainExecutionEvidence, traces, repair attempts, and execution results.
9. Add Fidelity Verification fixtures proving packet evidence flows into
   lifecycle acceptance.
10. Update `pnpm audit:ontology` to prevent raw runtime execution bypass,
    old active-name re-entry, and packet-less Factory execution layer.

Required negative tests:

- missing adapter contract
- missing selected ArchitectureCandidate
- missing runtime admission artifact
- role graph cycle
- unmapped Executable Specification node
- substrate-term leakage in kernel fields
- out-of-scope tool binding
- empty write or execute scope
- missing evidence producer
- nondeterministic packet hash
- blocked diagnostics without UncertaintyEntry refs
- raw runtime execution bypassing the packet

## Non-Goals

- No storage/path migration beyond adding packet persistence support.
- No package rename.
- No model fine-tuning.
- No lifecycle promotion inside Instruction Tuning.
- No Domain Adapter implementation rewrite.
- No coding substrate terms in kernel fields.
