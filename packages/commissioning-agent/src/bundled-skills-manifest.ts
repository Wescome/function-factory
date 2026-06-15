/**
 * @factory/commissioning-agent — bundled skills manifest
 *
 * T1 bundled skill content, imported at build time.
 * Real domain content is filled in per GAP-008; these are functional stubs.
 *
 * IMPORTANT: Each key MUST match the name after 'bundled:' in DOMAIN_SKILL_REGISTRY.
 */

// Inline imports as string literals — bundler resolves at build time.
// Using explicit string maps avoids dynamic `import()` which is not
// available in Cloudflare Workers without a loader.

export const BUNDLED_SKILLS: Record<string, string> = {
  'factory-authoring-core': `---
name: factory-authoring-core
description: Core governance authoring rules for the Function Factory I-layer.
---

# Factory Authoring Core

You produce governance artifacts for the Function Factory I-layer.

## Lineage requirements
Every artifact you produce must carry:
- \`producedBy: CommissioningAgentDO:{orgId}\`
- \`dispositionEventId: {ELC-* from the active signal}\`
- \`producedAt: {ISO timestamp}\`

## Explicitness
Never assume unstated constraints. When a constraint is ambiguous, surface it as advisory.
Never propose WorkGraph amendments without fault attribution grounded in Divergence evidence.
`,

  'gtm-signal-pattern-library': `---
name: gtm-signal-pattern-library
description: GTM-engineering signal pattern library for pattern-appraisal phase.
---

# GTM Signal Pattern Library

Used during pattern-appraisal phase for gtm-engineering vertical.

## Patterns

### P1 — Pipeline Conversion Drop
**Match condition**: Signal describes a measurable drop in funnel conversion at a specific stage.
**Factory-addressable**: true
**Rationale**: Factory can author a WorkGraph targeting the gap between lead qualification and close.

### P2 — ICP Definition Gap
**Match condition**: Signal indicates the team lacks a documented Ideal Customer Profile.
**Factory-addressable**: true
**Rationale**: Factory can produce an ICP definition artifact from available data.

### P3 — Market Noise / Unactionable Signal
**Match condition**: Signal is general market commentary without a specific conversion or adoption metric.
**Factory-addressable**: false
**Rationale**: Not addressable without a concrete adoption or revenue metric target.
`,

  'gtm-candidate-evaluation': `---
name: gtm-candidate-evaluation
description: GTM-engineering candidate scoring for deliberation phase.
---

# GTM Candidate Evaluation

Used during deliberation phase.

## Scoring criteria
Score each candidate on:
- Strategic fit with GTM domain (0–10)
- Feasibility given current WorkGraph capacity (0–10)
- Risk of blocking constraint violation (0–10, lower = lower risk)

Nominate the highest-scoring feasible candidate.
`,

  'gtm-fault-attribution': `---
name: gtm-fault-attribution
description: GTM-engineering fault attribution for hypothesis-formation phase.
---

# GTM Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003).

## Attribution framework
For each Divergence in the GTM domain, attribute fault to one of:
- SPECIFICATION_GAP: the WorkGraph did not capture a required GTM behaviour (e.g. missing ICP qualifier)
- TOOLING_FAILURE: a permitted tool produced incorrect output (e.g. CRM enrichment tool returned stale data)
- INVARIANT_MISMATCH: the atom's INV-* binding does not match the actual pipeline stage constraint
- ENVIRONMENTAL: external dependency failure (e.g. Salesforce API downtime)

Every Hypothesis must state: fault category, evidence chain from Divergence trace, proposed scope of amendment.
`,

  'gtm-acceptance-criteria': `---
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
`,

  'healthcare-signal-pattern-library': `---
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
`,

  'healthcare-candidate-evaluation': `---
name: healthcare-candidate-evaluation
description: Healthcare-operations candidate scoring for deliberation phase.
---

# Healthcare Candidate Evaluation

Used during deliberation phase.

## Scoring criteria
Score each candidate on:
- Patient outcome impact (0–10)
- Compliance risk of blocking constraint violation (0–10, lower = lower risk)
- Feasibility given current WorkGraph capacity (0–10)

Nominate the highest-scoring feasible candidate.
`,

  'healthcare-fault-attribution': `---
name: healthcare-fault-attribution
description: Healthcare-operations fault attribution for hypothesis-formation phase.
---

# Healthcare Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003).

## Attribution framework
For each Divergence in the healthcare domain, attribute fault to one of:
- SPECIFICATION_GAP: the WorkGraph did not capture a required clinical workflow step
- TOOLING_FAILURE: a permitted integration produced incorrect output (e.g. EHR API returned stale record)
- INVARIANT_MISMATCH: the atom's INV-* binding does not match the actual regulatory constraint
- ENVIRONMENTAL: external system failure (e.g. HIE downtime)
`,

  'healthcare-acceptance-criteria': `---
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
`,

  'commerce-signal-pattern-library': `---
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
`,

  'commerce-candidate-evaluation': `---
name: commerce-candidate-evaluation
description: Commerce candidate scoring for deliberation phase.
---

# Commerce Candidate Evaluation

Used during deliberation phase.

## Scoring criteria
Score each candidate on:
- Revenue impact (0–10)
- Customer experience improvement (0–10)
- Feasibility given current WorkGraph capacity (0–10)

Nominate the highest-scoring feasible candidate.
`,

  'commerce-fault-attribution': `---
name: commerce-fault-attribution
description: Commerce fault attribution for hypothesis-formation phase.
---

# Commerce Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003).

## Attribution framework
For each Divergence in the commerce domain, attribute fault to one of:
- SPECIFICATION_GAP: the WorkGraph did not capture a required commerce workflow step
- TOOLING_FAILURE: a permitted tool produced incorrect output (e.g. payment processor returned stale status)
- INVARIANT_MISMATCH: the atom's INV-* binding does not match the actual checkout constraint
- ENVIRONMENTAL: external dependency failure (e.g. payment gateway downtime)
`,

  'fintech-signal-pattern-library': `---
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
`,

  'fintech-candidate-evaluation': `---
name: fintech-candidate-evaluation
description: Fintech-compliance candidate scoring for deliberation phase.
---

# Fintech Candidate Evaluation

Used during deliberation phase.

## Scoring criteria
Score each candidate on:
- Regulatory risk reduction (0–10)
- Feasibility given compliance toolset (0–10)
- Audit traceability (0–10)

Nominate the highest-scoring feasible candidate.
`,

  'fintech-fault-attribution': `---
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
`,

  'fintech-acceptance-criteria': `---
name: fintech-acceptance-criteria
description: Fintech-compliance acceptance criteria for workgraph-authoring phase.
---

# Fintech Acceptance Criteria

Used during workgraph-authoring phase.

## Required checks before dispatch
- All atoms have at least one INV-* binding with a regulatory reference
- All blocking constraints from DomainProfile are addressed
- PRD contains a testable compliance success condition
- Every tool referenced has an audit-log binding
`,
}
