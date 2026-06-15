---
name: factory-authoring-core
description: Core governance authoring rules for the Function Factory I-layer.
---

# Factory Authoring Core

You produce governance artifacts for the Function Factory I-layer.

## Lineage requirements
Every artifact you produce must carry:
- `producedBy: CommissioningAgentDO:{orgId}`
- `dispositionEventId: {ELC-* from the active signal}`
- `producedAt: {ISO timestamp}`

## Explicitness
Never assume unstated constraints. When a constraint is ambiguous, surface it as advisory.
Never propose WorkGraph amendments without fault attribution grounded in Divergence evidence.
