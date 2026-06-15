---
name: gtm-signal-pattern-library
description: GTM-engineering signal pattern library for pattern-appraisal phase.
---

# GTM Signal Pattern Library

Used during pattern-appraisal phase for gtm-engineering vertical. Your task: match the incoming Signal against the patterns below, return `{ matches: true|false, patternId: 'P1'|..., reason: string }`. Default to `matches: false` on ambiguous signals — it is better to archive than to commission a WorkGraph that wastes execution budget on a non-addressable problem.

---

## Core Appraisal Questions

Before matching any pattern, answer these two questions from the Signal text:

1. Can I write a Pressure node with a concrete `forcingCondition` from this Signal? If the forcing condition would have to be fabricated or inferred beyond what the Signal states, answer is No — the Signal is not addressable.

2. Does the Signal describe something Factory can build (automation, workflow, report, integration, enrichment) or something it cannot (market research, brand strategy, relationship building, executive decision-making)? If the latter, the Signal is not addressable.

If either answer is No, return `{ matches: false, patternId: 'P-UNACTIONABLE', reason: "..." }` before checking individual patterns.

---

## Pattern Library

### P1 — Pipeline Conversion Drop

**Match condition:**
Signal contains all three:
- A specific funnel stage named (e.g., "MQL-to-SQL," "SQL-to-opportunity," "opportunity-to-close")
- A conversion metric with a numeric value (rate, count, or ratio)
- A timeframe or baseline delta (before/after, quarter-over-quarter, vs. target)

**Example matching signals:**
- "MQL-to-SQL conversion fell from 18% to 12% over the past 30 days"
- "SQL-to-close rate is 14%; our target is 22%; we've been below target for 2 quarters"
- "Only 40% of qualified opportunities are advancing to demo stage within 5 business days"

**Boundary conditions — do NOT match:**
- "Pipeline is slow" — no metric, no stage named → P-UNACTIONABLE
- "Sales is struggling this quarter" — no conversion metric → P-UNACTIONABLE
- "We need more leads" — demand generation problem, not a conversion drop → P-UNACTIONABLE (route to P2 check)

**Discriminator:** Is there a measurable delta (before/after, or target/actual) at a named funnel stage? If yes → P1 matches. If no → not addressable.

**Factory response:**
- Pressure node: forcingCondition = named conversion metric + delta + timeframe
- Capability node: inability to qualify or advance leads at required rate at the named stage
- Function proposal: functionType = 'workflow' or 'automation', toolSurface = CRM or outreach platform name from Signal
- PRD terminal atom: conversion rate at named stage meets or exceeds target, measured in CRM over 30-day window

---

### P2 — ICP Definition Gap

**Match condition:**
Signal contains at least one of:
- Explicit absence of documented ICP criteria ("we don't have a defined ICP", "no documented qualification criteria")
- Mixed close rates across segments with no segment-qualification logic documented
- High early churn (< 90 days) correlated with a specific customer segment, suggesting ICP mismatch rather than pipeline mechanics
- Outbound targeting multiple segments with no scoring or prioritization rules

**Example matching signals:**
- "We're selling to SMBs and mid-market with no documented difference in approach — close rates vary wildly"
- "Our top 20% of customers by LTV have completely different profiles from the rest; we don't know why"
- "New customers from the healthcare segment are churning at 60% in 90 days; our ICP was written 2 years ago"

**Boundary conditions — do NOT match:**
- "We need more leads" — demand generation, not ICP definition → P-UNACTIONABLE unless combined with segment confusion evidence
- "Sales isn't qualifying well" — execution issue, not an ICP definition gap unless qualification criteria are documented to be absent
- "We're losing deals" — go to P4 (competitive displacement) first; ICP gap requires evidence of segment confusion or absent documentation

**Discriminator:** Does the Signal reference (a) absent/outdated ICP documentation, (b) segment confusion with evidence (mixed close rates, early churn correlated to segment), or (c) no scoring/prioritization between segments? Yes to any → P2 matches.

**Factory response:**
- Pressure node: forcingCondition = segment churn metric or missing ICP documentation + business cost
- Capability node: inability to score/prioritize leads by fit at required accuracy
- Function proposal: functionType = 'report' or 'workflow', toolSurface = CRM + any scoring tool named in Signal
- PRD terminal atom: ICP scoring model applied to all new inbound, close rate for top-ICP segment meets target over 60-day window

---

### P3 — Outbound Sequence Decay

**Match condition:**
Signal contains all three:
- Named outbound sequence or channel (email, LinkedIn, cold call cadence)
- A decay metric (open rate decline, reply rate decline, bounce rate increase)
- A time window showing the decay trend (minimum 30 days of data)

**Example matching signals:**
- "Email open rates on our primary outbound sequence dropped from 34% to 18% over the last 6 weeks"
- "LinkedIn sequence reply rate has been declining for 45 days — now at 2.1% vs. 6% six months ago"
- "Our cold call connect rate fell 40% in Q1; we haven't changed our sequence in 8 months"

**Boundary conditions — do NOT match:**
- Single-week open rate blip — insufficient trend data → surface as advisory, not P3
- General "outreach isn't working" without a metric → P-UNACTIONABLE
- Decline caused by identified technical issue (SPF/DKIM problem, domain blacklist) → ENVIRONMENTAL fault, not a WorkGraph addressable signal

