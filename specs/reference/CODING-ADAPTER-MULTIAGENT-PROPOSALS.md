# Coding Adapter — Multi-Agent Design Proposals

**Status:** Pending Architect review  
**Authored by:** Architect Agent, 2026-05-18  
**Lineage:** coding-adapter.harness.yaml, observability-se-diagnosis.md,
  PI_PRODUCTION_DEFECTS.md, DEFECT-1, Agentic-AI-Pipeline prior art
  (hoangsonww/Agentic-AI-Pipeline)

---

## Context

The coding adapter harness (`harnesses/coding-adapter.harness.yaml`) runs
six stages in sequence: SEED → CONTRACT → MAP → PATCH → VERIFY → RELEASE.
All non-SEED stages run the `pi-author` worker — one Pi subprocess per stage,
one model attempt at a time, with a filesystem tool capability probe and up to
`max_repair_rounds` contract-repair turns per stage.

Two live defects make multi-agent improvement urgent:

- **DEFECT-1**: `patch_applies_cleanly` fails for real source because Pi
  produces patches with hunk context mismatches. The gate catches it but
  terminates the run with no repair path.
- **VERIFY gate failure**: Pi's VerifierReport is missing `Tests run` — the
  gate requires the exact section heading. Pi can autonomously author a patch,
  but quality of the output artifacts is not yet production-grade.

The SE diagnosis (`observability-se-diagnosis.md`) identified three
infrastructure bugs (dispatcher `buildStageContextForRun` before try block,
`notifyWorkflowComplete` swallowing send failures, `harness-dlq` no consumer)
that are separate from the quality questions addressed here.

---

## Prior Art

### Agentic-AI-Pipeline (hoangsonww/Agentic-AI-Pipeline)

Production Python pipeline that demonstrates exactly the patterns needed for
the Pi coding path. Key findings:

**Pattern 1 — Role-per-agent, not file-per-agent.**
Five named roles: GPT Coder, Claude Coder, Ruff Formatter, Claude Test Author
+ Pytest Runner, Gemini QA Reviewer. Each role runs a different model with a
different prompt scope. Multiple coder models run _in sequence against the same
state_ (pair programming) rather than each getting a different file.

**Pattern 2 — Shared state dict as coordination primitive.**
`state: {task, proposed_code, tests_passed, qa_passed, feedback}` flows
between all agents. In the Factory's terms: R2 artifacts are the shared state
dict. Each stage reads declared inputs from R2, writes declared outputs to R2.
This is already the architecture — the prior art confirms it.

**Pattern 3 — Iterative repair loop: max 3 iterations.**
Testing failure → back to Drafting with feedback payload (test output).
QA failure → back to Drafting with QA feedback. QA pass → Completed.
Maps exactly to the existing `maxRepairRounds` mechanism in `stage-runtime.mjs`
(lines 785-796).

**Pattern 4 — QA reviewer uses a different model from the coder.**
Gemini reviews GPT/Claude's diff. The reviewer is a separate subprocess with
separate state. This directly motivates having VERIFY use a separate Pi session
(new subprocess) rather than the same Pi process that authored the patch.

**Pattern 5 — Repo identity is simple.**
The pipeline accepts `repo URL or local path` as direct input. No complex
authorization layer. For the Factory: the SeedWorkspace file IS the repo
snapshot. A real-repo path can be a field on SeedWorkspace. No separate
authorization primitive needed.

---

## Problems and Proposals

### Problem A — PATCH quality: hunk context mismatches (DEFECT-1)

**Current behavior:** Pi authors a CandidatePatch. The `patch_applies_cleanly`
gate runs `validatePatchAgainstSeedWorkspace`, which replays hunks line by
line. A context mismatch fails the gate and terminates the run with no repair
path — the run is marked `patch_does_not_apply` (failure_taxonomy maps this
to `return_to_stage`) but the harness does not currently carry that feedback
back to PATCH in autonomous mode.

**Root cause:** Pi's unified diff emission is model-quality sensitive. Context
lines frequently slip (off-by-one on hunk headers, wrong context window). This
is not a contract repair issue — Pi already ran and produced a syntactically
recognizable diff that the contract evaluator accepted (it checked the diff
format, not application). The real check is in the gate, post-dispatch.

