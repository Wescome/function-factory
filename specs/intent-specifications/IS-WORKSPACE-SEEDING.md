---
id: IS-WORKSPACE-SEEDING
version: 1
title: "Workspace Seeding for PI Container Execution"
source_refs:
  - ADR-011-workspace-seeding
  - ADR-003a-pi-rpc-container-supersedes-003
  - IS-GC-EP-FORMULA-DISPATCH
  - IS-GC-RUNTIME-PROVIDER-CONTRACT
explicitness: explicit
rationale: >
  ADR-011 accepted Option B (2026-05-30, Wes +B): formula compiler assembles
  a SeedWorkspace bundle (IS/ES content + rig files), writes it to R2 keyed
  by form_id, and the PI container fetches and hydrates inputArtifacts at
  execute time. Architect and SE reviews confirmed the receiver (server.mjs
  599-623, workspace-seed.mjs) is fully implemented and dormant — nothing
  upstream populates inputArtifacts. This IS specifies the producer side.
---

# Workspace Seeding for PI Container Execution

## JTBD

When Factory dispatches a formula to Gas City and the pi-rpc harness provider
fires `POST /__pi-container/execute`, the PI container agent must receive the
IS content, ES acceptance criteria, and relevant rig files so it can produce
non-vacuous output. Currently `inputArtifacts: {}` on every step. This function
produces the seed payload and makes it available to the container at execute time.

## Problem

Three kernel requirements are unmet on every dispatch:

- **K1 (Intent):** Agent receives `"IS-GC-DISPATCH-WIRE"` (ID string), not the IS body.
- **K2 (Acceptance):** ES acceptance criteria never fetched or passed.
- **K3 (Source material):** Working directory is empty — no rig files present.

The PI container receiver is complete: `server.mjs:599-623` reads
`inputArtifacts`, writes each entry to disk, detects `inputArtifacts.SeedWorkspace`,
materializes files via `prepareSeedWorkspace`, and injects all content into the
agent's prompt. Nothing upstream produces a payload — the receiver is dormant.

Without this function every dispatch is vacuous: steps complete in ~500ms with
no artifacts and `stageHistory: []`.

## Goal

Implement a function that, as part of the formula dispatch flow:

1. Fetches the IS document body from ArangoDB (`intent_specifications` collection)
   using `ep.intentSpecificationId`.
2. Fetches the ES document body from ArangoDB (`executable_specifications`
   collection) using `ep.executableSpecificationId`.
3. Assembles a `SeedWorkspace` JSON bundle (schema: `coding-adapter-workspace.ts`)
   containing IS/ES content as named entries and the curated rig file set.
4. Writes the bundle to R2 (`ff-workspaces` bucket) at key
   `seeds/<form_id>/seed.json` — deterministic, keyed by FORM-* ID.
5. Makes the seed key available to the PI container via the execution request
   so the container can fetch and hydrate `inputArtifacts` before running pi.
6. Halts with an `UncertaintyEntry` if IS/ES fetch fails or R2 write fails.
   Never dispatches with an empty or missing seed (INV-1).

The function is LLM-free and deterministic: same EP + same `factory_attempt`
always produces the same seed key and the same bundle content (INV-3).

## Constraints

**Injected deps pattern.** All new I/O (IS/ES fetch, R2 write) must be added
to `FormulaCompilerDeps` (`formula-compiler.ts`) as injected functions, unit-
testable with mocks before any live wiring. Follow the existing pattern of
`writeFormAndDispatchLog`, `httpFetch`, etc.

**Seed durability precedes dispatch (INV-2).** R2 write completes and is
confirmed before CALL 3 (sling) fires. The seed key is never passed to Gas City
until the payload is durably stored.

**Determinism (INV-3, AC-4).** The seed bundle is a pure function of EP content
and `factory_attempt`. File lists are sorted. Bundle is serialized with
`stableStringify`. The R2 key is `seeds/<form_id>/seed.json` — `form_id`
already satisfies AC-4.

**No Gas City changes.** Gas City is not touched. The seed key travels to the
PI container as a field the container reads and resolves; Gas City transports
it opaquely.

**Fail-closed on missing seed (INV-1).** If IS or ES cannot be fetched, or if
the R2 write fails, the function returns an `UncertaintyEntry` outcome and does
not fire CALL 3 (sling). A vacuous dispatch with an empty workspace is worse
than no dispatch.

**No silent truncation (INV-5).** If the assembled bundle exceeds R2 limits or
a configurable size ceiling, the function emits an `UncertaintyEntry`
("seed bundle too large — narrow the rig file selection") rather than truncating.

**Coding domain only for v1.** The `SeedWorkspace` encoding is coding-specific
(`coding-adapter-workspace.ts` schema). Other domain adapters define their own
K3 encodings in separate functions. The kernel mechanism (`inputArtifacts` map)
is domain-neutral; the content producers are adapter-specific.

