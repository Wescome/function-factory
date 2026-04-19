---
name: factory-meta
version: 2026-04-19
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
  - "every meta-artifact must be tagged SIG-META-* / PRS-META-* / BC-META-* / FP-META-* / FN-META-* / PRD-META-* / etc."
category: meta
---

# Factory-about-the-Factory

The Factory's first application is its own construction. This skill governs
how to produce Factory artifacts that describe the Factory itself.

## When to invoke

- Writing the first Signals (`specs/signals/SIG-META-*.yaml`) — Stage 1
  origin artifacts whose `source` field names the internal origin
  (whitepaper, ConOps, architect correction, build event, agent trace).
- Writing the first Pressures (`specs/pressures/PRS-META-*.yaml`) — Stage 2
  forcing functions derived from the Signals above.
- Writing Capabilities that describe what the Factory must be able to do
  (`specs/capabilities/BC-META-*.yaml`).
- Writing FunctionProposals for Factory components (`specs/functions/FP-META-*.yaml`).
- Drafting PRDs for Factory components (`specs/prds/PRD-META-*.md`).
- Running the compiler against a meta-PRD and capturing Coverage Reports
  (even when failing — especially when failing).

## Core rules

1. **Tag everything `META`.** Signal IDs, Pressure IDs, Capability IDs,
   Function IDs, FunctionProposal IDs, PRD IDs, WorkGraph IDs. The `META`
   prefix signals bootstrap-phase artifacts and lets the Factory later
   distinguish its own construction lineage from first-customer lineage.
   Gate 1 enforces the META- prefix on every artifact ID during Bootstrap
   mode per ConOps §4.1.

2. **Source signals are internal and materialized.** During bootstrap,
   Stage 1 signals come from build events, agent traces, test results,
   architect corrections, and the whitepaper itself — not from
   market/customer/competitor telemetry. The `source` field in an
   ExternalSignal names the internal origin (e.g., `arch-review`,
   `build-event`, or a file path like
   `WeOps/Architecture/inbox/The_Function_Factory_2026-04-18_v4.md`).
   The Signal artifact itself lives in `specs/signals/SIG-META-*.yaml`.
   Signal `source_refs` may be empty because Signals have no upstream
   Factory artifact by category — the external origin is cited in
   `source` instead. See the `lineage-preservation` skill for the audit
   carve-out.

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

- **Do not skip the Signal → Pressure → Capability → FunctionProposal chain.**
  If you have a Function in mind, back it out to the FunctionProposal it
  instantiates, the Capability it implements, the Pressure that justified
  the Capability, and the Signal(s) that produced the Pressure. No
  Functions without full lineage, and no Pressures without at least one
  cited Signal per the ExternalSignal/Pressure schema contract.
- **Do not treat illustrative examples from the whitepaper or the source
  thread as meta-Functions.** `password_reset` is not a Factory meta-
  artifact; it was an expositional device.
- **Do not write invariants without detectors during meta-work.** The
  invariant-authoring skill applies.
- **Do not author a Signal with both empty `source` and empty `source_refs`.**
  A Signal must name its external origin somewhere; a Signal that cites
  neither a Factory artifact (via `source_refs`) nor an external origin
  (via `source`) is ungrounded and cannot be audited. See
  `lineage-preservation` anti-pattern #2.

## Self-rewrite hook

After every 5 meta-artifact creations OR on any Gate 1 failure traceable
to meta-content:
1. Read the last 5 meta entries in `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`
2. Check for recurring Gate 1 failures or Coverage Report patterns
3. If a pattern exists, update the anti-patterns section above
4. Commit: `META: skill-update: factory-meta, {one-line reason}`

Do NOT rewrite this skill on every invocation. Most invocations produce
nothing worth changing.
