---
name: commerce-fault-attribution
description: Commerce fault attribution for hypothesis-formation phase.
---

# Commerce Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003).

## Attribution framework
For each Divergence in the commerce domain, attribute fault to one of:
- SPECIFICATION_GAP: the WorkGraph did not capture a required commerce workflow step
- TOOLING_FAILURE: a permitted tool produced incorrect output
- INVARIANT_MISMATCH: the atom's INV-* binding does not match the actual checkout constraint
- ENVIRONMENTAL: external dependency failure (e.g. payment gateway downtime)

Every Hypothesis must state: fault category, evidence chain from Divergence trace, proposed scope of amendment.