**Proposal A1 — Repair loop carries gate failure back to PATCH.**

When `patch_applies_cleanly` fails, the `failure_taxonomy` entry
`patch_does_not_apply: return_to_stage` should return to PATCH with the exact
apply error embedded in the feedback prompt. This matches the Agentic-AI-Pipeline
repair loop pattern: Testing failure → Drafting with feedback.

Implementation requires:
1. NLAH `return_to_stage` to carry the `GateResult.message` as a repair
   prompt field — this is upstream contribution #2 (failure semantics).
2. The harness-dispatcher `dispatchOne` to build a repair `WorkerInput` when
   `return_to_stage` fires, rather than a fresh-stage input. The gate failure
   message becomes the `context.repairContext` field on the WorkerInput.
3. The Pi container server `handleExecute` to detect `repairContext` and
   prepend it as a repair turn before the main prompt — using the same
   `pi.stdin.write` repair mechanism already in place (lines 785-796).

No schema changes to coding-adapter.harness.yaml. The `max_repair_rounds: 2`
at the runtime level governs repair budget for both contract-repair turns and
gate-failure-repair turns.

**Proposal A2 — Pi prompt instructs explicit hunk context width.**

The PATCH role prompt should explicitly instruct Pi: "Emit each hunk with at
least 3 lines of context above and below the change. Count context lines from
the SeedWorkspace file content exactly."

This is a cheap prompt improvement that reduces hunk context failures without
changing the pipeline architecture. Ship this before any structural change.

**Recommendation:** Ship A2 immediately (prompt change). Gate A1 on NLAH
upstream contribution #2 landing.

---

### Problem B — Work division for multi-agent Pi path

**Current behavior:** Each stage runs a single Pi subprocess against the whole
stage contract. Cartographer, PatchWorker, and Verifier are role _labels_ in
the YAML but all execute identically through the same `pi-author` worker with
the same dispatch path.

**Finding from prior art:** The Agentic-AI-Pipeline uses role-per-agent with
different models. The key insight is that _roles_, not _files_, define the work
division boundary. In a multi-agent model, each role gets a different model
instance with a different prompt scope.

**Current Factory status:** The coding adapter harness ALREADY implements this
correctly. Cartographer (CONTRACT + MAP stages), PatchWorker (PATCH stage), and
Verifier (VERIFY stage) are distinct roles with distinct prompts and distinct
output contracts. The harness YAML is the role boundary definition.

**Proposal B — No structural change needed. Affirm existing design.**

The multi-agent boundary is already the stage boundary. Each `pi-author` stage
IS a separate Pi subprocess (new spawn per `/execute` call per `handleExecute`
in server.mjs — see `startPi` at line 592). The harness graph is the
coordination primitive. R2 artifacts are the shared state dict.

The only open question is whether PATCH and VERIFY should run on different model
candidates to reduce correlated failure. See Problem E.

---

### Problem C — Repair loop budget and feedback fidelity

**Current behavior:** `max_repair_rounds: 2` applies to contract-repair turns
within a single stage (`stage-runtime.mjs` lines 785-796). The repair prompt
is `buildContractRepairPrompt(evaluation.findings)` — a function that reports
which artifacts are missing and what patterns are required.

The Agentic-AI-Pipeline uses repair feedback that includes the full test output
and QA output, not just "these patterns are missing." The feedback _payload_
is what makes the repair loop effective.

**Problem:** For PATCH stage failures (gate failure, not contract failure), the
feedback payload is the exact `git apply` error message. For VERIFY failures,
it is the test output. Neither of these currently flows back to the authoring
stage.

**Proposal C — Add `gateFailureContext` to StageCompletePayload.**

When `advanceHarness` sets a stage to `return_to_stage` due to gate failure,
the `StageCompletePayload` should carry a `gateFailureContext` field containing:
- `gateName`: which gate failed
- `gateMessage`: the full `GateResult.message`
- `artifactName`: the artifact the gate evaluated

