# Ontology Rename Proposal Template

**Status:** Template for future one-family rename proposals
**Use when:** A PR proposes any physical path, package, schema API, runtime
collection, or worker terminology rename from current implementation names to
ontology v0.2 names.

Do not use this template to justify a bulk rename. Each proposal must cover
exactly one rename family and must preserve the current live evidence and
cutover guardrails until the migration is proven green.

## Rename Family

- Family:
- Current implementation names:
- Ontology target names:
- Physical surfaces:
- Runtime surfaces:
- Generated or persisted surfaces:
- Out of scope:

## Decision

- Proposed action:
- Why the rename is worth the churn:
- Why aliases alone are insufficient:
- Current names that remain valid after merge:
- Current names scheduled for later removal:

## Cutover Strategy

- Export aliases:
- Import/path aliases:
- Read cutover:
- Write cutover:
- Generated artifact cutover:
- Runtime data cutover:
- Documentation cutover:

## Blast Radius

- Source files expected to change:
- Tests expected to change:
- Specs or generated artifacts expected to change:
- CI or workflow files expected to change:
- Worker/runtime evidence expected to change:
- Arango collections or persisted records expected to change:

## Rollback Plan

- Revert strategy:
- Data rollback:
- Alias rollback:
- Runtime rollback:
- Evidence that rollback preserves current live evidence:

## Verification Plan

Before merge, the PR must show:

- `pnpm audit:docs`
- `pnpm audit:ontology`
- Package tests for affected exports
- `pnpm -r typecheck`
- Reference search for stale old paths and stale new aliases
- Remote `Repository Audit`, `Test`, `Typecheck`, and Factory PR Gate checks
- Live worker, MRP, lifecycle, and Verification evidence validation when the
  rename touches runtime or persisted surfaces

## Non-Starters

- No mass rename across multiple families.
- No edit to `packages/schemas/src/core.ts` without explicit approval.
- No edit to `.agent/AGENTS.md` or `.agent/skills/*` without explicit
  approval.
- No Arango collection rename without an explicit read cutover and a data
  migration plan.
- No replacement of Fidelity Verification, MRP, lifecycle, or accepted Function
  evidence terms without live runtime validation.
