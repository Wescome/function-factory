---
name: gtm-acceptance-criteria
description: GTM-engineering acceptance criteria for workgraph-authoring phase.
---

# GTM Acceptance Criteria

Used during workgraph-authoring phase to validate the authored WorkGraph.

## Required checks before dispatch
- All atoms have at least one INV-* binding
- All blocking constraints from DomainProfile are addressed in the WorkGraph
- PRD artifact contains a testable success condition for each atom
- No atom references an unknown tool
- WorkGraph includes a measurable conversion metric as the terminal success condition
