# Trellis Execution Packet

**Status:** Active specification draft
**Date:** 2026-05-10
**Source references:** `DOMAIN-FACTORY-KERNEL.md`,
`TRELLIS-REFACTOR-FIRST-CUT.md`, `ONTOLOGY-CURRENT-MAPPING.md`,
`.agent/memory/semantic/DECISIONS.md`

The Trellis Execution Packet is the lineage-bearing, harness-facing artifact
that bridges the Factory compiler and Trellis runtime execution.

The Factory produces an Executable Specification. Instruction Tuning projects
that Executable Specification, a selected ArchitectureCandidate, runtime
admission evidence, and a Domain Adapter Contract into a Trellis Execution
Packet. Trellis consumes the packet, orchestrates role execution, invokes the
Domain Adapter through typed execution requests, captures evidence, and returns
a typed execution result for Verification.

## Artifact Identity

The packet is a persistent Factory artifact, not an anonymous runtime blob.

Artifact family:

- Prefix: `TEP-*`
- Name: Trellis Execution Packet
- Storage: implementation slice must choose the physical collection/path.
- Required schema update: extend the artifact ID parser to accept `TEP`.

The packet also carries a deterministic content hash. The artifact ID gives
lineage addressability; the hash proves the exact authorization object used by
runtime traces, repair attempts, and evidence.

## Boundary

Factory owns:

- Intent Specification compilation.
- Executable Specification assembly.
- ArchitectureCandidate selection.
- Runtime admission.
- Instruction Tuning.
- Verification obligations.
- Lifecycle decisions.

Trellis owns:

- Harness role scheduling.
- Tool authority enforcement.
- Memory/context presentation.
- Domain Adapter call orchestration.
- Repair-loop execution.
- Evidence capture.

Domain Adapters own:

- Substrate-specific tools.
- Substrate-specific execution semantics.
- Substrate-specific evidence sources.
- Substrate-specific handoff artifacts.

Trellis must not read compiler intermediates directly. Trellis may execute only
from a parsed Trellis Execution Packet. During migration, any raw Executable
Specification execution path must be explicitly marked transitional and must
emit a violation diagnostic.

## Packet Contract

A Trellis Execution Packet is immutable for a single execution attempt. Trellis
may emit evidence, traces, and repair proposals, but it must not mutate the
packet that authorized the attempt.

Minimum shape:

```ts
interface TrellisExecutionPacket {
  id: string
  packetVersion: string
  functionId: string
  intentSpecificationId: string
  executableSpecificationId: string
  selectedArchitectureCandidateId: string
  runtimeAdmissionId: string
  source_refs: string[]
  explicitness: 'explicit' | 'inferred'
  rationale: string
  instructionTuning: InstructionTuningProvenance
  runtimeProfile: TrellisRuntimeProfile
  adapter: DomainAdapterBinding
  roles: TrellisRoleInstruction[]
  roleGraph: TrellisRoleGraph
  contextBundle: TrellisContextBundle
  toolPolicy: TrellisToolPolicy
  evidencePlan: TrellisEvidencePlan
  repairPolicy: TrellisRepairPolicy
  completionContract: TrellisCompletionContract
  lifecyclePathway: LifecyclePathway
  audit: TrellisPacketAudit
}
```

Rules:

- `id` must use the `TEP-*` artifact family.
- `source_refs` must include the Intent Specification, Executable
  Specification, selected ArchitectureCandidate, runtime admission artifact,
  and Domain Adapter Contract reference.
- `explicitness` and `rationale` are required because the packet is derived.
- Every derived field must be covered by packet audit provenance.

## Canonical Serialization And Hashing

Packet hashing must be deterministic.

Canonicalization rules:

