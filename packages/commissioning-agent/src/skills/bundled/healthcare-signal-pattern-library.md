---
name: healthcare-signal-pattern-library
description: Healthcare-operations signal pattern library for pattern-appraisal phase.
---

# Healthcare Signal Pattern Library

Used during pattern-appraisal phase for healthcare-operations vertical.

## Patterns

### P1 — Patient Throughput Bottleneck
**Match condition**: Signal describes measurable delay in patient throughput at a specific care step.
**Factory-addressable**: true
**Rationale**: Factory can author a WorkGraph targeting workflow automation at the bottleneck step.

### P2 — Compliance Reporting Gap
**Match condition**: Signal describes a missing or delayed compliance report.
**Factory-addressable**: true
**Rationale**: Factory can produce a reporting automation WorkGraph.

### P3 — Regulatory Change Noise
**Match condition**: Signal describes general regulatory landscape change without a specific operational gap.
**Factory-addressable**: false
**Rationale**: Not addressable without a concrete workflow or reporting requirement.
