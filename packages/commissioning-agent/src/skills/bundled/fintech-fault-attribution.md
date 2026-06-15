---
name: fintech-fault-attribution
description: Fintech-compliance fault attribution for hypothesis-formation phase.
---

# Fintech Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003). Your task: examine the Divergence trace, attribute fault to exactly one of the four categories, form a Hypothesis with evidence, and propose an amendment scope. The four categories are exhaustive.

---

## Regulatory Filing Safety Pre-Check (Run First)

Before attribution, check whether the Divergence involved a mandatory regulatory filing:
- SAR (Suspicious Activity Report) — FinCEN Form 111, or equivalent
- CTR (Currency Transaction Report) — FinCEN Form 112, or equivalent
- Any named regulatory submission with a statutory deadline

**If yes:** Set `severity: 'blocking'` regardless of fault category. A missed or incorrect mandatory regulatory filing is a direct legal violation. Document: `"REGULATORY-FILING: Divergence involves a mandatory regulatory filing. Blocking severity applied regardless of fault category. Principal notification required immediately. Assess whether a regulatory notification obligation exists (e.g., voluntary self-disclosure to regulator)."`

Also check whether the Divergence involved sanctions screening:

**If yes:** Set `severity: 'blocking'` regardless of fault category. Document: `"SANCTIONS-SCREENING: Divergence involves sanctions screening. Any screening failure or incorrect result is high-risk. Blocking severity applied. Principal notification required. Assess whether any transaction was processed with a potentially sanctioned counterparty."`

---

## Attribution Decision Tree

**Step 1: Did the compliance tool/API run?**
- No tool output in the Divergence trace, or call was not attempted → go to Step 1a
- Tool ran and produced output → go to Step 2

**Step 1a: Why did the tool not run?**
- Compliance data provider unavailable (503, timeout, maintenance), regulatory API down (FinCEN BSA E-Filing, SEC EDGAR, FCA RegData) → **ENVIRONMENTAL**
- The atom spec did not include the required compliance check or filing step → **SPECIFICATION_GAP**

**Step 2: Did the spec say what to do with the tool output?**
- Compliance tool output exists but the atom had no instruction for how to use it to advance the compliance workflow → **SPECIFICATION_GAP**
- The spec covered the handling → go to Step 3

**Step 3: Did the invariant match the current regulatory state?**
- The atom's INV-* binding referenced a regulatory threshold, rule, or requirement that has been updated since WorkGraph authoring → **INVARIANT_MISMATCH**
- The invariant matched current regulation → go to Step 4

**Step 4: Was the compliance tool output correct?**
- Tool ran, output was structurally valid, spec was correct, invariant matched — but the tool output contained stale, incorrect, or incomplete compliance data → **TOOLING_FAILURE**

**Ambiguity tiebreak:** SPECIFICATION_GAP vs. INVARIANT_MISMATCH — choose SPECIFICATION_GAP. Spec fix is more conservative.

---

## Category Definitions and Fintech Signatures

### SPECIFICATION_GAP

A required compliance step was absent from the atom specification.

**Fintech signatures:**
- KYC onboarding atom ran but did not include the UBO (Ultimate Beneficial Owner) verification step required by the FinCEN CDD Rule — accounts were opened without UBO
- SAR filing atom ran but did not include the documentation of analyst rationale — SARs were filed but lacked the narrative required under BSA
- Transaction monitoring case management atom ran but did not include the escalation threshold — high-risk cases were being reviewed without an escalation path to the BSA Officer
- Regulatory report atom ran but a required data field was not mapped — report was filed with missing required fields
- EDD (Enhanced Due Diligence) atom ran but did not include the source-of-funds documentation step — high-risk account onboarding lacked required EDD evidence
- KYC refresh atom ran but did not include re-screening against updated PEP/sanctions lists — refresh was completed but screening was not updated

