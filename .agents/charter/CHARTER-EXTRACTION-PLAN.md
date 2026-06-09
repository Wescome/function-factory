# Runtime Charter Extraction Plan

**Status:** Draft plan; not active policy
**Date:** 2026-05-08
**Source references:** `specs/reference/FF-ONTOLOGY-v0.2.md`,
`specs/reference/ONTOLOGY-CURRENT-MAPPING.md`,
`.agent/AGENTS.md`, `.agent/skills/_index.md`,
`.agent/protocols/permissions.md`

Ontology v0.2 separates `Runtime Charter` from `Harness Skill`. This plan
stages that separation without rewriting current skills or changing active
agent behavior.

## Goal

Extract shared, non-negotiable runtime policy into charter documents while
leaving task-family procedures in harness skills.

## Non-Goals

- Do not edit `.agent/AGENTS.md` in this workstream.
- Do not edit `.agent/skills/*` until the charter split is reviewed.
- Do not change permissions, lifecycle rules, or tool schemas here.
- Do not rename current skills or directories as part of extraction.

## Candidate Charter Topics

| Future charter file | Source material | Scope |
| --- | --- | --- |
| `lineage-discipline.md` | `.agent/AGENTS.md`, lineage skill, decisions | Source refs, explicitness, rationale, no fabricated lineage. |
| `verification-enforcement.md` | coverage gate skills, decisions | Fail-closed gates, report emission, promotion blocks. |
| `artifact-persistence.md` | `.agent/AGENTS.md`, specs docs | Path-addressable artifacts, append-only evidence, move discipline. |
| `agent-lifecycle.md` | skills, memory protocol | Read order, workspace updates, episodic logging, completion discipline. |
| `orchestrator-minimality.md` | ontology v0.2, decisions | Thin conductor boundary and no hidden intelligence in harness loops. |

## Extraction Sequence

1. Inventory repeated policy text across `.agent/AGENTS.md`, protocol files,
   skills, and memory.
2. Classify each rule as charter policy, harness procedure, package contract,
   or artifact convention.
3. Draft charter files with source citations back to current active files.
4. Add failure taxonomy entries for common violations before changing any
   skill instructions.
5. Run a docs audit and review the diff as a documentation-only proposal.
6. In a separate approval-gated PR, update skills to reference charter files
   instead of duplicating shared policy.

## Completion Criteria

- Every extracted charter rule cites an active source.
- No active rule is weakened during extraction.
- Harness skills retain task-specific procedure.
- `pnpm audit:docs` passes.
- The charter README clearly states whether the charter is active or draft.
