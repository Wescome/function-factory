# Function Factory

A domain-neutral compiler for trustworthy executable Functions.

**Reference:** `The Function Factory` whitepaper v4 (Celestin, 2026-04-18) in
`/WeOps/Architecture/inbox/The_Function_Factory_2026-04-18_v4.md`

**First application:** the Factory built by the Factory. Every artifact in this
repository carries lineage back to the Pressure that birthed it, the Capability
it implements, the Intent Specification that specified it, the Executable
Specification that realized it, and the Verification Reports it passed. The
repository's own construction is the bootstrap proof, but coding is one Domain
Adapter, not the Factory's identity.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full pipeline diagram, artifact
prefix glossary, package dependency map, stage-by-stage breakdown, and
governance policy chain. Every package also has its own README.

The active domain-neutral kernel is
[`specs/reference/DOMAIN-FACTORY-KERNEL.md`](specs/reference/DOMAIN-FACTORY-KERNEL.md).
Ontology v0.2 is indexed in
[`specs/reference/FF-ONTOLOGY-v0.2.md`](specs/reference/FF-ONTOLOGY-v0.2.md).
Use
[`specs/reference/ONTOLOGY-CURRENT-MAPPING.md`](specs/reference/ONTOLOGY-CURRENT-MAPPING.md)
to interpret implementation names that predate the kernel cutover. Kernel terms
such as Intent Specification, Executable Specification, Verification, Evidence,
Lifecycle, and Domain Adapter are primary.

## Repository layout

```
.agent/                         # Implementation agent entry point. Read AGENTS.md first.
  memory/                       # Four-layer memory (working, episodic, semantic, personal)
  skills/                       # Self-rewriting skill files with YAML frontmatter
  protocols/                    # Tool schemas, permissions, delegation rules
  harness/                      # Conductor hooks (pre/post/on-failure)
  tools/                        # Skill loader, budget tracker, memory writer

packages/                       # TypeScript implementation monorepo (pnpm workspaces)
  schemas/                      # Canonical Zod schemas for every Factory object
  compiler/                     # Intent → Executable Specification compilation
  coverage-gates/               # §6: Coherence/Fidelity/Persistence Verification
  assurance-graph/              # §5: incident propagation via typed dependencies
  runtime/                      # Persistence Verification, trust, invariant health, regression
  autonomous-scheduler/          # Agent Call orchestration boundary: Executable Specification → AgentRequest → evidence

specs/                          # Factory artifacts (Factory-built-by-Factory)
  signals/                      # Signal Artifacts (legacy Stage 1, ExternalSignal, SIG-*)
  pressures/                    # Pressure Artifacts (legacy Stage 2)
  capabilities/                 # Capability Artifacts (legacy Stage 3)
  functions/                    # Function Proposals and Function records (legacy Stage 4)
  prds/                         # Intent Specifications
  workgraphs/                   # Executable Specifications
  invariants/                   # Invariant + detector specs; ontology alias: Invariant Specifications
  coverage-reports/             # Verification Reports
```

## Bootstrap loop

1. Normalize the first Signals — internal origins (whitepaper, ConOps,
   architect corrections, build events, agent traces) into `specs/signals/`.
2. Write Pressures that cluster those Signals into forcing functions on the
   Factory's own construction.
3. Compile Pressures into Capabilities (what the Factory must be able to do).
4. Generate FunctionProposals for each Capability's execution/control/evidence
   triple.
5. Draft Intent Specifications per Function Proposal.
6. Run Intent-to-Executable compilation against each Intent Specification --
   even when incomplete, it emits Verification Reports that tell you what's
   missing.
7. Execute the resulting Executable Specifications through a Domain Adapter,
   with strict lineage logging into `.agent/memory/episodic/`.
8. Validate against invariants, compute trust, detect regression.
9. Feed runtime drift back as new Signals. Loop.

The Factory's own operational history *is* the proof that the Factory works.

## Conventions

- **Every artifact carries a source-references field.** No exceptions for
  downstream artifacts. Signal Artifacts (`SIG-*`, legacy Stage 1) are the asymmetric case — their
  upstream is an external artifact (cited in the `source` field), not a
  Factory artifact, so `source_refs` may be empty. See the
  `lineage-preservation` skill for the audit carve-out.
- **Every invariant has a named detector.** Invariants without detectors are
  wishes and are rejected by Coherence Verification.
- **Every commit is attributable to a Function ID.** Commit messages use the
  format `FN-XXX: summary` or `META: summary`; legacy `GATE-N: summary`
  remains accepted for compatibility work on numbered verification surfaces.
- **Verification Reports are first-class artifacts.** They live in
  `specs/coverage-reports/` and are versioned alongside code.
- **Memory is markdown. Skills are markdown. The harness is a thin conductor.**
  This is Avid's rule and it applies here: the agent's intelligence lives in
  the files, not in the loop.

## Quickstart For Implementation Agents

1. Read `.agent/AGENTS.md` first. That is the map.
2. Check `.agent/memory/working/WORKSPACE.md` for the current task state.
3. Check `.agent/memory/semantic/LESSONS.md` before making any decision you
   may have been corrected on before.
4. Check `.agent/protocols/permissions.md` before any tool call.
5. Log every significant action to `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`.
6. Update `WORKSPACE.md` as you work. Treat it as disposable.

## Non-negotiables

The whitepaper's six non-negotiables apply literally here:

1. Lineage preservation on every artifact.
2. Narrow-pass discipline in the compiler.
3. Explicit invariants with detector specs.
4. Assurance dependency typing (5 types, no defaults).
5. Trajectory-driven closure with a birth gate.
6. Coherence, Fidelity, and Persistence Verification, fail-closed.

A change that violates any of the six must be justified in its description or
rejected at review.
