<!--
APPEND TO: .agent/memory/semantic/DECISIONS.md

These are the remaining proposed entries from the 2026-04-19 bundle
pending Architect approval per ConOps §5.3. Each is a Class B
architectural change per ConOps §12.1 and does not take effect until
the Architect merges them (converting Status from "Proposed" to
"Active") and the corresponding implementation PR lands. Both were
surfaced by PRD-META-GATE-1-COMPILE-COVERAGE during Bootstrap chain
authoring on 2026-04-19 and should be reviewed as a bundle because
their implementation work is coupled (schema → skill).

Decisions #1 and #4 from the original bundle were activated on
2026-04-19 (see DECISIONS.md for the recorded entries) and removed
from this file to avoid confusion about which entries remain pending.

Remove this comment block before appending.
-->

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
