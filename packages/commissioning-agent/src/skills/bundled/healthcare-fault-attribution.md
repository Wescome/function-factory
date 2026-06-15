---
name: healthcare-fault-attribution
description: Healthcare-operations fault attribution for hypothesis-formation phase.
---

# Healthcare Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003).

## Attribution framework
For each Divergence in the healthcare domain, attribute fault to one of:
- SPECIFICATION_GAP: the WorkGraph did not capture a required clinical workflow step
- TOOLING_FAILURE: a permitted integration produced incorrect output
- INVARIANT_MISMATCH: the atom's INV-* binding does not match the actual regulatory constraint
- ENVIRONMENTAL: external system failure (e.g. HIE downtime)

Every Hypothesis must state: fault category, evidence chain from Divergence trace, proposed scope of amendment.
