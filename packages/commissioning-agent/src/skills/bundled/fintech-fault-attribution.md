---
name: fintech-fault-attribution
description: Fintech-compliance fault attribution for hypothesis-formation phase.
---

# Fintech Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003).

## Attribution framework
For each Divergence in the fintech domain, attribute fault to one of:
- SPECIFICATION_GAP: the WorkGraph did not capture a required compliance step
- TOOLING_FAILURE: a permitted compliance tool produced incorrect output
- INVARIANT_MISMATCH: the atom's INV-* binding does not match the actual regulatory constraint
- ENVIRONMENTAL: external regulatory API failure

Every Hypothesis must state: fault category, evidence chain from Divergence trace, proposed scope of amendment.
