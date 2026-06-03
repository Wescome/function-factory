# Tessera Gate System — Concept of Operations

**Author:** Wislet J. Celestin
**Affiliation:** Koales.ai / WeOps Research
**Document type:** Concept of Operations (doctrinal)
**Status:** Active — v2 (canonical rewrite)
**Date:** 2026-06-01
**Companion documents:**
- IS-TESSERA-PRE-EDIT-GATE — Gate 1 intent specification
- IS-TESSERA-PRE-COMMIT-GATE — Gate 2 intent specification
- IS-TESSERA-PRE-MERGE-GATE — Gate 3 intent specification
- IS-TESSERA-SPEC-CHANGE-GATE — Gate 4 intent specification
- IS-TESSERA-GOVERNANCE-CHANGE-GATE — Gate 5 intent specification
- IS-TESSERA-PARSER v2 — FunctionVariable extraction (Gate 1 dependency)
- IS-TESSERA-INDEXER v2 — stream-and-write (operational dependency)
- *The Function Factory* ConOps v1 (2026-04-18) — parent operational doctrine

---

## Table of Contents

1. Purpose and Scope
2. Operational Context
3. Operator Roles
4. System Modes
5. Authority and Permission Model
6. Information Flow
7. Operational Scenarios
8. Exception Handling
9. Interfaces to Adjacent Systems
10. Measures of Operational Effectiveness
11. Transition Plan: Advisory → Mandatory
12. Governance and Change Control

---

## 1. Purpose and Scope

### 1.1 Purpose of this document

This Concept of Operations specifies how the Tessera Gate System is operated as a mandatory enforcement layer within the Koales.ai coding and governance lifecycle. The five companion IS files (IS-TESSERA-PRE-EDIT-GATE through IS-TESSERA-GOVERNANCE-CHANGE-GATE) define the technical contracts — what each gate computes, what schemas it reads, what audit records it writes. This document defines the operational reality — who interacts with the gates, what scenarios they face, how authority over gate decisions is exercised, and how the system behaves when components are unavailable or verdicts are disputed.

A reader who has absorbed the IS files and this ConOps should be able to operate the gate system without reconstructing operational intent from first principles. A reader who comes to the ConOps without the IS files will understand how the system behaves but will lack the technical specification for how it computes its answers. Both documents are required for full orientation.

### 1.2 Scope

This ConOps covers five gates:

- **Gate 1 — Pre-Edit:** enforced before any coding agent edits a code symbol
- **Gate 2 — Pre-Commit:** enforced before any coding agent commits staged changes
- **Gate 3 — Pre-Merge:** enforced automatically by CI on every pull request
- **Gate 4 — Spec Change:** enforced before any coding agent edits a specification artifact
- **Gate 5 — Governance Change:** enforced before any coding agent edits a governance artifact

These five gates address three artifact graphs — code, specification, and governance — and three phases of the development lifecycle — editing, committing, and merging. They are collectively called the Tessera Gate System.

### 1.3 Out of scope

The following are explicitly out of scope for this ConOps:

- The internal computation of Tessera impact analysis — that is specified in IS-TESSERA-IMPACT.
- The indexing pipeline that produces the graph these gates query — specified in IS-TESSERA-INDEXER and IS-TESSERA-PARSER.
- The ArangoDB schema for audit records — specified in IS-TESSERA-ARANGO-SCHEMA.
- The Tessera MCP server's other tools (query, context, detect_changes, rename, etc.) — specified in IS-TESSERA-MCP.
- The operations of the Function Factory itself — specified in the Function Factory ConOps v1.

### 1.4 Relationship to the IS files

Where an IS file makes a technical contract (request schema, response shape, decision logic, audit format), this ConOps translates that contract into operational rules: who calls the gate, in what situation, with what authority to override, and what they must do with the result. A change to this ConOps that contradicts an IS file's contract is a change to the IS file, not just the ConOps. Both must be updated together.

---

## 2. Operational Context

### 2.1 The incident that produced this system

On 2026-06-01 a coding agent spent 45 minutes making iterative fixes to `dispatch_runtime.go` in the gascity codebase. Each fix introduced new regressions. The session ended with a compile error and a full revert. Root cause: the agent changed the call path away from `workflowServeList` — a Go package-level function variable that 12 tests override as a test seam — without knowing those 12 tests existed. The agent was not malicious and was not negligent by any reasonable standard. It lacked information that Tessera had. It never asked for it.

One command before the first edit would have returned STOP and surfaced 12 callers at immediate depth, risk HIGH. That command was never called because advisory tools get skipped under context pressure. This is not an anomaly — it is predictable human and agent behavior. Advisory checks are optional by definition. The incident was not an agent failure. It was a system design failure: Tessera's impact analysis was advisory, and advisory systems get bypassed at exactly the moment they matter most.

### 2.2 The compound nature of the failure

The 2026-06-01 incident was three distinct failures layered together. Isolating them matters because each requires a different gate:

The first failure was that the agent edited a symbol without knowing its blast radius. A pre-edit check would have surfaced the risk before the first keystroke.

The second failure was that the diff accumulated symbols beyond what the agent intended to change — neighboring code was inadvertently swept up across multiple iterative edits. A pre-commit check reconciling the actual diff against stated intent would have caught this before the commit was staged.

