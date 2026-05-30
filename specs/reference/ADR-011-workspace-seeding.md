# ADR-011: Workspace Seeding for PI Container Execution

## Status

Proposed — pending Wes approval

## Date

2026-05-30

## Lineage

ADR-010 (Gas City supersedes NLAH), ADR-003a (Pi RPC-in-Container),
IS-GC-RUNTIME-PROVIDER-CONTRACT, Architect review (2026-05-30),
SE assessment (2026-05-30)

---

## 1. Problem

The Gas City → pi-rpc → PI container pipeline is fully wired but vacuous.
Steps close as `gc.outcome: pass` in ~500ms and produce no artifacts.

**Root cause:** `WorkerInput.context.inputArtifacts` is `{}` on every dispatch.
Three kernel requirements are unmet:

| Req | What the agent needs | What it gets today |
|-----|---------------------|--------------------|
| K1 — Intent | IS document body | `"IS-GC-DISPATCH-WIRE"` (string ID) |
| K2 — Acceptance | ES acceptance criteria | `"ES-GC-DISPATCH-WIRE"` (string ID) |
| K3 — Source material | Rig files to read/modify | Empty working directory |

The PI container receiver (`server.mjs:599-623`) is fully implemented: it reads
`inputArtifacts`, writes entries to disk, detects `inputArtifacts.SeedWorkspace`,
materializes files, and injects everything into the agent's prompt. Nothing
upstream produces a payload.

---

## 2. Options

| Option | Mechanism | Gas City change? | Large payloads? | Failure modes |
|--------|-----------|-----------------|----------------|---------------|
| **A** — Spec content in formula vars | Compiler fetches IS/ES, injects as `{{is_content}}` / `{{es_content}}` vars; substituted into step description text | No | Bloats bead metadata, sling hash, dispatch_log rows | Size limit on vars; content lands in description text, not materialized to disk — does not satisfy K3 |
| **B** — SeedWorkspace via R2 | Compiler fetches IS/ES + rig files, builds `SeedWorkspace` JSON, writes to R2 keyed by `form_id`, passes key as var; PI container fetches and hydrates `inputArtifacts` at execute time | No | Content in object storage; only a reference key travels through Gas City | R2 write on critical path; signed-URL TTL must outlive cold-start latency; deterministic key required (AC-4) |
| **C** — Container pulls spec from ArangoDB | Container takes `contextRefs.is_id`/`es_id` and fetches content from a new ff-pipeline endpoint at execute time | No | Bounded by response size | Violates determinism (K7): content drifts between dispatch and execute; couples execution runtime to Factory data plane (ADR-010 boundary violation) |
| **D** — Artifacts in sling vars; Gas City populates bead inputs | Compiler base64-encodes artifacts into vars; Gas City decodes and populates `bead.Inputs`; `harnessExecutionRequestForBead` sets `req.Inputs` | **Yes** — new `Inputs` field on `Bead` struct; Go change in `cmd/gc/harness_dispatch.go` | Base64 inflates ~33%; bead store carries file content | Requires Go change in Gas City (GUV does not write Go); file sets bloat bead store |

**Recommendation: Option B.** GUV recommendation +

Rationale:
- No Go change. All changes in TypeScript (`formula-compiler.ts`, container hydration).
- `prepareSeedWorkspace` already exists and works — the receiver is dormant, not missing.
- Content bypasses Gas City; bead/dispatch_log rows stay small.
- Satisfies K1+K2+K3 in one mechanism.
- R2 write is already on the critical path (WORKSPACE_BUCKET bound on ff-pipeline).

Option C is rejected on determinism and boundary grounds regardless of other factors.
Option D is deferred, not rejected — viable if a future provider cannot reach R2.
Option A alone never satisfies K3 (no disk materialization).

---

## 3. Decision

*[ Wes marks + or - above ]*

---

## 4. Key Invariants (if B is adopted)

| Invariant | Rule |
|-----------|------|
| INV-1 (no vacuous dispatch) | Compiler halts (UncertaintyEntry) if IS/ES fetch fails or R2 write fails. Never dispatches with empty seed. |
| INV-2 (seed durability precedes dispatch) | R2 write completes before CALL 3 (sling) fires. |
| INV-3 (determinism) | Seed key = `form_id` (already deterministic by AC-4). Seed bundle is canonicalized (sorted file order, `stableStringify`). |
| INV-4 (lineage) | Each seeded artifact carries `source_refs` back to IS/ES/EP it derived from. |
| INV-5 (no silent truncation) | Over-budget rig sets emit UncertaintyEntry ("rig too large; narrow the file selection"). Never truncate silently. |

---

## 5. Consequences (if B adopted)

1. `formula-compiler.ts` gains two new injected deps (`fetchIntentSpec`, `fetchExecutableSpec`) following the existing `buildFormulaCompilerDeps` pattern. Unit-testable in isolation before live wiring.
2. New `seedWorkspace` dep writes assembled bundle to R2 at `ff-workspaces/<form_id>/seed.json`.
3. PI container gains a hydration step: reads seed key from `contextRefs`, fetches from R2, injects into `inputArtifacts` before running pi.
4. `GAS_CITY_RIG_ROOT` becomes vestigial. The agent works in a container-managed workspace seeded from R2, not a mounted path. Retire in follow-up.
5. First dispatch uses a hand-curated file list in EP parameters. Automated rig file selection is deferred.
6. R2 indirection for large seeds (`schemaVersion` gate) is deferred to v1.1.

## 6. Non-Goals

- Automated rig file selection (repo-map generation)
- Signed-URL TTL management (use stable key + container auth)
- Gas City `Bead.Inputs` channel (Option D — separate ADR if needed)
- Multi-domain seed encodings beyond coding `SeedWorkspace`