The `RunCoordinator` stores this alongside the stage result. When PATCH is
re-dispatched, the dispatcher reads the stored context and passes it as
`context.repairContext` on the `WorkerInput`. The Pi container server then
prepends it as a repair prompt turn.

This is the minimum implementation that makes repair loops as effective as the
Agentic-AI-Pipeline's feedback path.

---

### Problem D — Patch reconciliation when multiple agents touch the same file

**Context from prior art:** In the Agentic-AI-Pipeline, GPT Coder and Claude
Coder both run against the same state in sequence. If both produce patches to
the same file, the second coder's diff is against the already-modified
workspace — there is no reconciliation because it is sequential, not parallel.

**Current Factory status:** The coding adapter runs stages sequentially
(graph_mode: linear). There is no parallel patch authoring. One PatchWorker
produces one CandidatePatch.

**Finding:** Problem D does not exist in the current architecture. Sequential
linear execution means there is only ever one active patch author at a time.
No patch reconciliation mechanism is needed.

**If parallel PATCH stages are added in the future**, the reconciliation
boundary is clear: each parallel branch must target disjoint file sets
(declared in the SeedWorkspace or the RepoMap). A static disjointness check
at harness-compile time would catch conflicts before execution. This is an
architecture gate for a future version, not a current blocker.

---

### Problem E — VERIFY: independent verification, different model

**Current behavior:** VERIFY runs `pi-author` with the same model candidates
as PATCH. The Verifier role runs a new Pi subprocess (new spawn), so the
session is technically fresh. But the same model list is used, and if gpt-5.4
authored the CandidatePatch, it may also be the VERIFY executor — correlated
failure.

**Finding from prior art:** The Agentic-AI-Pipeline explicitly uses a different
model for QA review (Gemini reviews GPT/Claude code). The reviewer being a
different model from the coder is a proven pattern for catching errors the
coder would overlook.

**Proposal E — Verifier role uses a dedicated model candidate list.**

Add an optional `verifier_model_candidates` field to the harness YAML runtime
section:

```yaml
runtime:
  state_root: state
  artifact_root: artifacts
  graph_mode: linear
  default_failure_action: abort
  max_repair_rounds: 2
  verifier_model_candidates:
    - openrouter/google/gemini-3.1-pro-preview
    - openrouter/anthropic/claude-sonnet-4.6
    - openrouter/openai/gpt-5.4
```

The harness dispatcher reads this field when building the `WorkerInput` for
the VERIFY stage (or any stage with the `Verifier` role) and overrides the
default `PI_FILESYSTEM_MODEL_CANDIDATES` env var with the harness-specified
list. This puts Gemini first for VERIFY while keeping gpt-5.4 first for PATCH.

**Immediate fix (no YAML change needed):** The `resolvePiModelRoute` function
in `harness-dispatcher.ts` already routes by `routeKindForRole(stage.role)`.
The current `routeKindForRole` maps "verify" to `"tester"`. This route kind
is not yet used to select a different model — `routeKind` is annotation-only.
A targeted env var `PI_VERIFIER_MODEL_CANDIDATES` (parallel to
`PI_FILESYSTEM_MODEL_CANDIDATES`) can be read for VERIFY-role stages without
any NLAH schema changes.

**Recommendation:** Ship the env-var approach first
(`PI_VERIFIER_MODEL_CANDIDATES`). Gate the harness YAML `verifier_model_candidates`
field on the NLAH schema extension being accepted upstream.

---

### Problem: VERIFY gate — `test_results_support_claims` currently fails

**This is the current production blocker** (from `observability-se-diagnosis.md`).

The gate requires `VerifierReport` to contain the exact string `"Tests run"`.
Pi's VERIFY prompt does not explicitly require this section heading.

**Proposal — Two-part fix:**

1. Update the VERIFY stage `Verifier` role responsibility in
   `coding-adapter.harness.yaml` to explicitly state: "Write VerifierReport
   with exact heading `## Tests run` followed by the captured test command
   output (stdout + exit code)."

2. Update the `VerifierReport` artifact contract to use `"Tests run"` as an
   exact `required_patterns` entry (it already does) AND add it as a required
   section in `required_sections`. Confirm the pattern matches Pi's likely
   heading variant with a case-insensitive option if needed.

