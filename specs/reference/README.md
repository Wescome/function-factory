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
| [`DOMAIN-FACTORY-KERNEL.md`](DOMAIN-FACTORY-KERNEL.md) | Active architecture anchor | Defines the domain-neutral kernel vocabulary and makes coding one Domain Adapter rather than the Factory identity. Read before coding-adapter or physical refactor work. |
| [`FF-ONTOLOGY-v0.2.md`](FF-ONTOLOGY-v0.2.md) | Newest architecture reference; working document | Ontology anchor for current architecture vocabulary and categorical structure. Use with the compatibility mapping before proposing renames. |
| [`FF-ONTOLOGY-ADDENDUM-A.md`](FF-ONTOLOGY-ADDENDUM-A.md) | Ontology v0.2 addendum; historical-number concordance | Maps legacy stages, gates, compiler passes, artifact prefixes, and skill files to ontology terms. Use when interpreting numbered source material; do not treat it as approval for physical renames. |
| [`ONTOLOGY-ADDENDUM-B-STAGE-EXTENSIONS.md`](ONTOLOGY-ADDENDUM-B-STAGE-EXTENSIONS.md) | Repo-local stage extension concordance | Maps current Stage 8/8.5/9/10 compatibility labels to primary process interpretations until the ontology receives a later revision. |
| [`ONTOLOGY-CURRENT-MAPPING.md`](ONTOLOGY-CURRENT-MAPPING.md) | Current implementation-to-kernel crosswalk | Maps existing repo terms, paths, packages, verification terms, and runtime concepts to domain-kernel terms; legacy implementation names are migration debt, not the target architecture. |
| [`ONTOLOGY-CUTOVER-CONSTRAINTS.json`](ONTOLOGY-CUTOVER-CONSTRAINTS.json) | Machine-readable hard-cutover guardrails | Lists current physical surfaces, package names, forbidden replacement paths, and forbidden collection identifiers enforced by `pnpm audit:ontology`. |
| [`EXECUTION-LAYER-REFACTOR-FIRST-CUT.md`](EXECUTION-LAYER-REFACTOR-FIRST-CUT.md) | Active execution layer refactor backlog | Names the first no-compatibility-baggage code slices and the active source residues they must remove. |
| [`EXECUTION-PACKET.md`](EXECUTION-PACKET.md) | Active Execution Packet contract | Defines the immutable harness-facing packet that the execution layer consumes after Instruction Tuning. |
| [`INSTRUCTION-TUNING-SPEC.md`](INSTRUCTION-TUNING-SPEC.md) | Active compiler transformation draft | Defines the transformation from Executable Specification to Execution Packet. |
| [`EXECUTION-PACKET-IMPLEMENTATION-PLAN.md`](EXECUTION-PACKET-IMPLEMENTATION-PLAN.md) | Active Execution Packet implementation roadmap | Orders the schema, compiler, runtime, Verification, and audit work needed to implement packet-driven Trellis execution. |
| [`BOOTSTRAP-GOAL-SET.md`](BOOTSTRAP-GOAL-SET.md) | Active planning reference | Goal and epic set for moving from verification-clean post-Stage-5 bootstrap through Gas City IP-1, Fidelity intake, Persistence monitoring, amendment, and operationalization. |
| [`GAS-CITY-HARNESS-RUNTIME-PROVIDER-ARCHITECTURE.md`](GAS-CITY-HARNESS-RUNTIME-PROVIDER-ARCHITECTURE.md) | Draft architecture reference | Defines the Gas City runtime-provider layer that generalizes Pi, OpenShell, Cloudflare Sandbox, and other executors under the harness/evaluator tuple before implementation specs. |
| [`ONTOLOGY-RENAME-BLAST-RADIUS.md`](ONTOLOGY-RENAME-BLAST-RADIUS.md) | Pre-refactor assessment | Classifies current-name usage across source, specs, workers, infra, and docs; recommends no physical rename before one-family migration plans exist. |
| [`ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md`](ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md) | Rename proposal template | Required structure for any future one-family physical rename proposal. |
| [`ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md`](ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md) | Refactor readiness checklist | Required preflight checklist before any ontology-aligned physical rename or refactor. |
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
| [`FF-REFACTORING-PLAN.md`](FF-REFACTORING-PLAN.md) | Stale-baseline roadmap | Directionally useful ontology-alignment plan, but written against an older skeleton repo. Do not execute mass renames from it without the compatibility checks in `ONTOLOGY-CURRENT-MAPPING.md`. |
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
| [`ADR-011-workspace-seeding.md`](ADR-011-workspace-seeding.md) | Proposed | Workspace seeding for PI container execution — options analysis, pending Wes +/-. |

