# @factory/schemas

Canonical Zod schema definitions for every Factory artifact, shared across all pipeline stages.

## Pipeline Position

**Stage:** Foundation (no pipeline stage)
**Consumes:** Nothing
**Produces:** Zod schemas, TypeScript types, and ArtifactId patterns used by every downstream package

## Exports

Re-exports from the following modules:

- `lineage` -- `ArtifactId`, `Explicitness`, `Lineage` base schema
- `core` -- `FactoryMode`, `SignalType`, `BusinessCapability`, `FunctionProposal`, `WorkGraph`, `WorkGraphNode`, `WorkGraphEdge`, and all Stage 1-6 artifact schemas
- `coverage` -- `Gate1Report`, `CoverageVerdict`, `CoverageCheck`
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

## Key Invariants

- Every artifact schema extends `Lineage`, enforcing `source_refs`, `explicitness`, and `rationale` at the type level
- `ArtifactId` is regex-validated to match `<TYPE-PREFIX>-<ALPHANUM-WITH-HYPHENS>`
- This package has zero runtime dependencies beyond `zod`
- Modifications require explicit approval per permissions.md

## Dependencies

- `zod` -- Schema definition and runtime validation