1. Serialize as UTF-8 JSON.
2. Normalize strings to Unicode NFC before serialization.
3. Sort object keys lexicographically.
4. Sort arrays by declared stable key:
   - roles by `roleId`
   - role graph nodes by `roleId`
   - role graph edges by `from`, then `to`, then `reason`
   - tool bindings by `bindingId`
   - evidence requirements by `evidenceId`
   - repair failure classes by `code`
   - source refs lexicographically
5. Exclude `instructionTuning.generatedAt` from `audit.packetHash`.
6. Include `instructionTuning.inputExecutableSpecificationHash`.
7. Compute SHA-256 over the canonical JSON bytes.

Hash stability tests must permute input ordering and prove identical packet
hashes when semantic content is unchanged.

## Instruction Tuning Provenance

```ts
interface InstructionTuningProvenance {
  transformationVersion: string
  inputExecutableSpecificationHash: string
  outputPacketHash: string
  generatedAt: string
  deterministicInputs: string[]
  uncertaintyRefs: string[]
}
```

Rules:

- `inputExecutableSpecificationHash` must be computed over the exact
  Executable Specification content used by Instruction Tuning.
- `outputPacketHash` must equal `audit.packetHash`.
- `uncertaintyRefs` must contain typed UncertaintyEntry artifact refs when
  Instruction Tuning could not map any obligation, role, tool, context, or
  evidence requirement.

## Runtime Profile

```ts
interface TrellisRuntimeProfile {
  profileId: string
  roleCatalogRef: string
  toolCatalogRef: string
  memoryCatalogRef: string
  policyCatalogRef: string
  modelPolicyRef?: string
  suppliedBy: 'trellis-runtime'
}
```

The runtime profile declares the capabilities Trellis makes available to
Instruction Tuning. Factory authorizes obligations and policy; Trellis supplies
runtime capabilities; Domain Adapters supply substrate renderings.

## Domain Adapter Binding

```ts
interface DomainAdapterBinding {
  adapterId: string
  adapterContractRef: string
  adapterContractHash: string
  executionMode: 'simulate' | 'execute' | 'verify' | 'observe'
  requiredEffectors: string[]
  requiredEvidenceSources: string[]
  executionRequest: DomainExecutionRequestShape
}

interface DomainExecutionRequestShape {
  adapterId: string
  functionId: string
  intentSpecificationId: string
  executableSpecificationId: string
  runId: string
  mode: 'simulate' | 'execute' | 'verify' | 'observe'
  parameters: Record<string, unknown>
}
```

The binding aligns with the live Domain Adapter schema. Trellis schedules and
invokes the adapter; the adapter owns substrate semantics and returns typed
DomainExecutionEvidence.

## Role Instructions

```ts
interface TrellisRoleInstruction {
  roleId: string
  roleKind: string
  objective: string
  inputs: string[]
  outputs: string[]
  toolBindingRefs: string[]
  evidenceObligations: string[]
  stopConditions: string[]
  escalationConditions: string[]
  instruction: string
  provenanceRefs: string[]
}
```

Rules:

- Every role instruction must be derived from an Executable Specification node,
  validation, invariant, ArchitectureCandidate field, runtime profile field, or
  adapter binding.
- Tool authority is not granted by role-local `allowedTools` fields. The tool
  policy is the single authority source.
- No role may receive ambient authority.
- No role may be assigned an obligation without a corresponding output or
  evidence obligation.
- Role instructions must be executable without reading hidden compiler state.

## Role Graph

```ts
interface TrellisRoleGraph {
  nodes: Array<{
    roleId: string
    executableNodeRefs: string[]
    dependsOn: string[]
    parallelizable: boolean
  }>
  edges: Array<{
    from: string
    to: string
    reason: string
    blocking: boolean
  }>
}
```

The role graph is a harness execution projection of the Executable
Specification and selected ArchitectureCandidate. It may refine execution
ordering, parallelism, and handoff points, but it must not introduce new
functional obligations.

## Context Bundle

