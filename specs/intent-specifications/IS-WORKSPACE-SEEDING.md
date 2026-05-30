---
id: IS-WORKSPACE-SEEDING
version: 2
title: "Workspace Seeding for PI Container Execution"
source_refs:
  - ADR-011-workspace-seeding
  - ADR-003a-pi-rpc-container-supersedes-003
  - IS-GC-EP-FORMULA-DISPATCH
  - IS-GC-RUNTIME-PROVIDER-CONTRACT
explicitness: explicit
rationale: >
  ADR-011 accepted Option B (2026-05-30, Wes +B). V2 resolves four MUST
  blockers from Architect + SE review (2026-05-30):
  MUST-1: delivery path — Gas City Go change approved (Wes 2026-05-30);
  MUST-2: container reads inline, not R2-fetch; delivery is inline JSON in
  bead metadata, R2 write is for audit only;
  MUST-3: SeedWorkspace schema uses existing issue/acceptance fields, no
  schema extension (Wes approved 2026-05-30);
  MUST-4: lineage carried as a files[] entry, not a top-level field;
  MUST-5: new outcomes use failed+error-string pattern, not new enum values.
---

# Workspace Seeding for PI Container Execution

## JTBD

When Factory dispatches a formula to Gas City and the pi-rpc harness provider
fires `POST /__pi-container/execute`, the PI container agent must receive the
IS content, ES acceptance criteria, and relevant rig files so it can produce
non-vacuous output. Currently `inputArtifacts: {}` on every step. This function
produces the seed payload and delivers it to the container at execute time.

## Problem

Three kernel requirements are unmet on every dispatch:

- **K1 (Intent):** Agent receives `"IS-GC-DISPATCH-WIRE"` (ID string), not the IS body.
- **K2 (Acceptance):** ES acceptance criteria never fetched or passed.
- **K3 (Source material):** Working directory is empty — no rig files present.

The PI container receiver is complete: `server.mjs:599-625` reads
`inputArtifacts`, writes each entry to disk, detects
`inputArtifacts.SeedWorkspace` as an inline JSON string, materializes files via
`prepareSeedWorkspace`, and injects `issue` and `acceptance` into the agent's
prompt. Nothing upstream produces a payload — the receiver is dormant.

The delivery gap: `harness.ExecutionRequest.Inputs` (`types.go:84`) is read by
pi-rpc `translateRequest` (`provider.go:336`) but written by zero production
code paths in Gas City. `harnessExecutionRequestForBead`
(`harness_dispatch.go:222-253`) builds the request from bead metadata only.

## Goal

Implement a function that, as part of the formula dispatch flow:

1. Fetches the IS document body from ArangoDB (`intent_specifications`)
   using `ep.intentSpecificationId`.
2. Fetches the ES document body from ArangoDB (`executable_specifications`)
   using `ep.executableSpecificationId`.
3. Assembles a `SeedWorkspace` JSON bundle using the existing schema
   (`coding-adapter-workspace.ts`):
   - `issue`: IS body text (K1)
   - `acceptance`: ES acceptance criteria as a string array (K2)
   - `testCommand`: from `EP.parameters.test_command` if present
   - `files[]`: curated rig file set from `EP.parameters.rig_files` (K3)
   - A `lineage.json` entry in `files[]` carrying `{form_id, ep_id, is_id,
     es_id, factory_attempt}` as JSON text (lineage carrier)
4. Writes the serialized bundle to R2 (`ff-workspaces` bucket) at key
   `seeds/<form_id>/seed.json` for audit/durability.
5. Includes the full SeedWorkspace JSON string as bead metadata label
   `gc.seed_workspace` in the CALL 2 bead-create body so Gas City can read it.
6. Gas City (`harnessExecutionRequestForBead`, `harness_dispatch.go:222`) reads
   `bead.Metadata["gc.seed_workspace"]` and sets
   `req.Inputs["SeedWorkspace"] = metadata["gc.seed_workspace"]`.
   pi-rpc `translateRequest` then maps `req.Inputs` →
   `context.inputArtifacts`, which the container reads inline.
