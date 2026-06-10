# Linear Integration — Specification Index

Six directions for integrating Linear as a governance surface for the
Function Factory. Directions 1, 3, and 6 collapse into `SPEC-LINEAR-SYNC-SERVICE-001`;
the remaining three have dedicated specs.

| Direction | Description | Spec |
|-----------|-------------|------|
| 1 | WorkGraph atoms as Linear issues (P1/P2 atom + trace state projections) | SPEC-LINEAR-SYNC-SERVICE-001 |
| 2 | Linear as We-layer Disposition Event surface (ff-linear-bridge) | SPEC-FF-LINEAR-BRIDGE-001 |
| 3 | Divergence → Linear issue with A9 elucidation (P3 divergence projection) | SPEC-LINEAR-SYNC-SERVICE-001 |
| 4 | Linear cycle as governance sprint cadence (CycleAwarenessService) | SPEC-FF-CYCLE-HEALTH-001 |
| 5 | Factory commit tracing via FACTORY_* env vars → git trailers → SHA back to Linear | SPEC-FF-COMMIT-TRACING-001 |
| 6 | Factory Health as living Linear document (P4 health document) | SPEC-FF-CYCLE-HEALTH-001 |

## Key architectural finding

Linear is already the We-layer during Bootstrap. The bridge is a
translation layer; the WeOps Console (SPEC-WEOPS-CONSOLE-001) is the
native surface. The `WEOPS_SIGNING_KEY` is shared between the bridge and
the Console — no gateway update required during Phase 1→3 migration.

## Implementation order

1. `SPEC-LINEAR-SYNC-SERVICE-001` — P1 atom projection (unblocks WEO-7/8/9)
2. `SPEC-FF-LINEAR-BRIDGE-001` — bridge webhook handler (unblocks human Dispositions)
3. `SPEC-FF-COMMIT-TRACING-001` — commit tracing (closes lineage loop)
4. `SPEC-FF-CYCLE-HEALTH-001` — cycle cadence + health document (observability)