The third failure was that no automated impact analysis ran when the resulting PR was opened. A human reviewer who has not traced the call graph cannot assess risk from a diff alone. A CI-enforced pre-merge check would have posted the blast radius to the PR before any human reviewed it.

Any one of the three gates would have stopped the cascade. None existed. All three are now specified.

### 2.3 The structural gap being closed

The gap is not one agent making one mistake. The gap is that Tessera's knowledge — 23,000 symbols, 39,000 edges, all execution flows — was available and unused at the moments it was most needed. The gate system closes that gap by converting the question "should I check Tessera?" from a judgment call into a structural requirement. The agent no longer decides whether to consult Tessera before editing. The gate does.

### 2.4 Scope expansion: specification and governance artifacts

The code gate story (Gates 1–3) is the one the incident produced. But specification artifacts and governance artifacts carry equivalent risk under different failure modes. When a Business Capability specification changes, Intent Specifications that depend on it may silently become inconsistent with their upstream — the same invisible-dependency problem, in the spec graph instead of the code graph. When a governance tier rule changes, every skill governed by that tier is affected — a change that looks narrow from inside a single YAML file but is categorically wide in operational effect.

Gates 4 and 5 apply the same mandatory principle to these adjacent artifact graphs. The technical mechanism is the same (Tessera impact traversal); the graphs are different (spec graph, governance graph); the operational authority model is the same.

---

## 3. Operator Roles

The gate system is operated by four distinct roles. Each has bounded authority, specific information access, and defined responsibilities at each gate.

### 3.1 Coding Agent

The **Coding Agent** is the software role that initiates gate checks as part of its normal operation. In the Koales.ai configuration, Coding Agents are harness-bound instances of Claude Code, Cursor, or equivalent. The Coding Agent is the primary initiator of Gates 1, 2, 4, and 5 — it calls the gate, receives the verdict, and either proceeds, documents rationale, or surfaces the verdict to the Human Operator for override.

The Coding Agent has no authority to override a STOP verdict on its own. If the gate returns STOP, the Coding Agent must surface the full impact report to the Human Operator and halt until an override is provided. An agent that proceeds past a STOP without an override has violated the system's most fundamental rule. The audit trail will record this; the violation cannot be erased.

The Coding Agent is responsible for maintaining awareness of index freshness before calling a gate. A stale index means the gate's verdicts may not reflect current code. The Coding Agent must re-index before relying on gate results when the index is known to be stale.

### 3.2 Human Operator

The **Human Operator** is the human in the loop — the developer, architect, or reviewer who is present in the coding session when a STOP verdict is returned. The Human Operator is the only role with authority to provide override approval. The operator reviews the impact report surfaced by the Coding Agent, makes a judgment, and either approves the override with rationale or instructs the Coding Agent to revert and rescope.

The Human Operator is the system's safety valve. The gates are designed to make bypassing them visible and traceable, not impossible. A gate system that cannot be overridden by a knowledgeable human under legitimate circumstances is not a gate system — it is a lock. The override mechanism exists precisely because there are situations (intentional seam removal, architectural refactors, spec deprecation) where STOP is the correct machine judgment and PROCEED is the correct human judgment. The Human Operator makes that call, with their identity and rationale committed to the audit log.

In the seed Koales.ai configuration, the Human Operator role is typically held by Wes Celestin. As the organization scales, additional humans may hold this role for their respective repos, but override authority always rests with a named human — never with an automated system.

### 3.3 CI/CD System

The **CI/CD System** is the automated role that runs Gate 3 on every pull request without agent or human invocation. In the Koales.ai configuration, this is the GitHub Actions workflow that calls the Tessera Worker's pre-merge route on `pull_request` events. The CI/CD System has no override authority. It is a reporter, not a decision-maker. It posts the impact analysis to the PR, sets the commit status, and notifies the reviewer. The merge decision remains with the Human Operator.

Gate 3 is the only gate the CI/CD System operates. It is also the only gate that runs independently of agent cooperation — it runs on human-authored commits as well as agent-authored commits, and it runs whether or not Gates 1 and 2 were called in the upstream session.

### 3.4 Architect

The **Architect** holds ultimate authority over the gate system's design and calibration. The Architect does not operate the gates day-to-day; the Architect establishes the decision thresholds, approves changes to the gate specifications, investigates systematic failures and miscalibrations, and reviews override frequency as a system health signal. In the seed configuration, the Architect role is held by Wes Celestin.

The Architect is the role that changes gate behavior, not the role that operates it. When override frequency climbs — indicating that STOP is returning too often, or for conditions that do not warrant it — the Architect investigates whether the gate is miscalibrated or whether the work is genuinely high-risk. The response is to calibrate the gate, not to lower standards for when STOP fires.

### 3.5 Role interaction summary

| Situation | Initiator | Recipient | Action |
|---|---|---|---|
| Pre-edit, pre-commit, spec, governance check | Coding Agent | Tessera gate | Coding Agent calls gate; gate returns verdict |
| STOP verdict | Tessera gate | Coding Agent | Coding Agent halts and surfaces to Human Operator |
| Override request | Coding Agent | Human Operator | Human Operator reviews, approves with rationale, or instructs revert |
| Override approval | Human Operator | Gate | Human provides `override: true`; gate writes audit entry |
| PR opened | CI/CD System | Tessera Worker | Gate 3 runs automatically; impact posted to PR |
| Override rate rising | Audit system | Architect | Architect reviews calibration |

