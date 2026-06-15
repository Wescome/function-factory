---
name: healthcare-fault-attribution
description: Healthcare-operations fault attribution for hypothesis-formation phase.
---

# Healthcare Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003). Your task: examine the Divergence trace, attribute fault to exactly one of the four categories, form a Hypothesis with evidence, and propose an amendment scope. The four categories are exhaustive.

---

## Patient Safety Pre-Check (Run First)

Before any attribution, check whether the Divergence involved a patient safety-relevant process:
- Patient routing in the ED or ICU
- Medication administration or order transmission
- Discharge or transfer coordination for high-acuity patients
- Any process named as a "critical" clinical workflow in the DomainProfile

**If yes:** Set `severity: 'blocking'` on the Hypothesis regardless of fault category and regardless of amendment scope. Patient safety process Divergences require principal notification before any re-dispatch.

---

## Attribution Decision Tree

**Step 1: Did the integration/tool run?**
- No tool output in trace, or call was not attempted → go to Step 1a
- Tool ran and produced output → go to Step 2

**Step 1a: Why did the tool not run?**
- EHR/HIE API unavailable, authentication failure, interface engine timeout → **ENVIRONMENTAL**
- The atom spec did not include the required integration call → **SPECIFICATION_GAP**

**Step 2: Did the spec cover what to do with the tool output?**
- Tool output exists but the atom had no instruction for how to use it to advance the clinical workflow → **SPECIFICATION_GAP**
- The spec covered the tool output handling → go to Step 3

**Step 3: Did the invariant match the production clinical/regulatory state?**
- The atom's INV-* referenced a clinical protocol threshold, regulatory requirement, or routing rule that has been updated since WorkGraph authoring → **INVARIANT_MISMATCH**
- The invariant matched production → go to Step 4

**Step 4: Was the tool output correct?**
- Integration returned structurally valid output but wrong patient data, wrong encounter, stale record, or mis-matched identifiers → **TOOLING_FAILURE**

**Ambiguity tiebreak:** SPECIFICATION_GAP vs. INVARIANT_MISMATCH — choose SPECIFICATION_GAP. Spec fix is more conservative.

---

## Category Definitions and Healthcare Signatures

### SPECIFICATION_GAP

A required clinical workflow step was absent from the atom specification.

**Healthcare signatures:**
- Discharge workflow ran but did not include scheduling post-discharge follow-up appointment — care coordination dropped
- Referral atom ran but did not include tracking or status-check steps — referrals were sent but completions were not tracked
- Compliance report atom ran but did not include the specific CMS measure numerator/denominator logic — report was filed with incorrect data
- Care handoff atom ran but did not include medication reconciliation step — handoff was incomplete
- Documentation automation ran but did not include the required diagnosis specificity fields — billing denials resulted
- Prior auth atom ran but did not include the payer-specific clinical criteria that must be submitted — authorization was denied

**Evidence required:**
- The specific atom that ran (atom id, title)
- The atom's `successCondition` as written
- The specific clinical step that was absent (name it precisely, cite the clinical or regulatory basis for why it was required)
- The downstream consequence: what failed in the care workflow as a result

**PATIENT SAFETY ESCALATION:** If the absent step is a patient safety step (e.g., allergy check, fall risk assessment, critical lab notification), set `severity: 'blocking'` regardless of any other factor. Document: `"PATIENT SAFETY: Absent step involves patient safety process. Blocking severity applied. Principal notification required before re-dispatch."`

**Amendment scope for SPECIFICATION_GAP:**
- `'add-atom'` — the missing clinical step requires a new atom
- `'modify-atom'` — the missing step is an extension of an existing atom

**Example hypothesis:**
```
faultCategory: SPECIFICATION_GAP
explanation: "ATOM-2 (Discharge Coordination) executed and updated patient status to 'Discharged' in the EHR. The atom's successCondition was 'patient status = Discharged AND discharge summary completed.' It did not include instructions to schedule a 7-day follow-up appointment for CHF patients (required by the org's CHF readmission protocol). 14 CHF patients were discharged without follow-up scheduling during the 3-week execution window. 2 of these patients were readmitted within 30 days."
severity: blocking
amendmentScope: modify-atom
proposedChange: "Extend ATOM-2 acceptanceCriteria to include: 'For patients with primary DX: CHF (ICD-10 I50.*), a follow-up appointment within 7 days must be scheduled and recorded in EHR before discharge status is confirmed.'"
```

