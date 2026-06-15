---
name: commerce-signal-pattern-library
description: Commerce signal pattern library for pattern-appraisal phase.
---

# Commerce Signal Pattern Library

Used during pattern-appraisal phase for comeflow-commerce vertical.

## Patterns

### P1 — Cart Abandonment Spike
**Match condition**: Signal describes a measurable increase in cart abandonment rate.
**Factory-addressable**: true
**Rationale**: Factory can author a WorkGraph targeting checkout flow optimisation.

### P2 — Inventory Mismatch
**Match condition**: Signal describes discrepancy between online inventory and warehouse stock.
**Factory-addressable**: true
**Rationale**: Factory can produce a sync automation WorkGraph.

### P3 — General Market Trend
**Match condition**: Signal describes broad consumer trend without a specific operational metric.
**Factory-addressable**: false
**Rationale**: Not addressable without a concrete conversion or fulfilment metric.