---

## 4. System Modes

The gate system operates in one of four modes at any time.

### 4.1 Pre-deployment mode

**Definition.** The mode in which all five gate specifications are complete but no gate is yet enforced in production. Agents may call gate tools voluntarily; the gates will return correct verdicts. No AGENTS.md block yet mandates that agents call the gates. CI Gate 3 is not yet wired into any repository's workflow.

**Current status.** As of the writing of this document, the system is in pre-deployment mode. All five IS files are complete. The gate tools are specified. The audit collections are specified. No gate is yet enforced.

**Rules specific to pre-deployment.** Gate calls are voluntary. Override authority exists but is rarely exercised since STOP verdicts are not blocking anything. Index freshness is the primary operational concern — the gate tools require an accurate index to return meaningful verdicts.

**Transition out.** Pre-deployment ends when at least one gate is enforced: AGENTS.md for the relevant repo includes the mandatory gate block, and at least one agent session has been blocked by a STOP verdict and required a Human Operator override.

### 4.2 Nominal mode

**Definition.** The mode in which all five gates are enforced as specified. Coding Agents call Gates 1, 4, and 5 before editing; Gate 2 before committing; Gate 3 runs automatically on every PR. STOP verdicts require Human Operator override. Override actions write to the audit log. Index freshness is monitored.

**Rules specific to nominal mode.** No Coding Agent may bypass a STOP without a Human Operator override. Override frequency is tracked as a Measure of Operational Effectiveness. CI Gate 3 is active on all production repositories. AGENTS.md enforcement blocks are in place for all repositories where agents operate.

### 4.3 Degraded mode

**Definition.** The mode in which one or more gates are temporarily unavailable — the Tessera Worker is down, the graph database is unreachable, the index is severely stale — but the gate system as a whole continues to operate in reduced form.

**Triggers.** Any of: Tessera Worker health check failing, ArangoDB audit collection unreachable, graph index more than one full re-index cycle behind HEAD, Gate 3 CI workflow failing to trigger.

**Rules specific to degraded mode.** A gate that cannot compute a verdict must return WARN explicitly: "Gate unavailable — index unreachable." The gate must never silently pass in a degraded state. An unavailable gate is treated as a WARN, not as a PROCEED. The Human Operator decides whether to proceed given the unavailability. The inability to write to the audit log does not unblock a STOP — if the audit trail is down, STOP verdicts stand.

**Transition out.** Degraded mode ends when the unavailable component is restored and health-checked. The Human Operator acknowledges the transition back to nominal in the session log.

### 4.4 Emergency mode

**Definition.** The mode in which a declared incident requires immediate changes to high-risk code or governance artifacts, and the normal gate flow must be managed under emergency authority rather than routine override.

**Triggers.** A sev1 incident linked to one of the indexed repositories; a declared emergency by the Architect; a security event requiring immediate Function or artifact isolation.

**Rules specific to emergency mode.** The gates continue to run and continue to return verdicts — emergency mode does not disable the gates. The Human Operator may provide overrides at higher frequency than nominal, and the Architect's authority over override approval expands to cover changes that would not normally require Architect-level review. All emergency overrides are logged with the incident ID as primary lineage, creating a parallel audit trail for the incident independent of the normal artifact lineage. Emergency mode is time-boxed; indefinite emergency mode is a governance defect.

---

## 5. Authority and Permission Model

### 5.1 Who may override

Override authority is held exclusively by human operators. No automated system — not the Coding Agent, not the CI/CD System, not any scheduled job — may pass `override: true` without explicit human action. The gate system is designed so that overrides require a human to be present, aware, and explicitly accepting responsibility.

In practical terms: when a gate returns STOP, the Coding Agent surfaces the full impact to the Human Operator in the active session. The Human Operator reads it. If the Human Operator judges that the change is safe despite the risk verdict — because they know the context the gate does not — they pass the override. The override carries the operator's identity, their stated rationale, and a timestamp, all written immutably to the audit log.

### 5.2 What an override commits to

An override is not a dismissal of the gate's finding. It is an acknowledgment of the finding and an explicit human decision to proceed anyway. The override record in the audit log answers three questions: What did the gate flag? Who decided to proceed? Why?

An override without stated rationale is a malformed override. The gate should refuse to log a rationale-free override and require the Human Operator to provide one. A blank rationale field defeats the audit trail's purpose.

### 5.3 Override authority hierarchy

| Risk verdict | Minimum authority to override |
|---|---|
| LOW / MEDIUM | Human Operator (routine) |
| HIGH | Human Operator (routine, but rationale required) |
| CRITICAL | Human Operator + logged DECISIONS.md entry |

CRITICAL overrides are not routine. They require the Human Operator to log the decision in DECISIONS.md — not just in the gate audit trail — because CRITICAL verdicts indicate that the change affects a large enough surface that the decision itself is architecturally significant and should be preserved in the operational record.

### 5.4 Override frequency as a governance signal

Override frequency is the most important signal about the gate system's health. A low, stable override rate indicates the gates are calibrated correctly: STOP fires when STOP is warranted, and the Human Operator almost always agrees. A rising override rate indicates one of two things: the gate is miscalibrated (returning STOP too broadly), or the work being done is genuinely riskier than expected and the override rate is hiding a systemic problem.

