# @factory/policy-activation

Activates approved successor policies under controlled rollout with mandatory rollback plans, enforcing that auto-activation remains disabled and proposal IDs match.

## Pipeline Position

**Stage:** 10
**Consumes:** `GOVD-*` (GovernanceDecision), `GOVS-*` (PolicySuccessorNote)
**Produces:** `GOVA-*` (PolicyActivation), `GOVR-*` (PolicyRollbackPlan)

## Exports

- `assertActivationAllowed()` -- Triple guard: decision must be approved, auto-activation must be disabled, and decision proposal ID must match activation proposal ID
- `emitPolicyActivation()` -- Emits a GOVA artifact recording staged rollout (shadow/partial/full) with rollback target preserved
- `emitRollbackPlan()` -- Emits a GOVR artifact alongside every activation, recording the predecessor policy as rollback target
- `policyActivationIdFromSuccessorId()`, `rollbackPlanIdFromSuccessorId()` -- Deterministic ID generators

## Key Invariants

- Auto-activation is unconditionally blocked; human approval is the only path to activation
- Every activation must have a matching rollback plan emitted alongside it
- Rollback target is always the predecessor policy; silent replacement is prevented
- Proposal ID mismatch between decision and activation is a hard error
- Rollout states are explicit: shadow, partial, or full

## Dependencies

- `@factory/schemas` -- `PolicyActivation`, `PolicyRollbackPlan` types