**Evidence required:**
- The specific atom that ran (id, title)
- The atom's `successCondition` as written
- The specific compliance step that was absent (name the regulatory requirement: cite the rule, section, or requirement by name)
- The downstream consequence: which regulatory requirement was not met, what filing gap or compliance gap resulted

**REGULATORY SEVERITY RULE:** If the absent step created a reportable compliance failure (missed SAR filing deadline, missing CTR threshold, incorrect AML monitoring coverage), set `severity: 'blocking'` regardless of other factors.

**Amendment scope for SPECIFICATION_GAP:**
- `'add-atom'` — the missing compliance step requires a new atom
- `'modify-atom'` — the missing step is an extension of an existing atom

**Example hypothesis:**
```
faultCategory: SPECIFICATION_GAP
explanation: "ATOM-3 (Business Account Onboarding KYC) executed and set account status to 'KYC_COMPLETE' in the compliance system. The atom's successCondition was 'identity verified AND risk scored.' It did not include the UBO verification step required by FinCEN CDD Rule 31 CFR 1010.230 for all legal entity customers with 25%+ owners. 44 business accounts were opened with status 'KYC_COMPLETE' but without UBO certification forms collected. These accounts have been transacting for an average of 18 days without required UBO documentation."
severity: blocking
amendmentScope: modify-atom
proposedChange: "Extend ATOM-3 acceptanceCriteria to include: 'For all legal entity accounts: UBO certification collected for all beneficial owners with ≥25% equity interest AND for each individual with significant management control (FinCEN CDD Rule 31 CFR 1010.230). Document in compliance system with beneficiary name, DOB, address, SSN/ITIN/Passport.'"
```

---

### TOOLING_FAILURE

A permitted compliance tool produced a result that was structurally valid but semantically wrong for the compliance context.

**Fintech signatures:**
- Sanctions screening provider returned "CLEAR" but the counterparty had been added to the OFAC SDN list 36 hours prior (list freshness SLA breach by provider)
- PEP (Politically Exposed Person) database returned no match but the individual had been designated a PEP in a foreign jurisdiction not covered by the provider's dataset
- AML transaction monitoring system produced a false negative (failed to flag a qualifying transaction pattern) due to a rule engine update that introduced a logic bug
- Identity verification provider returned "VERIFIED" for a document that was subsequently determined to be fraudulent (provider accuracy failure)
- Credit bureau returned incorrect income data due to a data mapping error in the provider's update process

**Evidence required:**
- The tool/provider that failed (name, API endpoint, data product)
- The output the tool produced (show the relevant fields/values and timestamps)
- The output the tool should have produced (what was expected per regulatory requirement)
- The regulatory consequence: which compliance check was rendered ineffective
- The data freshness timestamp from the tool output vs. the relevant list or database update time

**SANCTIONS FAILURE SEVERITY:** TOOLING_FAILURE in sanctions screening is ALWAYS `severity: 'blocking'`. Document: `"SANCTIONS-TOOLING-FAILURE: Sanctions screening tool produced incorrect results. Any transaction that was processed based on this incorrect screening may involve a sanctioned counterparty. Immediate review required. Assess potential OFAC/sanctions notification obligation."`

**Amendment scope for TOOLING_FAILURE:**
- `'add-invariant'` — add an INV-* binding that validates data freshness, coverage, or accuracy before the atom accepts tool output
- `'modify-atom'` — add a pre-check that validates the screening result meets minimum data quality requirements