The Architect reviews override frequency in the periodic operational review. When the override rate climbs, the Architect investigates which gate is firing, for which artifact types, and whether the threshold is correct. The response to miscalibration is to adjust the IS file's decision logic — not to habituate operators to overriding STOP as routine.

---

## 6. Information Flow

### 6.1 The primary flow — gate check to verdict to action

The gate system's information flow begins with an agent's intent to change something. The agent declares its target — a code symbol, a spec artifact, a governance artifact — and calls the appropriate gate before making any change. The gate queries the Tessera graph, traverses upstream dependencies, computes risk, and returns a verdict. The agent acts on the verdict: proceeding, documenting rationale, or surfacing to the Human Operator.

The primary flow is synchronous. The agent waits for the gate's verdict before proceeding. There is no fire-and-forget mode. A gate that cannot return a verdict within a reasonable time — because the graph database is slow, because the index is large, because the impact traversal is deep — is a gate that is holding up the agent. The IS files specify timeout behavior; this ConOps notes that slow gates produce agent pressure to skip them, which is a calibration problem, not an agent problem.

### 6.2 The audit flow

Parallel to the primary flow, every gate check — verdict, rationale, override, timing — writes to the corresponding audit collection in ArangoDB. The audit collections are append-only. No DELETE route exists. An agent cannot erase a gate check, cannot revise a logged verdict, cannot remove an override record.

The audit flow is the system's institutional memory. It answers questions the primary flow cannot: How often does Gate 1 return STOP for this repository? What is the distribution of override rationales? Which symbols trigger STOP most frequently? Has the override rate changed since the last calibration? These questions cannot be answered from the primary flow alone; they require the accumulated audit trail.

The audit trail is also the record of incidents: when an agent bypassed a gate that should have been called, the absence of a gate record for the relevant symbol and timestamp is itself evidence. The audit trail proves what happened; its gaps prove what did not happen.

### 6.3 The CI flow — Gate 3

Gate 3 runs a separate information flow from Gates 1, 2, 4, and 5. It is not agent-initiated. It is triggered by a GitHub webhook on pull request events. The CI/CD System calls the Tessera Worker with the PR's base and head refs; the Worker computes the aggregate blast radius of all changed symbols in the diff; the Worker posts a structured impact comment to the PR and sets the commit status.

The CI flow is asynchronous from the agent's perspective — the agent has already committed and pushed before Gate 3 runs. Gate 3 is not a blocker for the agent's immediate work; it is a signal to the human reviewer and a CI status that the merge tooling respects. When Gate 3 returns CRITICAL, the commit status blocks the merge until a Human Operator manually overrides at the merge level.

### 6.4 Timing and cadence

| Activity | When it happens |
|---|---|
| Gate 1 check | Before every edit to a code symbol, every session |
| Gate 2 check | Before every git commit |
| Gate 3 check | Automatically on every pull_request event (opened, synchronize) |
| Gate 4 check | Before every edit to a spec artifact (BC-*, IS-*, ES-*, PRS-*, FP-*) |
| Gate 5 check | Before every edit to a governance artifact (PDP rules, classification rules, autonomy tiers, taxonomy) |
| Audit writes | On every gate check, including overrides |
| Index freshness check | Before relying on any gate verdict; explicitly on UNKNOWN verdicts |
| Override rate review | Periodic operational review by Architect |

---

## 7. Operational Scenarios

The following scenarios specify how the gate system operates under nominal and named non-nominal conditions. Each scenario is written from the operator's perspective — what roles experience, what they see, what they decide, and what the outcome is.

### 7.1 Scenario A — Nominal pre-edit check, PROCEED

**Situation.** A Coding Agent intends to modify a utility function in the gascity codebase. The function has no known dependents and has not been changed recently.

**Flow.**

The Coding Agent declares the target symbol and calls Gate 1 before opening any file. Gate 1 queries the Tessera index, traverses upstream dependencies, and returns a verdict within seconds: LOW risk, PROCEED. The gate writes the check to the audit log with the symbol, verdict, risk level, and timestamp.

The Coding Agent proceeds with the edit. No Human Operator involvement is required. The session continues without interruption.

**Outcome.** The agent made a change with confirmed low blast radius. The audit trail shows a gate was called, a verdict was returned, and the agent proceeded with full information.

---

### 7.2 Scenario B — Pre-edit check, STOP with override

**Situation.** A Coding Agent intends to modify a function that is, unknown to the agent, used as a test seam by 12 downstream tests. The agent has a legitimate reason to change it — the seam is being intentionally removed as part of a refactor — but needs Human Operator confirmation before proceeding.

**Flow.**

The Coding Agent calls Gate 1 before the first edit. Gate 1 traverses upstream and returns STOP: 14 symbols impacted at immediate depth, risk HIGH. The gate writes the check to the audit log.

The Coding Agent does not proceed. It surfaces the full impact report to the Human Operator in the active session: the symbol targeted, the 14 upstream dependents, the risk level, the recommendation to halt.

The Human Operator reads the report. The 14 callers are test seams being intentionally removed as part of the refactor the agent is working on. The Human Operator provides the override with explicit rationale: "Confirmed — seam removal is intentional, all downstream tests will be updated in this PR."

