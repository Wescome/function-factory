# ADR-012: CandidatePatch Capture — Fix Untracked-File Blindness

## Status

Proposed — 2026-06-03 (Architect review complete; awaiting Wes decision)

## Date

2026-06-03

## Lineage

ADR-011 (Workspace Seeding for PI Container Execution — Accepted 2026-05-30),
ADR-003a (Pi RPC-in-Container),
IS-GC-RUNTIME-PROVIDER-CONTRACT,
SPEC-FF-SEEDWORKSPACE-001 (draft, rejected in Architect review 2026-06-03),
Live failure: CareTrace run do-5193 — CandidatePatch = 440 bytes (expected ~2000 lines)

---

## 1. Problem

**Confirmed live failure:** Pipeline ran end-to-end for CareTrace POC
(do-5193: Plan ✅, Code ✅, Verify ✅, Release ❌). The coding agent executed
correctly — 135 tool-call events, 2 minutes of real LLM work — but
`CandidatePatch` = 440 bytes instead of the expected ~2000 lines of TypeScript.

**Root cause — untracked-file blindness:**

| Step | What happens |
|------|-------------|
| workspace-init | Seed commit runs `git add -A && git commit` on the initial seed files |
| Agent executes | Agent creates new TypeScript files (workers/, dashboard/) in `/workspace` |
| `agent.commit_patch()` | Runs `git diff` (without `--cached`) against HEAD |
| Result | New files are **untracked** — `git diff` without `--cached` silently omits them |
| CandidatePatch | Contains only modifications to pre-existing seed files (~440 bytes) |

The agent did its job. The patch capture mechanism does not.

**Where the bug lives (confirmed by Architect code read):**

| File | Line | Current (broken) | Correct |
|------|------|-------------------|---------|
| `workers/ff-pipeline/pi-container/workspace-seed.mjs` | ~77 | `cd workspace && git diff > ../CandidatePatch` | `cd workspace && git add -A && git diff --cached > ../CandidatePatch` |
| `workers/ff-pipeline/pi-container/contract-evaluator.mjs` | ~311 | same broken form | same corrected form |

**What SPEC-FF-SEEDWORKSPACE-001 proposed and why it was rejected:**

The spec proposed a Skeleton Builder (new CF Workflow), a new R2 bucket
(`ff-skeletons`), a new `ff-coordinator` worker (does not exist), and a new
DO pre-flight check (C8). The Architect found:

1. No `agent.commit_patch()` function exists in the codebase — the spec
   diagnosed a fictional mechanism.
2. The Skeleton Builder does not fix the bug: if the prompt still runs
   `git diff` (not `--cached`), cloning the whole repo produces the same
   440-byte patch.
3. `function-factory` is 110 MB tracked (102 MB = `gc-linux-amd64` binary),
   violating SPEC-FF-SEEDWORKSPACE-001's own INV-SEED-5 (50 MB limit) on
   day one.
4. Hardcoding `function-factory` as the skeleton source is a domain-adapter
   boundary violation (AGENTS.md §"Domain adapter boundary"): CareTrace needs
   its own target repo, not the Factory's repo cloned into its workspace.

Verdict: SPEC-FF-SEEDWORKSPACE-001 is **not ready for implementation**.

---

## 2. Options

| Option | Mechanism | Lines changed | Fixes do-5193? | Risks |
|--------|-----------|---------------|----------------|-------|
| **A — Fix the prompt (this ADR)** | Change `git diff` → `git add -A && git diff --cached` in workspace-seed.mjs and contract-evaluator.mjs | 2 | ✅ Yes | New files erroneously staged if workspace is dirty before agent runs. Mitigated: workspace-init.sh ensures clean baseline commit before agent fires. |
| **B — Skeleton Builder (SPEC-FF-SEEDWORKSPACE-001)** | New CF Workflow + R2 bucket + Coordinator DO pre-flight + container init script | ~400 | ❌ No (prompt still broken) | 102 MB binary violates spec's own size limit. Fictional function targets. Domain-adapter boundary violation. 4–6 sprints. |
| **C — Combined: A first, then scope skeleton separately** | Ship A now; re-scope skeleton work around adapter-supplied repoRef if independently justified | 2 (now) + TBD | ✅ Yes | No new risk beyond A. |

**Recommendation: Option A now (Option C if skeleton work is later justified).**

The two-line fix resolves the confirmed live failure with zero new infrastructure.
SPEC-FF-SEEDWORKSPACE-001's skeleton concern is legitimate for a different problem
(providing the agent an existing target codebase to edit) but is not blocking
CandidatePatch correctness and requires re-scoping before implementation.

---

## 3. Decision

**PENDING WES APPROVAL.**

Proposed: **Option A accepted.** Option C deferred pending D2 below.

---

## 4. Invariants (if A is adopted)

| ID | Invariant | Enforcement |
|----|-----------|-------------|
| INV-PATCH-1 | CandidatePatch is captured via `git add -A && git diff --cached`, never `git diff` alone. | workspace-seed.mjs and contract-evaluator.mjs enforce the command; Verification Agent validates PatchManifest.linesAdded > 0. |
| INV-PATCH-2 | A CandidatePatch with linesAdded = 0 after agent execution is a pre-release halt (DIV-PATCH-EMPTY). | Verification Agent reads PatchManifest before forwarding to Release. |
| INV-PATCH-3 | The workspace baseline commit (from workspace-init.sh) must exist before the agent receives its first tool call. | workspace-init.sh exits non-zero if `git rev-list --count HEAD` < 1; container halts. |

---

## 5. Consequences (if A is adopted)

1. `workspace-seed.mjs:~77` changes one shell command. No new files, no new bindings.
2. `contract-evaluator.mjs:~311` changes the same command in the evaluator path.
3. Re-run CareTrace do-5193 equivalent. Expected: CandidatePatch linesAdded ≥ 100.
4. Release fidelity gate becomes the next live target (currently fail-closed; the 440-byte patch is the cause).
5. No Gas City changes required. No ArangoDB changes. No R2 changes.

---

## 6. Open Decisions (architecture gates — Wes only)

| ID | Decision | Options | Default if deferred |
|----|----------|---------|---------------------|
| **D1** | Ship the two-line prompt fix (Option A) and re-run CareTrace before any skeleton work begins? | Yes / No | Blocked — do not ship skeleton work first |
| **D2** | Reframe SPEC-FF-SEEDWORKSPACE-001 as "adapter-supplied repoRef skeleton" (gives agent an existing target codebase to edit) rather than a CandidatePatch fix? | Accept reframing / Cancel spec | Parked at SE for scoping |
| **D3** | Remove `gc-linux-amd64` (102 MB) from git tracking, store in LFS or R2? | LFS / R2 artifact / Separate repo | Parked — blocks no current work, but blocks any future skeleton cloning under 50 MB |

---

## 7. Non-Goals

- Skeleton Builder infrastructure (SPEC-FF-SEEDWORKSPACE-001 — separate ADR required after D2 resolution)
- Automated rig file selection (deferred since ADR-011)
- Adapter-supplied repoRef for non-self-build functions (deferred — D2)
- `gc-linux-amd64` git tracking removal (deferred — D3)