**Discriminator:** Is there 30+ days of a specific decay metric on a named outbound channel? Yes → P3 matches. Less than 30 days → advisory only.

**Factory response:**
- Pressure node: forcingCondition = named metric decay + duration + volume affected
- Capability node: inability to maintain reply/open rate above floor threshold
- Function proposal: functionType = 'workflow', toolSurface = outreach platform name from Signal (e.g., "Outreach.io," "Apollo.io," "Salesloft")
- PRD terminal atom: sequence open rate or reply rate returns to target threshold over 30-day post-deploy window

---

### P4 — Competitive Displacement Signal

**Match condition:**
Signal contains all three:
- A specific competitor named (not "competitors in general")
- At least 2 deal references where that competitor won
- A common loss reason pattern (price, feature gap, relationship, implementation complexity)

**Example matching signals:**
- "We lost 7 deals to Competitor X in Q1 — all cited missing [Feature Y] as the deciding factor"
- "Gong recordings from 3 lost deals show the same objection: Competitor X offers dedicated onboarding; we don't"
- "Competitor X is undercutting us by 30% on initial contract; we lose every head-to-head where price is mentioned first"

**Boundary conditions — do NOT match:**
- "We're losing to competitors in general" — no named competitor, no pattern → P-UNACTIONABLE
- Single deal loss to a competitor — no pattern established, insufficient for WorkGraph → advisory note only
- General "we need better competitive intelligence" — market research request, not a WorkGraph signal → P-UNACTIONABLE

**Discriminator:** Named competitor + 2+ deal losses with a common reason? Yes → P4 matches.

**Factory response:**
- Pressure node: forcingCondition = named competitor + named loss reason + count of affected deals
- Capability node: inability to counter named competitor's advantage in deals where the advantage is raised
- Function proposal: functionType = 'report' or 'workflow', toolSurface = CRM (battlecard distribution) + call recording tool if named
- PRD terminal atom: win rate against named competitor improves by X% over 60-day window in deals where loss reason was raised

---

### P5 — Tool Adoption Failure

**Match condition:**
Signal contains:
- A specific GTM tool named (CRM, sales engagement platform, forecasting tool)
- A data quality or adoption metric (usage rate, data completeness %, field population rate)
- Evidence that the adoption failure is blocking a downstream business process (forecasting, pipeline reporting, outbound execution)

**Example matching signals:**
- "Salesforce data is 40% complete — activity logging is manual and being skipped; our pipeline report is unreliable"
- "HubSpot contact records missing company data in 60% of cases; enrichment was supposed to run on import but isn't"
- "Our outreach platform has a 35% sequence enrollment rate — 65% of SDRs are using personal email instead"

**Boundary conditions — do NOT match:**
- General "the team doesn't like the tool" — sentiment, not a metric → P-UNACTIONABLE unless adoption metric is provided
- "CRM is too complicated" — UX/training issue outside Factory scope unless the signal names a data completeness metric that affects a downstream process

**Discriminator:** Named tool + adoption/data quality metric + downstream business process being blocked? All three → P5 matches.

**Factory response:**
- Pressure node: forcingCondition = data completeness or adoption rate metric + downstream process being blocked
- Capability node: inability to produce accurate pipeline data or execution tracking at required completeness level
- Function proposal: functionType = 'automation' or 'integration', toolSurface = named tool
- PRD terminal atom: data completeness at ≥ target % or adoption rate at ≥ target % over 30-day window

---

### P-UNACTIONABLE — Market Noise / Non-Addressable

**Match condition (any of):**
- Signal describes general market trends, macro conditions, analyst reports without a specific operational metric
- Signal asks for "more leads" without specifying a conversion problem or ICP gap
- Signal describes brand perception, social media sentiment, or share of voice
- Signal describes a strategic decision (pricing strategy, product roadmap, geographic expansion) that Factory cannot automate
- Signal describes relationship-building or executive engagement activities

**Return:**
```json
{
  "matches": false,
  "patternId": "P-UNACTIONABLE",
  "reason": "Signal lacks a measurable operational metric or conversion target. Factory cannot author a WorkGraph without a concrete funnel stage gap, sequence decay metric, or ICP documentation gap. Specify: which stage, what metric, what target."
}
```

---

## Appraisal Decision Rules

1. Match against P1–P5 in order. Stop at first match.
2. If no pattern matches, return P-UNACTIONABLE — do not stretch a pattern to fit.
3. If signal matches multiple patterns (e.g., P1 + P4 together), return the pattern with the more specific forcing condition. Add a note in `reason`: "Signal also contains elements of P{n} — consider commissioning a second WorkGraph if priority permits."
4. For signals that are borderline (e.g., 25 days of decay data for P3 threshold), return the signal as advisory: `{ matches: false, patternId: 'P-BORDERLINE', reason: "Insufficient trend data for P3. Recommend re-evaluating in 5 days when 30-day window is complete." }`
5. Never fabricate missing metric data to make a signal match a pattern. If the metric is not in the Signal, it does not exist.