This is a prompt engineering fix, not an architecture change. It should be the
first thing shipped because it unblocks the existing autonomous run path.

---

### Q7 — Repo identity: how does Pi know which real repo to work against?

**Current architecture:** The SeedWorkspace JSON is the repo snapshot. Pi
works against a virtual filesystem (files extracted from `SeedWorkspace.files`
into a tmpdir). Pi never touches a real git remote.

**Finding from prior art:** Agentic-AI-Pipeline takes `repo URL or local path`
as direct input. Pi then does `git clone` or works against the local path.

**Current Factory architecture choice:** The SeedWorkspace snapshot approach
was chosen deliberately:
- Pi runs in an ephemeral Container with no outbound git access.
- The patch is a unified diff against the SeedWorkspace snapshot, not a real
  git apply against a live remote.
- PR creation is a separate RELEASE stage (FinalPatch + PRSummary).

**For real-repo integration**, the path is:
1. `SeedWorkspace.repoUrl` field (optional, already has space in the schema)
2. The SEED worker (preseed) clones the target repo and produces the
   SeedWorkspace from the real files — this is already what the preseed worker
   is designed to do.
3. The RELEASE stage reads `FinalPatch` and `PRSummary`, creates a branch via
   GitHub API, applies the patch, and opens a PR. The `GITHUB_TOKEN` is already
   in scope per `SDLC-ARCHITECTURE.md:1396`.

**No new architecture is needed.** The SEED/preseed stage is the repo identity
boundary. The preseed worker already resolves the repo into a SeedWorkspace.
The RELEASE stage already has a spec for GitHub PR creation. The gap is
implementation, not design.

---

## Summary: What To Ship In Order

| Priority | Item | Type | Blocker |
|----------|------|------|---------|
| 1 | Fix `test_results_support_claims` gate failure | Prompt change in VERIFY role | Production blocker |
| 2 | Add explicit hunk context instruction to PATCH prompt (Proposal A2) | Prompt change | DEFECT-1 partial mitigation |
| 3 | Fix SE Bug 1: `buildStageContextForRun` before try block | Code fix, harness-dispatcher.ts:324 | Infrastructure correctness |
| 4 | Fix SE Bug 2: `notifyWorkflowComplete` no retry | Code fix, run-coordinator.ts:275 | Infrastructure correctness |
| 5 | Fix SE Bug 3: `harness-dlq` no consumer | New file + wrangler.jsonc | Infrastructure correctness |
| 6 | `PI_VERIFIER_MODEL_CANDIDATES` env var for Verifier role (Proposal E fast path) | harness-dispatcher.ts change | Quality improvement |
| 7 | Gate failure feedback → `gateFailureContext` in repair prompt (Proposal C) | Requires NLAH upstream contribution #2 | Quality improvement |
| 8 | Return-to-PATCH repair loop with gate error payload (Proposal A1) | Requires NLAH #2 + Proposal C | DEFECT-1 full fix |

---

## Invariants (SE view)

These invariants must hold for the multi-agent coding path to be trustworthy:

**INV-CODING-01:** A CandidatePatch that fails `patch_applies_cleanly` MUST
  NOT reach VERIFY. Either a repair round brings it back into compliance or
  the run is marked `patch_does_not_apply` and halted.

**INV-CODING-02:** VERIFY must run in a Pi subprocess that has NOT previously
  seen the CandidatePatch content within the same session. (Each stage spawns
  a fresh Pi — this is currently satisfied by `startPi` creating a new
  subprocess per `/execute` call.)

**INV-CODING-03:** VerifierReport must contain "Tests run" with captured
  test command output before the `test_results_support_claims` gate passes.
  The gate is the enforcement point; the prompt is the authoring guide.

**INV-CODING-04:** The Verifier role (VERIFY stage) must not be the same model
  instance that authored the CandidatePatch when a Verifier-specific model
  list is configured. Correlated model failure between PATCH and VERIFY reduces
  independent verification to a formality.

**INV-CODING-05:** Repair loop budget (`max_repair_rounds`) applies across
  both contract-repair turns and gate-failure-repair turns combined. Total
  Pi inference budget per stage is bounded.