---

### TOOLING_FAILURE

An EHR/HIE/clinical integration returned structurally valid output that was semantically wrong for the healthcare context.

**Healthcare signatures:**
- ADT (Admission, Discharge, Transfer) feed returned wrong encounter type — patient was routed to wrong unit
- Lab interface returned results for the wrong patient due to a merge/split issue in the EHR MPI (Master Patient Index)
- HIE query returned a stale medication list — the patient's current medications were not included because the HIE had a sync lag
- EHR scheduling API returned an available slot that was actually blocked — double-booking resulted
- Clinical decision support (CDS) hook returned an outdated drug interaction alert because the drug database had not been refreshed

**Evidence required:**
- The integration/API that failed (name, endpoint, interface specification)
- The raw output the tool produced (show the relevant fields/values)
- What the tool should have produced (what was expected per the spec)
- The clinical consequence: what care workflow failed as a result
- Whether this is a known issue with the specific integration (MPI quality, HIE sync frequency, lab interface configuration)

**PHI EXPOSURE NOTE:** If the wrong patient data was returned or accessed, add to `explanation`: `"PHI EXPOSURE RISK: Integration returned data for an incorrect patient. Assess whether a HIPAA breach notification review is required."`

**Amendment scope for TOOLING_FAILURE:**
- `'add-invariant'` — add an INV-* binding that validates the tool output's patient match, data freshness, or encounter type before the atom accepts it
- `'modify-atom'` — add a pre-check step that validates the tool output before proceeding

**Example hypothesis:**
```
faultCategory: TOOLING_FAILURE
explanation: "ATOM-1 (Patient Routing) received an ADT message from the HL7 interface engine. The ADT A01 (Admit) message contained encounter type 'OBS' (Observation) but the patient had been entered into the EHR as an inpatient admission ('INP'). The HL7 interface engine was using a cached encounter-type mapping from a configuration that was updated 3 weeks prior. Patient was routed to the observation unit instead of an inpatient bed. No PHI cross-patient exposure — the patient data was correct, only the encounter type was wrong."
amendmentScope: add-invariant
proposedChange: "Add INV-ADT-ENCOUNTER-001: 'Validate ADT encounter type against EHR source of truth before routing. If encounter type in ADT message does not match EHR encounter type, flag for manual routing review rather than automated routing.'"
```

---

### INVARIANT_MISMATCH

The atom's INV-* binding was correct at authoring time but the actual production clinical or regulatory constraint has changed.

**Healthcare signatures:**
- INV referenced a CMS quality measure threshold that was updated in the annual IPPS/OPPS rule
- INV encoded discharge criteria for a specific DRG that were updated in the clinical protocol by the medical staff
- INV referenced an ICD-10 code set that was updated in the October annual release
- INV encoded a state-specific reporting threshold for mandatory reportable conditions that changed in a new state health regulation
- INV referenced a prior authorization clinical criteria set that the payer updated quarterly
- INV encoded a bed assignment rule that was updated in a hospital capacity management policy change

**Evidence required:**
- The INV-* binding text from the WorkGraph spec
- The current actual clinical or regulatory constraint (show the regulation text, protocol update, or payer criteria)
- The effective date when the production constraint changed
- How the mismatch caused the Divergence

**Regulatory version pinning:** When proposing an amendment, always include a version pin on regulatory references: `INV-CMS-HRRP-2026: readmission penalty threshold for CHF = X% (effective 2026-10-01 per FY2027 IPPS Final Rule)`.

**Amendment scope for INVARIANT_MISMATCH:**
- `'modify-invariant'` — update the INV-* binding to reflect the current constraint

