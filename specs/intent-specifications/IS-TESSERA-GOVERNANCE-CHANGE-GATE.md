---
id: IS-TESSERA-GOVERNANCE-CHANGE-GATE
version: 1
title: "Tessera Governance Change Gate — Blast-radius check on the governance graph before changing any PDP rule, classification rule, or autonomy tier"
sourceCapabilityId: BC-TESSERA-GOVERNANCE-CHANGE-GATE
sourceFunctionId: FP-TESSERA-GOVERNANCE-CHANGE-GATE
source_refs:
  - TESSERA-GATE-CONOPS
  - IS-TESSERA-PRE-EDIT-GATE
  - IS-TESSERA-GOVERNANCE-ADAPTER
  - IS-TESSERA-SKILLS-ADAPTER
  - IS-TESSERA-IMPACT
explicitness: explicit
rationale: >
  Governance changes are the hardest failures to debug because they manifest as
  silent DENY responses scattered across unrelated skill invocations. Changing a
  PDP rule, a classification rule, a taxonomy purpose, or an autonomy tier can
  break tool invocations across the entire system with no compile error and no
  obvious cause. The pre-edit gate (Gate 1) protects code symbols; it is blind
  to governance artifacts, which live in the governance graph built by
  IS-TESSERA-GOVERNANCE-ADAPTER (Purpose, ClassificationRule, Tier nodes) and
  connect to skills through GOVERNS edges.

  The 2026-04-16 kdense harness run is the proof case. 938 of 1340 assertions
  failed because a single T0/T1 autonomy-tier issue affected every skill's TC-01
  and TC-02 test cases — every skill that invokes `tool.invoke` under that tier.
  No tool surfaced that blast radius before the change was made. A 938-failure
  cascade traced to one tier change is exactly the failure mode a governance
  blast-radius gate exists to prevent.

  Per TESSERA-GATE-CONOPS §3 (Gate 5) and §4, governance changes flow through
  Gate 5 instead of Gate 1. This IS specifies Gate 5: before an engineer changes
  any governance artifact, the gate traverses GOVERNS edges from the target
  through Purpose to the governed skills and reports the affected-skill count.
  Tier changes are special-cased: because any autonomy-tier change affects every
  skill invoking `tool.invoke` under that tier, a tier change always STOPs
  regardless of count, as the 938-failure incident proved.
---

# Tessera Governance Change Gate

## JTBD

When an engineer is about to change a governance artifact (PDP rule,
classification rule, autonomy tier, taxonomy purpose), they want to know which
skills, purposes, and role bindings are affected, so governance changes don't
silently break tool invocations across the system.

## Problem

Governance is the Factory's hardest blast radius to see and its hardest failure
to debug. A code change that breaks a function produces a compile error or a
failing test pointed at the function. A governance change that breaks tool
invocation produces a silent DENY at runtime, in a skill that may have nothing
visibly to do with the artifact that changed. The cause is buried in the
governance graph: a ClassificationRule governs a Purpose, the Purpose governs a
set of Skills, and every skill in that set silently loses access.

The 2026-04-16 kdense harness run is the canonical incident. A T0/T1 autonomy
tier issue affected every skill's TC-01 and TC-02 test cases, producing 938
failures out of 1340 assertions. The blast radius — every k-dense skill that
invokes `tool.invoke` under the affected tier — was knowable from the governance
graph, but no tool surfaced it before the change landed. The failure looked like
938 unrelated skill bugs; it was one governance change.

The pre-edit gate cannot catch this. Governance artifacts are not code symbols;
they are Purpose, ClassificationRule, and Tier nodes in the governance graph
built by IS-TESSERA-GOVERNANCE-ADAPTER, connected to skills (indexed by
IS-TESSERA-SKILLS-ADAPTER) through GOVERNS edges. What is missing is a gate that
traverses those edges before the change and STOPs when the affected-skill count
is high — and always STOPs for tier changes, which are categorically
high-blast-radius.

## Goal

1. Implement a **governance-change gate function** (`checkGovernanceChangeGate`)
   in the Tessera Worker that engineers MUST call before editing any governance
   artifact. The gate:
   - Resolves the target governance node (ClassificationRule, Purpose, or Tier)
     in the governance graph
   - Traverses GOVERNS edges from ClassificationRule → Purpose → governed Skills
   - Returns a structured `GovernanceChangeGateResult` (PROCEED / WARN / STOP)
     driven by affected-skill count, with Tier changes always STOP
2. Expose `POST /repos/:slug/governance-change-check` accepting
   `{ target: "ClassificationRule:TREATMENT:CARE_COORDINATION" }` or
   `{ target: "Tier:T0" }`, and `tessera_governance_change_check` as an MCP tool.
3. Produce a **gate audit log** entry in ArangoDB for every call:
   `tessera_governance_change_gates` collection. Immutable.

## Scope

**In scope:**
- `workers/tessera-worker/src/governance-change-gate.ts` —
  `checkGovernanceChangeGate()` + HTTP route
  `POST /repos/:slug/governance-change-check`
- `workers/tessera-worker/src/mcp.ts` — register
  `tessera_governance_change_check`
- `workers/tessera-worker/src/schema.ts` — `tessera_governance_change_gates`
  collection (append-only, no DELETE route)

**Out of scope:**
- Any change to IS-TESSERA-GOVERNANCE-ADAPTER or IS-TESSERA-SKILLS-ADAPTER
  graph-building logic (they own the governance and skills graphs; this gate
  consumes them)
