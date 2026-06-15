---
name: healthcare-acceptance-criteria
description: Healthcare-operations acceptance criteria for workgraph-authoring phase.
---

# Healthcare Acceptance Criteria

Used during workgraph-authoring phase to validate the authored WorkGraph before dispatch. Run all checks in order. A WorkGraph that fails any CHECK marked REJECT must not be dispatched. Return it to authoring with the exact rejection message shown.

---

## Check 1: Pressure Node References a Clinical or Operational SLA

**Rule:** The `forcingCondition` in the pressure node must contain at least one of:
- A specific SLA with numeric threshold (response time, completion rate, turnaround time)
- A regulatory filing deadline (specific date, reporting period, or statutory frequency)
- A measurable patient-outcome metric (readmission rate, infection rate, complication rate)
- A documented care quality metric (completion rate, denial rate, error rate)

**REJECT if:** `forcingCondition` contains only qualitative language.

Rejection message: `"CHECK-HC-01 FAILED: Pressure node forcingCondition lacks a measurable clinical or operational SLA. Current value: '{current_forcingCondition}'. Required: a specific SLA, regulatory deadline, or patient-outcome metric with a numeric value. Example: 'ED triage-to-bed assignment exceeding 30-minute SLA in 60% of high-acuity cases.'"`

---

## Check 2: No PHI in Unlicensed Tool Permissions

**Rule:** Every tool listed in any atom's `toolPermissions` that would handle PHI (patient identifiers, clinical data, billing data, demographic data) must be present in the org's HIPAA-permitted toolset. The permitted toolset is sourced from `domainProfile.orgContext.hipaaPermittedTools` or equivalent field.

The following categories of data constitute PHI for this check:
- Patient name, date of birth, address, contact information
- Medical record numbers, encounter IDs, claim IDs
- Diagnosis codes, procedure codes, medication records
- Lab results, imaging results, clinical notes
- Insurance/payer identifiers

**REJECT if:** Any atom's `toolPermissions` includes a tool that handles PHI but is not in the HIPAA-permitted toolset.

Rejection message: `"CHECK-HC-02 FAILED: ATOM-{n} lists tool '{tool_name}' in toolPermissions. This tool handles PHI but is not in the org's HIPAA-permitted toolset. Either: (a) remove this tool and use a HIPAA-permitted alternative, or (b) confirm that a BAA is in place with '{tool_name}' and add it to the HIPAA-permitted toolset before dispatch. Do not dispatch PHI-handling workflows with unlicensed tools."`

---

## Check 3: No Clinical Decision Logic in Atoms

**Rule:** No PRD atom may contain logic that constitutes clinical decision-making. Factory automates operational workflows, not clinical protocols.

Clinical decision logic includes:
- Selecting a diagnosis from differential diagnoses
- Choosing between treatment options based on clinical criteria
- Calculating drug doses or adjusting dosing based on patient parameters
- Determining admission or discharge based on clinical assessment
- Overriding clinical alerts or safety checks automatically

Operational workflow logic (acceptable) includes:
- Routing a patient to a unit based on an already-made admission decision
- Triggering a notification when a lab result arrives
- Scheduling a follow-up appointment based on a discharge order already placed
- Submitting a prior authorization request with criteria provided by clinical staff
- Generating a report from EHR-recorded clinical data

**REJECT if:** Any atom's `title`, `description`, or `acceptanceCriteria` contains clinical decision logic.

Rejection message: `"CHECK-HC-03 FAILED: WorkGraph contains clinical decision logic in ATOM-{n}: '{offending_text}'. Factory does not commission clinical protocol automation. Remove or reclassify this atom. Clinical decision logic must be authored and approved by clinical leadership, not by Factory."`

---

## Check 4: Compliance Atoms Have Version-Pinned Regulatory INV-* Bindings

**Rule:** Any atom that executes a compliance or regulatory reporting workflow must have INV-* bindings that reference a specific regulation, and that reference must include a version or effective date.

**Insufficient (advisory warning):**
- `INV-CMS-001` with text "must comply with CMS requirements" — too generic
- `INV-HIPAA-001` with text "must follow HIPAA rules" — too generic

**Sufficient:**
- `INV-CMS-HRRP-2026: Hospital Readmissions Reduction Program — readmission measure per IQR specifications, FY2027 (effective 2026-10-01)`
- `INV-HIPAA-§164.312: HIPAA Security Rule §164.312(a)(1) — access control requirements, version in effect 2026`
- `INV-JCAHO-NPSG-01.01.01-2026: Joint Commission NPSG 01.01.01 — use at least two patient identifiers, effective 2026 CAMH`

**REJECT if:** Any compliance atom has zero INV-* bindings.

