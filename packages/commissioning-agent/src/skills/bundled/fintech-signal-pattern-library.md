---
name: fintech-signal-pattern-library
description: Fintech-compliance signal pattern library for pattern-appraisal phase.
---

# Fintech Signal Pattern Library

Used during pattern-appraisal phase for fintech-compliance vertical. Your task: match the incoming Signal against the patterns below, return `{ matches: true|false, patternId: 'P1'|..., reason: string }`. Default to `matches: false` on ambiguous signals.

---

## Critical Protocol Pre-Checks (Run Before Any Pattern Matching)

### Pre-Check 1: Sanctions / OFAC Signal

If the Signal mentions OFAC, EU Sanctions, UN Sanctions, SDN list, sanctions screening, or counterparty screening against a specific sanctioned entity:

Add to reason in all pattern match responses (do not block matching):
`"SANCTIONS-ADVISORY: Signal involves sanctions screening. Confirm that all toolPermissions reference a sanctions data provider with SLA for list freshness. Any gap in sanctions screening is potentially a regulatory violation — treat as high-urgency."`

### Pre-Check 2: Credit / Underwriting / Risk Appetite

If the Signal implies changing credit underwriting models, adjusting risk scoring models, or changing the org's risk appetite:

Return immediately:
```json
{
  "matches": false,
  "patternId": "P-CREDIT-PROTOCOL",
  "reason": "Signal implies changes to credit underwriting or risk scoring models. Factory automates operational compliance workflows, not credit decisioning or risk appetite changes. Route to credit risk management and risk committee before any WorkGraph is authored."
}
```

### Pre-Check 3: Regulatory Deadline Urgency Flag

If a Signal matches any pattern AND contains a regulatory deadline within 30 days:

Add to reason: `"REGULATORY-DEADLINE-URGENT: Regulatory deadline within 30 days detected. Prioritize commission — delay risks regulatory penalty."`

---

## Core Appraisal Questions

After pre-checks:

1. Can I write a Pressure node with a concrete `forcingCondition` — a specific regulation, a named deadline, a measured compliance metric? If not, the Signal is not addressable.

2. Does the Signal describe something Factory can build (report automation, screening workflow, case management, audit trail generation, regulatory filing submission, onboarding workflow automation)? Or something Factory cannot build (credit decisioning, risk appetite setting, legal interpretation, relationship-based compliance)? If the latter, return P-UNACTIONABLE.

---

## Pattern Library

### P1 — Compliance Report Delay

**Match condition:**
Signal contains all three:
- A specific regulator named (FinCEN, SEC, FINRA, OCC, FCA, CFTC, FDIC, state banking regulator, CFPB)
- A specific report or filing named (SAR, CTR, FR Y-9C, Form ADV, Form PF, CCAR, DFAST, FR 2052a, FFIEC call report, 10-K/10-Q)
- A missed or at-risk deadline (specific date, reporting period, or statutory frequency)

**Example matching signals:**
- "We missed the Q1 CTR (FinCEN Form 112) batch submission deadline for 3 transactions that qualified — manual review process broke down"
- "SEC Form ADV annual update is due in 15 days; data compilation is manual and takes 3 weeks; we'll miss it"
- "FFIEC call report submission for Q4 was filed with errors — 4 schedule items had incorrect data that required an amendment"

**Boundary conditions — do NOT match:**
- "We have compliance issues" — no specific regulator, no specific report → P-UNACTIONABLE
- "We need better regulatory reporting" — no report named, no deadline → P-UNACTIONABLE
- "Regulatory environment is tough" → P-REGULATORY-NOISE

**Discriminator:** Regulator + report name + deadline/frequency? All three → P1.

**Factory response:**
- Pressure node: forcingCondition = named regulator + named report + deadline date + consequence of missing (penalty, enforcement risk)
- Capability node: inability to compile and submit named report with required accuracy and within deadline
- Function proposal: functionType = 'report' or 'automation', toolSurface = regulatory reporting platform or compliance management system named in Signal
- PRD terminal atom: report submitted on time with confirmation, all required fields validated

---

### P2 — KYC/AML Gap

