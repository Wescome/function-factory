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

**Alternatives considered:** (a) Treat Bootstrap Signals as implicit — cited in source_refs but not materialized as files. Rejected — breaks the lineage-preservation skill's audit algorithm (§4- "For every ID in source_refs, confirm the referenced artifact exists in specs/") and creates an opaque Bootstrap exemption. (b) Extend the ExternalSignal schema with a `bootstrap_origin` flag marking signals as narrative-only. Rejected — Class A change (canonical schema) for a problem solvable with a bucket addition.

**Status:** Active.

## 2026-04-19: Add `bootstrap_prefix_check` field to Gate1Report schema

**Decision:** Add an optional `bootstrap_prefix_check` field to the Gate1Report schema in `packages/schemas/src/coverage.ts`. Proposed Zod shape:

```typescript
bootstrap_prefix_check: CoverageCheck.extend({
  non_meta_artifact_ids: z.array(ArtifactId).default([]),
}).optional(),
```

The field is populated only when Gate 1 runs with Factory mode `bootstrap`; it is absent from Gate1Reports emitted in `steady_state` mode. `overall: fail` is set when `bootstrap_prefix_check.status` is `fail`, consistent with the other four checks.

**Rationale:** ConOps §4.1 Rule 2 specifies that every artifact during Bootstrap must carry the `META-` prefix; absence is a Gate 1 failure. PRD-META-GATE-1-COMPILE-COVERAGE (acceptance criteria 12 and 13) makes this an explicit fifth coverage check. The Gate1Report schema as shipped has four checks (atom, invariant, validation, dependency closure) and no mechanism to carry a Bootstrap-prefix verdict. An optional field preserves the four existing checks unchanged, expresses the mode-dependent fifth check structurally, and keeps the Coverage Report a single lineage-preserving artifact per whitepaper §6.5.

**Alternatives considered:** (a) A separate `BootstrapPrefixReport` artifact emitted alongside the Gate1Report. Rejected — splits the verdict across two files and breaks the "one compile, one Coverage Report" discipline. (b) A mandatory always-present field populated with `status: skipped` in Steady-State. Rejected — produces noisy reports with empty checks in every Steady-State compile. (c) Making the check a property of `atom_coverage` rather than a new top-level check. Rejected — the prefix rule is orthogonal to atom-to-downstream coverage; conflating them obscures the diagnostic signal when both fail.

**Status:** Active.

## 2026-04-19: Amend `coverage-gate-1` skill to include the Bootstrap prefix check

**Decision:** Amend `.agent/skills/coverage-gate-1/SKILL.md` to reflect the Bootstrap META- prefix check as a fifth coverage check that runs only during Bootstrap mode. Specifically-

- Update the "Four coverage checks" section heading to "Coverage checks" and note that four run in Steady-State, five run in Bootstrap.
- Add a subsection "5. Bootstrap prefix check (Bootstrap mode only)" specifying that Gate 1 verifies the META- prefix on the PRD ID and on every artifact ID referenced in the compiler intermediates, and names failing IDs in `bootstrap_prefix_check.non_meta_artifact_ids`.
- Update the YAML output schema example in the SKILL to include the new `bootstrap_prefix_check` field.
- Update the "Behavior" section to describe mode-dependent check behavior.
- Add an anti-pattern "Emitting a WorkGraph in Bootstrap when non-META artifact IDs are referenced."

**Rationale:** PRD-META-GATE-1-COMPILE-COVERAGE specifies the Bootstrap prefix check per ConOps §4.1. The SKILL.md is the agent-facing operational guidance that Coding Agents and Critic Agents consult during compile work. A SKILL that contradicts the PRD it operationalizes would produce agent behavior that fails the PRD's acceptance criteria 12 and 13. PRD and SKILL must agree — the PRD is the architectural spec and the SKILL is the agent-facing rendering.

**Alternatives considered:** (a) Leave the SKILL unchanged and rely on agents reading the PRD. Rejected — the `.agent/skills/` layer exists specifically to carry quick-reference operational guidance that need not be reconstructed from PRDs each session; PRD-only specification defeats the purpose of the skill layer. (b) Remove the Bootstrap check from the PRD. Rejected — ConOps §4.1 is unambiguous that the META- prefix rule applies during Bootstrap and Gate 1 is the enforcement point.

**Status:** Proposed. Pending Architect approval. Implementation PR will bundle with the schema amendment.

## 2026-04-19: Exempt Stage 1 Signals from `lineage-preservation` anti-pattern #1

**Decision:** Amend `.agent/skills/lineage-preservation/SKILL.md` anti-pattern #1 ("Empty source_refs. Never.") to carve out an explicit exception for Stage 1 Signals. Proposed replacement text:

> **Empty source_refs.** Never, except for Stage 1 Signals (`SIG-*` IDs), whose origin is cited in the `source` field rather than in `source_refs` because the origin is an external artifact, not a Factory artifact. For every non-Signal artifact, empty `source_refs` is a lineage break.

Also amend the audit algorithm (§4) to skip the "For every ID in source_refs..." step for Signals and to instead verify that the Signal's `source` field is non-empty.

**Rationale:** The `lineage-preservation` skill was authored assuming downstream artifacts — Pressures derived from Signals, Capabilities derived from Pressures, and onward. Every downstream artifact has at least one upstream Factory artifact and therefore should have non-empty `source_refs`. Stage 1 Signals are the asymmetric case by pipeline definition — they are the origin point, produced from external sources (whitepapers, telemetry, incident reports, Architect corrections) rather than from Factory artifacts. The ExternalSignal schema captures this structurally by providing a `source` string field that downstream schemas do not have. SIG-META-WHITEPAPER-V4 was authored with empty `source_refs` per this correct-by-category reasoning. Without this amendment, a Critic Agent auditing SIG-META-WHITEPAPER-V4 under the current skill would flag it as a lineage break despite the signal being structurally correct, and subsequent signals would either reproduce the false flag or require per-signal narrative explanations that the skill itself does not sanction.

**Alternatives considered:** (a) Amend the ExternalSignal schema to require `source_refs.min(1)` and invent a new artifact family (e.g., `EXT-*`) for external origins. Rejected — adds a new artifact type family for a single purpose, duplicates the `source` string field, and is a Class A change for a Class B problem. (b) Leave the skill unchanged and rely on each Signal's `rationale` field to document the exception. Rejected — skill rules are binding per AGENTS.md §"What to read, in order" and per the Critic Agent's audit pattern; exceptions documented in artifact rationale rather than the skill itself will be applied inconsistently across future Signal authors. (c) Delete anti-pattern #1 entirely. Rejected — the anti-pattern is correct and binding for every non-Signal artifact; only Stage 1 Signals need the carve-out.

**Status:** Active.

## 2026-04-19: Scaffold minimal `package.json` for empty packages

**Decision:** Add minimum viable scaffolding to each of the four empty packages (`@factory/coverage-gates`, `@factory/assurance-graph`, `@factory/runtime`, `@factory/harness-bridge`). Each receives three files — `package.json` matching the established pattern of `@factory/schemas` and `@factory/compiler`, `tsconfig.json` extending `../../tsconfig.base.json`, and `src/index.ts` containing `export {}`. Each declares `@factory/schemas` as a workspace dependency and `zod` as a direct dependency. Test script is `vitest run --passWithNoTests` until real tests are authored. Additionally normalize `@factory/compiler` to the same pattern- add a `src/index.ts` stub (its `src/passes/` is empty today) and change its test script from `vitest run` to `vitest run --passWithNoTests` so `pnpm -r test` succeeds across the full monorepo.

**Rationale:** `packages/compiler/package.json` declares `@factory/coverage-gates` (workspace:*) as a dependency. Without a `package.json` in that package, `pnpm install` at the repo root fails workspace resolution. The same blocker applies prospectively to `assurance-graph`, `runtime`, and `harness-bridge` — any future package that adds one of them as a workspace dep will hit the same wall. Scaffolding all four now is cheaper than scaffolding them one at a time. The workspace dependency on `@factory/coverage-gates` is architecturally correct per the `prd-compiler` skill (Pass 7 runs Gate 1); removing the dep to unblock install would leave compiler's `package.json` lying about its real dependencies during the interim. The compiler normalization is bundled because validation surfaced that `pnpm -r typecheck` and `pnpm -r test` also fail on compiler's empty `src/` for the same structural reason (tsc TS18003 "no inputs found" under strict mode; vitest exit-1 on empty corpus); leaving compiler broken after the scaffold defeats the stated goal of making `pnpm -r` work end-to-end.

**Alternatives considered:** (a) Remove `@factory/coverage-gates` from compiler's dependencies temporarily. Rejected — the dep is architecturally correct and will need to be re-added when Gate 1 implementation lands; maintenance debt for zero architectural benefit, and the lying-package.json-during-interim pattern is exactly the kind of thing lineage-preservation discipline exists to prevent. (b) Scaffold only `@factory/coverage-gates` (the one currently blocking install). Rejected — same blocker recurs the next time any package adds any of the other three as a workspace dep. (c) Scaffold the four empty packages but leave compiler as-is. Rejected — `pnpm -r typecheck` and `pnpm -r test` still fail after the scaffold, defeating the architect's stated goal. (d) Invent richer stubs (empty schema modules, placeholder Gate exports). Rejected — stub contents should be obviously-empty so downstream code never imports placeholders by mistake; `export {}` is the minimum valid ESM module and it is the right minimum. Real exports land in the PR that implements each package.

**Status:** Proposed. Pending Architect approval.