The gate writes the override to the audit log: symbol, original verdict, override provider identity, rationale, timestamp. PROCEED_WITH_OVERRIDE is returned.

The Coding Agent proceeds with the edit, knowing that a human reviewed the full impact and accepted responsibility.

**Outcome.** A human with context made an informed decision to proceed. The override is immutably logged. No future reviewer needs to wonder whether the blast radius was considered.

---

### 7.3 Scenario C — Pre-commit check, WARN on unintended symbols

**Situation.** A Coding Agent has completed a session editing three functions in a Go service. When the staged diff is assembled, it contains a fourth symbol — a utility function that was auto-formatted or inadvertently swept up during the edit.

**Flow.**

Before committing, the Coding Agent calls Gate 2 with its stated intent: the three symbols it meant to change. Gate 2 compares the intent against the actual staged diff. The diff contains the three intended symbols and one unintended symbol.

Gate 2 returns WARN: the unintended symbol is named, its presence in the diff is flagged, and the Human Operator is asked to confirm or revert before committing.

The Human Operator reviews the unintended symbol. It is a trivial formatting change with no logical effect. The Human Operator confirms it is safe to include. Gate 2 writes the confirmation to the audit log, and the commit proceeds.

**Alternate flow — revert.** If the unintended symbol were a substantive change that the agent did not intend, the Human Operator would instruct a revert on that symbol before committing. Gate 2 prevents the unintended change from entering the repository's history.

**Outcome.** The diff was audited against intent before the commit. An unintended symbol was identified and reviewed. The commit is traceable to a confirmed scope.

---

### 7.4 Scenario D — CI pre-merge check, HIGH verdict

**Situation.** A developer opens a pull request in the gascity repository. The PR modifies four functions across two files. No gates were called during the editing session — perhaps the developer was not using a harness that enforces them.

**Flow.**

When the PR is opened, GitHub triggers the CI workflow. The CI/CD System calls the Tessera Worker with the base branch and head branch. The Worker computes the blast radius across all four changed symbols — not individually, but in aggregate. The aggregate risk is HIGH: the PR touches the `runWorkflowServe` execution flow, which is among the system's most critical paths.

The Worker posts a structured impact comment to the PR: the changed symbols, the affected downstream symbols, the affected execution flows, the risk level, and the recommendation that the reviewer verify test coverage for the affected processes. The commit status is set to `warning`.

The human reviewer reads the impact comment before reviewing the diff. They know, before they look at a single line of code, that this PR is touching a high-risk path. They review with appropriate care.

**Outcome.** A human reviewer who might have seen a modest-looking diff in isolation instead reviews it knowing the actual blast radius. Gate 3 is the safety net that fires regardless of whether Gates 1 and 2 were called.

---

### 7.5 Scenario E — Spec change gate, STOP on referencing specs

**Situation.** A Coding Agent intends to revise a Business Capability specification (BC-GC-FORMULA-DISPATCH) to tighten its scope. Three Intent Specifications reference this BC via `source_refs`. Changing the BC may silently invalidate those IS files.

**Flow.**

The Coding Agent calls Gate 4 before opening the BC file. Gate 4 traverses the spec graph — relationships derived from `source_refs` arrays across all indexed spec artifacts — and returns STOP: 3 specs reference this capability at depth 1 or 2, risk HIGH.

Gate 4 surfaces the referencing specs: two IS files and one ES file that cite this BC as a source. The Coding Agent cannot safely modify the BC without reviewing these three artifacts.

The Coding Agent surfaces this to the Human Operator. The Human Operator reviews all three referencing specs, identifies which sections would be affected by the proposed BC change, and either narrows the BC change to avoid invalidating them, updates all three in the same PR, or provides an override with rationale explaining why the BC change is valid despite the dependency.

**Outcome.** A spec change that would have silently invalidated downstream artifacts was caught before the first edit. The spec graph is treated with the same mandatory rigor as the code graph.

---

### 7.6 Scenario F — Governance change gate, CRITICAL on tier rule

**Situation.** A Coding Agent intends to tighten the definition of autonomy tier T0 in the weops-enterprise PDP rules. T0 governs every skill that invokes `tool.invoke`. There are 134 such skills.

**Flow.**

The Coding Agent calls Gate 5 before opening the PDP rule file. Gate 5 traverses the governance graph — relationships from classification rules through purposes to skills — and returns STOP: CRITICAL. Tier T0 governs 134 skills. Any change to a tier rule is categorically CRITICAL regardless of count, because tier rules are the base of the governance hierarchy.

The gate surfaces the full scope: 12 affected purposes, 134 affected skills, the risk level, and the directive that this change requires DECISIONS.md documentation before proceeding.

The Human Operator reviews the proposed change. They write a DECISIONS.md entry explaining the rationale for the tier redefinition, the expected effect on the 134 affected skills, and the validation plan to confirm the change has the intended effect. The override is provided with the DECISIONS.md entry ID as rationale.

**Outcome.** A change that in a previous incident (2026-04-16) produced 938 harness failures was caught before any file was opened. The DECISIONS.md entry is the durable record that this was a deliberate, reviewed architectural decision.

---

### 7.7 Scenario G — Stale index handling

