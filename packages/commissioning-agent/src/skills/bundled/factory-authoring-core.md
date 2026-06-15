---
name: factory-authoring-core
description: Core governance authoring rules for the Function Factory I-layer. Loaded for every phase, every vertical.
---

# Factory Authoring Core

You produce governance artifacts for the Function Factory I-layer. This file is loaded for every phase and every vertical. Rules here are absolute — vertical-specific skill files may extend them but never override them.

---

## Artifact ID Formats

Every artifact you produce uses a stable nanoid8 suffix. Use these formats exactly — never invent alternative formats:

| Artifact type | ID format | Example |
|---|---|---|
| WorkGraph | `WG-{nanoid8}` | `WG-a4bX9mKz` |
| Pressure node | `PRE-{nanoid8}` | `PRE-7nRqW2pL` |
| Capability node | `CAP-{nanoid8}` | `CAP-mK3sD8vN` |
| Function proposal | `FP-{nanoid8}` | `FP-xQ5tB1cY` |
| PRD | `PRD-{nanoid8}` | `PRD-hJ9wE4rZ` |
| PRD atom | `ATOM-{n}` | `ATOM-1`, `ATOM-2` |
| Hypothesis | `HYP-{nanoid8}` | `HYP-2nLpA6qM` |
| Amendment | `AMD-{nanoid8}` | `AMD-8kSvF3dT` |
| Candidate | `CND-{n}` | `CND-1`, `CND-2` |
| EluciationEvent | `ELC-{nanoid8}` | `ELC-r5Ym7gWx` |

---

## Lineage Requirements (non-negotiable)

Every artifact you produce must carry all three lineage fields:

```
producedBy: CommissioningAgentDO:{orgId}
dispositionEventId: {ELC-* id from the active Signal}
producedAt: {ISO 8601 timestamp, e.g. 2026-04-14T09:31:00Z}
```

Rules:
- The `dispositionEventId` is sourced from the active Signal's ELC-* reference. It never changes within a single commission run.
- The `dispositionEventId` must propagate unchanged to every artifact in the chain — pressure, capability, function proposal, PRD, all atoms.
- Artifacts missing any of the three lineage fields are structurally invalid. Do not emit them. Return an error instead: `"Lineage field missing: {field}. Cannot emit artifact without complete lineage."`
- `producedAt` must be the time of production, not the time the Signal was received.

---

## WorkGraph Chain: Pressure → Capability → Function Proposal → PRD

Each WorkGraph is a directed chain. Each node must be complete before the next can be authored.

### Pressure node
The forcing function — what external or internal condition makes inaction costly.

Required fields:
```
id: PRE-{nanoid8}
title: string (max 80 chars, imperative phrase)
description: string (2-4 sentences, operational context)
forcingCondition: string (concrete metric, event, or dated obligation — NEVER vague)
urgency: 'immediate' | 'near-term' | 'long-term'
```

Rules:
- `forcingCondition` must be concrete. "Pipeline is slow" is invalid. "MQL-to-SQL conversion at 12% vs. Q1 baseline of 18%, 30-day trend" is valid.
- "Immediate" urgency = external deadline within 30 days or active SLA breach. "Near-term" = 31–90 days. "Long-term" = 90+ days or structural gap without hard deadline.
- A pressure node that could describe any org in the vertical is too vague. It must be specific to the signal data.

### Capability node
The gap the pressure creates — what the org cannot currently do.

Required fields:
```
id: CAP-{nanoid8}
title: string
gapDescription: string (what is absent, not what is needed)
affectedProcess: string (named operational process)
currentCapabilityLevel: number (0–10)
requiredCapabilityLevel: number (0–10)
```

Rules:
- `currentCapabilityLevel` must be < `requiredCapabilityLevel`. A gap of 0 means no capability gap exists — do not emit a capability node for a gap of 0.
- `affectedProcess` must name a real operational process, not a vague area: "MQL qualification workflow" not "sales process."
- A capability node that covers multiple distinct processes is too broad. Split into separate capability nodes, each with its own PRE-* parent.

### Function proposal
What Factory should build to close the capability gap.

Required fields:
```
id: FP-{nanoid8}
title: string
description: string
functionType: 'automation' | 'integration' | 'report' | 'workflow' | 'alerting' | 'validation' | 'enrichment'
toolSurface: string (specific tool category or named tool, e.g. "Salesforce CRM", "HL7 FHIR API", "Shopify Storefront API")
successCondition: string (testable — see testability rules below)
```

Rules:
- `toolSurface` must be specific. "Software" or "system" are not acceptable values.
- `successCondition` must be testable — see Testability Rules section below.
- A function proposal that could be built in any tooling context has no `toolSurface`. Fix it before emitting.

### PRD
Product requirements for the function proposal.

Required fields:
```
id: PRD-{nanoid8}
functionProposalId: FP-{nanoid8}
atoms: Atom[]  (minimum 1; each Atom has required fields — see below)
terminalSuccessCondition: ATOM-{n}  (reference to the atom that closes the WorkGraph)
```

Rules:
- A PRD with zero atoms is structurally invalid.
- `terminalSuccessCondition` must reference exactly one atom — the one that measures the real-world outcome, not process completion.
- Every atom must reference at least one INV-* binding. Atoms without INV-* bindings are invalid.

### PRD atom
Required fields:
```
id: ATOM-{n}
title: string
description: string
acceptanceCriteria: string[]  (minimum 1; each criterion must be testable — see rules)
invariantBindings: string[]  (minimum 1; e.g. ['INV-SQL-001'])
toolPermissions: string[]  (tools this atom is permitted to use; empty array = no tool access)
```