**Match condition:**
Signal contains:
- A specific customer segment, onboarding volume, or account type (retail, business, high-net-worth, correspondent bank)
- A named KYC/AML gap (missing UBO verification, incomplete PEP screening, stale CDD documentation, EDD not conducted on high-risk accounts)
- A count or percentage of affected accounts

**Example matching signals:**
- "30% of business account onboarding lacks Ultimate Beneficial Owner (UBO) verification — 120 accounts have been open 90+ days without completing UBO under FinCEN CDD Rule"
- "Our PEP (Politically Exposed Person) screening is running on data updated quarterly; FATF guidelines require ongoing monitoring — 2,400 accounts haven't been rescreened in 6 months"
- "Enhanced Due Diligence (EDD) was not conducted on 18 accounts that our risk scoring flagged as high-risk during onboarding; these accounts are actively transacting"

**Boundary conditions — do NOT match:**
- "KYC is too slow" — process speed complaint, not a compliance gap → check P4 (transaction monitoring) for rate context
- "AML is complicated" — too vague → P-UNACTIONABLE
- "We need better customer screening" — no specific gap, no count → P-UNACTIONABLE

**Discriminator:** Named KYC/AML requirement + named customer segment + count/percentage of non-compliant accounts? Yes → P2.

**Factory response:**
- Pressure node: forcingCondition = regulatory requirement (cite specific rule: FinCEN CDD Rule, BSA Section 312, etc.) + count of non-compliant accounts + risk exposure
- Capability node: inability to complete required KYC/AML step for the named segment at required coverage rate
- Function proposal: functionType = 'workflow' or 'automation', toolSurface = KYC/identity verification platform named in Signal (Jumio, Refinitiv, ComplyAdvantage, LexisNexis Risk)
- PRD terminal atom: 100% of named segment accounts have completed the required KYC/AML step, verified in compliance platform

---

### P3 — Transaction Monitoring False Positive Rate

**Match condition:**
Signal contains:
- A named transaction monitoring system or alert workflow
- A false positive rate metric (% of alerts that are false positives, alert-to-SAR filing ratio)
- A resource cost metric (analyst hours per week, backlog count, average alert review time)

**Example matching signals:**
- "85% of our AML transaction monitoring alerts are false positives — analysts spend 40 hours/week reviewing alerts that don't result in SARs or escalations"
- "Alert-to-SAR conversion rate is 0.3% — industry standard is 1–3%; our rules are over-triggering on low-risk behavior patterns"
- "Transaction monitoring alert queue backlog is 3,200 unreviewed alerts — alert volume exceeds analyst capacity by 60%"

**Boundary conditions — do NOT match:**
- "We have too many alerts" — no false positive rate, no analyst cost metric → P-UNACTIONABLE
- "AML monitoring needs improvement" — too vague → P-UNACTIONABLE
- "We're missing suspicious activity" — this is a false negative problem (under-detection), not a false positive problem — evaluate separately and note the distinction

**Discriminator:** Named monitoring system + false positive rate metric + resource cost? Yes → P3.

**Factory response:**
- Pressure node: forcingCondition = false positive rate + analyst resource cost + backlog risk (delayed SAR filing)
- Capability node: inability to prioritize high-risk alerts and deprioritize low-risk false positives at required accuracy rate
- Function proposal: functionType = 'workflow' or 'automation', toolSurface = transaction monitoring system named in Signal (NICE Actimize, FISERV, Bottomline)
- PRD terminal atom: false positive rate reduced to ≤ target over 60-day window with no reduction in SAR filing accuracy

---

### P4 — Audit Finding Remediation

**Match condition:**
Signal contains:
- A reference to a specific audit finding (internal audit, external regulatory examination, third-party review)
- A named control gap or deficiency
- A remediation deadline (regulatory corrective action deadline or internal commitment date)

**Example matching signals:**
- "OCC exam finding (MRA): insufficient documentation of change management for BSA/AML system updates — remediation deadline 90 days"
- "Internal audit identified that 34% of SAR decisions lack documented analyst rationale — audit committee committed to 100% documentation within 60 days"
- "FDIC found that our BSA Officer review of high-risk account activity is not documented in the core system — must remediate within 120 days"

