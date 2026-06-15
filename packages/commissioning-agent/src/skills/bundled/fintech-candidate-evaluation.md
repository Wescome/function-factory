---
name: fintech-candidate-evaluation
description: Fintech-compliance candidate scoring and nomination for deliberation phase.
---

# Fintech Candidate Evaluation

Used during deliberation phase for fintech-compliance vertical. Produce 2–4 candidates, score each on three criteria, and nominate the best feasible candidate. Fewer than 2 candidates indicates insufficient deliberation.

---

## Pre-Evaluation Gate

Before scoring any candidate, check:

**Audit trail gate (automatic infeasibility):**
If the candidate's function proposal does not produce immutable audit log entries for all automated actions, it is infeasible in the fintech-compliance vertical — period.

```
feasible: false
infeasibilityReason: "Candidate does not produce an immutable audit trail for all automated actions. Fintech-compliance vertical requires complete audit traceability on every automated step. Add audit log bindings before this candidate can be commissioned."
```

**Regulated activity gate:**
If the candidate would cause Factory to perform a regulated financial activity (credit decisioning, investment advice, insurance underwriting, money transmission, securities brokerage):

```
feasible: false
infeasibilityReason: "Candidate performs a regulated financial activity: {activity}. Factory does not commission regulated activity automation. Remove this function from scope or restructure so Factory only automates the operational wrapper (reporting, documentation, routing) not the regulated decision itself."
```

---

## Scoring Criteria

Each candidate receives three scores (0–10). All scores require 1–2 sentence justification.

---

### Criterion 1: Regulatory Risk Reduction (0–10)

How much does this candidate reduce the org's regulatory exposure?

| Score | Meaning |
|-------|---------|
| 9–10 | Candidate closes a named regulatory gap with a specific regulation reference and a deadline. NOT commissioning this candidate creates material risk of regulatory penalty, enforcement action, or exam finding. This score MUST trigger the COMPLIANCE-PRIORITY override — see nomination rules. |
| 7–8 | Candidate materially reduces regulatory exposure in an area with ongoing supervisory attention (AML, KYC, sanctions, BSA). Named regulation is relevant but deadline is not imminent. |
| 5–6 | Candidate improves compliance controls in an area with moderate regulatory scrutiny. Risk reduction is real but not urgent. |
| 3–4 | Candidate improves audit trail or documentation quality with indirect compliance benefit. No specific regulatory requirement is being closed. |
| 0–2 | No direct regulatory risk dimension. Candidate is operational efficiency without compliance impact. |

**COMPLIANCE-PRIORITY escalation:** Any candidate with regulatory risk reduction = 9–10 receives `"COMPLIANCE-PRIORITY": true`. This candidate must be nominated or explicitly rejected with documented reasoning. Silent deprioritization is not permitted.

---

### Criterion 2: Feasibility Given Compliance Toolset (0–10)

Can this candidate be built within the org's existing compliance technology stack and regulatory permissions?

| Score | Meaning |
|-------|---------|
| 9–10 | Implements using existing regtech/compliance platforms already confirmed in `domainProfile.orgContext` (e.g., ComplyAdvantage, Refinitiv World-Check, NICE Actimize, Jumio, LexisNexis Risk, Oracle Financial Services). No new vendor onboarding, no new data processing agreements. |
| 7–8 | Requires one new compliance data provider or API integration. The provider is a recognized regtech vendor with standard data processing agreement terms (DPA). Feasible with moderate onboarding. |
| 5–6 | Requires compliance architecture changes (new data pipeline from core banking, significant configuration of existing platform) or legal review of new data processing. |
| 3–4 | Requires new regulatory data licenses, new jurisdictional approvals, or significant changes to the core banking system configuration. High setup risk. |
| 0–2 | Requires changing licensed business activities, new regulatory filings to expand scope, or capabilities Factory cannot provide. Mark `feasible: false`. |

---

### Criterion 3: Audit Traceability (0–10)

Does every automated action in this candidate produce an immutable, queryable audit record?

