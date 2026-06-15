---
name: healthcare-acceptance-criteria
description: Healthcare-operations acceptance criteria for workgraph-authoring phase.
---

# Healthcare Acceptance Criteria

Used during workgraph-authoring phase.

## Required checks before dispatch
- All atoms have at least one INV-* binding
- All blocking constraints from DomainProfile are addressed
- PRD contains a testable compliance success condition for each atom
- No atom references a tool not in the HIPAA-permitted toolset
