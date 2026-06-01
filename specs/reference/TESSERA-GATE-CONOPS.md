# Tessera Gate System — Complete Concept of Operations

**Document type:** CONOPS — Concept of Operations
**Version:** 2 (complete)
**Date:** 2026-06-01
**Status:** Active
**Scope:** All five Tessera-enforced gates across the coding and governance lifecycle

---

## 1. Situation

### 1.1 The incident that built this system

On 2026-06-01 a coding agent spent 45 minutes making iterative fixes to
`dispatch_runtime.go` in gascity, each introducing new regressions, ending with
a compile error and a full revert. Root cause: the agent changed the call path
away from `workflowServeList` — a Go package-level function variable that 12
tests override as a test seam — without knowing those 12 tests existed.

One command before the first edit would have returned STOP:
```
tessera_pre_edit_check({ target: "workflowServeList", repo: "gascity" })
→ STOP: 12 callers at d=1, risk HIGH
```

It was never called.

### 1.2 The structural failure

This is not a bad-agent story. It is a missing-gate story. Tessera had the
data. `tessera_impact` would have returned the right answer. The agent skipped
it — not out of malice, but because skipping an advisory check is the path of
least resistance under context pressure. Advisory checks get skipped. Mandatory
gates do not.

### 1.3 Three compound failures in one incident

The 2026-06-01 incident was three failures at once — each requiring a different gate:

**Failure 1:** Agent changed `workflowServeList` without knowing blast radius.
→ Gate 1 (pre-edit) would have caught this.

**Failure 2:** The diff accumulated unintended symbols beyond the stated fix target.
→ Gate 2 (pre-commit) would have caught this.

**Failure 3:** The PR had no automated impact analysis before reviewer saw it.
→ Gate 3 (pre-merge / CI) would have caught this.

Any one gate would have stopped the cascade. All three are now specified.

---

## 2. Mission

Convert Tessera from advisory to mandatory at five decision points in the
coding and governance lifecycle. One principle:

> **No agent proceeds past a gate without a risk verdict from Tessera.
> STOP means the human operator decides. WARN means the agent documents
> rationale. PROCEED means safe to continue.**

---

## 3. The Five Gates

### Gate 1 — Pre-Edit (`tessera_pre_edit_check`)

**When:** Before editing any symbol in any indexed repo — before the first
keystroke, before any file is opened for writing.

**Question:** What breaks if I change this symbol?

**Engine:** `tessera_impact` — upstream blast radius traversal.

**Decision table:**

| Risk | Decision | Action |
|------|----------|--------|
| CRITICAL | STOP | Surface to human. Wait for `override: true`. |
| HIGH | STOP | Surface to human. Wait for `override: true`. |
| MEDIUM | WARN | Proceed with documented rationale in commit message. |
| LOW | PROCEED | Safe to edit. |
| UNKNOWN | WARN | Symbol not in index or index stale. Re-index first. |

**Request:**
```json
POST /repos/{slug}/pre-edit-check
{
  "target": "workflowServeList",
  "kind": "FunctionVariable",
  "direction": "upstream",
  "override": false
}
```

**Response:**
```json
{
  "decision": "STOP",
  "risk": "HIGH",
  "impactedCount": 14,
  "directCallers": ["drainWorkflowServeWork", "runWorkflowServe", ...],
  "message": "14 symbols impacted at d=1. Requires human review.",
  "impact": { ... }
}
```

**Override flow:**
```
Agent: gate returns STOP
Agent: [surfaces impact to human — symbol, callers, risk, count]
Human: "understood, the seam is being refactored, proceed"
Human: override: true
Gate:  PROCEED_WITH_OVERRIDE [logged, immutable]
Agent: [makes edit]
```

**MCP tool:** `tessera_pre_edit_check` (14th tool)

**Audit:** `tessera_pre_edit_gates` — append-only, no DELETE.