7. Halts with outcome `failed` + `error: "seed_resolution_failed"` if IS/ES
   fetch fails. Halts with `failed` + `error: "seed_upload_failed"` if R2
   write fails. Never dispatches without a complete seed (INV-1).

## Constraints

**Schema: no changes.** `SeedWorkspace` schema (`coding-adapter-workspace.ts`
and `.mjs`) is not modified. IS content maps to `issue`; ES acceptance criteria
map to `acceptance[]`. Lineage is carried as a `files[]` entry
(`lineage.json`). Unknown keys would be silently dropped by the parser — so no
new top-level fields are introduced.

**One targeted Gas City Go change (approved Wes 2026-05-30).** The only Go
change is adding one read in `harnessExecutionRequestForBead`
(`harness_dispatch.go:222`): if `bead.Metadata["gc.seed_workspace"] != ""`,
set `req.Inputs["SeedWorkspace"] = bead.Metadata["gc.seed_workspace"]`. No
other Gas City files are touched.

**Delivery is inline.** The container reads `inputArtifacts.SeedWorkspace` from
the execute request body (server.mjs:608). The full JSON string travels through
Gas City as a bead metadata value. R2 write is for audit only — it is not the
delivery channel.

**Seed write precedes CALL 2.** The R2 write and the bead metadata label are
both set before CALL 2 (POST `/v0/city/{city}/beads`). This ensures the bead
carries the seed reference at creation time and the R2 copy is durable before
Gas City processes the bead.

**Injected deps pattern.** All new I/O (IS/ES fetch, R2 write, rig file fetch)
are added to `FormulaCompilerDeps` as injected functions, unit-testable with
mocks. Follow the `writeFormAndDispatchLog`, `httpFetch` pattern.

**Fail-closed on missing or failed seed (INV-1).** Outcome `failed` +
`error: "seed_resolution_failed"` when IS/ES fetch fails or rig file is
missing. Outcome `failed` + `error: "seed_upload_failed"` when R2 write fails.
These extend the existing `missing_coherence_vr` / `unregistered_adapter`
pattern (`formula-compiler.ts:295-304`). No new enum values added.

**Determinism (INV-3, AC-4).** Bundle serialized with `stableStringify`
(existing function in `formula-compiler.ts:1085`, to be exported or extracted
to a shared module). R2 key is `seeds/<form_id>/seed.json` — deterministic by
AC-4. Bundle content excludes timestamps or UUIDs.

**No silent truncation (INV-5).** If the assembled bundle exceeds 512 KB
(configurable via `SEED_MAX_BYTES` env var, default 524288), outcome is
`failed` + `error: "seed_too_large"` naming the oversized rig paths.

**Producer-side path safety.** Each path in `EP.parameters.rig_files` is
validated with `assertSafeRelativePath` (`coding-adapter-workspace.ts:218`)
before R2 fetch. Invalid paths halt with `failed` + `error: "seed_invalid_path"`.

**Coding domain only for v1.** The `SeedWorkspace` encoding is coding-specific.
Other domain adapters define their own K3 encodings separately.

**Curated file list for v1.** `EP.parameters.rig_files` is an array of
repo-relative paths. Rig file content is fetched from R2 at a pre-uploaded
snapshot key `rigs/<form_id>/` (operator-managed, `ff-workspaces` bucket).
Automated rig file selection is deferred.

## Acceptance Criteria

**AC-1 — IS content in seed.** The assembled bundle has a non-empty `issue`
field containing the IS document body fetched from `intent_specifications`.

**AC-2 — ES acceptance criteria in seed.** The assembled bundle has a non-empty
`acceptance` array containing the ES acceptance criteria strings fetched from
`executable_specifications`.

**AC-3 — Rig files in seed.** Each path in `EP.parameters.rig_files` appears
as a `files[]` entry with correct relative path and content.

**AC-4 — Lineage entry in seed.** `files[]` contains an entry with
`path: "lineage.json"` whose content is the JSON string
`{"form_id":"…","ep_id":"…","is_id":"…","es_id":"…","factory_attempt":N}`.

