# Major Decisions

Past architectural choices that would be costly to revisit. Do not
re-litigate without explicit architect approval.

## 2026-04-18: Factory built by the Factory as first application
**Decision:** The first application of the Factory is the Factory's own
construction. Every Function in the Factory codebase carries lineage back to
a Pressure that birthed it.
**Rationale:** Any other first vertical requires onboarding a domain
simultaneously with building the architecture, which will eat architecture
time. Self-application provides rich signal telemetry (build events, CI,
agent traces), a self-evident domain, and — critically — a lineage that
doubles as bootstrap proof.
**Alternatives considered:** Healthcare verticals (too much domain onboarding
for v1), RevOps (was an earlier candidate but rejected as not
architecture-proving), password reset (an illustrative example from source
material, not a real candidate).
**Status:** Active.

## 2026-04-18: Function as the canonical executable unit
**Decision:** Use `Function` as the single-word name for the core executable
unit. All other candidates (Capability, Instrument, Decision-Capability,
Governed Capability, Workflow, Feature, Service) are rejected.
**Rationale:** Function executes, composes, is testable, is governable, is
monitorable, and maps cleanly to both code and mathematics. Every other
candidate was either too static, too narrow, too procedural, too product-y,
or too implementation-bound.
**Alternatives considered:** See §2 of whitepaper v4.
**Status:** Active. Reversal would require rewriting the whitepaper.

## 2026-04-18: Pressure stays as the runtime object; Forcing Function is the formal concept
**Decision:** Keep `Pressure` as the runtime object name in schemas, code,
and artifacts. Introduce `Forcing Function` as the formal concept Pressure
implements. Same pattern as Work Order / commissioned work.
**Rationale:** Pressure is already throughout the schemas and TypeScript
code. Renaming would be destructive. Forcing Function is the right formal
lineage (control theory) and the right rhetorical lineage (SWOT); keeping it
as the concept rather than the runtime name gives both benefits without
breaking implementation.
**Status:** Active.

## 2026-04-18: WorkGraph is not Work Order
**Decision:** A WorkGraph (Factory-produced typed DAG) and a Work Order
(WeOps-governed organizational act) are distinct objects at distinct layers.
Factory tooling must not produce Work Orders and must not pretend to govern
them.
**Rationale:** Conflation erases the I/We boundary. See §2.1 and §8 of
whitepaper v4.
**Status:** Active. Any schema or function that blurs the two is a PR
rejection.

## 2026-04-18: Three Coverage Gates, all fail-closed
**Decision:** Gate 1 (Compile, end of Stage 5), Gate 2 (Simulation, before
verified → monitored), and Gate 3 (Assurance, continuous) are all required,
all fail-closed, and all produce lineage-preserving Coverage Reports.
**Rationale:** Trust computation without coverage is a claim rather than a
proof. Each gate closes a different failure mode (incomplete spec,
untested implementation, silent assurance loss). Any gate missing makes the
whole trust model aspirational.
**Alternatives considered:** Soft warnings instead of fail-closed (rejected —
the scoreboard would lie); single consolidated gate (rejected — different
failure modes need different stages).
**Status:** Active. All three must exist in v1.

## 2026-04-18: Repository agent infrastructure follows the thin-conductor pattern
**Decision:** The `.agent/` layer uses the four-layer memory model, skill
files with YAML frontmatter and self-rewrite hooks, typed protocol schemas,
and a harness that stays thin. Memory, skills, and protocols are all
markdown/JSON in git. The harness is a ~200-line conductor.
**Rationale:** Avid's builder pattern (2026-04-15), Harrison Chase's "your
harness, your memory" principle, and the Zhou et al. externalization
framework all converge on this shape. It is also the right shape for the
Factory because the Factory's own construction artifacts need to be
inspectable, diffable, and lineage-preserving.
**Status:** Active.

## 2026-04-18: Commit message format is artifact-ID-prefixed
**Decision:** Every commit message begins with an artifact ID prefix:
`FN-XXX: summary`, `GATE-N: summary`, `META: summary`, or `INFRA: summary`.
**Rationale:** Lineage preservation requires that every change be
attributable to a Function, a Gate, a Factory-about-the-Factory task, or
repository infrastructure. Untyped commits break the lineage graph.
**Status:** Active. Enforced via git hook (TODO).