**Example hypothesis:**
```
faultCategory: TOOLING_FAILURE
explanation: "ATOM-1 (Sanctions Screening) called ComplyAdvantage /v4/individual-searches and received { result: 'CLEAR', matched: false, data_timestamp: '2026-04-10T02:15:00Z' }. The OFAC SDN list was updated at 2026-04-10T14:00:00Z (12 hours after the screening) to add the counterparty (SDN entry: PERSON-2026-XXXX). The transaction was processed at 2026-04-10T16:30:00Z — 2.5 hours after the counterparty was added to the SDN list. ComplyAdvantage's standard SLA is 2-hour list refresh; the 2:15 AM data timestamp shows the screening used data that was 14+ hours old at the time of the transaction."
severity: blocking
amendmentScope: add-invariant
proposedChange: "Add INV-SANCTIONS-FRESHNESS-001: 'Sanctions screening result must use data with a data_timestamp within 4 hours of the transaction timestamp. If data_timestamp is older than 4 hours, re-run the screening immediately before proceeding. Do not accept a CLEAR result from stale data.'"
```

---

### INVARIANT_MISMATCH

The atom's INV-* binding was correct at authoring time but the actual production regulatory requirement has changed.

**Fintech signatures:**
- INV referenced the CTR threshold as $10,000 and a structuring pattern rule that was superseded by an updated FinCEN guidance
- INV encoded the SAR filing deadline as 30 days from detection but an amendment to the BSA updated the deadline for certain SAR types to 60 days
- INV referenced the OFAC SDN list version pinned to a specific date — the list is now multiple versions ahead and the atom is still using the pinned version logic
- INV encoded the CDD Rule beneficial ownership threshold as 10% (the org's more conservative internal policy) but the internal policy was revised to 25% (the regulatory minimum) — the INV now over-collects and creates friction
- INV referenced state reporting thresholds that changed in an annual state banking regulation update

**Evidence required:**
- The INV-* binding text from the WorkGraph spec
- The current regulatory text, guidance, or internal policy (show the actual updated text)
- The effective date of the regulatory or policy change
- How the mismatch caused the Divergence (over-compliance, under-compliance, or process error)

**Regulatory version pinning on amendment:** Every amended INV-* for a regulatory reference must include the rule version and effective date: `INV-FINCEN-CTR-2026: CTR filing required for cash transactions ≥ $10,000 per FinCEN Form 112 instructions (effective 2026-01-01)`.

**Amendment scope for INVARIANT_MISMATCH:**
- `'modify-invariant'` — update the INV-* binding to reflect the current regulatory requirement

**Example hypothesis:**
```
faultCategory: INVARIANT_MISMATCH
explanation: "ATOM-4's INV-SAR-DEADLINE-001 reads: 'SAR must be filed within 30 days of initial detection of suspicious activity.' FinCEN issued updated guidance on 2026-02-01 (FIN-2026-A001) clarifying that for cyber-enabled fraud involving $5,000 or more, the SAR deadline is 30 days from detection OR 60 days from initial report of the activity, whichever is earlier — depending on the transaction type. The WorkGraph was authored before this guidance. 3 cyber-fraud SARs were filed on day 28 when the updated timeline would have permitted more thorough investigation before filing. No compliance violation occurred (still within 30 days) but the INV should reflect the updated guidance to allow full investigation windows."
amendmentScope: modify-invariant
proposedChange: "Update INV-SAR-DEADLINE-001 to: 'SAR deadline per FinCEN guidance FIN-2026-A001 (effective 2026-02-01): 30 days from initial detection for standard suspicious activity; 60 days from initial report for cyber-enabled fraud involving ≥$5,000, whichever is earlier. Flag transaction type at case creation.'"
```

---

### ENVIRONMENTAL

An external regulatory or compliance dependency was unavailable. The spec was correct, the compliance tool was correct, the invariant matched — but the dependency failed.

**Fintech signatures:**
- FinCEN BSA E-Filing system was down — SAR/CTR submissions were queued but not transmitted
- SEC EDGAR filing system was unavailable during the submission window
- FCA RegData portal had an outage during the regulatory reporting period
- Identity verification provider (Jumio, Onfido) had a service degradation — KYC verification could not be completed
- SWIFT/ACH network had a disruption — payment transaction monitoring could not receive transaction data
- Credit bureau API had extended downtime — credit decisioning data was unavailable

**Critical rule: ENVIRONMENTAL never justifies a WorkGraph amendment.**
```
amendmentScope: 'none'
```

**Fintech severity escalation for ENVIRONMENTAL:**

**Severity BLOCKING (even though no amendment):** ENVIRONMENTAL failure for a regulatory filing with an imminent deadline:
- Regulatory filing API down AND deadline is within 24 hours
- Sanctions screening provider down AND transactions are in the queue
- Any ENVIRONMENTAL failure that has already caused or may cause a missed regulatory filing

Set `severity: 'blocking'` and note: `"REGULATORY-DEADLINE-ENVIRONMENTAL: ENVIRONMENTAL failure may result in a missed mandatory regulatory filing. No WorkGraph amendment is warranted but immediate escalation is required. Assess whether the filing can be submitted via an alternate method (paper, email, portal direct). Document the outage as evidence for any regulatory inquiry about the delay."`

**Severity ADVISORY:** ENVIRONMENTAL failure that does not immediately risk a regulatory filing:
- KYC provider outage (onboarding delayed, not a filing risk)
- Analytics system down (reporting delayed, not a mandatory filing)
- Non-mandatory reporting system unavailable

**Example hypothesis:**
```
faultCategory: ENVIRONMENTAL
explanation: "ATOM-5 (CTR Submission) attempted to submit a batch of 12 CTRs to the FinCEN BSA E-Filing System at 22:00 UTC on 2026-04-10 (last day of the 15-day filing window). The BSA E-Filing System returned 503 Service Unavailable errors from 21:45 to 23:30 UTC — a 105-minute outage confirmed on FinCEN's system status page (incident BSA-2026-0410). The atom spec was correct; the CTR data was valid and correctly formatted. 12 CTRs were not submitted within the statutory filing window. FinCEN's guidance allows self-reporting of technical outages as a mitigating factor."
severity: blocking
amendmentScope: none
recommendation: "No WorkGraph change needed. IMMEDIATE ACTION: (1) Retry submission now that BSA E-Filing is restored. (2) Document the outage evidence (FinCEN status page screenshot, timestamps) for the submission record. (3) Contact FinCEN if filing is ultimately late — the outage may qualify as a mitigating circumstance under BSA examination guidelines. (4) Implement retry-with-deadline-awareness: if approaching deadline and submission fails, escalate to BSA Officer immediately rather than continuing silent retries."
```

---

## Hypothesis Output Format

```json
{
  "id": "HYP-{nanoid8}",
  "divergenceRef": "{Divergence trace id or description}",
  "faultCategory": "SPECIFICATION_GAP|TOOLING_FAILURE|INVARIANT_MISMATCH|ENVIRONMENTAL",
  "regulatoryFilingInvolved": true|false,
  "sanctionsInvolved": true|false,
  "explanation": "string (3–6 sentences: what atom, what compliance tool, what requirement, what regulatory consequence)",
  "severity": "blocking|advisory",
  "amendmentScope": "add-atom|modify-atom|add-invariant|modify-invariant|none",
  "proposedChange": "string|null",
  "regulatoryDisclosureAssessmentRequired": true|false,
  "producedBy": "CommissioningAgentDO:{orgId}",
  "dispositionEventId": "{ELC-*}",
  "producedAt": "{ISO 8601}"
}
```

`regulatoryDisclosureAssessmentRequired: true` when: faultCategory is TOOLING_FAILURE and sanctionsInvolved is true, OR when a mandatory regulatory filing was missed or filed incorrectly.

Severity rules:
- `'blocking'`: Divergence involves a mandatory regulatory filing, sanctions screening failure, or ENVIRONMENTAL failure near a regulatory deadline. Requires principal notification. Cannot re-dispatch without principal clearance.
- `'advisory'`: Divergence is a process inefficiency or non-critical compliance workflow failure. Can be amended and re-dispatched without escalation.
