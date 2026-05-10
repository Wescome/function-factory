# Trellis Refactor First Cut

**Status:** Active refactor backlog
**Date:** 2026-05-10
**Source references:** `DOMAIN-FACTORY-KERNEL.md`,
`ONTOLOGY-CURRENT-MAPPING.md`, `.agent/memory/semantic/DECISIONS.md`

Trellis is the harness architecture target for the Function Factory refactor.
The Factory kernel stays domain-neutral; coding remains the bootstrap Domain
Adapter.

This first cut removes compatibility-as-strategy from the active refactor
frame. Persisted artifact IDs, storage buckets, ArangoDB collections, and live
runtime evidence are still deferred migration surfaces, but active architecture
work should not add new dual names or new Gate-number APIs.

## Current Active Residue

The next refactor commits should remove these active-source residues in small
behavior-preserving slices:

| Surface | Current residue | Target |
| --- | --- | --- |
| Coordinator state | `PipelineWorkGraph`, `WorkGraphNodeShape`, `WorkGraphEdgeShape`, `currentWorkGraphId`, `workGraph` parameters | `PipelineExecutableSpecification`, executable-spec node/edge shapes, executable-specification state fields |
| Lifecycle API | `gateReport`, `gateRequired`, `GATE_REQUIREMENTS`, `LegacyGateRequirement` | Verification-only report and requirement fields |
| Runtime statuses | `legacyStatus`, `gate-1-failed` metadata | Coherence Verification failure status only |
| Worker diagnostics | `/debug/gate2-simulate` and numbered gate route comments | `/debug/fidelity-verification` primary route only |
| Function synthesis tools | `readWorkGraph` | `readExecutableSpecification` |
| Cross-package source fields | `sourceWorkGraphId` | `sourceExecutableSpecificationId` |
| Compiler comments and options | PRD/WorkGraph path wording in active APIs | Intent Specification / Executable Specification wording |
| Reference guardrails | Compatibility contract framing | Hard-cutover constraints and explicit migration backlog |

## Cutover Rules

1. Do not add new `Gate1`, `Gate2`, `Gate3`, `gate1`, `gate2`, or `gate3`
   active APIs.
2. Do not add new `WorkGraph` active APIs outside historical artifacts or
   deferred persisted-storage migration code.
3. Do not add new `PRDDraft` active APIs; use `IntentSpecification`.
4. Do not add new `CoverageReport` active APIs; use Verification Report
   variants.
5. Keep persisted paths and collection names stable until a migration commit
   explicitly handles data movement and read/write cutover.
6. Every code slice must update `pnpm audit:ontology` so the old name cannot
   re-enter the active surface.

## First Code Slice

Start with the coordinator executable-specification rename:

1. Rename active TypeScript types:
   - `PipelineWorkGraph` -> `PipelineExecutableSpecification`
   - `WorkGraphNodeShape` -> `ExecutableSpecificationNodeShape`
   - `WorkGraphEdgeShape` -> `ExecutableSpecificationEdgeShape`
2. Rename coordinator state fields where they are not persisted external
   contracts:
   - `currentWorkGraphId` -> `currentExecutableSpecificationId`
   - local `workGraph` parameters -> `executableSpecification`
3. Preserve only persisted `WG-*`, `specs/workgraphs`, and
   `specs_workgraphs` identifiers until the storage/path migration slice.
4. Add audit checks for the removed active names.
5. Run focused coordinator tests, `pnpm audit:ontology`, and
   `pnpm -r typecheck`.

## Out Of Scope For First Code Slice

- No storage bucket rename.
- No ArangoDB collection rename.
- No package rename.
- No deletion of historical artifacts.
- No monitored lifecycle promotion.
