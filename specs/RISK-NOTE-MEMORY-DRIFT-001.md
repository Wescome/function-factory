# RISK-NOTE-MEMORY-DRIFT-001
**@mastra/memory Observer drift — CommissioningAgentDO**
*June 2026 — not yet specced, do not incorporate into design docs*

---

## What this is

A deferred risk note. Records a known failure mode of `@mastra/memory` observational compression that is relevant to the CommissioningAgentDO per-run memory thread. Not a spec. Not a design decision. Held here so it does not pollute the current architecture work.

---

## The risk

The Observer agent compresses `buildHypothesis()` and `proposeAmendment()` reasoning chains by inference. It may produce incorrect inferences — for example, assuming an Amendment was ADOPTED based on elapsed time or conversational pattern, when the actual Verdict was REJECTED.

If this happens inside the CommissioningAgentDO per-run thread, the next `buildHypothesis()` call reasons from a false premise: "AMD-001 was adopted and closed DIV-A3" when in fact AMD-001 was rejected and DIV-A3 is still open. The CA may then propose a duplicate or conflicting Amendment, or skip a necessary re-commission.

---

## Proposed mitigation (when this is specced)

`evaluateRunAcceptanceCriterion()` and `POST /review` request construction must read authoritative state from CoordinatorDO meta table and ArtifactGraphDO directly — not from the memory thread. The memory thread is reasoning context only, not the authoritative state store.

Specifically:
- `moleculeVerdictRefs` sourced from CoordinatorDO meta — not memory thread
- `openGapsFromPrior` sourced from ArchitectAgentDO `review_sessions` DO SQLite — not memory thread
- Amendment Verdict (ADOPTED / REJECTED) sourced from ArtifactGraphDO Verdict node — not memory thread

The memory thread can be wrong. The DO SQLite and ArtifactGraphDO cannot (append-only, written before any downstream action per AA-INV-001).

---

## When to action

If and when memory drift is observed in production — incorrect hypothesis attribution, duplicate amendments, or CA reasoning that contradicts the ArtifactGraphDO record. Not before.

---

## Related

- `SPEC-FF-WORKGRAPH-DOD-001 v1.2` — CommissioningAgentDO memory thread scope
- `SPEC-ARCHITECT-AGENT-DO-001 v2.0` — AA-INV-001 (write before downstream action)
- GitHub mastra-ai #13470 — Observer + adaptive thinking conflict (model constraint already enforced)