**AC-5 — R2 write before CALL 2.** The R2 PUT to `seeds/<form_id>/seed.json`
returns 2xx before the CALL 2 bead-create request fires.

**AC-6 — Bead carries seed label.** The CALL 2 bead-create body includes
metadata label `gc.seed_workspace` whose value is the full SeedWorkspace JSON
string (same content as the R2 object).

**AC-7 — Gas City populates req.Inputs.** When `bead.Metadata["gc.seed_workspace"]`
is non-empty, `harnessExecutionRequestForBead` sets
`req.Inputs["SeedWorkspace"] = bead.Metadata["gc.seed_workspace"]`.
Verified by checking the pi-rpc WorkerInput sent to the container contains
`context.inputArtifacts.SeedWorkspace`.

**AC-8 — Container materializes seed.** After execute, the PI container
working directory contains files matching `files[]` in the seed. The
observation event log includes `execute.seed_workspace_prepared`.

**AC-9 — Fail-closed on IS/ES fetch failure.** IS/ES fetch failure →
outcome `failed`, `error: "seed_resolution_failed"`, no sling call fires.

**AC-10 — Fail-closed on R2 write failure.** R2 PUT failure →
outcome `failed`, `error: "seed_upload_failed"`, no sling call fires.

**AC-11 — Fail-closed on missing rig file.** A `rig_files` entry not found in
R2 → outcome `failed`, `error: "seed_resolution_failed"`, naming the missing
path.

**AC-12 — Fail-closed on invalid rig path.** A `rig_files` entry that fails
`assertSafeRelativePath` → outcome `failed`, `error: "seed_invalid_path"`.

**AC-13 — Fail-closed on oversized bundle.** Bundle exceeds `SEED_MAX_BYTES` →
outcome `failed`, `error: "seed_too_large"`, naming offending paths.

**AC-14 — Determinism.** Same EP + same `factory_attempt` produces
byte-identical SeedWorkspace JSON (via `stableStringify`, no timestamps in
bundle). Same R2 key. Overwrite-safe (idempotent R2 PUT).

**AC-15 — Existing dispatch tests pass.** All existing acceptance criteria of
IS-GC-EP-FORMULA-DISPATCH are satisfied unchanged. The three-call sequence is
otherwise unmodified.

## Validation

- Unit tests `seedAssembly.test.ts`: IS/ES fetch mocked, R2 write mocked,
  rig file fetch mocked. Asserts bundle shape (AC-1–4), determinism (AC-14),
  fail-closed paths (AC-9–13). Does not touch live ArangoDB or R2.
- Integration probe: hand-upload a `SeedWorkspace` JSON to R2 at a known
  `seeds/<form_id>/seed.json`, dispatch via `dispatch-only.sh` with a
  matching `gc.seed_workspace` bead label (injected manually), observe
  `execute.seed_workspace_prepared` in PI container observation. Verifies
  AC-7 and AC-8 end-to-end before wiring the full compiler path.
- Gas City Go change test: unit test in `harness_dispatch_test.go` asserting
  that a bead with `gc.seed_workspace` metadata produces a WorkerInput with
  `context.inputArtifacts.SeedWorkspace` set.
- Regression: existing `formula-compiler.test.ts` dispatch tests pass
  unchanged (AC-15).

## Resolved Open Questions

**OQ-1 (seed key delivery) — RESOLVED.** Delivery is **inline JSON in bead
metadata**, not R2-key-fetch. The compiler writes the full SeedWorkspace JSON
as `gc.seed_workspace` bead metadata at CALL 2. Gas City reads it into
`req.Inputs`. Container reads inline from `inputArtifacts`. R2 write is for
audit only. Container needs no R2 access.

**OQ-2 (rig file source) — RESOLVED.** Option (a): operator-managed R2
snapshot at `rigs/<form_id>/` in `ff-workspaces` bucket. Missing rig file →
`seed_resolution_failed` (loud halt). Staleness is not detected automatically
— the operator manages snapshot freshness. A `lineage.json` entry in the seed
records the snapshot key for downstream auditability.
