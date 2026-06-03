# CandidatePatch Capture — Fix Untracked-File Blindness

* Status: Accepted — D1 approved by Wes 2026-06-03. D2/D3 parked.
* Deciders: Wes
* Date: 2026-06-03
* Technical Story: Live failure do-5193 — CareTrace run produced CandidatePatch = 440 bytes (expected ~2000 lines of TypeScript). Architect review of SPEC-FF-SEEDWORKSPACE-001 completed 2026-06-03.

## Context and Problem Statement

The coding pipeline ran end-to-end for the CareTrace POC (Plan ✅ Code ✅ Verify ✅ Release ❌). The agent executed correctly — 135 tool-call events, real LLM work for 2 minutes — but CandidatePatch contained only 440 bytes. The agent created new TypeScript files in `/workspace`, but the patch capture command runs `git diff` (not `git diff --cached`) against HEAD. New files created by the agent are **untracked**; `git diff` silently omits them. The result is a near-empty patch despite real work having been done.

Fix sites (confirmed by Architect code read):
- `workers/ff-pipeline/pi-container/workspace-seed.mjs` ~line 77
- `workers/ff-pipeline/pi-container/contract-evaluator.mjs` ~line 311

Both run: `cd workspace && git diff > ../CandidatePatch`
Both must run: `cd workspace && git add -A && git diff --cached > ../CandidatePatch`

SPEC-FF-SEEDWORKSPACE-001 was submitted as the fix. The Architect rejected it: the spec targets a non-existent `agent.commit_patch()` function, proposes a Skeleton Builder that does not fix the prompt, hardcodes `function-factory` as skeleton source (domain-adapter boundary violation for non-self-build functions like CareTrace), and the current repo is 110 MB tracked (102 MB = `gc-linux-amd64` binary) — violating the spec's own 50 MB limit on day one.

## Decision Drivers

* The confirmed live failure is a two-line bug, not a missing infrastructure component
* SPEC-FF-SEEDWORKSPACE-001 was rejected — do not implement skeleton infra before this fix ships
* ADR-011 (Workspace Seeding, accepted 2026-05-30) already governs the seeding architecture; this ADR resolves the patch-capture gap ADR-011 left open
* Domain-adapter boundary (AGENTS.md): skeleton source must be an adapter-supplied input, not a Factory-hardcoded constant

## Considered Options

* Option A — Fix the two prompt lines (`git add -A && git diff --cached`)
* Option B — Skeleton Builder as SPEC-FF-SEEDWORKSPACE-001 proposed
* Option C — Option A now, re-scoped skeleton work as a separate ADR after D2 resolution

## Decision Outcome

Chosen option: **Option A** (pending Wes approval — D1 below), because it is the minimum correct fix for the confirmed failure, requires no new infrastructure, and takes effect in the next deploy.

Option C is the recommended long-term posture: ship A immediately, re-scope skeleton infra as "adapter-supplied repoRef" for functions that need to edit an existing target codebase (a legitimate independent problem).

### Architecture Gates (Wes only)

| ID | Question | Options |
|----|----------|---------|
| D1 | Ship the two-line prompt fix and re-run CareTrace before any skeleton work? | Yes / No |
| D2 | Reframe SPEC-FF-SEEDWORKSPACE-001 as "adapter-supplied repoRef skeleton" (agent edits existing target repo) rather than a CandidatePatch bug fix? | Accept reframing / Cancel spec |
| D3 | Remove `gc-linux-amd64` (102 MB) from git tracking (LFS or R2 artifact)? | LFS / R2 / Separate repo / Defer |

### Positive Consequences

* CandidatePatch linesAdded ≥ 100 for any non-trivial coding atom (regression: CareTrace re-run)
* Release fidelity gate becomes the next live target
* No Gas City changes, no ArangoDB changes, no R2 changes, no new bindings

### Negative Consequences

* New files are staged unconditionally (`git add -A`) before diffing — if workspace-init.sh leaves unexpected files before the agent runs, they appear in the patch. Mitigated: workspace-init.sh ensures a clean baseline commit before the agent fires (INV-PATCH-3).
* Does not address the broader "agent editing an existing target repo" use case — deferred to D2/skeleton re-scope.

## Pros and Cons of the Options

### Option A — Fix the two prompt lines

`git diff` → `git add -A && git diff --cached` in workspace-seed.mjs ~77 and contract-evaluator.mjs ~311.

* Good, because 2 lines changed, deploys in minutes
* Good, because directly fixes the confirmed failure at the actual call site
* Good, because no new infrastructure, no new failure modes
* Bad, because does not give the agent an existing target repo to edit (separate problem)

### Option B — Skeleton Builder (SPEC-FF-SEEDWORKSPACE-001)

New CF Workflow + R2 bucket `ff-skeletons` + `ff-coordinator` worker (does not exist) + Coordinator DO pre-flight C8 + container init script.

* Good, because addresses the longer-term "agent edits existing repo" need
* Bad, because does not fix the patch-capture bug (prompt still uses `git diff`)
* Bad, because `ff-coordinator` worker does not exist — unstated scaffolding required
* Bad, because function-factory repo is 110 MB tracked; violates spec's own 50 MB INV-SEED-5 on day one
* Bad, because hardcoded skeleton source (`function-factory`) breaks every non-self-build (domain-adapter boundary violation)
* Bad, because `agent.commit_patch()` target function does not exist in the codebase

### Option C — Option A now, skeleton re-scoped separately

* Good, because ships the fix immediately and reopens skeleton conversation on correct terms
* Good, because skeleton re-scope (adapter-supplied repoRef + SHA-pinned staleness) is cleanly separable
* Neutral, because requires a follow-up ADR for the skeleton work

## Links

* Supersedes SPEC-FF-SEEDWORKSPACE-001 (rejected, 2026-06-03)
* Informed by ADR-011 (Workspace Seeding — Accepted 2026-05-30)
* Architect review finding: live fix sites are workspace-seed.mjs ~77 and contract-evaluator.mjs ~311
* SPEC-FF-DEVOPS-001 parked at SE — unrelated scope, does not affect this decision
