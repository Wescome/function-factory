# Charter Extraction Workspace

**Status:** Planning workspace only
**Date:** 2026-05-08
**Source references:** `specs/reference/FF-ONTOLOGY-v0.2.md`,
`specs/reference/ONTOLOGY-CURRENT-MAPPING.md`,
`.agent/skills/_index.md`

This directory is a staging area for extracting a future Runtime Charter from
the current skill and memory corpus.

It is not yet the active agent contract. The active contract remains
`.agent/AGENTS.md`, `.agent/protocols/permissions.md`, `.agent/skills/*`, and
the memory files named by `.agent/AGENTS.md`.

## Boundary

- Charter files here may describe future shared, non-negotiable substrate.
- Harness skill files remain in `.agent/skills/` until a separate approved
  skill rewrite workstream changes them.
- No agent should treat these files as overriding permissions, skills,
  lifecycle rules, or Factory artifact conventions.

## Current Files

| File | Purpose |
| --- | --- |
| [`CHARTER-EXTRACTION-PLAN.md`](CHARTER-EXTRACTION-PLAN.md) | Sequence for separating shared runtime policy from task-family harness skills. |
| [`FAILURE-TAXONOMY-TEMPLATE.md`](FAILURE-TAXONOMY-TEMPLATE.md) | Template for future skill/harness failure taxonomies. |
