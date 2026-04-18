# Skill Registry

Read this file on every session start. Load full `SKILL.md` files only when
a trigger phrase matches.

## factory-meta
Describes how the Factory is being built by the Factory. Invoked when the
agent needs to understand the bootstrap context or produce a Factory-about-
the-Factory artifact.
Triggers: "bootstrap", "factory about the factory", "meta function",
"self-application"

## prd-compiler
The eight-pass compiler that transforms PRDs into WorkGraphs. Stage 5 of the
Factory pipeline.
Triggers: "compile PRD", "compile spec", "generate WorkGraph", "Stage 5",
"run the compiler"

## coverage-gate-1
Compile Coverage Gate. Runs between `consistency_check` and
`assemble_workgraph`. Verifies atom coverage, invariant coverage, validation
coverage, and dependency closure. Fails closed.
Triggers: "Gate 1", "compile coverage", "compile gate", "coverage check
before workgraph"

## coverage-gate-2
Simulation Coverage Gate. Runs in Stage 7 before `verified` → `monitored`
transition. Verifies scenario coverage, invariant exercise, and required-
validation pass rate.
Triggers: "Gate 2", "simulation coverage", "promote to monitored",
"scenario coverage"

## coverage-gate-3
Assurance Coverage Gate. Runs continuously. Verifies detector freshness,
evidence source liveness, and audit pipeline integrity. Transitions Functions
to `assurance regressed` on failure.
Triggers: "Gate 3", "assurance coverage", "detector freshness", "monitoring
liveness"

## function-proposer
Generates Function proposals from Capability deltas or from Trajectories
(via ProblemFrames). Enforces execution/control/evidence/integration
typing and birth-gate scoring.
Triggers: "propose function", "function proposal", "capability delta",
"trajectory-driven birth"

## invariant-authoring
Writes invariants with complete detector specs. Rejects invariants without
named evidence sources, direct rules, regression policies, and incident
tags.
Triggers: "write invariant", "author invariant", "detector spec", "declare
invariant"

## lineage-preservation
Ensures every artifact has a populated `source_refs` array and an
explicitness tag on every derived field. Called by every other skill's
output stage.
Triggers: "check lineage", "verify source refs", "explicitness audit"

## memory-manager
Reads, scores, and consolidates memory entries. Triggers reflection cycles
when memory exceeds size thresholds or after task completion.
Triggers: "reflect", "what did I learn", "compress memory", "consolidate
episodes"

## skillforge
Creates new skills from observed patterns. When the agent notices it is
performing a repeated task without a skill, it drafts one.
Triggers: "create skill", "new skill", "I keep doing this manually",
"recurring task"
