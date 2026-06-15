---
name: healthcare-candidate-evaluation
description: Healthcare-operations candidate scoring and nomination for deliberation phase.
---

# Healthcare Candidate Evaluation

Used during deliberation phase for healthcare-operations vertical. Produce 2–4 candidates, score each on three criteria, and nominate the best feasible candidate. Fewer than 2 candidates indicates insufficient deliberation.

---

## Pre-Evaluation Safety Gate

Before scoring any candidate, check it against these auto-reject conditions:

**Auto-reject condition 1: Clinical decision logic**
If the candidate's `description` or implied function would modify clinical decision-making (selecting diagnoses, choosing treatments, dosing medications, determining admission or discharge criteria on clinical grounds):

```
feasible: false
infeasibilityReason: "Candidate modifies clinical decision logic. Factory does not commission clinical protocol changes regardless of score. Remove or reclassify this candidate."
```

**Auto-reject condition 2: PHI in non-HIPAA toolset**
If the candidate requires storing, transmitting, or processing PHI (Protected Health Information) using a tool not in the org's HIPAA-permitted toolset (`domainProfile.orgContext.hipaaPermittedTools` or equivalent):

```
feasible: false
infeasibilityReason: "Candidate requires PHI handling in a tool not listed in the org's HIPAA-permitted toolset: '{tool_name}'. Either remove the PHI requirement or confirm HIPAA BAA coverage for this tool before commissioning."
```

---

## Scoring Criteria

Each candidate receives three scores (0–10). All scores require a 1–2 sentence justification citing the Signal and DomainProfile.

---

### Criterion 1: Patient Outcome Impact (0–10)

Does this candidate directly or indirectly improve patient care outcomes?

| Score | Meaning |
|-------|---------|
| 9–10 | Candidate directly reduces a measured patient harm indicator named in the Signal: readmission rate, adverse event frequency, missed follow-up rate, care delay linked to patient harm. The terminal success condition is a patient outcome metric. |
| 7–8 | Candidate improves care delivery throughput or coordination in a way that reliably translates to better patient outcomes (faster throughput reduces boarding risk, better handoffs reduce readmissions). Connection is one inference step. |
| 5–6 | Candidate improves clinical staff workflow efficiency with indirect patient outcome benefit (less documentation burden = more time with patients). Two inference steps to patient outcome. |
| 3–4 | Candidate is administrative or financial with no direct patient-facing dimension. |
| 0–2 | Candidate is purely operational (infrastructure, vendor management, IT configuration) with no clinical or patient dimension. |

---

### Criterion 2: Compliance Risk Reduction (0–10)

Does this candidate reduce or close a regulatory compliance gap?

| Score | Meaning |
|-------|---------|
| 9–10 | Candidate closes a named regulatory gap with a specific regulation reference and an imminent deadline. Not commissioning this candidate exposes the org to regulatory penalty. This score triggers PRIORITY nomination — see nomination rules. |
| 7–8 | Candidate reduces compliance burden materially (improves audit trail, automates required reporting, reduces documentation denial rate for CMS billing). Named regulation is relevant. |
| 5–6 | Candidate improves compliance posture indirectly (better data quality supports future audits, more complete EHR records support regulatory review). |
| 3–4 | Compliance benefit is incidental. Named regulation is not at material risk from this gap. |
| 0–2 | No compliance dimension. |

**Compliance priority escalation:** If compliance risk reduction = 9–10, add `"COMPLIANCE-PRIORITY": true` to the candidate and note it in nomination reason. This candidate must be nominated or explicitly rejected with documented reasoning — it cannot be silently deprioritized.

---

### Criterion 3: Feasibility (0–10)

Can this candidate be built within the healthcare org's existing technical and operational constraints?

