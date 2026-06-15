---
name: healthcare-signal-pattern-library
description: Healthcare-operations signal pattern library for pattern-appraisal phase.
---

# Healthcare Signal Pattern Library

Used during pattern-appraisal phase for healthcare-operations vertical. Your task: match the incoming Signal against the patterns below, return `{ matches: true|false, patternId: 'P1'|..., reason: string }`. Default to `matches: false` on ambiguous signals.

---

## Safety Pre-Check (Run Before Any Pattern Matching)

Before matching any pattern, check the Signal for patient safety indicators:

**If the Signal describes:**
- An adverse event (patient harm that occurred)
- A near-miss (patient harm that was narrowly avoided)
- A "never event" (surgical error, wrong-patient medication, retained surgical item)
- A reportable sentinel event

**Return immediately (do not match patterns):**
```json
{
  "matches": false,
  "patternId": "P-SAFETY-ESCALATE",
  "reason": "Signal contains a patient safety indicator (adverse event / near-miss / sentinel event). Factory does not commission WorkGraphs in response to patient safety events without clinical governance review. Escalate to clinical leadership and risk management before any automation is considered."
}
```

---

## Clinical Protocol Pre-Check

If the Signal implies changing clinical decision-making logic — how diagnoses are made, which treatments are selected, how drug doses are calculated, which patients are admitted or discharged on clinical grounds:

**Return immediately:**
```json
{
  "matches": false,
  "patternId": "P-CLINICAL-PROTOCOL",
  "reason": "Signal implies changes to clinical decision-making logic. Factory automates operational workflows, not clinical protocols. Route to clinical leadership for protocol review before any WorkGraph is authored."
}
```

---

## Core Appraisal Questions

After the pre-checks pass:

1. Can I write a Pressure node with a concrete `forcingCondition` (a specific operational SLA, regulatory deadline, or patient-outcome metric)? If the forcing condition would have to be fabricated, the Signal is not addressable.

2. Does the Signal describe something Factory can build (workflow automation, reporting, scheduling, notifications, data integration, documentation automation)? Or does it describe something Factory cannot build (clinical protocol changes, staffing decisions, physician practice patterns)? If the latter, the Signal is not addressable.

---

## Pattern Library

### P1 — Patient Throughput Bottleneck

**Match condition:**
Signal contains all three:
- A named care step or process (admit, triage, discharge, ED boarding, referral, lab turnaround, radiology read)
- A time-based metric (average wait time, throughput per shift, patients per hour, bed occupancy %, time-to-first-contact)
- A target, SLA, or baseline comparison

**Example matching signals:**
- "ED triage-to-bed assignment averaging 47 minutes; our SLA is 30 minutes; we're breaching on 60% of high-acuity cases"
- "Discharge process taking avg 4.2 hours from physician order to patient exit; bed management can't board new admissions"
- "Lab turnaround for STAT CBC averaging 68 minutes vs. 45-minute SLA; ED throughput is impacted"

**Boundary conditions — do NOT match:**
- "Patients are waiting too long" — no named step, no metric → P-UNACTIONABLE
- "Our throughput is worse than last year" — no named step, no specific metric → P-UNACTIONABLE
- "Staffing is inadequate" — staffing decisions are outside Factory scope → P-CLINICAL-PROTOCOL

**Discriminator:** Named care step + time/throughput metric + target or SLA? Yes → P1.

**Factory response:**
- Pressure node: forcingCondition = named SLA breach at named care step with frequency metric
- Capability node: inability to route/process patients through named step at required throughput
- Function proposal: functionType = 'workflow' or 'automation', toolSurface = EHR workflow engine or patient flow system named in Signal
- PRD terminal atom: throughput at named step meets SLA over 30-day window

---

### P2 — Compliance Reporting Gap

**Match condition:**
Signal contains all three:
- A specific regulatory requirement named (CMS Conditions of Participation, Joint Commission standard, state health department requirement, CQM measure, HIPAA Privacy/Security rule, ONC certification requirement)
- A specific report, filing, or attestation that is missed, delayed, or at-risk
- A deadline or filing frequency

**Example matching signals:**
- "CMS is auditing our readmission rate reporting — we missed the Q1 submission for HRRP measure data"
- "Joint Commission survey next month; our infection control logs are manual and 3 weeks behind"
- "State requires monthly adverse drug event reporting by the 10th; we've been late 4 of the last 6 months"

**Boundary conditions — do NOT match:**
- "We have compliance issues" — too vague, no specific requirement → P-UNACTIONABLE
- "Regulations are changing" — landscape noise, no specific gap → P-REGULATORY-NOISE
- "We need to improve our quality scores" — no specific measure or reporting requirement → P-UNACTIONABLE

**Discriminator:** Named regulation + named report/filing + deadline? All three → P2.

**PHI advisory:** If the reporting involves patient-level data, add to reason: `"ADVISORY: This WorkGraph will handle PHI. Ensure all toolPermissions reference HIPAA-permitted tools only."`

**Factory response:**
- Pressure node: forcingCondition = named regulation + named filing + deadline date
- Capability node: inability to produce the required report/filing at required accuracy and frequency
- Function proposal: functionType = 'report' or 'automation', toolSurface = EHR reporting module or compliance platform named in Signal
- PRD terminal atom: report submitted by deadline with confirmation receipt

---

### P3 — Care Coordination Breakdown