```ts
interface TrellisContextBundle {
  intentSummary: string
  executableSummary: string
  invariants: string[]
  validationRefs: string[]
  domainContextRefs: string[]
  memoryRefs: string[]
  omittedContext: Array<{
    ref: string
    reason: string
  }>
  provenanceRefs: string[]
}
```

Rules:

- Context is explicit and bounded.
- Omitted context must be named with a reason.
- Context must preserve source lineage back to the Intent Specification,
  Executable Specification, ArchitectureCandidate, runtime policy, or adapter
  contract.
- Trellis must not fetch extra memory opportunistically unless the packet grants
  a tool or memory capability for that role.

## Tool Policy

```ts
interface TrellisToolPolicy {
  defaultPolicy: 'deny'
  bindings: ToolBinding[]
}

interface ToolBinding {
  bindingId: string
  toolName: string
  roles: string[]
  operation: 'read' | 'write' | 'execute'
  parameterSchemaRef: string
  scopeSchemaRef: string
  scope: string[]
  constraints: string[]
  timeoutMs: number
  approvalRequired: boolean
  idempotency: 'required' | 'best-effort' | 'not-applicable'
  evidenceRequired: boolean
}
```

Rules:

- Default-deny is mandatory.
- Tool policy is the single source of tool authority.
- Write and execute tools require explicit scope.
- Parameter and scope schemas are required for every binding.
- Tool calls outside scope are runtime violations and must be captured as
  evidence.
- Tool policy is adapter-aware but kernel-neutral.

## Evidence Plan

```ts
interface TrellisEvidencePlan {
  requiredEvidence: EvidenceRequirement[]
  verificationInputs: {
    fidelity: string[]
    persistence: string[]
  }
}

interface EvidenceRequirement {
  evidenceId: string
  producedByRole: string
  verifies: string[]
  verifierTarget: 'fidelity' | 'persistence' | 'both'
  source: string
  collectionSource: string
  expectedOutcome: string
  retentionPolicy: string
  hashRequired: boolean
  requiredForCompletion: boolean
}
```

Rules:

- Every validation obligation from the Executable Specification must map to at
  least one required evidence item or a typed UncertaintyEntry.
- Evidence items must name their producing role.
- Evidence used by Fidelity Verification must be distinguishable from evidence
  intended for Persistence Verification.
- Substrate-specific commands or observation rules belong in adapter-bound
  evidence source definitions, not kernel packet fields.

## Repair Policy

```ts
type FailureCode =
  | 'role-output-invalid'
  | 'required-evidence-missing'
  | 'tool-policy-violation'
  | 'adapter-contract-violation'
  | 'invariant-violation'
  | 'validation-failed'
  | 'runtime-timeout'
  | 'runtime-resource-exhausted'
  | 'human-escalation-required'

interface TrellisRepairPolicy {
  maxRepairAttempts: number
  failureClasses: Array<{
    code: FailureCode
    retryable: boolean
    repairAuthority: 'none' | 'same-scope' | 'narrower-scope'
    recertificationRequired: boolean
  }>
  patchAuthority: Array<{
    roleId: string
    scope: string[]
  }>
  escalationTarget: string
}
```

Rules:

- Repair authority is narrower than or equal to initial execution authority.
- A failed invariant, out-of-scope tool call, missing required evidence item, or
  Domain Adapter Contract violation is nonretryable unless the packet names a
  specific recertified repair path.
- Repair attempts produce evidence and are included in Fidelity Verification
  inputs.
- Any repair proposal that changes executable intent requires recertification.

## Completion Contract

```ts
interface TrellisCompletionContract {
  successStatus: string
  failureStatuses: string[]
  requiredOutputs: string[]
  requiredEvidence: string[]
  executionResultSchemaRef: string
}
```

Rules:

- Trellis completion never promotes lifecycle state by itself.
- Trellis completion returns evidence that Verification can consume.
- Lifecycle promotion remains a Factory decision after Verification.
- Success requires all required outputs and all required evidence.