**WARNING (advisory, do not block) if:** A compliance atom has INV-* bindings but they lack version or effective date. Add: `"CHECK-HC-04 WARNING: ATOM-{n} compliance INV-* bindings lack version pinning. Regulatory requirements change annually — add effective date or rule version to prevent future INVARIANT_MISMATCH divergences."`

Rejection message for zero bindings: `"CHECK-HC-04 FAILED: Compliance atom ATOM-{n} has no INV-* bindings. All compliance and regulatory reporting atoms must reference the specific regulation with version or effective date."`

---

## Check 5: Care Handoff Atoms Include Failure Escalation Criteria

**Rule:** Any atom that represents a care handoff (ED-to-inpatient, primary-to-specialist, inpatient-to-post-acute, discharge coordination) must include at least one acceptance criterion that specifies the failure escalation path.

A failure escalation criterion must specify:
1. The condition that constitutes a failure (e.g., "If referral not acknowledged within 2 hours")
2. The action triggered on failure (e.g., "Notify supervising clinician via alert system")
3. The notification method (named system, not "alert" alone)

**Handoff atom identifiers:** An atom is a handoff atom if its title contains words like "handoff," "transfer," "referral," "discharge coordination," "transition of care," or if its function proposal type is 'integration' between two clinical teams or settings.

**REJECT if:** A handoff atom has no failure escalation criterion.

**REJECT if:** A handoff atom has a failure escalation criterion that does not specify all three elements above.

Rejection message: `"CHECK-HC-05 FAILED: ATOM-{n} is a care handoff atom but its acceptanceCriteria do not include a failure escalation path. Add a criterion in the format: 'If [condition indicating handoff failure], [action to be taken] via [named notification system] within [time window].'" `

---

## Check 6: All Blocking Constraints Addressed

**Rule:** Every constraint in `domainProfile.constraints` with `severity: 'blocking'` must be explicitly addressed in at least one of:
- An atom's `acceptanceCriteria`
- The capability node's `gapDescription`
- An atom's `invariantBindings`

**REJECT if:** Any blocking constraint has no explicit reference in the WorkGraph.

Rejection message: `"CHECK-HC-06 FAILED: Blocking constraint '{constraint_id}: {constraint_text}' is not addressed anywhere in the WorkGraph. Add an atom or invariant that explicitly resolves this constraint before dispatch."`

---

## Check 7: Terminal Success Condition Is a Clinical or Operational Outcome Metric

**Rule:** The PRD must have exactly one `terminalSuccessCondition` atom. That atom's criteria must be an outcome metric, not a process completion metric.

**Process completion (insufficient):**
- "Report submitted" — process metric
- "Workflow executed" — process metric
- "Patient record updated" — process metric
- "Notification sent" — process metric

**Clinical or operational outcome (sufficient):**
- "30-day readmission rate for CHF patients ≤ 12% over 90-day window following function activation, measured in EHR analytics"
- "Discharge summary completion rate within 24 hours ≥ 90% over 30-day window, measured in EHR"
- "ED triage-to-bed assignment SLA compliance ≥ 85% over 30-day window, measured in bed management system"
- "Prior authorization denial rate ≤ 5% over 60-day window, measured in billing system"

**REJECT if:** No `terminalSuccessCondition` is designated.

**REJECT if:** The terminal atom's criteria are process-completion only.

Rejection messages:
- No terminal: `"CHECK-HC-07 FAILED: PRD has no terminalSuccessCondition. Designate the atom whose criteria represent the real-world clinical or operational outcome (readmission rate, SLA compliance %, denial rate) as the terminal atom."`
- Process only: `"CHECK-HC-07 FAILED: Terminal atom ATOM-{n} uses process-completion criteria. Replace with a clinical or operational outcome metric: '[metric] meets [threshold] over [time window] as measured by [tool or system].'"`

---

## Check 8: Minimum INV-* Bindings Per Atom

**Rule:** Every atom must have at least one INV-* binding. Healthcare atoms must have bindings that reference clinical process constraints or regulatory requirements — not generic quality statements.

**REJECT if:** Any atom has zero INV-* bindings.

Rejection message: `"CHECK-HC-08 FAILED: ATOM-{n} has no invariant bindings. Every healthcare workflow atom must have at least one INV-* binding specifying a clinical protocol constraint, regulatory requirement, or operational SLA."`

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
    { "checkId": "CHECK-HC-03", "atomId": "ATOM-2", "message": "..." }
  ],
  "warnings": [
    { "checkId": "CHECK-HC-04", "atomId": "ATOM-1", "message": "..." }
  ]
}
```

Do not dispatch a WorkGraph with `valid: false`.
