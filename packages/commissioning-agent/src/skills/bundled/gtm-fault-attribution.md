---
name: gtm-fault-attribution
description: GTM-engineering fault attribution for hypothesis-formation phase.
---

# GTM Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003). Your task: examine the Divergence trace, attribute fault to exactly one category, form a Hypothesis with evidence, and propose an amendment scope. The four categories are exhaustive — every Divergence maps to exactly one.

---

## Attribution Decision Tree

Work through this decision tree in order. Stop at the first condition that applies.

**Step 1: Did the tool run?**
- No tool output in the Divergence trace, or tool call was not attempted → go to Step 1a
- Tool ran and produced output → go to Step 2

**Step 1a: Why did the tool not run?**
- Tool unavailable, API timeout, auth failure, external service down → **ENVIRONMENTAL**
- Tool was not called because the atom's spec did not include a tool invocation → **SPECIFICATION_GAP** (the spec omitted a required step)

**Step 2: Did the spec say what to do with the tool output?**
- Tool output exists but the atom had no instruction for how to use it to advance the GTM workflow → **SPECIFICATION_GAP**
- The spec covered the tool output handling → go to Step 3

**Step 3: Did the invariant match the production state?**
- The atom's INV-* binding referenced a constraint that differs from the actual production constraint (pipeline stage threshold, qualification criteria, routing rule) → **INVARIANT_MISMATCH**
- The invariant was correct → go to Step 4

**Step 4: Was the tool output correct?**
- Tool ran, output was structurally valid, spec coverage was correct, invariant matched — but the output contained wrong data that caused the GTM workflow to fail → **TOOLING_FAILURE**

**Ambiguity tiebreak:** When evidence points equally to SPECIFICATION_GAP vs. INVARIANT_MISMATCH, choose SPECIFICATION_GAP. A spec fix is safer and more conservative than an invariant change. Document the ambiguity in `explanation`.

---

## Category Definitions and GTM Signatures

### SPECIFICATION_GAP

The WorkGraph atom ran (or would have run) but a required GTM behaviour was absent from the specification.

**GTM signatures:**
- Lead scoring logic not included in the qualification atom — leads were processed but not scored
- ICP criteria not encoded in the atom — outreach went to wrong segment
- Sequence personalization rules omitted — generic message sent where personalised content was required
- Stage-advancement criteria absent — opportunities moved to wrong stage
- CRM field update omitted — downstream reporting broke because a field was never populated
- Handoff trigger not in spec — SDR-to-AE handoff was not initiated despite qualification completing

**Evidence required:**
- The specific atom that ran (atom id, title)
- The atom's `successCondition` as written
- The specific GTM behaviour that was absent (name it precisely)
- The effect: what downstream GTM process failed as a result

**Amendment scope options for SPECIFICATION_GAP:**
- `'add-atom'` — the missing behaviour requires a new atom in the execution chain
- `'modify-atom'` — the missing behaviour is an extension of an existing atom's acceptance criteria

**Example hypothesis:**
```
faultCategory: SPECIFICATION_GAP
explanation: "ATOM-3 (Lead Qualification) ran and updated lead status to 'MQL' but contained no instruction to apply the ICP score from the scoring model. The successCondition was 'lead status = MQL' but did not include 'ICP score ≥ 70 in scoring model field'. Outreach enrolled all MQLs regardless of ICP fit. 34% of enrolled leads had ICP score < 40."
amendmentScope: modify-atom
proposedChange: "Extend ATOM-3 acceptanceCriteria to include: 'ICP score field populated in CRM; only leads with ICP score ≥ 70 enrolled in outbound sequence.'"
```

---

### TOOLING_FAILURE

A permitted GTM tool produced a result that was structurally valid (no error, correct format) but semantically wrong for the GTM context.

**GTM signatures:**
- CRM enrichment returned stale firmographic data — lead was mis-scored because company headcount was outdated
- Lead routing rule in the CRM fired on wrong territory due to a cached geo-mapping error
- Outreach platform sent sequence to wrong contact — CRM sync had a duplicate record issue that the atom did not detect
- Analytics tool returned stale pipeline data — the WorkGraph's reporting atom presented incorrect conversion rates
- Intent data provider returned empty results for a segment that should have had high intent (provider-side data lag)

**Evidence required:**
- The tool that failed (name, API endpoint or integration)
- The output the tool produced (show the relevant field values)
- The output the tool should have produced (what was expected)
- The specific GTM process that failed as a result
- Whether this is a known issue with the tool (caching, eventual consistency, rate limiting)

**Amendment scope for TOOLING_FAILURE:**
- `'add-invariant'` — add an invariant binding that validates tool output quality before the atom accepts it
- `'modify-atom'` — add a pre-check step in the atom that validates the tool output before proceeding

**Example hypothesis:**
```
faultCategory: TOOLING_FAILURE
explanation: "ATOM-2 (CRM Enrichment) called the enrichment API and received a 200 response with company headcount = 45. Actual current headcount (verified via LinkedIn) is 380. The enrichment provider's data for this company was 14 months stale. The lead was scored as 'SMB fit' (score 42) and excluded from the enterprise outbound sequence despite being an ICP match. The provider's SLA guarantees data freshness within 6 months — this violated their SLA."
amendmentScope: add-invariant
proposedChange: "Add INV-ENRICH-FRESHNESS-001: 'Enrichment data must carry a last-updated timestamp within 180 days. If timestamp is absent or older than 180 days, flag lead for manual review rather than automated scoring.'"
```

