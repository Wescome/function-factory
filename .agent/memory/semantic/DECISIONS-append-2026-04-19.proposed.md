<!--
APPEND TO: .agent/memory/semantic/DECISIONS.md

These are proposed entries pending Architect approval per ConOps §5.3. Each is
a Class B architectural change per ConOps §12.1 and does not take effect until
the Architect merges them (converting Status from "Proposed" to "Active") and
the corresponding implementation PRs land. All four were surfaced by
PRD-META-GATE-1-COMPILE-COVERAGE during Bootstrap chain authoring on 2026-04-19
and should be reviewed as a bundle because their implementation work is
coupled (schema → skill → skill → README/layout).

Remove this comment block before appending.
-->

## 2026-04-19: Add `specs/signals/` bucket for Stage 1 Signal artifacts

**Decision:** Add a new bucket `specs/signals/` to the repository layout for Stage 1 ExternalSignal artifacts (`SIG-*` IDs). Amend the README.md repo layout table to include it. Update the `factory-meta` skill's "When to invoke" section to name Signal authoring as a Bootstrap-relevant activity alongside Pressures, Capabilities, FunctionProposals, and PRDs.

**Rationale:** The Pressure schema in `packages/schemas/src/core.ts` requires `derivedFromSignalIds: z.array(ArtifactId).min(1)`. The ArtifactId regex in `packages/schemas/src/lineage.ts` requires the referenced ID to match `SIG-*`. The `lineage-preservation` skill requires every cited artifact ID to resolve to a file in `specs/`. Prior to this decision, those three constraints jointly required a specs/signals/ bucket that did not exist, leaving the Bootstrap chain (Signal → Pressure → Capability → FunctionProposal → PRD) uncommittable by design. The first Signal authored under this decision is SIG-META-WHITEPAPER-V4, which produces PRS-META-THREE-COVERAGE-GATES and the rest of the Gate 1 lineage chain.

**Alternatives considered:** (a) Treat Bootstrap Signals as implicit — cited in source_refs but not materialized as files. Rejected — breaks the lineage-preservation skill's audit algorithm (§4- "For every ID in source_refs, confirm the referenced artifact exists in specs/") and creates an opaque Bootstrap exemption. (b) Extend the ExternalSignal schema with a `bootstrap_origin` flag marking signals as narrative-only. Rejected — Class A change (canonical schema) for a problem solvable with a bucket addition.

**Status:** Proposed. Pending Architect approval.

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

**Status:** Proposed. Pending Architect approval. Implementation PR will land alongside the skill amendments below.

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

**Status:** Proposed. Pending Architect approval. Can land independently of decisions 2 and 3 if the Architect prefers to sequence the skill amendments before the schema PR.