- Any change to the `tessera_impact` engine itself
- Resolving the underlying T0/T1 tier issue from the 2026-04-16 incident (that
  is a governance-content fix, not a gate concern; the gate surfaces it)
- Code-symbol or spec-artifact gating (those are Gate 1 and Gate 4)

## Acceptance Criteria

### Gate logic (AC-GC*)

**AC-GC1.** `POST /repos/:slug/governance-change-check` accepts a governance
target identified by type-qualified key:
```json
{ "target": "ClassificationRule:TREATMENT:CARE_COORDINATION" }
```
or
```json
{ "target": "Tier:T0" }
```

**AC-GC2.** For a ClassificationRule or Purpose target, the gate traverses
GOVERNS edges ClassificationRule → Purpose → governed Skills and returns the
affected-skill count and the affected purposes:
```json
{
  "decision": "STOP",
  "target": "ClassificationRule:TREATMENT:CARE_COORDINATION",
  "affectedPurposes": ["CARE_COORDINATION", "..."],
  "governedSkillCount": 12,
  "sampleSkillIds": ["skill-care-intake", "skill-care-handoff", "..."],
  "message": "12 skills governed by this classification rule. Human review required before change."
}
```

**AC-GC3.** For a ClassificationRule or Purpose change, affected-skill count
maps to a decision:

| Affected skills | Risk | Decision |
|-----------------|------|----------|
| >= 50 | CRITICAL | STOP |
| >= 10 | HIGH | STOP |
| 1–9 | MEDIUM | WARN |
| 0 | LOW | PROCEED |

**AC-GC4.** For a **Tier** target, the gate ALWAYS returns STOP regardless of
count. Any autonomy-tier change affects every skill that invokes `tool.invoke`
under that tier, as proven by the 2026-04-16 938-failure incident. The response
states the count for context but the decision is STOP unconditionally:
```json
{
  "decision": "STOP",
  "target": "Tier:T0",
  "reason": "Tier changes always STOP — they affect every skill invoking tool.invoke under this tier.",
  "governedSkillCount": 134
}
```

**AC-GC5.** The response includes: the affected purposes list, the governed
skills count, and a sample of affected skill IDs, so the engineer can scope the
change and notify owners before proceeding.

**AC-GC6.** Every `governance-change-check` writes a document to
`tessera_governance_change_gates` (append-only): target, affected purposes,
governed skill count, sample skill IDs, decision, agentId, timestamp. There is
NO DELETE route. Immutable.

**AC-GC7.** When the governance-adapter or skills-adapter index is stale or
absent, the gate returns `WARN` with the explicit message "Governance/skills
index is stale or absent — re-index before this check is authoritative." It MUST
NEVER return `PROCEED` against a stale governance index. (Tier targets still
return STOP per AC-GC4.)

### MCP tool (AC-MCP*)

**AC-MCP1.** `tessera_governance_change_check` is registered as an MCP tool.
Input schema matches AC-GC1. Output schema matches AC-GC2 / AC-GC4.

### Reference case (AC-REF*)

**AC-REF1.**
`tessera_governance_change_check({ target: "Tier:T0", repo: "weops-enterprise" })`
returns `decision: "STOP"`, affecting all 134 k-dense skills that use
`tool.invoke` under T0. The audit log records the STOP, the governed-skill
count, and the tier-always-STOP reason. This is the gate that would have
surfaced the 2026-04-16 blast radius before the change.

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var | Database name |
| `TESSERA_QUERY_TOKEN` | secret | Bearer auth |

Inherits the governance graph from IS-TESSERA-GOVERNANCE-ADAPTER, the skills
graph from IS-TESSERA-SKILLS-ADAPTER, and the impact engine from
IS-TESSERA-IMPACT. No new env vars. **Hard dependency:** both the governance and
skills adapters must be deployed and indexing for this gate to function.

## Non-negotiables

- **Tier changes always STOP**, regardless of affected-skill count. The
  938-failure incident proves a tier change is categorically high blast radius.
- ClassificationRule and Purpose changes are evaluated by affected-skill count:
  >=10 STOP, 1–9 WARN, 0 PROCEED. The gate does not auto-proceed on a
  HIGH/CRITICAL count.
- This gate only works when the governance and skills indexes are current. A
  stale or absent index returns WARN, never PROCEED (Tier targets still STOP).
- `tessera_impact` over the governance graph is the engine; the gate is the
  enforcement layer over it, not a replacement.
- The audit log is immutable. There is no API to delete or modify gate entries.
- Per TESSERA-GATE-CONOPS §5, the risk→decision mapping, audit-trail
  immutability, and AGENTS.md enforcement contracts are shared across all five
  gates and apply here unchanged.

## Success Metrics

The 2026-04-16 class of incident — a governance change that silently breaks tool
invocation across hundreds of skills — cannot recur:

1. An engineer changing autonomy tier T0 in weops-enterprise receives STOP and
   the count of every affected k-dense skill before the change lands.
2. A classification-rule change surfaces the governed purposes and skills, so
   the engineer scopes the change and notifies owners with full visibility.
3. The 938-failure cascade collapses to a single STOP at the gate, with the
   blast radius named up front instead of discovered across 938 assertions.
4. The audit log records which governance changes carried the largest blast
   radius across the skill set.