**Critical note — Go test seams (IS-TESSERA-PARSER v2):**
Go package-level function variables (`var f = someFunc`) are test seams —
invisible to the v1 parser. IS-TESSERA-PARSER v2 extracts them as
`FunctionVariable` nodes. Without v2, `tessera_pre_edit_check` on
`workflowServeList` returns UNKNOWN. Gate 1 is only reliable after
IS-TESSERA-PARSER v2 ships.

**IS:** IS-TESSERA-PRE-EDIT-GATE
**BC:** BC-TESSERA-PRE-EDIT-GATE

---

### Gate 2 — Pre-Commit (`tessera_pre_commit_check`)

**When:** Before `git commit` — after edits are written, before they are staged
and committed.

**Question:** What symbols actually landed in my diff, and are any of them
outside what I intended to change?

**Engine:** `tessera_detect_changes` — maps staged diff hunks to symbols and
execution flows.

**Why Gate 1 is not enough:** Gate 1 fires on a single declared symbol before
the edit. It cannot see what the diff accumulated across a session: a refactored
helper, an auto-formatted neighbor, a parameter threaded through three call
sites. The diff is ground truth. Gate 2 reconciles the diff against intent.

**Request:**
```json
POST /repos/{slug}/pre-commit-check
{
  "intent": ["workflowServeQueue", "drainWorkflowServeWork"]
}
```

**Response:**
```json
{
  "decision": "WARN",
  "changedSymbols": ["workflowServeQueue", "drainWorkflowServeWork", "workflowServeList"],
  "affectedProcesses": ["runWorkflowServe", "runConvoyControlServe"],
  "unintended": ["workflowServeList"],
  "message": "1 unintended symbol in diff. Confirm or revert before committing."
}
```

**Decision table:**

| Unintended symbols | Decision | Action |
|--------------------|----------|--------|
| 0 | PROCEED | Diff matches intent. Commit. |
| 1–2 | WARN | Confirm each unintended symbol or revert. |
| 3+ | STOP | Too much drift from intent. Revert and re-scope. |

**MCP tool:** `tessera_pre_commit_check` (15th tool)

**Audit:** `tessera_pre_commit_gates` — append-only, no DELETE.

**IS:** IS-TESSERA-PRE-COMMIT-GATE
**BC:** BC-TESSERA-PRE-COMMIT-GATE

---

### Gate 3 — Pre-Merge / CI (`tessera_pre_merge_check`)

**When:** CI — on `pull_request` event (opened, synchronize). Runs automatically,
without agent cooperation.

**Question:** What is the full blast radius of this PR across the codebase?

**Engine:** `tessera_impact` across all changed symbols in the PR diff (base → head).

**Why Gates 1–2 are not enough:** They live inside the agent's session and depend
on the agent calling them. Gate 3 is the CI-enforced safety net for everything
that slipped through: multi-commit PRs, cross-session edits, human contributions
that never touched a Tessera gate, and aggregate risk that no single commit looks
dangerous but the PR is HIGH.

**Request:**
```json
POST /repos/{slug}/pre-merge-check
{
  "base": "main",
  "head": "factory/fix-timeout",
  "pr_number": 73
}
```

**Response:**
```json
{
  "decision": "HIGH",
  "changedSymbols": 4,
  "affectedSymbols": 18,
  "risk": "HIGH",
  "affectedProcesses": ["runConvoyControlServe"],
  "comment": "PR touches runWorkflowServe chain. Reviewer must verify test coverage.",
  "commitStatus": "warning"
}
```

**GitHub integration:**
- CRITICAL → commit status `failure` (merge blocked)
- HIGH → commit status `warning` (reviewer warned, merge allowed)
- MEDIUM/LOW → commit status `success` with report
- Structured impact comment posted on PR listing changed symbols, affected processes, risk

**MCP tool:** No — Gate 3 is CI-triggered via the Tessera Worker's
`/repos/:slug/pre-merge-check` route, called by a GitHub Actions workflow.

**Audit:** `tessera_pre_merge_gates` — append-only, no DELETE.

