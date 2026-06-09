# @factory/schemas

Canonical Zod schema definitions for every Factory artifact and domain adapter
boundary.

## Ontology Alias

Ontology v0.2 introduces aliases for several schema-backed artifact families:
Intent Specification is an `Intent Specification`, ExecutableSpecification is an `Executable Specification`,
Verification Report is a `Verification Report`, and Invariant is an
`Invariant Specification`. The domain-kernel cutover adds `DomainAdapter`
schemas so repository, branch, pull request, diff, CI check, and deployment
language stays inside coding-adapter mappings rather than becoming kernel
vocabulary.

## Pipeline Position

**Stage:** Foundation (no pipeline stage)
**Consumes:** Nothing
**Produces:** Zod schemas, TypeScript types, and ArtifactId patterns used by every downstream package

## Exports

Re-exports from the following modules:

- `lineage` -- `ArtifactId`, `Explicitness`, `Lineage` base schema
- `core` -- `FactoryMode`, `SignalType`, `BusinessCapability`, `FunctionProposal`, `ExecutableSpecification`, `ExecutableSpecificationNode`, `ExecutableSpecificationEdge`, and current compatibility artifact schemas from Signal Artifacts through Agent Call execution
- `coverage` -- `CoherenceVerificationReport`, `VerificationVerdict`, `VerificationCheck`
- `capability-delta` -- `CapabilityDelta`, `CapabilityDeltaFinding`
- `architecture-candidate` -- `ArchitectureCandidate`
- `candidate-selection` -- `ArchitectureCandidateSelection`, `CandidateScorecard`, `CandidateSelectionDecision`
- `runtime-admission` -- `RuntimeAdmissionArtifact`
- `controlled-effectors` -- `EffectorArtifact`
- `execution-trace` -- `ExecutionStart`, `ExecutionTrace`, `ExecutionResult`, `ExecutionLog`, `ExecutionNodeRecord`
- `effector-realization` -- `EffectorRealization`
- `observation` -- `ObservationArtifact`
- `signal-hygiene` -- `NormalizedSignal`, `SignalNormalizationArtifact`
- `adaptive-recalibration` -- `RecalibratedPressure`, `DeltaDriftInput`
- `selection-bias` -- `CandidateReliability`, `SelectionBiasInput`
- `meta-governance` -- `PolicyStressReport`, `GovernanceProposal`, `GovernanceDecision`, `PolicySuccessorNote`
- `policy-activation` -- `PolicyActivation`, `PolicyRollbackPlan`
- `commit-triage` -- Commit triage schemas
- `domain-adapter` -- `DomainAdapterContract`, `DomainExecutionRequest`, and
  `DomainExecutionEvidence` kernel boundary schemas
- `coding-domain-adapter` -- the bootstrap coding Domain Adapter contract that
  maps repository/branch/pull request/diff/CI/deployment terms into kernel
  concepts
- `ontology-aliases` -- Non-breaking aliases from ontology v0.2 terms to
  current stable schema names (`IntentSpecification` -> `IntentSpecification`,
  `ExecutableSpecification` -> `ExecutableSpecification`, `VerificationReport` ->
  `VerificationReport`)

## Key Invariants

- Every artifact schema extends `Lineage`, enforcing `source_refs`, `explicitness`, and `rationale` at the type level
- `ArtifactId` is regex-validated to match `<TYPE-PREFIX>-<ALPHANUM-WITH-HYPHENS>`
- This package has zero runtime dependencies beyond `zod`
- Modifications require explicit approval per permissions.md

## Dependencies

- `zod` -- Schema definition and runtime validation