| Score | Meaning |
|-------|---------|
| 9–10 | Every automated action (screening check, alert review, filing submission, KYC step, document generation) produces an immutable audit log entry with: timestamp (UTC), actor identity (system ID + operator ID if applicable), data reference (record ID, version), and outcome. Audit log is append-only and stored in a system that cannot be modified after write. |
| 7–8 | Audit log is produced for all actions but is not stored in an immutable/append-only system — could potentially be overwritten. Acceptable if overwrite requires multi-party authorization. |
| 5–6 | Partial audit trail — some actions are logged, others are not. Gaps are in non-critical steps. |
| 3–4 | Audit trail covers only outcomes, not intermediate steps. Regulatory examination would find gaps. |
| 0–2 | No meaningful audit trail. For fintech-compliance, this auto-triggers `feasible: false` — see pre-evaluation gate. |

**Immutability requirement:** "Immutable" means the log cannot be modified, deleted, or overwritten by any operator after the entry is written. A database with delete permissions for admins does not satisfy this requirement.

---

## Nomination Rules

1. **COMPLIANCE-PRIORITY override:** If any feasible candidate has `COMPLIANCE-PRIORITY: true` (regulatory risk reduction = 9–10), that candidate MUST be nominated regardless of composite score. Add to `nominationReason`: `"COMPLIANCE-PRIORITY nomination: named regulatory gap with deadline. Regulatory risk overrides composite score."`

2. **Primary rule (no COMPLIANCE-PRIORITY):** Nominate candidate with highest `(regulatoryRiskReduction + feasibility) / 2` where `feasible: true`.

3. **Audit traceability tiebreak:** If two candidates tie on composite score, prefer the one with higher audit traceability score. Audit trail quality is a first-order concern in fintech-compliance.

4. **Low-regulatory fallback:** If all feasible candidates have regulatory risk reduction < 5, add to `nominationReason`: `"No candidate directly closes a named regulatory gap. Recommend human review — Factory may be misapplied to this signal if no regulatory risk is at stake."`

5. **No feasible candidates:** Return `{ nominated: null, reason: "All candidates failed audit trail or regulated activity gates. Restructure scope so that automated functions produce immutable audit logs and do not perform regulated decisions. Escalate to principal." }`

6. **Minimum candidates:** Produce 2–4. If 1 concept is viable, produce a second stretch candidate. Do not produce only 1.

---

## Candidate Output Format

```json
{
  "id": "CND-{n}",
  "title": "string",
  "description": "string (2–4 sentences: which compliance workflow, which regulation, what automation, which platform)",
  "functionType": "automation|integration|report|workflow|alerting|validation",
  "toolSurface": "string (specific compliance platform: ComplyAdvantage, NICE Actimize, Jumio, etc.)",
  "compliancePriority": true|false,
  "scores": {
    "regulatoryRiskReduction": { "score": 0–10, "justification": "string" },
    "feasibility": { "score": 0–10, "justification": "string" },
    "auditTraceability": { "score": 0–10, "justification": "string" }
  },
  "compositeScore": "(regulatoryRiskReduction + feasibility) / 2",
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

## Fintech-Specific Scoring Notes

**SAR/CTR automation:** Any candidate that automates SAR (Suspicious Activity Report) or CTR (Currency Transaction Report) production scores 9–10 on regulatory risk reduction when the Signal involves a missed or at-risk filing. These are mandatory BSA filings — failure is a direct regulatory violation.

**UBO/KYC automation:** Candidates targeting the FinCEN CDD Rule (UBO verification for business accounts) score 9–10 on regulatory risk reduction when the Signal names accounts that are non-compliant with UBO requirements.

**PEP screening automation:** Candidates automating ongoing PEP (Politically Exposed Person) screening score 8–9 on regulatory risk reduction, with feasibility depending on the data provider already in the toolset.

**Sanctions screening candidates:** If the Signal involves OFAC or EU Sanctions, any candidate that improves sanctions screening data freshness or coverage scores 9–10 on regulatory risk reduction. Flag SANCTIONS-ADVISORY on all such candidates.

**Audit trail for core banking integrations:** Candidates integrating with core banking systems (FIS, Fiserv, Jack Henry) score 7–8 on audit traceability if the core banking system produces its own audit log that can be queried. The candidate's own audit layer is additive, not the sole source.

**Regulatory reporting platform candidates:** Candidates using a dedicated regulatory reporting platform (Wolters Kluwer OneSumX, Axiom SL, Moody's Analytics REGSCI) score 9–10 on audit traceability — these platforms are purpose-built with immutable audit logs for regulatory examination.