## Design Notes

| Document | Purpose |
| --- | --- |
| [`ARCHITECTURE-TIAGO-FACTORY-INTERACTION.md`](ARCHITECTURE-TIAGO-FACTORY-INTERACTION.md) | Describes the boundary between the human-facing governor harness and autonomous Factory infrastructure. |
| [`DESIGN-CONDUCTOR-DO.md`](DESIGN-CONDUCTOR-DO.md) | Generalized multi-agent orchestration Durable Object design. |
| [`DESIGN-CRYSTALLIZER.md`](DESIGN-CRYSTALLIZER.md) | Crystallizer semantic fidelity design. |
| [`DESIGN-CRYSTALLIZER-NEXT.md`](DESIGN-CRYSTALLIZER-NEXT.md) | Approved next-priority crystallizer design notes. |
| [`DESIGN-DIFF-ATOMS.md`](DESIGN-DIFF-ATOMS.md) | Diff-based atom code generation design. |
| [`DESIGN-GOVERNOR-AGENT.md`](DESIGN-GOVERNOR-AGENT.md) | GovernorAgent design. |
| [`FACTORY-LEARNING-ARCHITECTURE.md`](FACTORY-LEARNING-ARCHITECTURE.md) | Reviewed and foundation-implemented architecture for the repo-native Factory learning substrate that precedes any Dream DO rollout. |
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
replace the typed internal artifact graph (`PRS-*`, `BC-*`, `FP-*`, `IS-*`,
`ES-*`, `INV-*`, `VR-*`) or its `source_refs` lineage. The current strategic
reference for this boundary is
[`ONTOLOGICAL-SELF-SENSING-2026-05-03.md`](ONTOLOGICAL-SELF-SENSING-2026-05-03.md).

## Domain Adapter Rule

The Factory kernel is domain-neutral. Coding, GitHub, pull requests, branches,
diffs, CI checks, repositories, and deployments are coding-adapter terms. They
may appear in adapter docs and historical references, but they must not be
introduced as kernel categories in active architecture. The current anchor for
this rule is [`DOMAIN-FACTORY-KERNEL.md`](DOMAIN-FACTORY-KERNEL.md).

## Legacy Number Policy

Historical source documents, prior handoffs, decision entries, episodic memory,
and archived ConOps material may contain legacy stage, gate, and pass numbers.
Do not rewrite them just to modernize vocabulary. Use
[`FF-ONTOLOGY-ADDENDUM-A.md`](FF-ONTOLOGY-ADDENDUM-A.md) and
[`ONTOLOGY-ADDENDUM-B-STAGE-EXTENSIONS.md`](ONTOLOGY-ADDENDUM-B-STAGE-EXTENSIONS.md)
to interpret those numbers. Active docs and new code should lead with ontology
terms and keep numbered labels only when describing historical artifacts or
deferred migration surfaces.

## Known Friction To Resolve Later

| Issue | Impact |
| --- | --- |
| Header status conflicts with `DECISIONS.md` in some canonical docs. | Agents can mistake draft/proposed headers for current truth. |
| ADRs are split between `docs/adr/` and `specs/reference/`. | Requires explicit indexing and later migration decision if consolidation is desired. |
| `ARCHITECTURE.md` may contain stale compiler-pass sequencing. | Use package/compiler docs and current Intent Specifications before changing implementation based on that section. |
| `specs/reference/` mixes canonical references, designs, reviews, research, and handoffs. | This index classifies in place; do not move files without link and lineage checks. |

## Diataxis Rule For This Directory

Most files here are reference or explanation. They stay here for now because
their authority comes from Factory decisions, lineage, and usage by tooling or
agents, not from their Diataxis quadrant.
