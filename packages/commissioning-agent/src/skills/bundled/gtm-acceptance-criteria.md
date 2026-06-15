---
name: gtm-acceptance-criteria
description: GTM-engineering acceptance criteria for workgraph-authoring phase.
---

# GTM Acceptance Criteria

Used during workgraph-authoring phase to validate the authored WorkGraph before dispatch. Run all checks in order. A WorkGraph that fails any CHECK marked REJECT must not be dispatched — return it to authoring with the exact rejection message shown.

---

## Check 1: Pressure Node Has a GTM Metric

**Rule:** The `forcingCondition` in the pressure node must contain at least one measurable GTM metric. Acceptable metric types: conversion rate, MQL/SQL/opportunity volume, deal velocity (days in stage), average contract value (ACV), win rate, churn rate, sequence reply/open rate, NRR.

**Pass:** `forcingCondition` contains a specific numeric metric and either a baseline or a target.

**REJECT if:** `forcingCondition` contains only qualitative language.

Rejection message: `"CHECK-GTM-01 FAILED: Pressure node forcingCondition lacks a measurable GTM metric. Current value: '{current_forcingCondition}'. Required: a specific conversion rate, volume, or velocity metric with a numeric value. Example: 'MQL-to-SQL conversion at 12% vs. 18% Q1 baseline, 30-day trend.'"`

---

## Check 2: Capability Gap Is Quantified

**Rule:** The capability node must have:
- `currentCapabilityLevel` as a number between 0 and 10
- `requiredCapabilityLevel` as a number between 0 and 10
- The gap (`requiredCapabilityLevel - currentCapabilityLevel`) must be > 0

**Pass:** Both fields present, numeric, and gap > 0.

**REJECT if:** Either field is absent, non-numeric, or gap is 0.

Rejection messages:
- Missing fields: `"CHECK-GTM-02 FAILED: Capability node missing {field}. Both currentCapabilityLevel and requiredCapabilityLevel are required as numbers 0–10."`
- Gap is 0: `"CHECK-GTM-02 FAILED: Capability gap is zero (current = required = {value}). A WorkGraph with no capability gap should not be commissioned. Re-assess the Signal."`

---

## Check 3: Function Proposal Names a Specific Tool Surface

**Rule:** The function proposal's `toolSurface` must name a specific GTM tool category or named tool. Acceptable: "Salesforce CRM," "HubSpot," "Outreach.io," "Apollo.io," "Gong," "LinkedIn Sales Navigator," "Marketo," "Google Analytics 4," "Looker," etc.

**REJECT if:** `toolSurface` contains only generic terms like "software," "system," "platform," or "tool."

Rejection message: `"CHECK-GTM-03 FAILED: Function proposal toolSurface is too generic: '{current_toolSurface}'. Replace with a specific GTM tool name (e.g., 'Salesforce CRM', 'HubSpot', 'Outreach.io'). Check domainProfile.orgContext for tools already in use."`

---

## Check 4: All PRD Atoms Have Testable Acceptance Criteria

**Rule:** Each acceptance criterion in each atom must specify all three of:
1. What was measured (the metric)
2. How it was measured (the tool or method)
3. What threshold constitutes success

**Pass:** Criterion contains a metric + a measurement method + a threshold.

**REJECT if:** Any atom contains a criterion that is missing any of the three components.

Test each criterion against these REJECT forms:
- "Performance improves" → no metric, no method, no threshold → REJECT
- "Lead quality is better" → no metric, no method, no threshold → REJECT
- "Conversion rate increases" → no measurement method, no threshold → REJECT
- "CRM data is complete" → no threshold percentage, no field specification → REJECT

Rejection message: `"CHECK-GTM-04 FAILED: ATOM-{n} criterion '{criterion_text}' is not testable. Missing: {missing_components}. Required format: '[metric] meets/exceeds [threshold] as measured by [tool/method] within [time window].'"`.

Example passing criterion: `"MQL-to-SQL conversion rate ≥ 20% as measured in Salesforce pipeline report, averaged over 30-day window following function activation"`

---

## Check 5: INV-* Bindings Reference Pipeline-Stage Constraints

**Rule:** Each atom's `invariantBindings` must include at least one INV-* that references a stage-specific or process-specific constraint relevant to GTM execution. Generic invariants are not sufficient.

**Insufficient (advisory warning, not rejection):**
- `INV-quality-001` with text "outputs must be high quality" — too generic
- `INV-compliance-001` with text "must comply with company policies" — too generic

