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
Compilation harness that transforms Intent Specifications (Intent Specifications) into
Executable Specifications (Executable Specifications).
Triggers: "compile Intent Specification", "compile spec", "generate Executable Specification", "Stage 5",
"run the compiler"

## coherence-verification
Coherence Verification charter. Runs before Executable Specification assembly.
Verifies atom coverage, invariant coverage, validation coverage, and dependency
closure. Fails closed.
Triggers: "Coherence Verification", "compile completeness", "coherence verification", "verification check
before executable-specification"

## fidelity-verification
Fidelity Verification charter. Runs before lifecycle promotion beyond verified
execution evidence. Verifies scenario coverage, invariant exercise, and
required-validation pass rate.
Triggers: "Fidelity Verification", "simulation coverage", "promote to monitored",
"scenario coverage"

## persistence-verification
Persistence Verification charter. Runs continuously. Verifies detector
freshness, evidence source liveness, and audit pipeline integrity. Transitions
Functions to `assurance regressed` on failure.
Triggers: "Persistence Verification", "assurance coverage", "detector freshness", "monitoring
liveness"

## function-proposer
Generates Function proposals from Capability deltas or from Trajectories
(via ProblemFrames). Enforces execution/control/evidence/integration
typing and birth-verification scoring.
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
