# Function Factory

An upstream-to-downstream compiler for trustworthy executable Functions.

**Reference:** `The Function Factory` whitepaper v4 (Celestin, 2026-04-18) in
`/WeOps/Architecture/inbox/The_Function_Factory_2026-04-18_v4.md`

**First application:** the Factory built by the Factory. Every artifact in this
repository carries lineage back to the Pressure that birthed it, the Capability
it implements, the PRD that specified it, the WorkGraph that realized it, and
the Coverage Reports it passed. The repository's own construction is the
bootstrap proof.

## Repository layout

```
.agent/                         # Coding agent entry point. Read AGENTS.md first.
  memory/                       # Four-layer memory (working, episodic, semantic, personal)
  skills/                       # Self-rewriting skill files with YAML frontmatter
  protocols/                    # Tool schemas, permissions, delegation rules
  harness/                      # Conductor hooks (pre/post/on-failure)
  tools/                        # Skill loader, budget tracker, memory writer

packages/                       # TypeScript monorepo (pnpm workspaces)
  schemas/                      # Canonical Zod schemas for every Factory object
  compiler/                     # Stage 5: PRD → WorkGraph (8 passes)
  coverage-gates/               # §6: Gate 1, Gate 2, Gate 3 (fail-closed)
  assurance-graph/              # §5: incident propagation via typed dependencies
  runtime/                      # Stage 7: trust, invariant health, regression
  # Stage 6 coordinator — pending fresh meta-PRD authored per whitepaper §3

specs/                          # Factory artifacts (Factory-built-by-Factory)
  signals/                      # Stage 1 input (ExternalSignal, SIG-*)
  pressures/                    # Stage 2 output
  capabilities/                 # Stage 3 output
  functions/                    # Stage 4 output (FunctionProposals)
  prds/                         # Stage 5 input
  workgraphs/                   # Stage 5 output
  invariants/                   # Invariant + detector specs
  coverage-reports/             # Gate 1/2/3 outputs, timestamped
```

## Bootstrap loop

1. Normalize the first Signals — internal origins (whitepaper, ConOps,
   architect corrections, build events, agent traces) into `specs/signals/`.
2. Write Pressures that cluster those Signals into forcing functions on the
   Factory's own construction.
3. Compile Pressures into Capabilities (what the Factory must be able to do).
4. Generate FunctionProposals for each Capability's execution/control/evidence
   triple.
5. Draft PRDs per FunctionProposal.
6. Run the compiler (Stage 5) against each PRD — even when incomplete, it
   emits Coverage Reports that tell you what's missing.
7. Execute the resulting WorkGraphs via Claude Code or another harness, with
   strict lineage logging into `.agent/memory/episodic/`.
8. Validate against invariants, compute trust, detect regression.
9. Feed runtime drift back as new Signals. Loop.

The Factory's own operational history *is* the proof that the Factory works.

## Conventions

- **Every artifact carries a source-references field.** No exceptions for
  downstream artifacts. Stage 1 Signals are the asymmetric case — their
  upstream is an external artifact (cited in the `source` field), not a
  Factory artifact, so `source_refs` may be empty. See the
  `lineage-preservation` skill for the audit carve-out.
- **Every invariant has a named detector.** Invariants without detectors are
  wishes and are rejected at Gate 1.
- **Every commit is attributable to a Function ID.** Commit messages use the
  format `FN-XXX: summary` or `GATE-N: summary` or `META: summary`.
- **Coverage Reports are first-class artifacts.** They live in
  `specs/coverage-reports/` and are versioned alongside code.
- **Memory is markdown. Skills are markdown. The harness is a thin conductor.**
  This is Avid's rule and it applies here: the agent's intelligence lives in
  the files, not in the loop.

## Quickstart for coding agents

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
6. The three Coverage Gates, fail-closed.

A PR that violates any of the six must be justified in its description or
rejected at review.
