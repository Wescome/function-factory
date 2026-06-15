---
name: fintech-acceptance-criteria
description: Fintech-compliance acceptance criteria for workgraph-authoring phase.
---

# Fintech Acceptance Criteria

Used during workgraph-authoring phase to validate the authored WorkGraph before dispatch. Run all checks in order. A WorkGraph that fails any CHECK marked REJECT must not be dispatched. Return it to authoring with the exact rejection message shown.

---

## Check 1: Every Atom Has an Immutable Audit Log Binding

**Rule:** Every atom in the PRD must have an `invariantBindings` entry that references an audit logging requirement. The audit log INV-* must specify:
1. That all automated actions produce log entries
2. That the log is immutable (append-only, cannot be modified or deleted after write)
3. What data is captured per entry (minimum: timestamp, actor/system identity, data record reference, outcome)

**Reference INV for this binding:** `INV-AUDIT-IMMUTABLE-001: All automated actions produce append-only audit log entries. Each entry captures: UTC timestamp, system actor ID, data record reference (ID + version), and action outcome. Log entries may not be modified or deleted after write.`

Each atom may reference this shared INV or define a more specific audit log INV for its context (e.g., `INV-SAR-AUDIT-001: SAR filing actions produce audit entries including: analyst ID, decision (file/no-file), rationale text, SAR reference number, and FinCEN submission confirmation`).

**REJECT if:** Any atom has zero INV-* bindings OR has no INV-* binding referencing audit logging.

Rejection message: `"CHECK-FT-01 FAILED: ATOM-{n} lacks an immutable audit log binding. Every fintech-compliance atom must reference an INV-* that specifies append-only audit log requirements. Add INV-AUDIT-IMMUTABLE-001 or an equivalent atom-specific audit log INV before dispatch."`

---

## Check 2: Regulatory References Are Version-Pinned

**Rule:** Any INV-* that references a regulation, regulatory guidance, exam finding, or supervisory letter must include the regulation version or effective date.

**Insufficient:**
- `INV-BSA-001: must comply with Bank Secrecy Act` — no version, no effective date
- `INV-OFAC-001: must screen against OFAC SDN list` — no data freshness or version pin
- `INV-KYC-001: must perform Know Your Customer` — no specific rule reference

**Sufficient:**
- `INV-FINCEN-CDD-2018: FinCEN Customer Due Diligence Rule, 31 CFR 1010.230, effective 2018-05-11 (as amended 2026-01-15 per FinCEN RIN 1506-AB53)`
- `INV-OFAC-SDN-FRESHNESS: OFAC SDN list check must use data with timestamp within 4 hours of transaction. List source: OFAC SDN Master List, updated by OFAC continuously at https://ofac.treasury.gov/`
- `INV-FINCEN-SAR-31CFR1020.320: SAR filing required for transactions involving $5,000+ where institution knows/suspects violation. Filing deadline: 30 days from detection (60 days if no suspect identified), per 31 CFR 1020.320 (effective 2022-11-01)`

**REJECT if:** Any compliance atom has an INV-* regulatory reference without a version or effective date.

Rejection message: `"CHECK-FT-02 FAILED: ATOM-{n} INV-* binding '{inv_id}' references a regulatory requirement without a version pin or effective date. Regulatory requirements change — unversioned references will become stale and cause INVARIANT_MISMATCH divergences. Add the rule citation, version, and effective date to the INV-* text."`

---

## Check 3: Sanctions and PEP Screening Atoms Have Data Freshness Invariants

**Rule:** Any atom that performs sanctions screening (OFAC, EU Sanctions, UN Consolidated List, UK HMT) or PEP (Politically Exposed Person) screening must include an INV-* binding that specifies:
1. The maximum acceptable age of screening data (staleness tolerance in hours)
2. The action required if data exceeds the staleness tolerance (re-run screening, do not proceed, escalate)

**Minimum freshness standard:** OFAC screening data must not be older than 4 hours for any transaction or onboarding event. PEP screening data must not be older than 24 hours for any onboarding event and not older than 7 days for any monitoring refresh.

**Example valid INV:**
`INV-SANCTIONS-FRESHNESS-001: OFAC SDN screening must use data with provider_timestamp within 4 hours of screening event. If provider_timestamp is older than 4 hours, discard result and re-run screening before proceeding. If re-run fails (provider unavailable), halt and escalate to compliance officer — do not proceed without a valid screening result.`

**REJECT if:** Any sanctions or PEP screening atom lacks a data freshness INV-*.

Rejection message: `"CHECK-FT-03 FAILED: ATOM-{n} performs sanctions/PEP screening but has no data freshness invariant. Add an INV-* binding specifying: the maximum acceptable data age (≤4 hours for OFAC, ≤24 hours for PEP onboarding screening), and the action required when data exceeds this age. Stale sanctions screening data is a regulatory risk."`

---

## Check 4: Regulatory Requirements Have a Dedicated Compliance Success Criterion

**Rule:** For every named regulatory requirement in the pressure node's `forcingCondition`, the PRD must contain at least one atom whose `acceptanceCriteria` explicitly closes that requirement by:
1. Naming the regulation or requirement
2. Stating what threshold or action constitutes compliance
3. Stating how compliance is verified (which system, which record, which report)

