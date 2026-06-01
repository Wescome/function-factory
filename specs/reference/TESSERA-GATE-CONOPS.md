# Tessera Gate System — Concept of Operations

**Document type:** CONOPS — Concept of Operations
**Date:** 2026-06-01
**Status:** Active
**Scope:** All Tessera-enforced gates across the Factory and GasCity coding lifecycle
**Related IS files:** IS-TESSERA-PRE-EDIT-GATE, IS-TESSERA-PRE-COMMIT-GATE, IS-TESSERA-PRE-MERGE-GATE, IS-TESSERA-SPEC-CHANGE-GATE, IS-TESSERA-GOVERNANCE-CHANGE-GATE

---

## 1. Situation

### 1.1 The problem without gates

On 2026-06-01 a coding agent spent 45 minutes making iterative fixes to
`dispatch_runtime.go` in gascity, each introducing new regressions, ending
with a compile error and a full revert. The root cause: the agent changed the
call path away from `workflowServeList` — a package-level function variable
that 12 tests override as a test seam — without knowing those 12 tests existed.

One `tessera_impact` call before the first edit would have returned STOP. It
was never called.

This is not an isolated incident. It is the failure mode of any autonomous
coding agent operating without graph intelligence:

- **Silent test seam breakage** — function variables, global hooks, test
  overrides invisible without graph traversal
- **Cross-file cascade** — changing one function breaks 15 callers the agent
  never read
- **Spec drift** — editing a capability (BC-*) without knowing which IS files
  depend on it
- **Governance blind spots** — changing a PDP rule without knowing which skills
  it governs

### 1.2 What Tessera enables

Tessera has indexed every symbol, relation, and dependency in the Factory's
codebases. The graph knows what `workflowServeList` calls and what calls it.
The graph knows which IS files reference `BC-GC-FORMULA-DISPATCH`. The graph
knows which skills the `TREATMENT` classification rule governs.

What was missing is not the data — it is **enforcement**. Without gates, the
data is advisory. Agents skip advisory checks under pressure. The 2026-06-01
incident was not a knowledge failure. It was an enforcement failure.

The Tessera Gate System converts Tessera from advisory to mandatory.

---

## 2. Mission

The Tessera Gate System enforces graph intelligence at every decision point
in the coding lifecycle where a wrong move produces regressions, spec drift,
or governance violations.

**Five gates, one principle:** no agent proceeds past a gate without a risk
verdict from Tessera. STOP means the human operator decides. WARN means the
agent documents rationale. PROCEED means safe to continue.

---

## 3. Gates — Operational Concept

### Gate 1: Pre-Edit Gate (`tessera_pre_edit_check`)
**IS:** IS-TESSERA-PRE-EDIT-GATE
**Trigger:** Before editing any symbol in any indexed repo
**Question:** What breaks if I change this symbol?
**Tool:** `tessera_impact` (upstream blast radius)

```
Agent: "I need to change workflowServeList"
Gate:  tessera_pre_edit_check({ target: "workflowServeList", repo: "gascity" })
Result: STOP — 12 callers at d=1, risk HIGH
Action: Surface to human operator. Wait for override approval.
```

**Audit:** Every check written to `tessera_pre_edit_gates` (immutable).

---

### Gate 2: Pre-Commit Gate (`tessera_pre_commit_check`)
**IS:** IS-TESSERA-PRE-COMMIT-GATE
**Trigger:** Before `git commit` — after edits are written, before they are
committed
**Question:** What did I actually change, and does it match what I intended?
**Tool:** `tessera_detect_changes` (maps diff hunks to affected symbols +
processes)

```
Agent: [has made edits, about to commit]
Gate:  tessera_pre_commit_check({ repo: "gascity" })
Result: {
  changedSymbols: ["workflowServeQueue", "drainWorkflowServeWork"],
  affectedProcesses: ["runWorkflowServe", "runConvoyControlServe"],
  unintended: ["workflowServeList"]  ← symbol in diff but not in stated intent
}
Action: WARN — unintended symbol in diff. Agent must confirm or revert.
```

**Why this matters:** The pre-edit gate catches intent. The pre-commit gate
catches *actual* impact — what landed in the diff versus what was planned.
An agent that edits the right function but inadvertently touches a neighboring
line is caught here.

---

### Gate 3: Pre-Merge Gate (`tessera_pre_merge_check`)
**IS:** IS-TESSERA-PRE-MERGE-GATE
**Trigger:** CI — on PR open / push to PR branch, before merge
**Question:** What is the full blast radius of this PR across the codebase?
**Tool:** `tessera_impact` across all changed symbols in the PR diff

