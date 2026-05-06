# Architecture And Reference Index

This directory contains the Function Factory architecture/reference corpus:
canonical references, ADRs, design notes, reviews, research, assessments, and
session handoffs. Files are indexed in place because several are canonical or
lineage-relevant inputs.

## Status Authority

When a file's header status conflicts with
[`../../.agent/memory/semantic/DECISIONS.md`](../../.agent/memory/semantic/DECISIONS.md),
the decision log is the current authority. This index records current
interpretation where known and calls out conflicts instead of silently editing
source documents.

## Canonical Spine

Read these first when grounding work in the architecture.

| Document | Current status | Role |
| --- | --- | --- |
| [`literate-canonical-reference.md`](literate-canonical-reference.md) | Canonical architecture reference | Implementation-facing reference and literate source for generated/tangled code. |
| [`The_Function_Factory_2026-04-18_v4.md`](The_Function_Factory_2026-04-18_v4.md) | Conceptual source | Whitepaper defining the Factory, pipeline, non-negotiables, and category boundaries. |
| [`The_Function_Factory_ConOps_2026-04-18.md`](The_Function_Factory_ConOps_2026-04-18.md) | Operational source | Concept of Operations for how the Factory is operated. |
| [`ONTOLOGICAL-SELF-SENSING-2026-05-03.md`](ONTOLOGICAL-SELF-SENSING-2026-05-03.md) | Strategic self-assessment | Applies the Factory's ontology-sensing frame to the Factory itself; clarifies that AGENTS.md/spec.md/tasks.md should be emitted portable views, not replacements for native typed artifacts. |
| [`ADR-003-pi-sdk-default-executor.md`](ADR-003-pi-sdk-default-executor.md) | Active per decision log; header still says proposed | Establishes Pi SDK as default Coder/Tester executor. |
| [`FULL-PI-DEPLOYMENT-ARCHITECTURE.md`](FULL-PI-DEPLOYMENT-ARCHITECTURE.md) | Active per decision log; header still says draft | Current deployment architecture amended by ADR-003. |
| [`SDLC-ARCHITECTURE.md`](SDLC-ARCHITECTURE.md) | Active per decision log; header still says draft | Lifecycle layer above deployment architecture. |
| [`ROUTING-PHILOSOPHY.md`](ROUTING-PHILOSOPHY.md) | Active | Model-routing decision framework. |

## Superseded Or Historical

| Document | Status | Notes |
| --- | --- | --- |
| [`FINAL-DEPLOYMENT-ARCHITECTURE.md`](FINAL-DEPLOYMENT-ARCHITECTURE.md) | Superseded by `FULL-PI-DEPLOYMENT-ARCHITECTURE.md` per decision log | Keep for history and comparison. |
| [`SESSION-HANDOFF-2026-04-28.md`](SESSION-HANDOFF-2026-04-28.md) | Historical handoff | Cold-start/session transfer context from 2026-04-28. |
| [`PHASE5-PI-SDK-SPEC-v3.md`](PHASE5-PI-SDK-SPEC-v3.md) | Superseded by v4 hybrid spec | Keep as design history. |
| [`PHASE5-V4-HYBRID-AGENTS-SANDBOX.md`](PHASE5-V4-HYBRID-AGENTS-SANDBOX.md) | Spec v4 | Currenter than v3; check decisions before treating as authoritative. |

## ADRs

Architecture ADRs in this directory are part of the Factory reference corpus.
Repository/process ADRs are indexed separately in
[`../../docs/adr/README.md`](../../docs/adr/README.md).

| ADR | Header status | Current interpretation |
| --- | --- | --- |
| [`ADR-003-pi-sdk-default-executor.md`](ADR-003-pi-sdk-default-executor.md) | Proposed | Active per `DECISIONS.md`; header status is stale. |
| [`ADR-004-custom-graph-runner-over-langgraph.md`](ADR-004-custom-graph-runner-over-langgraph.md) | Accepted | Custom graph-runner decision. |
| [`ADR-005-vertical-slicing-execution.md`](ADR-005-vertical-slicing-execution.md) | Proposed | Vertical slicing execution design; check later review/design docs before applying. |
| [`ADR-006-workers-ai-stream-adapter.md`](ADR-006-workers-ai-stream-adapter.md) | Proposed | Workers AI stream adapter proposal. |
| [`ADR-007-output-reliability-layer.md`](ADR-007-output-reliability-layer.md) | Proposed | Output reliability layer proposal. |
| [`ADR-008-self-healing-factory.md`](ADR-008-self-healing-factory.md) | Proposed | Self-healing Factory proposal. |

## Design Notes