**Situation.** A Coding Agent calls Gate 1 on a symbol. Gate 1 returns WARN: the index is stale — the recorded last-commit does not match the repository's current HEAD. The gate cannot guarantee that its result reflects current code.

**Flow.**

The Coding Agent does not proceed on the stale result. It surfaces the staleness warning to the Human Operator and triggers a re-index of the repository before calling Gate 1 again. Once the re-index completes and the index commit matches HEAD, Gate 1 is called again and returns a fresh verdict.

**Why this matters.** A stale index may not know about symbols added since the last analysis, may not have removed deleted symbols, and may not reflect call-graph changes from recent commits. A gate verdict on a stale index is an unreliable verdict. The system treats it as WARN rather than silently PROCEED to make the unreliability visible.

**Outcome.** The gate provided a truthful signal about its own reliability. The agent re-indexed before proceeding. The subsequent verdict was fresh and trustworthy.

---

### 7.8 Scenario H — Gate unavailable

**Situation.** The Tessera Worker is temporarily unreachable. A Coding Agent calls Gate 1 and receives no response within the timeout window.

**Flow.**

The gate returns a degraded-mode WARN: "Gate unavailable — Tessera Worker did not respond. Index state unknown." The Coding Agent cannot obtain a fresh verdict.

The Human Operator is notified. They make one of two decisions: halt the session until the Worker is restored and a fresh verdict can be obtained, or proceed with explicit acknowledgment that this change is being made without gate verification — which is logged as a gate-unavailable override with the outage as rationale.

A gate-unavailable override is not equivalent to a gate-verified PROCEED. It is a recorded acknowledgment that the gate was not consulted. This is honest accounting: the audit trail accurately reflects what actually happened in the session.

**Outcome.** The system communicated its own unreliability rather than failing silently. The Human Operator made an informed decision. The audit trail records what was verified and what was not.

---

## 8. Exception Handling

The gate system's philosophy on exceptions mirrors the Function Factory's: fail closed, log richly, surface explicitly. The system never silently passes; it never suppresses errors to avoid interrupting the agent.

### 8.1 Graph query failures

If the Tessera index exists but a graph traversal fails — due to a database error, a schema mismatch, or a corrupt edge — the gate returns WARN with the error detail rather than returning PROCEED. A failed traversal is not evidence of low risk; it is evidence of an inability to assess risk. Treating it as PROCEED would be the most dangerous possible default.

### 8.2 Symbol not found

If Gate 1 or Gate 4 is called on a symbol or artifact that does not exist in the index, the gate returns WARN with an explicit message: symbol not indexed. There are two possible causes. The symbol is new and has never been analyzed — in which case the agent should re-index before proceeding. The symbol name was misspelled or the wrong repo was specified — in which case the agent should correct the call. Either way, proceeding without finding the target is not safe.

### 8.3 Audit write failure

If the gate computes a verdict but cannot write the audit record — because ArangoDB is unreachable, because the collection is locked, because a network partition separates the Worker from the database — the gate must not return PROCEED silently. The audit trail is not optional. A gate that succeeded computationally but failed to log must return a degraded verdict indicating partial execution. The Human Operator decides whether to proceed without an audit record.

### 8.4 False positive handling

A Human Operator who believes a gate has returned STOP incorrectly — that the blast radius is overstated, that the risk assessment is wrong for the specific situation — has two options. They may provide an override with rationale, which proceeds immediately and logs the disagreement. Or they may escalate to the Architect, who investigates whether the gate's decision logic is miscalibrated for this artifact type.

False positives should never become normalized through routine override. If the same gate fires STOP repeatedly on the same class of change and the Human Operator overrides each time, this pattern surfaces in the override frequency MOE and triggers Architect review of the threshold. The right response to a systematic false positive is to recalibrate the gate, not to treat override as a routine cost of the workflow.

---

## 9. Interfaces to Adjacent Systems

### 9.1 AGENTS.md enforcement blocks

The gate system's mandatory nature depends on AGENTS.md. Every indexed repository must include a `## Never Do` block that prohibits Coding Agents from editing code symbols, spec artifacts, or governance artifacts without first calling the appropriate gate. The AGENTS.md block is the operational binding between the gate system's technical enforcement and the agents that must respect it.

**Outbound interface.** This ConOps specifies the required AGENTS.md language (see IS-TESSERA-PRE-EDIT-GATE for the canonical text). The repository maintainer ensures the block is present and current.

**Inbound interface.** Coding Agents read AGENTS.md on session start. The gate requirement is learned from AGENTS.md, not from a runtime prompt or a separate tool. An agent that did not read AGENTS.md is an agent that may not know the gate exists.

### 9.2 GitHub Actions CI (Gate 3)

Gate 3 is entirely CI-triggered. The interface is a GitHub Actions workflow file in each repository that listens for `pull_request` events, calls the Tessera Worker's pre-merge route, and processes the response into a commit status and PR comment.

**Outbound interface.** The Tessera Worker exposes the pre-merge route as documented in IS-TESSERA-PRE-MERGE-GATE. The CI workflow is the caller.

**Inbound interface.** The Tessera Worker receives the repo slug, base branch, head branch, and PR number. It returns a verdict, impact summary, and the text of the PR comment. The CI workflow posts the comment and sets the status.