```
PR #72: changes dispatch_runtime.go, cmd_convoy_dispatch_test.go
Gate:   tessera_pre_merge_check({ repo: "gascity", base: "main", head: "factory/fix-timeout" })
Result: {
  changedSymbols: 4,
  affectedSymbols: 18,
  risk: "HIGH",
  affectedProcesses: ["runConvoyControlServe"],
  comment: "PR touches runWorkflowServe chain. Reviewer must verify test coverage."
}
Action: Post structured impact comment on PR. Block merge on CRITICAL; warn on HIGH.
```

**Why this matters:** The pre-edit gate fires before edits. The pre-merge gate
fires after all edits are assembled. It is the safety net for anything the
pre-edit gate missed (multiple file edits, unintended side effects, agent
working across a session).

---

### Gate 4: Spec Change Gate (`tessera_spec_change_check`)
**IS:** IS-TESSERA-SPEC-CHANGE-GATE
**Trigger:** Before editing any spec artifact (BC-*, IS-*, ES-*, PRS-*)
**Question:** What IS files, ES files, and FP files reference this spec?
**Tool:** `tessera_impact` on the spec graph (IS-TESSERA-SPEC-ADAPTER)

```
Agent: "I need to update BC-GC-FORMULA-DISPATCH to add a new constraint"
Gate:  tessera_spec_change_check({ target: "BC-GC-FORMULA-DISPATCH", repo: "function-factory" })
Result: STOP — 3 IS files reference this BC (IS-GC-DISPATCH-WIRE,
        IS-GC-EP-FORMULA-DISPATCH, IS-GC-FIDELITY-VALIDATION).
        All 3 must be reviewed for impact before the BC is changed.
Action: Surface referencing IS files to human. Human approves scope of BC change.
```

**Why this matters:** Spec artifacts are the Factory's source of truth.
A BC-* change that silently invalidates 3 IS files is as dangerous as a code
change that silently breaks 12 tests. The spec graph (IS-TESSERA-SPEC-ADAPTER)
makes this visible.

---

### Gate 5: Governance Change Gate (`tessera_governance_change_check`)
**IS:** IS-TESSERA-GOVERNANCE-CHANGE-GATE
**Trigger:** Before editing any governance artifact (PDP rules, classification
rules, taxonomy purposes, autonomy tiers)
**Question:** What skills, purposes, and role bindings does this governance
change affect?
**Tool:** `tessera_impact` on the governance graph (IS-TESSERA-GOVERNANCE-ADAPTER)

```
Agent: "I need to change the TREATMENT domain classification rules"
Gate:  tessera_governance_change_check({ target: "ClassificationRule:TREATMENT:CARE_COORDINATION", repo: "weops-enterprise" })
Result: STOP — affects 5 Purposes, governs 12 Skills.
        937 of 1340 kdense harness assertions currently fail due to
        a related T0/T1 tier issue. Do not change classification rules
        without resolving the tier issue first.
Action: STOP. Human reviews governance impact before any rule change.
```

**Why this matters:** Governance changes are the hardest to debug — they
manifest as silent DENY responses across unrelated skill invocations. The
938-failure kdense harness run (2026-04-16) was a governance blast-radius
problem. The governance gate surfaces this before it happens.

---

## 4. Gate Topology

```
Developer / Agent intent
        │
        ▼
┌─────────────────────────────────────────┐
│  Gate 1: PRE-EDIT                       │
│  Before first file edit                 │
│  tessera_pre_edit_check(symbol, repo)   │
│  STOP → human approval required         │
└──────────────────┬──────────────────────┘
                   │ PROCEED / approved override
                   ▼
            [Agent makes edits]
                   │
                   ▼
┌─────────────────────────────────────────┐
│  Gate 2: PRE-COMMIT                     │
│  Before git commit                      │
│  tessera_pre_commit_check(repo)         │
│  WARN → agent confirms unintended diff  │
└──────────────────┬──────────────────────┘
                   │ PROCEED / confirmed
                   ▼
            [git commit]
                   │
                   ▼
┌─────────────────────────────────────────┐
│  Gate 3: PRE-MERGE (CI)                 │
│  On PR open / push                      │
│  tessera_pre_merge_check(repo, PR)      │
│  CRITICAL → merge blocked               │
│  HIGH → reviewer warned, impact posted  │
└──────────────────┬──────────────────────┘
                   │ PROCEED
                   ▼
            [merge to main]
```

Spec and governance changes flow through Gate 4 or Gate 5 **instead of** Gate 1
(spec artifacts are not code symbols; they flow through the spec graph adapter).