| Score | Meaning |
|-------|---------|
| 9–10 | Implements using existing EHR/EMR integrations and standard healthcare APIs (HL7 v2, FHIR R4, EHR-native workflow rules) already confirmed in `domainProfile.orgContext`. No new vendor onboarding. HIPAA toolset requirements met. |
| 7–8 | Requires one new integration module (e.g., a new EHR API endpoint, a third-party clinical communication platform, a care coordination SaaS) with standard HIPAA BAA coverage. Feasible with moderate setup effort. |
| 5–6 | Requires EMR customization beyond standard configuration, multi-system data pipeline, or data from a system not currently integrated. Feasible with extended setup. |
| 3–4 | Requires EHR vendor customization, new PHI data processing agreements, or significant technical infrastructure not in org context. High setup risk. |
| 0–2 | Requires changes to clinical protocols, requires physician workflow changes without clinical leadership approval, or requires capabilities Factory cannot provide. Mark `feasible: false`. |

---

## Nomination Rules

1. **Primary rule:** Nominate the candidate with highest `(patientOutcomeImpact + feasibility) / 2` where `feasible: true`.

2. **Compliance priority override:** If any feasible candidate has `COMPLIANCE-PRIORITY: true` (compliance risk reduction = 9–10), that candidate must be nominated, even if another candidate has a higher composite score. Compliance obligations with deadlines override optimization of patient impact scores. Note in `nominationReason`: `"COMPLIANCE-PRIORITY nomination: regulatory gap with imminent deadline overrides composite score comparison."`

3. **Tie-breaking:** If two candidates tie on `(patientOutcomeImpact + feasibility) / 2`, prefer the one with higher compliance risk reduction. If still tied, prefer the one with higher patient outcome impact.

4. **Low-impact fallback:** If all feasible candidates have patient outcome impact < 5 AND compliance risk reduction < 5, nominate the best available but add to `nominationReason`: `"Low patient outcome and compliance impact. Recommend human review of signal validity — Factory may be misapplied to this signal. Consider whether this is a strategic/organizational problem rather than an operational automation opportunity."`

5. **No feasible candidates:** Return `{ nominated: null, reason: "All candidates are infeasible. Blocking constraints or clinical protocol requirements prevent Factory commissioning. Escalate to principal and clinical governance." }`

6. **Minimum candidates:** Always produce 2–4. If only 1 concept is viable, produce a second lower-feasibility candidate and mark it as stretch.

---

## Candidate Output Format

```json
{
  "id": "CND-{n}",
  "title": "string",
  "description": "string (2–4 sentences: what clinical/operational workflow it targets, what it automates, what tool it uses)",
  "functionType": "automation|integration|report|workflow|alerting|validation",
  "toolSurface": "string (specific EHR module, FHIR API, clinical platform name)",
  "compliancePriority": true|false,
  "scores": {
    "patientOutcomeImpact": { "score": 0–10, "justification": "string" },
    "complianceRiskReduction": { "score": 0–10, "justification": "string" },
    "feasibility": { "score": 0–10, "justification": "string" }
  },
  "compositeScore": "(patientOutcomeImpact + feasibility) / 2",
  "feasible": true|false,
  "infeasibilityReason": "string|null"
}
```

Nomination:
```json
{
  "nominatedId": "CND-{n}",
  "nominationScore": 0–10,
  "nominationReason": "string",
  "compliancePriorityApplied": true|false
}
```

---

## Healthcare-Specific Scoring Notes

**FHIR-native candidates score higher on feasibility** when the EHR in org context supports FHIR R4 (Epic, Cerner, Meditech Expanse all support it). FHIR-based integration candidates score 8–9 on feasibility vs. 5–6 for HL7 v2 point-to-point integrations (more setup required).

**EHR workflow rule candidates:** Candidates that use EHR-native workflow rules (Epic BPAs, Cerner PowerPlans) score 9–10 on feasibility — no integration needed, minimal HIPAA surface expansion.

**Care coordination platform candidates:** If the org context includes a named care coordination platform (Klara, Phynd, Relatient, Strata Health), candidates using that platform score 8–9 on feasibility.

**Readmission reduction candidates:** If the Signal is P3 (care coordination breakdown) and a candidate targets the specific transition mentioned in the Signal, boost its strategic alignment note in the justification — even if patient outcome impact is indirect (it is two steps from readmission reduction, not three).