**Boundary conditions — do NOT match:**
- "Auditors found issues" — no specific finding, no deadline → P-UNACTIONABLE
- "We have audit concerns" — too vague → P-UNACTIONABLE

**Discriminator:** Named audit body + named control gap + remediation deadline? Yes → P4.

**Deadline urgency:** If remediation deadline ≤ 60 days, add REGULATORY-DEADLINE-URGENT flag.

**Factory response:**
- Pressure node: forcingCondition = named audit finding + regulatory body + remediation deadline
- Capability node: inability to produce the required documentation, control evidence, or workflow change at required quality
- Function proposal: functionType = 'workflow' or 'report', toolSurface = compliance management system or core banking system named in Signal
- PRD terminal atom: 100% of affected transactions/accounts have required documentation, validated in audit trail system, by remediation deadline

---

### P5 — Regulatory Change Implementation

**Match condition:**
Signal names:
- A specific regulatory change (new rule published, amended rule, guidance update, supervisory letter)
- An effective date for the change
- A specific operational change required in a named workflow (not a change to risk appetite or credit policy)

**Example matching signals:**
- "FinCEN beneficial ownership rule amendment effective 2026-01-01 — we need to update our business account onboarding to collect beneficial owner information from all controlling entities, not just 25%+ owners"
- "New CFPB small business lending data collection rule (Section 1071) is phased in for our loan volume tier starting 2026-07-01 — application data fields need to be added to the loan origination system"
- "FCA PS23/16 — Consumer Duty requires documented evidence of price/value assessment for all retail products by July 2026"

**Boundary conditions — do NOT match:**
- "New regulation coming" — no specific rule, no effective date → P-REGULATORY-NOISE
- "Regulators are increasing scrutiny" — no specific rule → P-REGULATORY-NOISE
- "We need to update our risk models for the new environment" — risk model change, not Factory scope → P-CREDIT-PROTOCOL

**Discriminator:** Named rule + effective date + named operational workflow change (not risk model or policy)? Yes → P5.

**Factory response:**
- Pressure node: forcingCondition = rule name + effective date + operational gap (what current workflow does not meet the new requirement)
- Capability node: inability to execute the specific named workflow change at required compliance by effective date
- Function proposal: functionType = 'workflow' or 'automation', toolSurface = named core banking, loan origination, or compliance system
- PRD terminal atom: operational change implemented and validated in target system, evidence of compliance produced, by effective date

---

### P-REGULATORY-NOISE

**Match condition:**
Signal describes general regulatory environment (proposed rules, industry associations' recommendations, regulator speeches, supervisory priority announcements) without a specific rule, filing requirement, or operational gap for this org.

**Return:**
```json
{
  "matches": false,
  "patternId": "P-REGULATORY-NOISE",
  "reason": "Signal is regulatory landscape commentary without a specific operational requirement for this org. Factory cannot commission a WorkGraph without: (1) a named regulation or exam finding, (2) a concrete workflow or filing gap, and (3) a deadline or compliance metric. Resubmit when the specific operational impact has been assessed."
}
```

---

### P-UNACTIONABLE

**Match condition:**
- Signal lacks a specific regulation, deadline, or compliance metric
- Signal describes risk appetite, credit policy, or model governance (not Factory scope)
- Signal describes executive decision-making, board-level governance, or strategic compliance posture

**Return:**
```json
{
  "matches": false,
  "patternId": "P-UNACTIONABLE",
  "reason": "Signal lacks a named regulation and a concrete operational gap. Fintech Factory signals must identify a specific filing requirement, KYC/AML process gap, audit finding, or regulatory change with a measurable compliance metric. {specific_gap}"
}
```

---

## Appraisal Decision Rules

1. Run all three pre-checks before matching any pattern.
2. Match against P1–P5 in order. Stop at first match.
3. Add SANCTIONS-ADVISORY overlay if sanctions screening is involved.
4. Add REGULATORY-DEADLINE-URGENT flag if deadline ≤ 30 days.
5. If no pattern matches, return P-REGULATORY-NOISE or P-UNACTIONABLE as appropriate.
6. Never fabricate a regulatory requirement to make a signal match. If the specific rule is not named in the Signal, it does not exist for Factory purposes.