**Sufficient:**
- `INV-SQL-THRESHOLD-001`: "SQL status requires lead score ≥ 70 in Salesforce lead scoring field"
- `INV-ICP-FIT-001`: "Outbound enrollment requires ICP score ≥ 60 in scoring model"
- `INV-TERRITORY-001`: "Lead routing must assign to territory based on billing_state field in CRM"
- `INV-SEQUENCE-001`: "Sequence enrollment requires contact has not been active in a sequence in the last 90 days"

**REJECT if:** Any atom has zero INV-* bindings.

**WARNING (advisory, do not block) if:** All INV-* bindings are generic (no stage/process reference). Add: `"CHECK-GTM-05 WARNING: ATOM-{n} INV-* bindings are generic. Replace with stage-specific constraints (e.g., scoring threshold, routing rule, enrollment criteria) before production deployment."`

Rejection message for zero bindings: `"CHECK-GTM-05 FAILED: ATOM-{n} has no invariant bindings. Every GTM atom must have at least one INV-* binding specifying a pipeline constraint."`

---

## Check 6: Blocking Constraints Are Addressed

**Rule:** Every constraint in `domainProfile.constraints` with `severity: 'blocking'` must appear explicitly in at least one of:
- An atom's `acceptanceCriteria` (the criterion directly addresses the constraint)
- The capability node's `gapDescription`
- An atom's `invariantBindings` (the INV-* text references the constraint)

**Pass:** Each blocking constraint has at least one explicit reference in the WorkGraph.

**REJECT if:** Any blocking constraint is not addressed anywhere in the WorkGraph.

Rejection message: `"CHECK-GTM-06 FAILED: Blocking constraint '{constraint_id}: {constraint_text}' is not addressed in the WorkGraph. Add an atom or invariant that explicitly resolves this constraint before dispatch."`

---

## Check 7: Terminal Success Condition Exists and Is a Revenue/Funnel Metric

**Rule:** The PRD must contain exactly one atom designated as `terminalSuccessCondition`. That atom's acceptance criteria must include a measurable funnel or revenue metric — not a process completion criterion.

**Process completion (insufficient):**
- "Sequence enrollment complete" — this is a process metric, not a GTM outcome
- "CRM records updated" — process metric
- "Report generated" — process metric

**Funnel/revenue outcome (sufficient):**
- "MQL-to-SQL conversion rate ≥ 20% over 30-day window" — funnel metric
- "Pipeline value from target segment increased by ≥ $X in 60-day window" — revenue metric
- "Win rate against Competitor X improved from Y% to Z% over 8-week window" — funnel metric
- "Outbound sequence reply rate ≥ 6% over 30-day window" — engagement metric with commercial intent (acceptable for sequence decay pattern)

**REJECT if:** The PRD has no `terminalSuccessCondition` designation.

**REJECT if:** The terminal atom's criteria are process-completion only.

Rejection messages:
- No terminal atom: `"CHECK-GTM-07 FAILED: PRD has no terminalSuccessCondition. Designate the atom whose criteria represent the real-world GTM outcome (conversion rate, pipeline metric, win rate) as the terminal atom."`
- Process metric only: `"CHECK-GTM-07 FAILED: Terminal atom ATOM-{n} criteria are process-completion metrics only. The terminal success condition must be a funnel metric or revenue metric. Replace with: '[metric] meets [threshold] over [time window] as measured by [tool].'"`

---

## Check 8: No Unknown Tool Permissions

**Rule:** Every tool listed in any atom's `toolPermissions` must appear in the org's known toolset from `domainProfile.orgContext` OR must have been explicitly added to the permitted toolset for this WorkGraph.

**REJECT if:** Any atom's `toolPermissions` includes a tool not in the known toolset.

Rejection message: `"CHECK-GTM-08 FAILED: ATOM-{n} references tool '{tool_name}' which is not in the org's permitted toolset. Either remove this tool from toolPermissions or add it to the permitted toolset with appropriate permissions before dispatch."`

---

## Validation Output Format

When all checks pass:
```json
{
  "valid": true,
  "workGraphId": "WG-{nanoid8}",
  "checksRun": 8,
  "checksPassed": 8,
  "warnings": []
}
```

When checks fail:
```json
{
  "valid": false,
  "workGraphId": "WG-{nanoid8}",
  "checksRun": 8,
  "checksPassed": {n},
  "failures": [
    { "checkId": "CHECK-GTM-04", "atomId": "ATOM-2", "message": "..." }
  ],
  "warnings": [
    { "checkId": "CHECK-GTM-05", "atomId": "ATOM-1", "message": "..." }
  ]
}
```

Do not dispatch a WorkGraph with `valid: false`. Return it to authoring with the full failure list.
