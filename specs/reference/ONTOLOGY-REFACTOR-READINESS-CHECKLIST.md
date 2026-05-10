# Ontology Refactor Readiness Checklist

**Status:** Required preflight checklist before any ontology-aligned physical
rename or refactor.

This checklist does not authorize a rename. It defines the evidence required
before a rename-family proposal can be considered ready for implementation.

## Current Decision

Physical renames are not ready by default. Current paths, packages, schema
exports, worker terms, API routes, artifact IDs, and ArangoDB collections remain
deferred migration surfaces. They are not the target architecture and must not
be treated as permanent compatibility baggage.

## Required Before Any Rename

- A one-family proposal starts from
  `ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md`.
- The proposal names the current implementation names and ontology target names.
- The proposal states why aliases alone are insufficient.
- The proposal identifies every physical, runtime, generated, and persisted
  surface touched by the rename.
- The proposal includes rollback steps and evidence that rollback preserves
  current live evidence.
- The proposal includes a read cutover plan for persisted data when a
  collection or runtime storage name changes.
- The proposal includes an explicit write cutover plan for generated and
  runtime artifacts.
- The proposal includes live worker, MRP, lifecycle, and Verification evidence
  validation when worker or persisted evidence terms are touched.

## Required Green Checks

- `pnpm audit:docs`
- `pnpm audit:ontology`
- Package tests for affected exports
- `pnpm -r typecheck`
- Remote `Repository Audit`
- Remote `Test`
- Remote `Typecheck`
- Remote Factory PR Gate

## Blocked Without Explicit Approval

- `.agent/AGENTS.md`
- `.agent/skills/*`
- `packages/schemas/src/core.ts`
- ArangoDB collection renames
- Worker route or Service Binding renames
- Fidelity Verification, MRP, lifecycle, or accepted Function evidence term replacement

## Audit-Enforced Non-Starters

- Parallel ontology-named replacement directories such as
  `specs/intent-specifications`, `specs/executable-specifications`,
  `specs/verification-reports`, `packages/verification`, or
  `workers/ff-fidelity-verification`.
- Ontology-named replacement collection identifiers such as
  `specs_intent_specifications`, `specs_executable_specifications`,
  `specs_verification_reports`, `coherence_verifications`, or
  `fidelity_verifications`.
- Removal or renaming of current storage directories such as `specs/intent-specifications`,
  `specs/executable-specifications`, `specs/verification-reports`, `packages/compiler`,
  `packages/verification`, `workers/ff-pipeline`, or `infra/arangodb`.

## Ready-To-Propose Bar

A rename family is ready to propose only when all of the following are true:

- `pnpm audit:ontology` covers the affected current names and any
  proposed migration guardrails.
- `ONTOLOGY-CUTOVER-CONSTRAINTS.json` has been updated for any approved
  current surface, forbidden target, or runtime collection guard change.
- The proposal can be reverted without losing current artifact lineage or live
  runtime evidence.
- The expected blast radius is small enough for one PR with no behavior changes
  beyond the rename and migration guardrails.