---

## 5. Shared Contracts

### Risk → Decision mapping (all gates)

| Risk | Decision | Agent action |
|------|----------|-------------|
| CRITICAL | STOP | Cannot proceed. Surface to human. Wait for `override: true`. |
| HIGH | STOP | Cannot proceed. Surface to human. Wait for `override: true`. |
| MEDIUM | WARN | May proceed. Must document rationale in commit message. |
| LOW | PROCEED | Safe to continue. |
| UNKNOWN | WARN | Symbol not found or index stale. Re-index before proceeding. |

### Audit trail (all gates)

Every gate check is written to the corresponding ArangoDB collection:
- `tessera_pre_edit_gates`
- `tessera_pre_commit_gates`
- `tessera_pre_merge_gates`
- `tessera_spec_change_gates`
- `tessera_governance_change_gates`

All collections are **append-only, no DELETE route**. Override is logged, not
hidden. An agent cannot erase a gate check from the audit trail.

### AGENTS.md enforcement (all repos)

Every indexed repo's AGENTS.md `## Never Do` block must include:
```
NEVER edit a symbol without first calling the appropriate Tessera gate.
NEVER proceed past a STOP decision without human operator approval.
NEVER delete or suppress gate audit log entries.
```

---

## 6. Operational Requirements

### Index freshness

All gates depend on a current index. A stale index (commit mismatch between
the repo and `tessera_meta`) must return WARN for any gate check, with an
explicit message: "Index is stale — re-index before this check is authoritative."

Re-indexing is automatic via IS-TESSERA-INDEXER (GitHub push → webhook →
INDEX_QUEUE). Manual re-index is available via `POST /repos/:slug/reindex`.

### Availability

Gates are in the critical path of every coding session. The Tessera Worker
must maintain p99 latency < 500ms for gate checks. A gate that times out must
return WARN (not PROCEED and not STOP) with an explicit timeout message.
Never silently fail open.

### Human-in-the-loop

STOP is not an error — it is a collaboration request. The gate surfaces risk
to the human operator who can approve the override with full context. The
override is logged. The pattern is:

```
Agent: gate returns STOP
Agent: [surfaces full impact to human: impacted symbols, processes, risk]
Human: "understood, proceed — the test seam is being refactored"
Human: tessera_pre_edit_check({ ..., override: true })
Gate:  PROCEED_WITH_OVERRIDE [logged]
Agent: [proceeds with edit]
```

---

## 7. Failure Mode Reference

| Scenario | Gate that catches it | Result |
|----------|---------------------|--------|
| Agent changes function, breaks 12 test seams | Gate 1 | STOP on the symbol |
| Agent changes function variable (Go test seam) | Gate 1 (with v2 parser) | STOP on FunctionVariable node |
| Agent edits correct function but drifts into adjacent line | Gate 2 | WARN — unintended diff |
| PR introduces HIGH-risk change, reviewer unaware | Gate 3 | HIGH posted as PR comment |
| BC-* spec changed, 3 IS files silently invalidated | Gate 4 | STOP on spec node |
| PDP rule changed, 12 skills affected | Gate 5 | STOP on governance node |
| Index is stale (29-min local re-index scenario) | All gates | WARN + explicit stale message |

---

## 8. Implementation Status

| Gate | IS | BC | Status |
|------|----|----|--------|
| Pre-Edit | IS-TESSERA-PRE-EDIT-GATE v1 | BC-TESSERA-PRE-EDIT-GATE | Spec complete |
| Pre-Commit | IS-TESSERA-PRE-COMMIT-GATE | BC-TESSERA-PRE-COMMIT-GATE | Spec pending |
| Pre-Merge | IS-TESSERA-PRE-MERGE-GATE | BC-TESSERA-PRE-MERGE-GATE | Spec pending |
| Spec Change | IS-TESSERA-SPEC-CHANGE-GATE | BC-TESSERA-SPEC-CHANGE-GATE | Spec pending |
| Governance Change | IS-TESSERA-GOVERNANCE-CHANGE-GATE | BC-TESSERA-GOVERNANCE-CHANGE-GATE | Spec pending |

Gates 2–5 depend on Gate 1 being deployed and operational. Build order:
IS-TESSERA-PRE-EDIT-GATE → IS-TESSERA-PRE-COMMIT-GATE → IS-TESSERA-PRE-MERGE-GATE
→ (IS-TESSERA-SPEC-CHANGE-GATE + IS-TESSERA-GOVERNANCE-CHANGE-GATE in parallel).
