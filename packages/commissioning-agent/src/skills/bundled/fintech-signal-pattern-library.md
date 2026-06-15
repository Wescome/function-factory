---
name: fintech-signal-pattern-library
description: Fintech-compliance signal pattern library for pattern-appraisal phase.
---

# Fintech Signal Pattern Library

Used during pattern-appraisal phase for fintech-compliance vertical.

## Patterns

### P1 — Compliance Report Delay
**Match condition**: Signal describes a delayed or missing regulatory filing.
**Factory-addressable**: true
**Rationale**: Factory can author a WorkGraph targeting automated report generation.

### P2 — KYC/AML Gap
**Match condition**: Signal describes a gap in Know-Your-Customer or Anti-Money-Laundering coverage.
**Factory-addressable**: true
**Rationale**: Factory can produce a screening automation WorkGraph.

### P3 — General Regulatory Landscape Noise
**Match condition**: Signal describes general regulatory uncertainty without a specific compliance deadline.
**Factory-addressable**: false
**Rationale**: Not addressable without a concrete regulatory deadline or requirement.
