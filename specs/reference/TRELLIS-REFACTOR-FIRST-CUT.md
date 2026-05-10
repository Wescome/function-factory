# Trellis Refactor First Cut

**Status:** First cut implemented; storage/path migration deferred
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

## First-Cut Result

The first refactor commits removed these active-source residues while leaving
persisted artifact IDs, storage buckets, and ArangoDB collections stable:

| Surface | Current residue | Target |
| --- | --- | --- |
| Coordinator state | Executable Specification-shaped type and field names | `PipelineExecutableSpecification`, executable-spec node/edge shapes, executable-specification state fields |
| Lifecycle API | numbered gate compatibility evidence fields | Verification-only report and requirement fields |
| Runtime statuses | numbered gate compatibility failure status metadata | Coherence Verification failure status only |
| Worker diagnostics | numbered Fidelity Verification diagnostic route alias | `/debug/fidelity-verification` only |
| Function synthesis tools | `readExecutableSpecification` | `readExecutableSpecification` |
| Cross-package source fields | `sourceExecutableSpecificationId` | `sourceExecutableSpecificationId` |
| Compiler comments and options | Intent Specification/ExecutableSpecification path wording in active APIs | Intent Specification / Executable Specification wording |
| Reference guardrails | Compatibility contract framing | Hard-cutover constraints and explicit migration backlog |

## Cutover Rules

1. Do not add new numbered Gate active APIs.
2. Do not add new Executable Specification active APIs outside historical artifacts or
   deferred persisted-storage migration code.
3. Do not add new `IntentSpecificationDraft` active APIs; use `IntentSpecification`.
4. Do not add new `VerificationReport` active APIs; use Verification Report
   variants.
5. Keep persisted paths and collection names stable until a migration commit
   explicitly handles data movement and read/write cutover.
6. Every code slice must update `pnpm audit:ontology` so the old name cannot
   re-enter the active surface.

## First Code Slice Completed

Completed scope:

1. Active coordinator TypeScript types and state fields now use Executable
   Specification names.
2. Lifecycle transitions require and persist `verificationReport` only.
3. Runtime Coherence Verification failures emit only
   `coherence-verification-failed`.
4. Fidelity Verification diagnostics are served only from
   `/debug/fidelity-verification`.
5. Function synthesis tools use `readExecutableSpecification`.
6. Cross-package lineage fields use `sourceExecutableSpecificationId`.
7. Compiler active options and comments use Intent Specification /
   Executable Specification wording.
8. `pnpm audit:ontology` enforces the removed active names.
9. Preserve only persisted `ES-*`, `specs/executable-specifications`, and
   `executable_specifications` identifiers until the storage/path migration slice.

## Out Of Scope

- No storage bucket rename.
- No ArangoDB collection rename.
- No package rename.
- No deletion of historical artifacts.
- No monitored lifecycle promotion.