Rules:
- Each acceptance criterion must specify: what was measured, how it was measured, and what threshold constitutes success.
- Atoms may not reference tools not in their `toolPermissions` list. Unknown tools must be flagged, not silently included.
- If an atom's acceptance criteria cannot be made testable, the atom should not exist — surface the gap to the commissioning context instead.

---

## Testability Rules

"Testable" means a human or automated validator can unambiguously determine pass/fail.

REJECT these forms:
- "Performance improves" — not testable (no baseline, no metric, no tool)
- "Users are satisfied" — not testable (no measurement method)
- "System is faster" — not testable (no p-value, no threshold)
- "Compliance is achieved" — not testable (which regulation, which check, which validator)

ACCEPT these forms:
- "p95 latency reduced from 420ms to ≤200ms, measured by [monitoring tool] over 7-day window following deploy"
- "MQL-to-SQL conversion rate ≥20% as measured in Salesforce pipeline report within 30 days of function activation"
- "SAR filing submitted to FinCEN BSA E-Filing by [deadline date], confirmation number recorded in audit log"
- "Cart abandonment rate on mobile checkout ≤65% over 14-day window post-deploy, measured in [analytics platform]"

When a success condition is ambiguous between a target and a floor, treat it as a target (conservative scoping).

---

## Explicitness Rules

1. Never infer constraints from org context alone. If a constraint is not in `domainProfile.constraints`, it does not exist as a blocking constraint. Surface suspected constraints as `severity: 'advisory'` in the output, not as blocking.

2. Never generate atoms that reference tools not explicitly listed in `toolPermissions`. If the needed tool is not in the permitted toolset, flag it: `"Tool '{toolName}' is required for this atom but is not in the org's permitted toolset. Add it or remove the atom."`

3. When a Signal metric is ambiguous (target vs. floor), treat as target — this is more conservative for WorkGraph scope.

4. When a Signal describes a gap but does not name the affected process, ask for clarification rather than inferring the process. A WorkGraph built on an inferred process may be misaligned.

5. Never produce two atoms that cover the same acceptance criterion. Duplication inflates scope and creates conflicting execution paths.

---

## Amendment Without Attribution: Prohibition

A WorkGraph amendment (AMD-*) must NEVER be proposed unless a HypothesisNode with a non-null `faultAttribution` exists and is linked.

Required fields on any amendment:
```
id: AMD-{nanoid8}
hypothesisId: HYP-{nanoid8}  (must reference a real, existing HYP-* id)
faultCategory: 'SPECIFICATION_GAP' | 'TOOLING_FAILURE' | 'INVARIANT_MISMATCH' | 'ENVIRONMENTAL'
amendmentScope: 'add-atom' | 'modify-atom' | 'add-invariant' | 'modify-invariant' | 'none'
justification: string (evidence chain from Divergence trace, not assertion)
```

Rules:
- If `faultCategory` is `ENVIRONMENTAL`, `amendmentScope` must be `'none'`. An external system failing never justifies a specification change.
- If `faultCategory` is `ENVIRONMENTAL` and the operation was time-sensitive (payment, regulatory deadline, patient routing), set `severity: 'blocking'` on the Hypothesis to trigger escalation — but still set `amendmentScope: 'none'`.
- If `hypothesisId` does not reference a real HYP-*, the amendment is invalid. Reject it.
- The four fault categories are exhaustive. Every Divergence maps to exactly one. When evidence points to two, choose the one that is more directly responsible for the failure outcome.

---

## Constraint Handling

Constraints come from `domainProfile.constraints`. Each constraint has a `severity` field:
- `'blocking'`: This constraint must be addressed before the WorkGraph can be dispatched. If unaddressed, return the WorkGraph to authoring.
- `'advisory'`: Surface the constraint in the WorkGraph commentary. Do not block dispatch.

When a Signal implies a constraint not in `domainProfile.constraints`:
- Do not treat it as blocking.
- Add it to the WorkGraph as an advisory note with the text: `"Suspected constraint from Signal [ELC-*]: {description}. Not in DomainProfile — treating as advisory. Confirm with principal before dispatch."`

---

## Structural Invariants (apply to all verticals)

INV-CORE-001: Every WorkGraph must have exactly one terminal atom, designated in `prd.terminalSuccessCondition`.
INV-CORE-002: Every atom's `acceptanceCriteria` must contain at least one criterion that references a measurable metric.
INV-CORE-003: No atom may be its own predecessor in the execution chain. Circular dependencies are structurally invalid.
INV-CORE-004: The `dispositionEventId` must be identical across all artifacts in a single WorkGraph chain.
INV-CORE-005: A WorkGraph with zero atoms in its PRD must not be dispatched under any circumstances.

---

## Output Format

When producing a WorkGraph chain, emit artifacts in order:
1. Pressure node (PRE-*)
2. Capability node (CAP-*)
3. Function proposal (FP-*)
4. PRD with atoms (PRD-*, ATOM-*)

When producing a Hypothesis, emit:
1. HypothesisNode (HYP-*)
2. Amendment if warranted (AMD-*) — ONLY if faultCategory is not ENVIRONMENTAL

When producing candidate evaluations, emit:
1. Candidates array (CND-1, CND-2, …)
2. Nomination with `nominatedId`, `nominationScore`, `nominationReason`

All outputs must be valid JSON or YAML matching the schema defined in the commissioning agent's type definitions. Do not emit markdown prose as output artifacts — prose belongs in `description` fields, not at the artifact level.
