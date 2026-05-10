# Addendum A: Legacy Numbering Concordance

**Purpose:** The Factory was originally designed using numbered stages (1-7), numbered gates (1-3), and numbered compiler passes (1-8). These numbers appear in ConOps documents, early SKILL.md files, conversation history, memory artifacts, and the Dropbox archive. This addendum maps every legacy number to its ontological name so that no one has to reconstruct the mapping from scattered sources.

This addendum is a *historical reference*, not an architectural document. The ontology (ONTOLOGY.md) is authoritative. If a conflict exists between a legacy-numbered document and the ontology, the ontology wins.

---

## Pipeline Stages

| Legacy name | Ontological category | What it does |
|-------------|---------------------|--------------|
| Stage 1 | Signal Artifact (collection) | Captures raw observations from the environment - market events, user reports, metric breaches, competitor actions - before interpretation |
| Stage 2 | Pressure Artifact (interpretation) | Interprets signals into named demands with metrics - claims that a class of need exists |
| Stage 3 | Capability Artifact (scoping) | Names organizational abilities that would address pressures, with acceptance criteria |
| Stage 4 | Function Proposal (decomposition) | Scopes deliverable units of value with defined inputs, outputs, and boundaries |
| Stage 5 (input) | Intent Specification (authoring) | The conceptual world model of a system that does not yet exist - the compiler's input |
| Stage 5 (output) | Executable Specification (compilation) | The procedural world model - a compiled state machine that a transformer can maintain |
| Stage 6 | Agent Call execution (orchestration) | Orchestrator delegates contracted agent calls to workers who execute executable specification nodes |
| Stage 7 | Persistence Verification (continuous assurance) | Unbounded monitoring that deployed invariant detectors remain fresh and regression surfaces remain covered |

---

## Verification Gates

| Legacy name | Ontological category | What it verifies | Temporal extent |
|-------------|---------------------|-----------------|-----------------|
| Coherence Verification | Coherence Verification | Structural completeness - every claim bound, every constraint edged, every obligation monitored | Synchronic (snapshot) |
| Fidelity Verificationa | Fidelity Verification (learned) | Behavioral correspondence - simulated execution consistent with intent, using a trained model | Bounded (simulation horizon) |
| Fidelity Verificationb | Fidelity Verification (deterministic) | Behavioral correspondence - deterministic checks against intent specification claims | Bounded (test suite) |
| Persistence Verification | Persistence Verification | Continuous assurance - deployed detectors fresh, monitors active, regression surfaces covered | Unbounded (lifetime of deployed system) |

---

## Compiler Passes

| Legacy name | Ontological category | Tier conversion |
|-------------|---------------------|-----------------|
| Pass 1 | Decomposition | Conceptual -> conceptual (narrative -> atomic claims) |
| Pass 2 | Binding | Conceptual -> constraint (claims -> typed contracts) |
| Pass 3 | Obligation Extraction | Conceptual -> procedural (claims -> monitored invariants with detector specs) |
| Pass 4 | Structural Assembly (dependency resolution) | Constraint -> procedural (contract dependencies -> directed edges) |
| Pass 5 | Structural Assembly (validation wiring) | Constraint -> procedural (validation conditions -> gate triggers) |
| Pass 6 | Structural Assembly (graph construction) | Procedural -> procedural (all bound elements -> executable specification graph) |
| Pass 7 | Completeness Certification | Procedural -> procedural (internal self-check: every atom bound, every contract typed, every invariant detected) |
| Pass 8 | Instruction Tuning (future) | Procedural -> procedural (post-compilation optimization of instruction text using execution traces) |

**Note:** Passes 4-6 were three implementation steps of a single ontological transformation kind (Structural Assembly). The ontology treats them as one category. Implementation may subdivide as needed, but the subdivision is an engineering choice, not a categorical distinction.

---

## Artifact ID Prefixes

These prefixes appear in schemas and in the specs/ directory naming convention. They remain valid as implementation identifiers but are not ontological names.

| Prefix | Ontological category |
|--------|---------------------|
| PRS- | Pressure Artifact |
| BC- | Capability Artifact |
| FP- / FN- | Function Proposal |
| IS- | Intent Specification |
| ES- | Executable Specification |
| INV- | Invariant Specification |
| VR- | Verification Report |

---

## SKILL.md File Mapping

| Legacy skill file | Ontological role | Charter or harness? |
|-------------------|-----------------|---------------------|
| factory-meta/SKILL.md | Factory bootstrap harness skill | Harness |
| prd-compiler/SKILL.md | Compilation harness skill | Harness |
| coherence-verification/SKILL.md | Coherence verification enforcement | Charter |
| fidelity-verification/SKILL.md | Fidelity verification enforcement | Charter |
| persistence-verification/SKILL.md | Persistence verification enforcement | Charter |
| invariant-authoring/SKILL.md | Invariant authoring harness skill | Harness |
| lineage-preservation/SKILL.md | Lineage discipline enforcement | Charter |
| memory-manager/SKILL.md | Memory management harness skill | Harness |

---

## Where Legacy Numbers Still Appear

After the Phase A refactoring, these numbers should be gone from the repo. Until then, they appear in:

- `.agent/AGENTS.md` - entry map references Stage 1-7, Coherence Verification-3
- `.agent/skills/*.SKILL.md` - all eight files use numbered references
- `packages/schemas/src/core.ts` - schema names (Intent SpecificationSchema, Executable SpecificationSchema)
- `packages/schemas/src/coverage.ts` - gate-numbered report types
- `.agent/memory/semantic/DECISIONS.md` - architectural decisions reference stages
- `.agent/memory/semantic/LESSONS.md` - lessons reference stages and gates
- `.agent/memory/episodic/AGENT_LEARNINGS.jsonl` - log entries reference stages
- ConOps documents in Dropbox (77KB Factory ConOps, 104KB WeOps ConOps) - stage-numbered throughout
- Conversation history across Claude projects - extensive stage/gate numbering

The ConOps documents and conversation history cannot be retroactively renamed. This concordance exists so that anyone encountering legacy numbers in those documents can map them to current ontological names without guessing.

---

*This addendum is part of FF-ONTOLOGY v0.2.*