**IS:** IS-TESSERA-PRE-MERGE-GATE
**BC:** BC-TESSERA-PRE-MERGE-GATE

---

### Gate 4 — Spec Change (`tessera_spec_change_check`)

**When:** Before editing any specification artifact (BC-*, IS-*, ES-*, PRS-*, FP-*).

**Question:** Which other spec artifacts reference this one via `source_refs`?

**Engine:** `tessera_impact` on the spec graph (IS-TESSERA-SPEC-ADAPTER —
`REFERENCES` edges derived from `source_refs` arrays).

**Why spec changes need a separate gate:** Spec artifacts are not code symbols.
A BC-* change that silently invalidates 3 IS files is as dangerous as a code
change that breaks 12 tests. Gate 1 operates on code graph nodes. Gate 4
operates on the spec graph. They are siblings, not duplicates.

**Request:**
```json
POST /repos/{slug}/spec-change-check
{
  "target": "BC-GC-FORMULA-DISPATCH"
}
```

**Response:**
```json
{
  "decision": "STOP",
  "risk": "HIGH",
  "referencingSpecs": [
    { "id": "IS-GC-DISPATCH-WIRE", "kind": "IS", "depth": 1 },
    { "id": "IS-GC-EP-FORMULA-DISPATCH", "kind": "IS", "depth": 1 },
    { "id": "ES-GC-DISPATCH-WIRE", "kind": "ES", "depth": 2 }
  ],
  "message": "3 specs reference this capability. All must be reviewed before changing."
}
```

**Decision table:**

| Referencing spec count | Decision |
|------------------------|----------|
| 0 | PROCEED |
| 1–2 | WARN |
| ≥ 3 | STOP (HIGH) |
| ≥ 10 | STOP (CRITICAL) |

**Requires:** IS-TESSERA-SPEC-ADAPTER deployed and indexing `specs/` directory.

**MCP tool:** `tessera_spec_change_check` (16th tool)

**Audit:** `tessera_spec_change_gates` — append-only, no DELETE.

**IS:** IS-TESSERA-SPEC-CHANGE-GATE
**BC:** BC-TESSERA-SPEC-CHANGE-GATE

---

### Gate 5 — Governance Change (`tessera_governance_change_check`)

**When:** Before editing any governance artifact (PDP rules, classification rules,
autonomy tiers, taxonomy purposes).

**Question:** Which skills, purposes, and role bindings does this governance
change affect?

**Engine:** `tessera_impact` on the governance graph (IS-TESSERA-GOVERNANCE-ADAPTER
— `GOVERNS` edges from ClassificationRule → Purpose → Skill).

**The incident this prevents:** On 2026-04-16 the kdense harness run had
938/1340 failures because TC-01, TC-02, and TC-10 fixtures used autonomy tier
`T0` while the PDP correctly denies `T0 + tool.invoke`. No tool surfaced that
changing the T0 tier rule affected every skill that invokes `tool.invoke`. The
governance graph makes this visible.

**Request:**
```json
POST /repos/{slug}/governance-change-check
{
  "target": "Tier:T0"
}
```

**Response:**
```json
{
  "decision": "STOP",
  "risk": "CRITICAL",
  "affectedPurposes": 12,
  "affectedSkills": 134,
  "message": "Tier T0 governs all 134 k-dense skills that invoke tool.invoke. Any change affects the full skill corpus."
}
```

**Decision table:**

| Target type | Rule | Decision |
|-------------|------|----------|
| Tier (T0/T1/T2/T3/T4) | Always STOP | Tier changes affect every skill under that tier |
| ClassificationRule | < 10 skills | WARN |
| ClassificationRule | ≥ 10 skills | STOP (HIGH) |
| ClassificationRule | ≥ 50 skills | STOP (CRITICAL) |
| Purpose | < 5 callers | WARN |
| Purpose | ≥ 5 callers | STOP |

**Tier changes always STOP** regardless of count. The 938-failure incident proved
that a single tier change is categorically high blast radius.

