---
id: PRD-META-CAPABILITY-DELTA-ENGINE
source_refs:
  - DEL-META-COMPUTE-CAPABILITY-DELTA
  - FP-META-CAPABILITY-DELTA-ENGINE
explicitness: inferred
rationale: >
  Derived deterministically from FP-META-CAPABILITY-DELTA-ENGINE and its upstream lineage.
sourceCapabilityId: BC-META-COMPUTE-CAPABILITY-DELTA
sourceFunctionId: FN-META-CAPABILITY-DELTA-ENGINE
title: Capability Delta Execution Engine
---

# Capability Delta Execution Engine

## Problem
The repo can now compute capability delta and emit FunctionProposal demand in Stage 4, but there is no dedicated execution engine artifact that computes capability delta as a first-class bootstrap Function from bounded repo evidence.

## Goal
Implement a deterministic capability-delta execution engine that consumes a BusinessCapability and RepoInventory, computes a CapabilityDelta for supported bootstrap capabilities, and produces reviewable downstream proposal demand without modifying compiler behavior.

## Constraints
Must remain separate from Stage 5 compiler logic.

Must preserve lineage and explicit rationale in emitted artifacts.

Must be deterministic and rule-based.

Must not use LLM-based inference in the first implementation.

## Acceptance Criteria
1. The engine accepts the supported bootstrap capability and a bounded RepoInventory input.
2. The engine computes a deterministic CapabilityDelta with explicit findings and overallStatus.
3. The engine emits downstream typed FunctionProposal demand from the computed delta.
4. The implementation fails explicitly for unsupported capabilities in the initial narrow version.
5. The implementation preserves lineage and explicitness in emitted artifacts.

## Success Metrics
Deterministic delta classification across repeated runs for supported bootstrap capabilities.

Stable and typed FunctionProposal emission from computed delta findings.

Zero compiler behavior changes required to adopt the produced PRD.

## Out of Scope
Generalized support for all capability families.

LLM-based repo interpretation or proposal generation.

Runtime execution, Gate 2, Gate 3, and assurance propagation.