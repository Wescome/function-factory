---
name: gtm-candidate-evaluation
description: GTM-engineering candidate scoring and nomination for deliberation phase.
---

# GTM Candidate Evaluation

Used during deliberation phase for gtm-engineering vertical. You produce 2–4 candidate function proposals, score each against the three criteria below, and nominate the best feasible candidate. Fewer than 2 candidates indicates insufficient deliberation — always produce at least 2.

---

## Scoring Criteria

Each candidate receives three scores (0–10). All scores must be justified with 1–2 sentences citing specific evidence from the Signal and DomainProfile. A score without justification is invalid.

---

### Criterion 1: Strategic Fit (0–10)

Does this candidate directly address the funnel stage or GTM gap named in the Signal?

| Score | Meaning |
|-------|---------|
| 9–10 | Candidate directly addresses the named funnel stage or ICP gap. Its success condition IS the metric named in the Signal. A human reading both the Signal and this candidate would immediately see the connection. |
| 7–8 | Candidate addresses the core GTM problem but the metric connection is indirect (e.g., Signal names SQL-to-close drop; candidate targets lead scoring quality which affects SQL pipeline volume rather than close stage directly). |
| 5–6 | Candidate is GTM-relevant but addresses an adjacent problem. Solving this candidate's problem might help the Signal's metric, but the connection requires multiple inferences. |
| 3–4 | Candidate is generically GTM-applicable (e.g., "improve CRM hygiene") but the Signal's specific metric is not in scope. Would not move the Signal's metric within 90 days. |
| 0–2 | Candidate is tangential or clearly misaligned. Examples: brand/awareness work when the Signal is a conversion drop; market research when the Signal is a sequence decay. |

---

### Criterion 2: Feasibility (0–10)

Can this candidate be built with the tools and permissions available in the org context?

| Score | Meaning |
|-------|---------|
| 9–10 | Candidate uses only tools/integrations already present in `domainProfile.orgContext`. No new vendor onboarding. No new API permissions. Can be built within a standard sprint. |
| 7–8 | Requires one new integration or one additional API permission not currently in org context. The integration is with a named, standard GTM tool (Salesforce, HubSpot, Apollo, Outreach, Gong, etc.). |
| 5–6 | Requires two or more new integrations, or requires data that is not currently captured in the org's systems. Feasible but with meaningful setup overhead. |
| 3–4 | Requires architectural changes to existing pipelines, custom data warehouse work, or significant permissions not in org context. Feasible only with extended timeline. |
| 0–2 | Requires capabilities Factory cannot provide: human relationship management, executive engagement, brand positioning, or direct sales execution. Mark `feasible: false`. |

---

### Criterion 3: Constraint Risk (0–10)

How likely is this candidate to encounter a blocking constraint from `domainProfile.constraints`?

Note: higher score = lower risk. Lower scores indicate higher constraint exposure.

| Score | Meaning |
|-------|---------|
| 9–10 | No blocking constraints in DomainProfile touch this candidate. Advisory constraints exist but do not block. |
| 7–8 | Candidate touches one advisory constraint. Addressable with a minor spec adjustment. |
| 5–6 | Candidate touches multiple advisory constraints or approaches (but does not clearly violate) a blocking constraint. Requires careful spec authoring. |
| 3–4 | Candidate may violate a blocking constraint depending on implementation details. Requires explicit constraint resolution before dispatch. |
| 0–4 | Candidate clearly violates a blocking constraint OR the org context does not contain enough information to assess constraint exposure. Must be marked `feasible: false`. |

**Auto-reject rule:** Any candidate with constraint risk ≤ 4 must be marked `feasible: false` with the note: `"Candidate may violate blocking constraint [{constraint-id}]: {constraint-text}. Cannot nominate without constraint resolution."`

---

## Nomination Rules

1. **Primary rule:** Nominate the candidate with the highest `(strategicFit + feasibility) / 2` score where `feasible: true` AND `constraintRisk > 4`.

2. **Tie-breaking:** If two candidates tie on `(strategicFit + feasibility) / 2`, nominate the one with higher strategic fit. If still tied, nominate the one with higher constraint risk (lower constraint exposure).

3. **Low-fit fallback:** If all feasible candidates have strategic fit < 5, nominate the best available candidate but add to `nominationReason`: `"No high-fit candidate identified. Best available option nominated. Human review recommended before dispatch — the Signal may not be addressable at this time."`

4. **No feasible candidates:** If all candidates are `feasible: false`, do not nominate. Return: `{ nominated: null, reason: "All candidates are infeasible given current constraints and toolset. Escalate to principal for Signal re-assessment." }`

5. **Minimum candidate count:** Always produce 2–4 candidates. If you can only identify 1 viable candidate concept, produce a second "stretch" candidate that is lower-fit or lower-feasibility but technically viable — mark it clearly as stretch. Do not produce only 1 candidate.

---

## Candidate Output Format

```json
{
  "id": "CND-{n}",
  "title": "string",
  "description": "string (2–4 sentences: what it builds, what problem it solves, what tool it uses)",
  "functionType": "automation|integration|report|workflow|alerting|validation|enrichment",
  "toolSurface": "string (specific tool name or category)",
  "scores": {
    "strategicFit": { "score": 0–10, "justification": "string" },
    "feasibility": { "score": 0–10, "justification": "string" },
    "constraintRisk": { "score": 0–10, "justification": "string" }
  },
  "compositeScore": "(strategicFit + feasibility) / 2",
  "feasible": true|false,
  "infeasibilityReason": "string|null"
}
```

Nomination:
```json
{
  "nominatedId": "CND-{n}",
  "nominationScore": 0–10,
  "nominationReason": "string (cite why this candidate was preferred over alternatives)"
}
```

---

## GTM-Specific Scoring Notes

**CRM-native candidates score higher on feasibility** when the org already uses a CRM named in the DomainProfile. Any candidate that requires only Salesforce or HubSpot native features scores 9–10 on feasibility.

**Sequence/outreach candidates:** If the Signal is P3 (sequence decay) and the candidate proposes building new sequences on the same platform, feasibility is 9–10 (no new integration). If it proposes migrating platforms, feasibility drops to 3–5.

**ICP scoring candidates:** If the org context includes an existing scoring model in the CRM, a candidate that extends it scores higher on feasibility than one that rebuilds from scratch.

**Conversion metric ownership:** If the Signal names a metric owned by a different team (e.g., "marketing owns MQL definition"), add an advisory note to the candidate: `"This candidate requires cross-functional alignment on metric ownership. Flag before dispatch."`

**Revenue-generating path priority:** Among candidates with equal composite scores, prefer the one whose terminal success condition is a revenue metric (ACV, pipeline value, close rate) over one whose terminal condition is a process metric (activity logged, sequence enrolled).
