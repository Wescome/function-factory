# ADR-0002: Workspace Seeding via R2 (Option B)

Status: Proposed

Date: 2026-05-30

## Context

The Gas City → pi-rpc → PI container pipeline is fully wired. Steps complete
with `gc.outcome: pass` but produce no real output — the LLM agent runs for
~500ms and emits nothing. Root cause: the PI container receives an empty
`inputArtifacts: {}` on every step. It has no IS content, no ES acceptance
criteria, and no rig files to read or modify.

The PI container's seeding receiver is fully implemented: `server.mjs:599-623`
reads `inputArtifacts`, writes each entry to disk, detects `inputArtifacts.SeedWorkspace`,
materializes files via `prepareSeedWorkspace`, and injects all content into the
agent's prompt. Nothing upstream produces a payload.

Three kernel requirements are unmet on every dispatch:

- **K1 (Intent):** The agent receives `"IS-GC-DISPATCH-WIRE"` (a string ID), not
  the IS document body.
- **K2 (Acceptance):** The ES acceptance criteria are never fetched or passed.
- **K3 (Source material):** The coding agent's working directory is empty; no
  rig files are present.

K4 (role instruction via `{{planner_prompt}}`) and K5 (output contract via
`DeclaredOutputs`) are already satisfied and not in scope.

Two candidate options were reviewed by Architect and SE:

- **Option B:** Formula compiler fetches IS/ES from ArangoDB, assembles a
  `SeedWorkspace` JSON, writes it to R2 keyed by `form_id`, passes the key as a
  formula var. PI container fetches from R2 at execute time and hydrates
  `inputArtifacts` locally before running pi. Gas City is not touched.

- **Option D:** Compiler encodes artifacts into sling vars; Gas City decodes and
  writes them onto the Bead via a new inputs channel; `harnessExecutionRequestForBead`
  populates `req.Inputs` from the Bead. Requires a Go change in
  `cmd/gc/harness_dispatch.go` and a new `Inputs` field on the `Bead` struct.

## Decision

**Option B.** The formula compiler produces a `SeedWorkspace` bundle, writes it
to R2, and passes the key downstream. The PI container fetches and hydrates it
at execute time. Gas City is not modified.

Rationale:

1. The receiver already works. No container change is required — the existing
   `prepareSeedWorkspace` path handles materialization and prompt injection once
   `inputArtifacts.SeedWorkspace` is present.

2. Option B requires no Go change. The Gas City enforcement surface (a system
   GUV does not implement directly) is untouched. All changes are TypeScript in
   systems the Factory owns (`formula-compiler.ts`, container hydration).

3. Content bypasses Gas City entirely. Large rig file sets do not bloat bead
   metadata, sling request hashes, or dispatch_log rows.

4. The compiler's existing `UncertaintyEntry` halt pattern covers the new
   failure modes: missing IS/ES or a failed R2 write halts dispatch rather than
   dispatching empty. **INV-1 (no vacuous dispatch)** becomes enforceable
   without new control flow.

Option D is deferred, not rejected. If a direct `Bead.Inputs` channel becomes
necessary for a future provider that cannot reach R2, that Go change can be
proposed as a separate ADR.

## Consequences

1. `formula-compiler.ts` gains two new injected deps: `fetchIntentSpec` and
   `fetchExecutableSpec`, consistent with the existing `buildFormulaCompilerDeps`
   pattern. These are unit-testable in isolation with mocks before live wiring.

2. A new `seedWorkspace` dep writes the assembled bundle to R2
   (`ff-workspaces/<form_id>/seed.json`). The key is deterministic (AC-4:
   same EP + same `factory_attempt` → same key).

3. The compiler halts with an `UncertaintyEntry` if IS/ES fetch fails or R2
   write fails. No vacuous dispatch.

4. The PI container gains a hydration step: at execute time, if `SeedWorkspaceRef`
   is present in `contextRefs` (or a designated var), it fetches from R2 and
   injects the content into `inputArtifacts` before calling `prepareSeedWorkspace`.

5. `GAS_CITY_RIG_ROOT` is vestigial for the inline-workspace path. The agent
   works in a container-managed `./workspace` directory seeded from R2, not a
   mounted path. Retire `GAS_CITY_RIG_ROOT` in a follow-up cleanup.

6. For the first dispatch (coding domain), the SeedWorkspace `files` are
   hand-curated from the relevant FF repo slice. Automated file selection
   (repo-map generation) is deferred.

## Non-Goals

This ADR does not automate rig file selection. The first seed uses a curated
file list specified in the EP parameters.

This ADR does not implement signed-URL TTL management. The initial design uses
a stable R2 key + container-side auth rather than time-boxed URLs.

This ADR does not add a `Inputs` channel to the Gas City `Bead` struct
(Option D). That is a separate proposal if needed.

This ADR does not address multi-domain seeding encodings beyond the coding
`SeedWorkspace`. Legal/financial/product adapters each define their own K3
encoding; the compiler's `inputArtifacts` map is already domain-neutral.

## Source Inputs

1. Architect review (2026-05-30): traced `WorkerInput.context.inputArtifacts`
   to its empty origin; confirmed SeedWorkspace is inline not R2-fetched in
   current container code; confirmed `contextRefs` is structurally dead in
   `buildPrompt`.
2. SE assessment (2026-05-30): kernel requirement decomposition K1–K5; four-option
   trade study; six failure modes; five-step sequencing plan.
3. `workspace-seed.mjs`, `server.mjs:599-623` — receiver implementation confirmed
   complete and dormant.
4. `harness_dispatch.go:222` (`harnessExecutionRequestForBead`) — confirmed
   `req.Inputs` is never populated; no `Bead.Inputs` channel exists.
5. `formula-compiler.ts:374-429` — var assembly; `buildFormulaCompilerDeps`
   injection pattern.
