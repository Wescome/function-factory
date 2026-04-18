---
name: factory-meta
version: 2026-04-18
triggers:
  - "bootstrap"
  - "factory about the factory"
  - "meta function"
  - "self-application"
tools: [bash, view, create_file, str_replace]
preconditions: []
constraints:
  - "do not produce Work Orders (those are WeOps, not Factory)"
  - "do not propose external-vertical Functions before the Factory itself is complete"
  - "every meta-artifact must be tagged PRS-META-* / BC-META-* / FN-META-* / etc."
category: meta
---

# Factory-about-the-Factory

The Factory's first application is its own construction. This skill governs
how to produce Factory artifacts that describe the Factory itself.

## When to invoke

- Writing the first Pressures (`specs/pressures/PRS-META-*.yaml`).
- Writing Capabilities that describe what the Factory must be able to do
  (`specs/capabilities/BC-META-*.yaml`).
- Writing FunctionProposals for Factory components (`specs/functions/FP-META-*.yaml`).
- Drafting PRDs for Factory components (`specs/prds/PRD-META-*.md`).
- Running the compiler against a meta-PRD and capturing Coverage Reports
  (even when failing — especially when failing).

## Core rules

1. **Tag everything `META`.** Pressure IDs, Capability IDs, Function IDs,
   PRD IDs, WorkGraph IDs. The `META` prefix signals bootstrap-phase
   artifacts and lets the Factory later distinguish its own construction
   lineage from first-customer lineage.

2. **Source signals are internal.** During bootstrap, Stage 1 signals come
   from build events, agent traces, test results, architect corrections,
   and the whitepaper itself — not from market/customer/competitor
   telemetry. The `source` field in an ExternalSignal should name the
   internal origin (e.g., `arch-review`, `build-event`, `whitepaper-v4`).

3. **The first Pressures already exist in the whitepaper.** The six
   non-negotiables in §11 are effectively six Pressures in narrative form.
   Translate them into formal Pressure objects:
   - PRS-META-LINEAGE-PRESERVATION
   - PRS-META-NARROW-PASS-DISCIPLINE
   - PRS-META-INVARIANT-DETECTOR-COMPLETENESS
   - PRS-META-ASSURANCE-DEPENDENCY-TYPING
   - PRS-META-TRAJECTORY-CLOSURE-WITH-BIRTH-GATE
   - PRS-META-THREE-COVERAGE-GATES

4. **The first Capabilities are the Factory's own required abilities.**
   - BC-META-COMPILE-PRD-TO-WORKGRAPH
   - BC-META-EXECUTE-WORKGRAPH-VIA-AGENTS
   - BC-META-COMPUTE-TRUST-FROM-EVIDENCE
   - BC-META-DETECT-REGRESSION
   - BC-META-PROPAGATE-INCIDENTS
   - BC-META-PROPOSE-FUNCTIONS-FROM-DRIFT
   - BC-META-ENFORCE-COVERAGE-GATES

5. **Each Capability yields the execution/control/evidence triple.**
   Per whitepaper §3 Stage 3 guardrail #2. Integration Functions appear
   when Capability requires external substrate (git, CI, Dropbox, etc.).

6. **Coverage Reports are the primary v0 output.** A Coverage Report on a
   meta-PRD — even a failing one — is the most valuable artifact the
   Factory can produce during bootstrap. It proves the Factory is checking
   itself by the same discipline it will later apply to customers.

## Anti-patterns

- **Do not skip the Pressure → Capability → FunctionProposal chain.** If
  you have a Function in mind, back it out to the Capability it implements
  and the Pressure that justified it. No Functions without lineage.
- **Do not treat illustrative examples from the whitepaper or the source
  thread as meta-Functions.** `password_reset` is not a Factory meta-
  artifact; it was an expositional device.
- **Do not write invariants without detectors during meta-work.** The
  invariant-authoring skill applies.

## Self-rewrite hook

After every 5 meta-artifact creations OR on any Gate 1 failure traceable
to meta-content:
1. Read the last 5 meta entries in `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`
2. Check for recurring Gate 1 failures or Coverage Report patterns
3. If a pattern exists, update the anti-patterns section above
4. Commit: `META: skill-update: factory-meta, {one-line reason}`

Do NOT rewrite this skill on every invocation. Most invocations produce
nothing worth changing.