**Example valid compliance criterion:**
- Pressure node forcingCondition: "FinCEN CDD Rule 31 CFR 1010.230 — 44 business accounts opened without UBO verification"
- Terminal atom criterion: "100% of business account records in compliance system have UBO_CERTIFIED=true and UBO documentation uploaded for all ≥25% beneficial owners, verified by query to compliance platform account table, within 30 days of function deployment"

**REJECT if:** A named regulatory requirement in the pressure node has no corresponding compliance criterion in any PRD atom.

Rejection message: `"CHECK-FT-04 FAILED: Pressure node references regulatory requirement '{requirement_text}' but no PRD atom's acceptanceCriteria explicitly addresses this requirement. Add an atom (or extend an existing atom) with a criterion that names the regulation, states the compliance threshold, and identifies the verification method."`

---

## Check 5: No Regulated Activity in Tool Permissions

**Rule:** No atom's `toolPermissions` may include tools that would cause Factory to perform regulated financial activities:
- Credit decisioning (automated loan approval/denial, credit score generation used as a decision)
- Securities brokerage (order routing, trade execution, investment advice generation)
- Insurance underwriting (automated underwriting decisions, premium setting)
- Money transmission (moving funds between unrelated parties without a licensed money transmitter in the chain)

**Tools that are NOT regulated activities (acceptable):**
- KYC/AML screening tools (ComplyAdvantage, LexisNexis Risk, Refinitiv) — screening is compliance, not a regulated decision
- Credit bureau data retrieval tools (Experian, Equifax, TransUnion API for data retrieval only — not automated decision)
- Regulatory filing APIs (FinCEN BSA E-Filing, SEC EDGAR API) — filing, not a regulated activity
- Document generation tools (PDF generation, report creation) — automation, not a regulated decision

**REJECT if:** Any atom's `toolPermissions` includes a tool that would perform a regulated financial activity as defined above.

Rejection message: `"CHECK-FT-05 FAILED: ATOM-{n} toolPermissions includes '{tool_name}' which performs a regulated financial activity: {activity_description}. Factory does not commission regulated financial activity automation. Remove this tool from toolPermissions and restructure the atom so Factory only automates the operational wrapper (documentation, routing, notification) without performing the regulated decision itself."`

---

## Check 6: All Blocking Constraints Addressed

**Rule:** Every constraint in `domainProfile.constraints` with `severity: 'blocking'` must be explicitly addressed in at least one of:
- An atom's `acceptanceCriteria`
- The capability node's `gapDescription`
- An atom's `invariantBindings`

**REJECT if:** Any blocking constraint is not addressed anywhere in the WorkGraph.

Rejection message: `"CHECK-FT-06 FAILED: Blocking constraint '{constraint_id}: {constraint_text}' is not addressed in the WorkGraph. Add an atom or invariant that explicitly resolves this constraint before dispatch."`

---

## Check 7: Terminal Success Condition Is a Compliance Outcome, Not a Process Metric

**Rule:** The PRD's `terminalSuccessCondition` atom must have at least one acceptance criterion that is a compliance outcome metric, not a process completion metric.

**Process completion (insufficient):**
- "SAR submitted" — process metric; does not confirm compliance outcome
- "Report filed" — process metric
- "KYC completed" — process metric
- "Screening run" — process metric

**Compliance outcome (sufficient):**
- "100% of business accounts in non-compliant segment now have UBO_CERTIFIED=true in compliance system, verified by compliance platform query, by [date]"
- "SAR filing for identified suspicious activity submitted to FinCEN BSA E-Filing with confirmation number recorded in audit log, within 30-day statutory window"
- "FR Y-9C regulatory report for Q1 2026 filed with Federal Reserve by April 30 deadline with zero required fields missing, filing confirmation saved to document repository"
- "All 120 non-compliant KYC accounts remediated OR escalated to BSA Officer for manual review, documented in compliance platform with outcome and analyst ID, within 45 days"

**REJECT if:** No `terminalSuccessCondition` is designated.

**REJECT if:** The terminal atom's criteria are process-completion only.

Rejection messages:
- No terminal: `"CHECK-FT-07 FAILED: PRD has no terminalSuccessCondition. Designate the atom whose criteria represent the regulatory compliance outcome (filing confirmed, accounts remediated, audit finding closed) as the terminal atom."`
- Process only: `"CHECK-FT-07 FAILED: Terminal atom ATOM-{n} uses process-completion criteria only. Replace with a compliance outcome criterion: '[what compliance state was achieved], [how verified], [by when].'"` 

---

## Check 8: Minimum INV-* Bindings Per Atom

**Rule:** Every atom must have at least one INV-* binding. For fintech-compliance, every atom must have at minimum:
1. An audit log binding (INV-AUDIT-IMMUTABLE-001 or equivalent) — required by Check 1
2. A regulatory reference INV-* (for compliance pathway atoms) — required by Check 2

**REJECT if:** Any atom has zero INV-* bindings.

Rejection message: `"CHECK-FT-08 FAILED: ATOM-{n} has no invariant bindings. Every fintech-compliance atom must have at minimum an audit log binding (INV-AUDIT-IMMUTABLE-001) and, for compliance pathway atoms, a version-pinned regulatory reference."`

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
    { "checkId": "CHECK-FT-01", "atomId": "ATOM-3", "message": "..." }
  ],
  "warnings": [
    { "checkId": "CHECK-FT-02", "atomId": "ATOM-1", "message": "..." }
  ]
}
```

Do not dispatch a WorkGraph with `valid: false`. Every failure in fintech-compliance carries potential regulatory exposure. Return to authoring with the complete failure list.