The CI workflow does not make merge decisions — it posts information and sets status. Human reviewers and merge tooling act on the status. The Worker does not interact with merge tooling directly.

### 9.3 ArangoDB audit collections

Every gate's audit records live in a dedicated ArangoDB collection. The collections are append-only by design — no DELETE route exists in the Tessera Worker for these collections. The gate system cannot erase its own history.

**Outbound interface.** The gate system writes to these collections on every check. The schema is specified in IS-TESSERA-ARANGO-SCHEMA.

**Inbound interface.** The Architect and Human Operator may query audit collections directly for operational review. Override frequency, gate-check coverage, and session-level gate usage are all derivable from the audit trail.

### 9.4 Tessera MCP server

Gates 1, 2, 4, and 5 are surfaced as MCP tools on the Tessera MCP server. Coding Agents call them through the MCP protocol in their harness environment. The MCP server handles authentication, rate limiting, and routing to the Tessera Worker.

**Outbound interface.** The Tessera MCP server registers the gate tools alongside the existing tools (query, context, impact, etc.). The gate tools are first-class tools in the server's tool manifest. IS-TESSERA-MCP specifies the full tool surface.

**Inbound interface.** Coding Agents call the gate tools by name. The MCP server routes the call, the Tessera Worker executes the gate logic, and the result is returned to the agent through the MCP protocol.

---

## 10. Measures of Operational Effectiveness

MOEs are the signals by which the gate system's operation is judged. They are not KPIs in the product-management sense; they are diagnostic indicators that the gate system is enforcing correctly, calibrating correctly, and producing trustworthy verdicts.

### 10.1 Coverage MOEs

**Gate invocation rate.** The fraction of code edits, commits, spec edits, and governance edits that were preceded by the appropriate gate call. The ideal rate is 100%. Any session where edits occurred without a preceding gate call is a coverage gap. Rising gap rates indicate AGENTS.md enforcement is failing or the agent is bypassing the gate.

**Gate-to-edit latency.** The time between a gate call and the subsequent edit. Extremely short latency (sub-second) may indicate the agent called the gate but did not read the verdict. This is a behavioral pattern worth investigating.

### 10.2 Verdict quality MOEs

**STOP rate by gate.** The fraction of gate calls that return STOP, per gate. A STOP rate that is too low suggests the gate is not calibrated to the actual risk profile of the work. A STOP rate that is very high may indicate over-sensitivity.

**Override rate by gate.** The fraction of STOP verdicts that result in Human Operator overrides. A low, stable override rate indicates the gates are well-calibrated: STOP fires when STOP is warranted. A rising override rate is the primary diagnostic signal of gate miscalibration or systematic over-restriction.

**Override-to-incident correlation.** Over time: do changes made with override approvals correlate with higher incident rates than changes that received PROCEED? If yes, the override rate is understating risk. If no, the overrides are likely legitimate judgments.

### 10.3 Incident prevention MOEs

**Incidents preceded by missing gate call.** For each incident involving a code or artifact change, was a gate call recorded for the relevant symbol before the change? Missing gate calls in incident post-mortems are the most direct evidence of gate system value — or its absence.

**Incidents preceded by override.** For each incident, if a gate was called, was it overridden? A cluster of incidents following overrides indicates that Human Operator override judgment needs calibration — either the operators are accepting too much risk or the impact reports are not communicating risk clearly enough.

### 10.4 Operational health MOEs

**Mean gate response time.** Time from gate call to verdict. Rising latency creates pressure for agents to skip gates. When response time trends up, the Tessera Worker or the graph database is the investigation target.

**Index freshness at gate-call time.** The fraction of gate calls where the index was current versus stale. Rising staleness indicates the indexing cadence needs to increase for actively-developed repositories.

**Audit collection availability.** The fraction of gate calls where the audit record was written successfully. Less than 100% indicates infrastructure issues that undermine the audit trail's completeness.

### 10.5 MOE review cadence

| MOE | Reviewed | By |
|---|---|---|
| Gate invocation rate | Per incident post-mortem | Architect |
| Override rate | Periodic operational review | Architect |
| Incident correlation | Quarterly | Architect |
| Gate response time | When degraded mode is triggered | Human Operator |
| Index freshness | On every UNKNOWN verdict | Coding Agent |

---

## 11. Transition Plan: Advisory → Mandatory

### 11.1 Current state

At the writing of this document, Tessera's tools are advisory. Agents may call `tessera_impact`, `tessera_detect_changes`, and related tools; AGENTS.md for the indexed repositories recommends calling them before edits. But AGENTS.md does not mandate it, no CI gate runs on pull requests, and agents that skip the advisory tools face no consequence.

The result is the pattern that produced the 2026-06-01 incident: advisory tools that are skipped precisely when context pressure is highest — when the agent is in the middle of a difficult debugging session, iterating quickly, and the thought of an extra tool call feels like friction rather than safety.

### 11.2 Desired state

In the desired state, the five gates are enforced:

- Every agent session in every indexed repository begins with the knowledge (from AGENTS.md) that gate calls are mandatory, not recommended.
- Gate 1 is called before every code symbol edit; Gates 4 and 5 before every spec and governance edit.
- Gate 2 is called before every commit.
- Gate 3 runs automatically on every PR via CI, regardless of what the agent did in the session.
- STOP verdicts require Human Operator override; overrides are logged immutably.
- Override frequency is reviewed by the Architect as a continuous system health signal.