**Curated file list for v1.** Automated rig file selection (repo-map generation)
is deferred. The v1 rig file set is specified in the EP's `parameters` field
under a `rig_files` key: an array of repo-relative paths. The function reads
this list and fetches file content from R2 (`ff-workspaces` workspace bucket,
where the rig snapshot is pre-uploaded by the operator) or via the Git API.

## Acceptance Criteria

**AC-1 — IS content in seed.** For every dispatch, the assembled
`SeedWorkspace` contains an entry `IS` whose value is the full text of the
IS document body fetched from ArangoDB.

**AC-2 — ES content in seed.** For every dispatch, the assembled
`SeedWorkspace` contains an entry `ES` whose value is the full text of the
ES document body fetched from ArangoDB.

**AC-3 — Rig files in seed.** For every dispatch whose EP carries a
`parameters.rig_files` list, each path in the list is present as a file entry
in `SeedWorkspace.files[]` with the correct path and content.

**AC-4 — Seed written to R2 before sling.** The R2 PUT for `seeds/<form_id>/seed.json`
completes with a 2xx response before CALL 3 (POST `/v0/city/{city}/sling`)
fires.

**AC-5 — Seed key in execution request.** The PI container receives the seed
key (`seeds/<form_id>/seed.json`) in the execution request — either via
`contextRefs.seed_ref` or a formula var passed through the step description —
and fetches the bundle from R2 before calling `prepareSeedWorkspace`.

**AC-6 — Container materializes seed.** After hydration, the PI container's
working directory contains the files declared in `SeedWorkspace.files[]`. The
observation event log includes `execute.seed_workspace_prepared`.

**AC-7 — Fail-closed on IS/ES fetch failure.** If `fetchIntentSpec` or
`fetchExecutableSpec` returns null or throws, the dispatch outcome is
`seed_resolution_failed` and no sling call fires. The dispatch_log records the
failure reason.

**AC-8 — Fail-closed on R2 write failure.** If the R2 PUT fails, the dispatch
outcome is `seed_upload_failed` and no sling call fires. The dispatch_log
records the failure reason.

**AC-9 — Determinism.** Running the seed assembly twice with the same EP
and `factory_attempt` produces byte-identical bundles (same `stableStringify`
output) and the same R2 key.

**AC-10 — No silent truncation.** If the bundle exceeds the configured size
ceiling, the dispatch outcome is `seed_too_large` with a human-readable
`UncertaintyEntry` message naming the offending rig path(s).

**AC-11 — Lineage.** The `SeedWorkspace` bundle carries a `lineage` field:
`{form_id, ep_id, is_id, es_id, factory_attempt}`. This field is written to
the bundle before the R2 PUT and is readable by the container after hydration.

**AC-12 — Existing dispatch path unchanged.** Steps AC-1 through AC-11 are
additive. The three-call dispatch sequence (CALL 1 version probe → CALL 2
bead create → CALL 3 sling) is otherwise unchanged. No existing acceptance
criteria of IS-GC-EP-FORMULA-DISPATCH are weakened.

## Validation

- Unit tests: `seedAssembly.test.ts` — IS/ES fetch mocked, R2 write mocked,
  asserts bundle shape and lineage fields. Covers AC-1, AC-2, AC-3, AC-9, AC-11.
- Unit tests: fail-closed paths — covers AC-7, AC-8, AC-10.
- Integration probe: hand-upload a `seed.json` to R2 at a known `form_id` key,
  dispatch via `dispatch-only.sh`, observe `execute.seed_workspace_prepared`
  event in PI container observation. Verifies AC-5, AC-6 end-to-end before
  wiring the compiler.
- Regression: existing dispatch tests in `formula-compiler.test.ts` pass
  unchanged (AC-12).

## Open Questions

**OQ-1 — Seed key delivery to PI container.** Two options:
  (a) Pass via `contextRefs.seed_ref` in the `harnessExecutionRequestForBead`;
      requires confirming Gas City forwards `contextRefs` to the provider.
  (b) Pass via a formula var (`{{seed_ref}}`), substituted into step description
      text; container parses from its task context.
  Architect to confirm which is less fragile given that `contextRefs` is
  structurally dead in `buildPrompt` (Architect finding 2026-05-30).

**OQ-2 — Rig file source.** For v1, where do rig file contents come from?
  (a) Pre-uploaded snapshot in `ff-workspaces` R2 bucket, operator-managed.
  (b) Fetched from GitHub API using `GITHUB_TOKEN` at dispatch time.
  Operator-managed snapshot (a) is safer for bootstrap; GitHub API (b) always
  fresh but adds a new network dependency and auth surface.