## 2026-04-19: Add `specs/signals/` bucket for Stage 1 Signal artifacts
**Decision:** Add a new bucket `specs/signals/` to the repository layout for Stage 1 ExternalSignal artifacts (`SIG-*` IDs). Amend the README.md repo layout table to include it. Update the `factory-meta` skill's "When to invoke" section to name Signal authoring as a Bootstrap-relevant activity alongside Pressures, Capabilities, FunctionProposals, and PRDs.
**Rationale:** The Pressure schema in `packages/schemas/src/core.ts` requires `derivedFromSignalIds: z.array(ArtifactId).min(1)`. The ArtifactId regex in `packages/schemas/src/lineage.ts` requires the referenced ID to match `SIG-*`. The `lineage-preservation` skill requires every cited artifact ID to resolve to a file in `specs/`. Prior to this decision, those three constraints jointly required a specs/signals/ bucket that did not exist, leaving the Bootstrap chain (Signal → Pressure → Capability → FunctionProposal → PRD) uncommittable by design. The first Signal authored under this decision is SIG-META-WHITEPAPER-V4, which produces PRS-META-THREE-COVERAGE-GATES and the rest of the Gate 1 lineage chain.
**Alternatives considered:** (a) Treat Bootstrap Signals as implicit — cited in source_refs but not materialized as files. Rejected — breaks the lineage-preservation skill's audit algorithm (§4 "For every ID in source_refs, confirm the referenced artifact exists in specs/") and creates an opaque Bootstrap exemption. (b) Extend the ExternalSignal schema with a `bootstrap_origin` flag marking signals as narrative-only. Rejected — Class A change (canonical schema) for a problem solvable with a bucket addition.
**Status:** Active.

## 2026-04-19: Exempt Stage 1 Signals from `lineage-preservation` anti-pattern #1
**Decision:** Amend `.agent/skills/lineage-preservation/SKILL.md` anti-pattern #1 ("Empty source_refs. Never.") to carve out an explicit exception for Stage 1 Signals. Replacement text:

> **Empty source_refs.** Never, except for Stage 1 Signals (`SIG-*` IDs), whose origin is cited in the `source` field rather than in `source_refs` because the origin is an external artifact, not a Factory artifact. For every non-Signal artifact, empty `source_refs` is a lineage break.

Also amend the audit algorithm (§4) to skip the "For every ID in source_refs..." step for Signals and to instead verify that the Signal's `source` field is non-empty.
**Rationale:** The `lineage-preservation` skill was authored assuming downstream artifacts — Pressures derived from Signals, Capabilities derived from Pressures, and onward. Every downstream artifact has at least one upstream Factory artifact and therefore should have non-empty `source_refs`. Stage 1 Signals are the asymmetric case by pipeline definition — they are the origin point, produced from external sources (whitepapers, telemetry, incident reports, Architect corrections) rather than from Factory artifacts. The ExternalSignal schema captures this structurally by providing a `source` string field that downstream schemas do not have. SIG-META-WHITEPAPER-V4 was authored with empty `source_refs` per this correct-by-category reasoning. Without this amendment, a Critic Agent auditing SIG-META-WHITEPAPER-V4 under the current skill would flag it as a lineage break despite the signal being structurally correct, and subsequent signals would either reproduce the false flag or require per-signal narrative explanations that the skill itself does not sanction.
**Alternatives considered:** (a) Amend the ExternalSignal schema to require `source_refs.min(1)` and invent a new artifact family (e.g., `EXT-*`) for external origins. Rejected — adds a new artifact type family for a single purpose, duplicates the `source` string field, and is a Class A change for a Class B problem. (b) Leave the skill unchanged and rely on each Signal's `rationale` field to document the exception. Rejected — skill rules are binding per AGENTS.md §"What to read, in order" and per the Critic Agent's audit pattern; exceptions documented in artifact rationale rather than the skill itself will be applied inconsistently across future Signal authors. (c) Delete anti-pattern #1 entirely. Rejected — the anti-pattern is correct and binding for every non-Signal artifact; only Stage 1 Signals need the carve-out.
**Status:** Active.