**Requires:** IS-TESSERA-GOVERNANCE-ADAPTER + IS-TESSERA-SKILLS-ADAPTER both
deployed and indexing weops-enterprise.

**MCP tool:** `tessera_governance_change_check` (17th tool)

**Audit:** `tessera_governance_change_gates` — append-only, no DELETE.

**IS:** IS-TESSERA-GOVERNANCE-CHANGE-GATE
**BC:** BC-TESSERA-GOVERNANCE-CHANGE-GATE

---

## 4. Gate Topology

```
 Intent declared
       │
       ▼
┌──────────────────────────────────────────┐
│  GATE 1: PRE-EDIT                        │
│  Before first file edit                  │
│  tessera_pre_edit_check(symbol, repo)    │
│  STOP (HIGH/CRITICAL) → human approval  │
└──────────────┬───────────────────────────┘
               │ PROCEED / approved
               ▼
         [Agent edits]
               │
               ▼
┌──────────────────────────────────────────┐
│  GATE 2: PRE-COMMIT                      │
│  Before git commit                       │
│  tessera_pre_commit_check(intent, repo)  │
│  WARN → confirm unintended diff          │
│  STOP (3+ unintended) → revert + rescope│
└──────────────┬───────────────────────────┘
               │ PROCEED / confirmed
               ▼
         [git commit]
               │
               ▼
┌──────────────────────────────────────────┐
│  GATE 3: PRE-MERGE (CI, automatic)       │
│  On PR open / push to PR branch          │
│  tessera_pre_merge_check(base, head, pr) │
│  CRITICAL → merge blocked (CI failure)   │
│  HIGH → reviewer warned (CI warning)     │
└──────────────┬───────────────────────────┘
               │ PROCEED
               ▼
         [merge to main]


 Spec artifact changes → GATE 4 (replaces Gate 1 for spec files)
 Governance artifact changes → GATE 5 (replaces Gate 1 for PDP/rules)
```

Gates 4 and 5 are not additions to Gates 1–3 for spec/governance changes.
They **replace** Gate 1 because spec artifacts and governance artifacts are not
code symbols — they live in different graphs (spec graph, governance graph).

---

## 5. Shared Contracts (all gates)

### Risk → Decision mapping

| Risk | Decision | Agent action |
|------|----------|-------------|
| CRITICAL | STOP | Cannot proceed. Surface to human. Wait for `override: true`. |
| HIGH | STOP | Cannot proceed. Surface to human. Wait for `override: true`. |
| MEDIUM | WARN | May proceed. Must document rationale in commit message. |
| LOW | PROCEED | Safe to continue. |
| UNKNOWN | WARN | Symbol not found or index stale. Re-index before proceeding. |

### Override protocol

Only a human operator may pass `override: true`. An automated agent must
never self-approve a STOP — it must surface the risk to the human and wait.

```
Agent:  STOP received — 14 callers, risk HIGH
Agent:  [presents impact to human]
Human:  "confirmed, proceed — this seam is intentionally being removed"
Human:  tessera_pre_edit_check({ ..., override: true })
Gate:   PROCEED_WITH_OVERRIDE [audit log entry written]
Agent:  [proceeds]
```

### Audit trail

Every gate check — including overrides — is written to the corresponding
ArangoDB collection. All collections are **append-only, no DELETE route**.
Immutable by design. An agent cannot erase a gate check.

| Gate | Collection |
|------|-----------|
| Pre-Edit | `tessera_pre_edit_gates` |
| Pre-Commit | `tessera_pre_commit_gates` |
| Pre-Merge | `tessera_pre_merge_gates` |
| Spec Change | `tessera_spec_change_gates` |
| Governance Change | `tessera_governance_change_gates` |

### Index freshness

A stale index (repo commit ≠ `tessera_meta.commit`) must return WARN with an
explicit message: "Index is stale — results may not reflect current code."
Never PROCEED silently on stale data. Never STOP silently on a broken check.

### AGENTS.md enforcement