| Document | Purpose |
| --- | --- |
| [`ARCHITECTURE-TIAGO-FACTORY-INTERACTION.md`](ARCHITECTURE-TIAGO-FACTORY-INTERACTION.md) | Describes the boundary between the human-facing governor harness and autonomous Factory infrastructure. |
| [`DESIGN-CONDUCTOR-DO.md`](DESIGN-CONDUCTOR-DO.md) | Generalized multi-agent orchestration Durable Object design. |
| [`DESIGN-CRYSTALLIZER.md`](DESIGN-CRYSTALLIZER.md) | Crystallizer semantic fidelity design. |
| [`DESIGN-CRYSTALLIZER-NEXT.md`](DESIGN-CRYSTALLIZER-NEXT.md) | Approved next-priority crystallizer design notes. |
| [`DESIGN-DIFF-ATOMS.md`](DESIGN-DIFF-ATOMS.md) | Diff-based atom code generation design. |
| [`DESIGN-GOVERNOR-AGENT.md`](DESIGN-GOVERNOR-AGENT.md) | GovernorAgent design. |
| [`PIPELINE-SEMANTIC-GROUNDING.md`](PIPELINE-SEMANTIC-GROUNDING.md) | Semantic grounding proposal for the pipeline. |
| [`SIGNAL-TAXONOMY-CLOSED-WORLD.md`](SIGNAL-TAXONOMY-CLOSED-WORLD.md) | Closed-world signal taxonomy contract. |
| [`ORIENTATION-ONTOLOGY.md`](ORIENTATION-ONTOLOGY.md) | Orientation-agent ontology. |
| [`PAI-TO-PI-AI-ARCHITECTURE.md`](PAI-TO-PI-AI-ARCHITECTURE.md) | PAI-to-pi-ai migration architecture proposal. |

## Reviews And Assessments

| Document | Purpose |
| --- | --- |
| [`GOVERNOR-PROMPT-ENGINEERING-REVIEW.md`](GOVERNOR-PROMPT-ENGINEERING-REVIEW.md) | Prompt-engineering review of GovernorAgent design. |
| [`REVIEW-VERTICAL-SLICING-CONVERGENCE.md`](REVIEW-VERTICAL-SLICING-CONVERGENCE.md) | Review of ADR-005 and vertical slicing convergence. |
| [`SE-ASSESSMENT-LLM-OUTPUT-RELIABILITY.md`](SE-ASSESSMENT-LLM-OUTPUT-RELIABILITY.md) | Systems-engineering assessment of output reliability. |
| [`SE-ASSESSMENT-VERTICAL-SLICING.md`](SE-ASSESSMENT-VERTICAL-SLICING.md) | Systems-engineering assessment of vertical slicing. |
| [`SE-GAP-ANALYSIS-TIAGO-GOVERNOR.md`](SE-GAP-ANALYSIS-TIAGO-GOVERNOR.md) | Gap analysis between TIAGO/PAI and GovernorAgent. |
| [`SE-REVIEW-CONDUCTOR-DO.md`](SE-REVIEW-CONDUCTOR-DO.md) | Systems-engineering review of ConductorDO. |
| [`GDK-PLATFORM-ANALYSIS.md`](GDK-PLATFORM-ANALYSIS.md) | GDK substrate analysis. |
| [`CRYSTALLIZER-LESSONS-FOR-PAI.md`](CRYSTALLIZER-LESSONS-FOR-PAI.md) | Crystallizer lessons applicable to PAI. |

## Research And Explanation

| Document | Purpose |
| --- | --- |
| [`CONTEXT-IS-NOT-COMPREHENSION-2026-04-24.md`](CONTEXT-IS-NOT-COMPREHENSION-2026-04-24.md) | Internal reference on limits of context injection. |
| [`ONTOLOGICAL-SELF-SENSING-2026-05-03.md`](ONTOLOGICAL-SELF-SENSING-2026-05-03.md) | Self-application analysis comparing the Factory ontology to Software 3.0/spec-driven development, including AGENTS.md emission, vocabulary translation, model-routing reevaluation, and ontology-layer positioning. |
| [`RESEARCH-PAPER-CLOSED-LOOP-SYNTHESIS.md`](RESEARCH-PAPER-CLOSED-LOOP-SYNTHESIS.md) | Research paper framing Function Factory as closed-loop synthesis. |
| [`cognitive-runtime-integration-whitepaper.md`](cognitive-runtime-integration-whitepaper.md) | Companion whitepaper connecting Function Factory and layered cognitive runtime. |

## Agent-Facing Markdown Views

`AGENTS.md`, `spec.md`, `tasks.md`, and similar files are treated as portable
agent-facing views that the Factory can emit from native artifacts. They do not
replace the typed internal artifact graph (`PRS-*`, `BC-*`, `FP-*`, `PRD-*`,
`WG-*`, `INV-*`, `CR-*`) or its `source_refs` lineage. The current strategic
reference for this boundary is
[`ONTOLOGICAL-SELF-SENSING-2026-05-03.md`](ONTOLOGICAL-SELF-SENSING-2026-05-03.md).

## Known Friction To Resolve Later

| Issue | Impact |
| --- | --- |
| Header status conflicts with `DECISIONS.md` in some canonical docs. | Agents can mistake draft/proposed headers for current truth. |
| ADRs are split between `docs/adr/` and `specs/reference/`. | Requires explicit indexing and later migration decision if consolidation is desired. |
| `ARCHITECTURE.md` may contain stale compiler-pass sequencing. | Use package/compiler docs and current PRDs before changing implementation based on that section. |
| `specs/reference/` mixes canonical references, designs, reviews, research, and handoffs. | This index classifies in place; do not move files without link and lineage checks. |

## Diataxis Rule For This Directory

Most files here are reference or explanation. They stay here for now because
their authority comes from Factory decisions, lineage, and usage by tooling or
agents, not from their Diataxis quadrant.