**Match condition:**
Signal contains:
- Named care transition between two teams or settings (ED-to-inpatient, primary-to-specialist, inpatient-to-post-acute, hospital-to-home)
- A measurable failure indicator (readmission rate, missed follow-up rate, days-to-referral completion, dropped handoff count)

**Example matching signals:**
- "30-day readmission rate for CHF patients at 18%; national benchmark is 12%; discharge coordination is manual and inconsistent"
- "Referral completion rate from primary to specialist is 54%; patients aren't following through and we have no tracking"
- "ED-to-inpatient handoff using paper forms; 22% of handoffs have missing medication reconciliation data"

**Boundary conditions — do NOT match:**
- "Teams don't communicate well" — sentiment, no metric → P-UNACTIONABLE
- "Doctors don't update the EHR" — physician practice pattern, outside Factory scope → P-CLINICAL-PROTOCOL
- "Patients don't follow up" — patient behavior, outside Factory scope unless the signal names a specific process gap that Factory can automate

**Discriminator:** Named transition + measurable failure indicator? Yes → P3.

**Factory response:**
- Pressure node: forcingCondition = named transition failure metric + impact (readmissions, missed care)
- Capability node: inability to track and trigger care handoffs at required reliability
- Function proposal: functionType = 'integration' or 'alerting', toolSurface = EHR + care coordination platform named in Signal
- PRD terminal atom: handoff completion rate or follow-up rate meets target over 60-day window

---

### P4 — Clinical Documentation Burden

**Match condition:**
Signal names:
- A specific documentation task (prior authorization, discharge summary, clinical coding, progress notes, referral letters, care plan documentation)
- A time-cost or error-rate metric (hours per provider per day/week, denial rate from documentation errors, late completion rate, audit failure rate)

**Example matching signals:**
- "Prior auth process taking 2.5 hours per physician per day; 40% of authorizations require rework"
- "Discharge summary completion rate at 62% within 24 hours of discharge; CMS target is 90%"
- "Clinical coding denial rate at 8.4%; audits show documentation of primary diagnosis is consistently missing specificity"

**Boundary conditions — do NOT match:**
- "Physicians spend too much time on documentation" — no specific task, no metric → P-UNACTIONABLE
- "We want to reduce burnout" — not a Factory-addressable operational gap → P-UNACTIONABLE
- "We need better notes" — no specific task, no metric → P-UNACTIONABLE

**Discriminator:** Named documentation task + time/error metric? Yes → P4.

**Factory response:**
- Pressure node: forcingCondition = time cost or error rate metric on named documentation task
- Capability node: inability to complete named documentation task at required speed or accuracy
- Function proposal: functionType = 'automation' or 'workflow', toolSurface = EHR + documentation tool named in Signal
- PRD terminal atom: documentation completion rate or denial rate meets target over 30-day window

---

### P5 — Supply Chain / Inventory Signal

**Match condition:**
Signal contains:
- A named medication, supply category, or device
- A stockout frequency, waste rate, or inventory accuracy metric
- Evidence that the inventory failure is affecting care delivery or creating regulatory risk

**Example matching signals:**
- "Contrast media stockout 3 times in Q1 — each caused a 2-hour delay in radiology; we have no automated reorder trigger"
- "Expired medication waste running at $40K/month in the pharmacy; no system tracking near-expiry items"
- "Surgical supply counts are manual; 15% variance between system inventory and physical count monthly"

**Boundary conditions — do NOT match:**
- "We're having supply issues" — no named item, no metric → P-UNACTIONABLE
- "Supply chain is complicated" — too vague → P-UNACTIONABLE

**Discriminator:** Named supply/medication + stockout/waste/accuracy metric? Yes → P5.

**Factory response:**
- Pressure node: forcingCondition = stockout frequency or waste cost + care delivery impact
- Capability node: inability to track and reorder named supply at required accuracy
- Function proposal: functionType = 'integration' or 'alerting', toolSurface = inventory management system or EHR medication management module
- PRD terminal atom: stockout rate or waste rate meets target over 60-day window

---

### P-REGULATORY-NOISE

**Match condition:**
Signal describes general regulatory landscape changes (a new rule has been proposed, a guidance document was published, an industry association issued recommendations) without a specific operational requirement or compliance deadline for this org.

**Return:**
```json
{
  "matches": false,
  "patternId": "P-REGULATORY-NOISE",
  "reason": "Signal is a regulatory landscape update without a specific operational requirement or compliance deadline for this org. Factory cannot commission a WorkGraph without a named regulation, a concrete workflow or reporting gap, and a deadline. Resubmit when the specific operational impact on this org has been assessed."
}
```

---

### P-UNACTIONABLE

**Match condition:**
- No named care step, regulatory requirement, transition, documentation task, or supply item
- No measurable metric
- Signal asks for something outside Factory scope (clinical protocols, staffing, physician behavior, patient behavior, strategic planning)

**Return:**
```json
{
  "matches": false,
  "patternId": "P-UNACTIONABLE",
  "reason": "Signal lacks a named operational process and a measurable metric. Healthcare Factory signals must identify a specific care step, reporting requirement, or workflow task with a time, count, or rate metric. {specific_gap_in_this_signal}"
}
```

---

## Appraisal Decision Rules

1. Run Safety Pre-Check first. If triggered, stop immediately.
2. Run Clinical Protocol Pre-Check. If triggered, stop immediately.
3. Match against P1–P5 in order. Stop at first match.
4. If Signal contains PHI references, add advisory note in all responses.
5. Never match a pattern to a Signal that requires inferring the operational metric. If the metric is not stated, it does not exist for Factory purposes.