## Lifecycle Pathway

```ts
interface LifecyclePathway {
  from: 'designed' | 'in_progress' | 'produced' | 'accepted'
  to: 'in_progress' | 'produced' | 'accepted' | 'monitored' | 'none'
  requiredVerification: 'none' | 'fidelity-verification' | 'persistence-verification'
}
```

Rules:

- A normal Trellis execution packet may authorize work toward `produced`.
- `produced -> accepted` requires Fidelity Verification after execution.
- `accepted -> monitored` requires active Persistence Verification and must not
  be treated as a one-shot Trellis execution outcome.

## Execution Result Contract

```ts
interface TrellisExecutionResult {
  packetId: string
  packetHash: string
  runId: string
  status: 'succeeded' | 'failed' | 'aborted' | 'blocked'
  domainExecutionEvidence: DomainExecutionEvidenceShape[]
  executionTraceRefs: string[]
  validationOutcomes: string[]
  repairAttempts: RepairAttemptEvidence[]
  fidelityVerificationInputRefs: string[]
  persistenceVerificationInputRefs: string[]
}

interface DomainExecutionEvidenceShape {
  adapterId: string
  executableSpecificationId: string
  runId: string
  status: 'succeeded' | 'failed' | 'aborted' | 'blocked'
  evidenceRefs: string[]
  observationSummary: string
}

interface RepairAttemptEvidence {
  attemptId: string
  failureCode: FailureCode
  roleId: string
  evidenceRefs: string[]
  recertified: boolean
}
```

The result contract is the bridge from Trellis execution into Verification.
Every result must include `packetId` and `packetHash` so evidence can be joined
to the exact authorization object.

## Packet Audit

```ts
interface TrellisPacketAudit {
  packetHash: string
  canonicalOrdering: string[]
  sourceCoverage: Array<{
    sourceRef: string
    sourceField: string
    consumedByPacketField: string[]
  }>
  unmappedExecutableRefs: string[]
  policyWarnings: string[]
}
```

Rules:

- `unmappedExecutableRefs` must be empty for a packet to be executable.
- `policyWarnings` do not block packet creation, but they must be visible to
  Trellis and Verification.
- Every derived packet field must have source coverage.
- A non-empty `unmappedExecutableRefs` list means Instruction Tuning failed
  closed.

## Validation Invariants

The packet is valid only if all invariants hold:

1. `id` uses the `TEP-*` artifact family.
2. `source_refs` includes the Intent Specification, Executable Specification,
   selected ArchitectureCandidate, runtime admission artifact, and Domain
   Adapter Contract.
3. Every role instruction maps to an Executable Specification node, validation,
   invariant, ArchitectureCandidate field, runtime profile field, or adapter
   binding.
4. Every required Executable Specification validation maps to required evidence.
5. Every tool binding references existing roles.
6. Every write or execute tool has non-empty scope.
7. Every role graph dependency references an existing role.
8. Every evidence item references an existing producing role.
9. Every derived field has source coverage.
10. The packet carries no substrate-specific terms outside adapter-bound fields.
11. `audit.unmappedExecutableRefs` is empty.
12. `audit.packetHash` is stable under canonical serialization.

## Required Negative Tests

Implementation must include tests that reject:

- missing adapter contract
- missing selected ArchitectureCandidate
- missing runtime admission artifact
- role graph cycle
- unmapped Executable Specification node
- substrate-term leakage in kernel fields
- out-of-scope tool call
- empty write or execute scope
- missing evidence producer
- nondeterministic packet hash
- blocked Instruction Tuning diagnostics
- raw runtime execution bypassing the packet

## Non-Goals

- The packet does not replace the Executable Specification.
- The packet does not encode lifecycle promotion.
- The packet does not define physical storage migration.
- The packet does not make coding substrate terms kernel concepts.
- The packet does not prescribe a specific LLM, model provider, or runtime
  hosting substrate.