No agent operates without the gate system's knowledge of what they are changing.

### 11.3 Transition sequence

The transition from advisory to mandatory proceeds in the following order, governed by the IS file dependency chain:

**Step 1 — Parser v2 ships.** IS-TESSERA-PARSER v2 delivers FunctionVariable extraction. This is required for Gate 1 to return reliable results on Go repositories where test seams are package-level function variables. Without v2, Gate 1 on those symbols returns UNKNOWN — a gate that cannot see the problem it was designed to prevent.

**Step 2 — Gate 1 enforced.** AGENTS.md for all active coding repositories is updated to include the mandatory pre-edit gate block. The gate tool is callable via MCP. The audit collection is active. At least one agent session is blocked by a STOP verdict and requires a Human Operator override — this is the operational validation that the gate is functioning as specified.

**Step 3 — Gate 2 enforced.** AGENTS.md is updated with the mandatory pre-commit gate block. Agents are blocked from committing without a Gate 2 check.

**Step 4 — Gate 3 active (CI).** The GitHub Actions workflow is deployed to all active repositories. The pre-merge route is live. The first PR with a HIGH or CRITICAL verdict produces a CI warning and a structured impact comment.

**Step 5 — Gates 4 and 5 enforced.** The IS-TESSERA-SPEC-ADAPTER and IS-TESSERA-GOVERNANCE-ADAPTER have indexed the relevant artifact sets. AGENTS.md is updated with mandatory spec-change and governance-change gate blocks.

**Completion criterion.** The transition is complete when: all five gates are enforced in production, at least one real STOP-to-override cycle has occurred for each gate, and the audit collections are receiving records from all active repositories.

### 11.4 Rollback

If a gate is found to be producing systematic false positives — stopping agents so frequently that the override rate is unacceptably high and the gates are creating more friction than the incidents they prevent — the response is calibration, not removal. The gate's IS file is revised with adjusted thresholds; the revision is documented in DECISIONS.md with the override-rate data that motivated it. Removing a gate entirely requires Architect decision and DECISIONS.md documentation of the reasoning.

---

## 12. Governance and Change Control

### 12.1 Change classes

Changes to the gate system are classified by what they affect:

**Class A — Behavioral changes.** Changes to a gate's decision logic, risk thresholds, or override protocol. These change what the gate returns for a given input. Class A changes require IS file revision, DECISIONS.md documentation, and Architect approval. They may require re-testing the gate against known scenarios.

**Class B — Operational changes.** Changes to AGENTS.md enforcement text, CI workflow configuration, audit collection structure, or gate tool registration. These do not change what the gate returns but change how the gate system is deployed and enforced. Class B changes require Architect review but not a new IS file version.

**Class C — Documentation changes.** Changes to this ConOps, the companion IS files' narrative sections, or reference materials that do not change the gate's behavior or deployment. Class C changes require review but not approval beyond the author's role.

### 12.2 Proposal mechanism

Non-Architect roles propose Class A or Class B changes through the DECISIONS.md mechanism. The proposal includes: the specific gate affected, the proposed change, the rationale (typically: override rate data, incident evidence, or a demonstrated false positive pattern), the alternatives considered, and the expected operational effect. The Architect approves, defers, or declines with documented reasoning.

No gate threshold is changed informally. An operator who disagrees with a gate's verdict in a specific instance may override. An operator who believes the gate is systematically miscalibrated escalates to the Architect with data, not with workaround habits.

### 12.3 This ConOps as a living document

This ConOps is reviewed:

- **When a new gate is specified.** The relevant sections are updated to include the new gate in all role, mode, scenario, and MOE discussions.
- **When a gate's IS file is revised.** The operational implications of the revision are reflected here.
- **When override-rate data indicates systematic miscalibration.** The relevant operational scenario and MOE sections are updated to reflect the recalibration.
- **When an incident post-mortem identifies a gap.** New scenarios may be added; existing scenarios may be revised.

Old versions remain in git history. An event under an earlier version of this ConOps is evaluated against the operational rules in effect at that time, not against current rules.

---

## Closing

The Tessera Gate System is the mechanism by which Tessera's knowledge — built at indexing time, complete at query time — is made unavoidable at the moment it matters: before the first edit, before the commit, before the merge. Advisory tools are skipped. Mandatory gates are not.

The five gates are not a bureaucracy. They are a recognition that coding agents operating under context pressure will take the path of least resistance. The gate system makes the safe path the default path. PROCEED is the easiest outcome — the one that requires nothing of the agent except calling the gate. STOP is the rare outcome that surfaces real risk and routes it to a human who can make a judgment the machine cannot.

The Human Operator is the system's conscience. The Coding Agent is the system's executor. The CI/CD System is the safety net for everything the agent missed. The Architect is the system's calibrator. Together, these roles operating under this ConOps constitute the gate system in operation.

The IS files describe the machine. This document describes how to run it.

---

## Revision history

- **v1 (2026-06-01):** Initial system spec (incorrect format). Written as a technical specification rather than a Concept of Operations.
- **v2 (2026-06-01):** Complete canonical rewrite. Operator-perspective narrative, role and mode doctrine, 8 operational scenarios, MOEs, transition plan. Authored by Wislet J. Celestin.