**Example hypothesis:**
```
faultCategory: INVARIANT_MISMATCH
explanation: "ATOM-3's INV-PRIOR-AUTH-CRITERIA-001 encoded the clinical criteria for inpatient rehabilitation prior authorization as: 'Patient requires 3-hour daily therapy.' The payer (Blue Cross PPO) updated their criteria on 2026-01-01 to: 'Patient requires 3-hour daily therapy AND therapy notes must document functional improvement at ≥ 2-week intervals.' The INV was authored in 2025-09-15. Since 2026-01-01, 11 prior auth requests have been denied because the documentation requirement was not included in the submission atom."
amendmentScope: modify-invariant
proposedChange: "Update INV-PRIOR-AUTH-CRITERIA-001 to include the documentation requirement. Pin to payer criteria version: 'Blue Cross PPO IRF Criteria, effective 2026-01-01.'"
```

---

### ENVIRONMENTAL

An external clinical system or dependency was unavailable. The atom spec was correct, the integration was correct, the invariant matched — but the dependency failed.

**Healthcare signatures:**
- HIE was undergoing scheduled maintenance during the execution window
- EHR API returned rate-limit errors during peak clinical hours (7–9 AM shift change)
- Lab interface engine had a network timeout — results were queued but not transmitted
- State immunization registry was unavailable — vaccine records could not be queried
- Payer eligibility verification service had an outage — eligibility checks failed

**Critical rule: ENVIRONMENTAL never justifies a WorkGraph amendment.**
```
amendmentScope: 'none'
```

**Healthcare severity escalation for ENVIRONMENTAL:**

**Severity BLOCKING (even though no amendment):** ENVIRONMENTAL failure in a time-sensitive clinical workflow:
- ED triage routing integration failure during active ED use
- Medication order transmission failure
- Critical lab result routing failure
- Any integration named as "critical path" in the DomainProfile

Set `severity: 'blocking'` and note: `"CLINICAL-CRITICAL: ENVIRONMENTAL failure in a time-sensitive clinical integration. Even though no WorkGraph amendment is warranted, this failure requires immediate infrastructure review. Principal notification required."`

**Severity ADVISORY:** ENVIRONMENTAL failure in a non-time-sensitive clinical workflow:
- Scheduled reporting job failure (can be retried)
- Non-urgent referral tracking failure
- Administrative integration (billing, scheduling optimization) failure

**Example hypothesis:**
```
faultCategory: ENVIRONMENTAL
explanation: "ATOM-2 (Lab Result Routing) failed to retrieve STAT CBC results at 14:42 UTC. The laboratory interface engine (Mirth Connect) logged a TCP connection timeout to the LIS (Laboratory Information System) between 14:38 and 15:02 UTC — a 24-minute outage caused by a network switch failure in the lab. The atom spec was correct, the HL7 interface configuration was unchanged, and the INV-* bindings matched production. 7 STAT CBC results were delayed by 24 minutes during the outage. These are time-sensitive results in the ED context."
severity: blocking
amendmentScope: none
recommendation: "No WorkGraph change needed. Escalate to IT infrastructure for network redundancy review on the lab-to-interface-engine connection. Consider adding a retry-with-escalation mechanism at the interface layer: if result not received within 30 minutes of order, alert charge nurse."
```

---

## Hypothesis Output Format

```json
{
  "id": "HYP-{nanoid8}",
  "divergenceRef": "{Divergence trace id or description}",
  "faultCategory": "SPECIFICATION_GAP|TOOLING_FAILURE|INVARIANT_MISMATCH|ENVIRONMENTAL",
  "patientSafetyRelevant": true|false,
  "phiExposureRisk": true|false,
  "explanation": "string (evidence chain: 3–6 sentences. What atom, what integration, what clinical step, what consequence)",
  "severity": "blocking|advisory",
  "amendmentScope": "add-atom|modify-atom|add-invariant|modify-invariant|none",
  "proposedChange": "string|null",
  "producedBy": "CommissioningAgentDO:{orgId}",
  "dispositionEventId": "{ELC-*}",
  "producedAt": "{ISO 8601}"
}
```

Severity rules:
- `'blocking'`: Divergence is in a patient safety process, involves PHI exposure, or is ENVIRONMENTAL in a critical clinical workflow. Requires principal notification. Cannot re-dispatch without principal clearance.
- `'advisory'`: Divergence is a performance issue, non-critical workflow failure, or administrative process gap. Can be resolved and re-dispatched without escalation.
