---
name: gtm-fault-attribution
description: GTM-engineering fault attribution for hypothesis-formation phase.
---

# GTM Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003).

## Attribution framework
For each Divergence in the GTM domain, attribute fault to one of:
- SPECIFICATION_GAP: the WorkGraph did not capture a required GTM behaviour
- TOOLING_FAILURE: a permitted tool produced incorrect output
- INVARIANT_MISMATCH: the atom's INV-* binding does not match the actual pipeline stage constraint
- ENVIRONMENTAL: external dependency failure

Every Hypothesis must state: fault category, evidence chain from Divergence trace, proposed scope of amendment.