Every indexed repo's AGENTS.md `## Never Do` block must include:
```
- NEVER edit a symbol without first calling tessera_pre_edit_check.
  A STOP requires human operator approval before proceeding.
- NEVER edit a BC-*, IS-*, or ES-* spec without calling tessera_spec_change_check.
- NEVER edit a PDP rule, classification rule, or autonomy tier without
  calling tessera_governance_change_check.
- NEVER commit without calling tessera_pre_commit_check.
- NEVER suppress, delete, or bypass gate audit log entries.
```

---

## 6. MCP Tool Surface

| # | Tool | Gate |
|---|------|------|
| 14 | `tessera_pre_edit_check` | Gate 1 |
| 15 | `tessera_pre_commit_check` | Gate 2 |
| — | (CI route, not MCP) | Gate 3 |
| 16 | `tessera_spec_change_check` | Gate 4 |
| 17 | `tessera_governance_change_check` | Gate 5 |

Gate 3 is CI-triggered. It is not an MCP tool — it is a Worker HTTP route
called by GitHub Actions, not by an agent.

---

## 7. Failure Mode Reference

| Scenario | Gate | Outcome without gate | Outcome with gate |
|----------|------|----------------------|------------------|
| Agent changes function, breaks 12 test seams (2026-06-01) | Gate 1 | 45 min regressions, full revert | STOP before line 1 |
| Agent changes Go test seam variable | Gate 1 + Parser v2 | UNKNOWN, proceeds blind | STOP — FunctionVariable node indexed |
| Diff accumulates unintended symbols | Gate 2 | Unintended symbols committed | WARN — confirm or revert |
| PR aggregate HIGH risk, reviewer unaware | Gate 3 | Merges unreviewed | HIGH warning posted, reviewer notified |
| BC-* changed, 3 IS files silently invalidated | Gate 4 | Spec drift | STOP — 3 referencing specs surfaced |
| PDP tier rule changed, 134 skills affected | Gate 5 | 938 harness failures | STOP — CRITICAL, tier always stops |
| Index 29 min stale (gascity re-index) | All gates | Silent wrong result | WARN — explicit stale message |

---

## 8. Dependencies and Build Order

```
IS-TESSERA-PARSER v2 (FunctionVariable extraction)
    └── IS-TESSERA-IMPACT (BFS traversal, Class/Interface seeding)
         └── IS-TESSERA-PRE-EDIT-GATE (Gate 1)
              └── IS-TESSERA-PRE-COMMIT-GATE (Gate 2)
                   └── IS-TESSERA-PRE-MERGE-GATE (Gate 3)

IS-TESSERA-SPEC-ADAPTER (spec graph indexing)
    └── IS-TESSERA-SPEC-CHANGE-GATE (Gate 4)

IS-TESSERA-GOVERNANCE-ADAPTER + IS-TESSERA-SKILLS-ADAPTER
    └── IS-TESSERA-GOVERNANCE-CHANGE-GATE (Gate 5)
```

Gates 4 and 5 can be built in parallel with Gates 2–3. Gate 1 is the
critical-path dependency for all downstream gates.

## 9. Implementation Status

| Gate | IS | Status |
|------|-----|--------|
| 1 — Pre-Edit | IS-TESSERA-PRE-EDIT-GATE v1 | Spec complete |
| 2 — Pre-Commit | IS-TESSERA-PRE-COMMIT-GATE v1 | Spec complete |
| 3 — Pre-Merge | IS-TESSERA-PRE-MERGE-GATE v1 | Spec complete |
| 4 — Spec Change | IS-TESSERA-SPEC-CHANGE-GATE v1 | Spec complete |
| 5 — Governance Change | IS-TESSERA-GOVERNANCE-CHANGE-GATE v1 | Spec complete |
| Parser v2 (FunctionVariable) | IS-TESSERA-PARSER v2 | Spec complete |
| Indexer v2 (stream-and-write) | IS-TESSERA-INDEXER v2 | Spec complete |

All specs complete. Factory execution pending.
