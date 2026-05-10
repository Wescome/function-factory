# @factory/schemas

Canonical Zod schema definitions for every Factory artifact, shared across all
ontology categories and compatibility pipeline labels.

## Ontology Alias

Ontology v0.2 introduces aliases for several schema-backed artifact families:
PRD is an `Intent Specification`, WorkGraph is an `Executable Specification`,
Coverage Report is a `Verification Report`, and Invariant is an
`Invariant Specification`. The exported schema names remain the compatibility
APIs until a separate schema/API alias pass is approved and typechecked.

## Pipeline Position

**Stage:** Foundation (no pipeline stage)
**Consumes:** Nothing
**Produces:** Zod schemas, TypeScript types, and ArtifactId patterns used by every downstream package

## Exports

Re-exports from the following modules:

- `lineage` -- `ArtifactId`, `Explicitness`, `Lineage` base schema
- `core` -- `FactoryMode`, `SignalType`, `BusinessCapability`, `FunctionProposal`, `WorkGraph`, `WorkGraphNode`, `WorkGraphEdge`, and current compatibility artifact schemas from Signal Artifacts through Agent Call execution
- `coverage` -- `CoherenceVerificationReport`, `CoverageVerdict`, `CoverageCheck`
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
- `ontology-aliases` -- Non-breaking aliases from ontology v0.2 terms to
  current stable schema names (`IntentSpecification` -> `PRDDraft`,
  `ExecutableSpecification` -> `WorkGraph`, `VerificationReport` ->
  `CoverageReport`)

## Key Invariants

- Every artifact schema extends `Lineage`, enforcing `source_refs`, `explicitness`, and `rationale` at the type level
- `ArtifactId` is regex-validated to match `<TYPE-PREFIX>-<ALPHANUM-WITH-HYPHENS>`
- This package has zero runtime dependencies beyond `zod`
- Modifications require explicit approval per permissions.md

## Dependencies

- `zod` -- Schema definition and runtime validation