---

### INVARIANT_MISMATCH

The atom's INV-* binding was correct at authoring time but the actual production constraint has changed.

**GTM signatures:**
- INV bound to "SQLs require score ≥ 50" but the sales team updated the threshold to ≥ 70 three weeks ago
- INV referenced a pipeline stage name that was renamed in the CRM ("Prospect" → "Qualified Lead") — routing broke
- INV encoded a territory assignment rule that was restructured in a mid-quarter sales reorganization
- INV referenced a quota structure for incentive routing that changed in a new comp plan cycle
- INV encoded a lead source classification that was updated in the marketing attribution model

**Evidence required:**
- The INV-* binding text from the WorkGraph spec
- The current actual constraint from the production system (screenshot, config export, or team documentation)
- The date when the production constraint changed (if known)
- The effect: how the mismatch caused the Divergence

**Amendment scope for INVARIANT_MISMATCH:**
- `'modify-invariant'` — update the INV-* binding to match current production constraint

**Example hypothesis:**
```
faultCategory: INVARIANT_MISMATCH
explanation: "ATOM-4's INV-SQL-SCORE-001 reads: 'SQL threshold = score ≥ 50 in Salesforce lead scoring field.' The sales operations team updated the SQL threshold to ≥ 70 on 2026-03-01 as part of Q2 pipeline quality initiative. The WorkGraph was authored on 2026-01-15. For 6 weeks, leads with scores 50–69 were advancing to SQL status and being handed to AEs, resulting in 22 low-quality SQLs per week reaching the pipeline."
amendmentScope: modify-invariant
proposedChange: "Update INV-SQL-SCORE-001 to: 'SQL threshold = score ≥ 70 in Salesforce lead scoring field.' Add a version comment noting the effective date of this threshold."
```

---

### ENVIRONMENTAL

An external dependency failed. The atom spec was correct, the tool was correct, the invariant was correct — but the dependency was unavailable.

**GTM signatures:**
- CRM API was down during the execution window — no records could be updated
- Outreach platform had a webhook failure — sequence enrollments were queued but not sent
- Enrichment provider returned 503 or rate-limit (429) errors — leads could not be enriched
- Analytics platform had ingestion lag — reporting atom presented stale data
- Email deliverability infrastructure had a temporary DNS issue — sequence open rates dropped to zero

**Evidence required:**
- The external system that failed (name, API endpoint)
- The failure mode (status code, error message, or reliability incident reference)
- The time window of the failure
- Confirmation that the atom spec and tool config were unchanged during this window

**Critical rule: ENVIRONMENTAL never justifies a WorkGraph amendment.**
```
amendmentScope: 'none'
```

ENVIRONMENTAL faults indicate infrastructure or dependency reliability issues — not specification problems. The appropriate response is retry logic, circuit breaker patterns, or alerting at the infrastructure layer, not a spec change.

**Severity escalation for GTM ENVIRONMENTAL faults:**
- If the ENVIRONMENTAL failure blocked a time-sensitive GTM execution (campaign launch date, event follow-up deadline, fiscal quarter-end sequence): set `severity: 'blocking'` to escalate to the principal
- If the failure was during a low-stakes window: `severity: 'advisory'`

**Example hypothesis:**
```
faultCategory: ENVIRONMENTAL
explanation: "ATOM-1 (CRM Update) failed at 14:32 UTC on 2026-04-10. Salesforce API returned 503 Service Unavailable for 47 minutes (14:28–15:15 UTC per Salesforce Trust status page — incident INC-2026-04-10-01). The atom spec was correct; the CRM configuration was unchanged. 18 leads that should have been updated to SQL status during this window were not updated. The GTM execution was non-time-sensitive (routine daily qualification run)."
amendmentScope: none
severity: advisory
recommendation: "No WorkGraph change needed. Implement retry-with-backoff at the CRM integration layer. Consider adding a daily reconciliation job to catch missed updates from API outage windows."
```

---

## Hypothesis Output Format

```json
{
  "id": "HYP-{nanoid8}",
  "divergenceRef": "{Divergence trace id or description}",
  "faultCategory": "SPECIFICATION_GAP|TOOLING_FAILURE|INVARIANT_MISMATCH|ENVIRONMENTAL",
  "explanation": "string (evidence chain: what happened, what atom, what tool, what effect — 3-6 sentences)",
  "severity": "blocking|advisory",
  "amendmentScope": "add-atom|modify-atom|add-invariant|modify-invariant|none",
  "proposedChange": "string|null (null only when amendmentScope is 'none')",
  "producedBy": "CommissioningAgentDO:{orgId}",
  "dispositionEventId": "{ELC-*}",
  "producedAt": "{ISO 8601}"
}
```

Severity rules:
- `'blocking'`: Divergence caused or would cause a material GTM failure (deals lost, sequences sent to wrong contacts, pipeline data corrupted). Requires principal notification before WorkGraph re-dispatch.
- `'advisory'`: Divergence is a performance issue or missed optimization. WorkGraph can be re-dispatched after amendment without principal escalation.
