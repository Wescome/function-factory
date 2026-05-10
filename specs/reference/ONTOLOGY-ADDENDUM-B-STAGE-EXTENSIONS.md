# Ontology Addendum B: Repo-Local Stage Extensions

**Status:** compatibility reference for post-v0.2 numbering
**Source references:** `FF-ONTOLOGY-v0.2.md`,
`FF-ONTOLOGY-ADDENDUM-A.md`, `ONTOLOGY-CURRENT-MAPPING.md`,
`.agent/memory/semantic/DECISIONS.md`

Addendum A covers the original legacy stages 1-7. The current repository also
contains later labels that were introduced by bootstrap work. These labels are
not new ontology categories yet. They are compatibility names for repo-local
process extensions.

## Extension Concordance

| Compatibility label | Primary interpretation | Current implementation surface |
| --- | --- | --- |
| Stage 8 | Merge Readiness / PR Handoff / Function identity materialization | Merge Readiness Pack assembly, PR draft evidence, CI evidence overlay, `FP-*` to `FN-*` materialization |
| Stage 8.5 | Selection-bias correction overlay | Selection-bias adaptation artifacts and historical bootstrap notes |
| Stage 9 | Meta-Governance / policy evolution | Meta-governance reports, governance proposals, policy stress evaluation |
| Stage 10 | Policy Activation / rollback control | Policy activation artifacts, rollback planning, activation verification |

## Policy

- Active docs and new code should lead with the primary interpretation.
- Numbered extension labels may remain as compatibility labels when they name
  an existing API, route, artifact history, or decision record.
- Physical renames are out of scope for this addendum. Any rename must follow
  `ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md` and
  `ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md`.
- Historical memory, ConOps material, and prior handoffs are not rewritten.

## Open Ontology Question

The next ontology revision should decide whether these extensions are true
categorical additions or lifecycle/process overlays:

- Merge Readiness / PR Handoff may belong under deployment handoff rather than
  the core Function ontology.
- Meta-Governance may belong to Factory self-governance rather than Function
  production.
- Policy Activation may be an operational control layer over governance
  proposals rather than a pipeline stage.
