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

**Status:** Active.

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

**Status:** Active.

## 2026-04-19: Ship compiler MVP for Gate 1 bootstrap proof

**Decision:** Ship minimum viable Stage 5 compiler (Passes 0–7, skipping Pass 8 WorkGraph assembly) as `@factory/compiler`. Implements seven pure passes plus an IO-bearing orchestrator and CLI, consuming the real `PRD-META-GATE-1-COMPILE-COVERAGE.md` and producing a Gate 1 Coverage Report. First bootstrap compile- `overall: pass` (all five coverage checks green). 29 atoms, 3 contracts, 3 invariants, 0 dependencies, 3 validations produced; Coverage Report emitted to `specs/coverage-reports/CR-PRD-META-GATE-1-COMPILE-COVERAGE-GATE1-<timestamp>.yaml`. Full monorepo typecheck/test/build green (68 tests total- 10 schemas + 50 coverage-gates + 8 compiler e2e).

**Rationale:** Closes the bootstrap loop per the whitepaper. Per the PRD's own closing section- "Whether that compile passes or fails on its first run is not the point. The Coverage Report from that first compile is the artifact that matters." The first compile passed, which means Gate 1 as specified is internally complete- every RequirementAtom extracted from the PRD has a downstream Contract/Invariant/ValidationSpec reference, every Invariant has a covering Validation and a well-formed DetectorSpec, every Validation backmaps to ≥1 artifact, every generated artifact ID carries the `META-` qualifier per ConOps §4.1 Rule 2. The Coverage Report itself is now the first non-scaffolding Factory artifact committed to `specs/coverage-reports/` — the evidence the Factory is checking itself by the discipline it will apply to every subsequent artifact.

**Alternatives considered:** (a) Implement all 8 compiler passes including WorkGraph assembly. Rejected — the Coverage Report is the bootstrap proof; a WorkGraph is additive and does not strengthen the proof. (b) Hand-author the first Coverage Report without building a compiler. Rejected — that would prove the schema and Gate 1 work on a synthetic example, not that the full pipeline (parse → extract → derive → gate → emit) is compositionally correct against a real PRD. (c) General-purpose compiler rather than MVP. Rejected — open-ended; the minimal closing-the-loop implementation is more valuable right now than a production-ready parser.

**Deferred follow-ups flagged during draft review:**

1. *Hardcoded atom subject/action/object.* Pass 1 assigns `subject: "Gate 1"`, `action: "shall"`, full criterion text in `object`. The MVP does not parse natural language into structured triples. A follow-up should implement a proper NL extractor (tokenize, identify auxiliary verbs, split) or propose relaxing the PRDDraft schema to not require the triple. Ship-as-is accepted by Architect.

2. *Contract IDs use `FN-` prefix with `-CONTRACT-` internal segment.* The `ArtifactId` regex does not permit a `CONTRACT-` prefix. A follow-up should propose adding `CONTRACT` as an allowed `ArtifactId` type prefix in `packages/schemas/src/lineage.ts` (Class B schema change per ConOps §12.1, requiring its own DECISIONS entry). Until then, contract IDs look like Function IDs from the outside, which is an audit readability concern. Ship-as-is accepted by Architect.

3. *`FactoryMode` defined in `@factory/coverage-gates` rather than `@factory/schemas`.* Currently derived as `Gate1Input["mode"]` since Gate 1 is the canonical consumer. `FactoryMode` is a Factory-wide concept (whitepaper §5, ConOps §4.1) and architecturally belongs in `@factory/schemas/core.ts`. A follow-up should promote it- add `export const FactoryMode = z.enum(["bootstrap", "steady_state"])` to core.ts, update `Gate1Input` and compiler types to import from there. Ship-as-is accepted by Architect.

**Observation from the bootstrap compile worth capturing:**

Pass 3 (invariant derivation) uses four hand-crafted templates (DETERMINISM, FAIL-CLOSED, LINEAGE, EMISSION) matched against constraint-category atoms only. On the first bootstrap compile, three invariants emitted (DETERMINISM, FAIL-CLOSED, LINEAGE) but EMISSION did not fire. Investigation- the PRD's emission wording ("Gate 1 writes the Gate1Report to specs/coverage-reports/...") lives in Acceptance Criterion 8, not in the Constraints section, and Pass 3 only inspects constraint-category atoms. A follow-up should decide between (a) extending template matching across all atom categories, or (b) treating the category-scoping as intentional and ensuring emission-class properties are authored as constraints not AC. This is the first piece of operational information the Factory has recorded about its own behavior- exactly the kind of diagnostic the whitepaper frames the bootstrap proof around, and exactly the self-rewrite-hook trigger condition named in `coverage-gate-1/SKILL.md`.

**Status:** Active.

## 2026-04-19: Promote FactoryMode to canonical Zod enum; add CONTRACT artifact prefix

**Decision:** Promote `FactoryMode` from a TypeScript type derived from `Gate1Input["mode"]` in `packages/compiler/src/types.ts` into a canonical Zod enum in `packages/schemas/src/core.ts`. Add `CONTRACT` to the `ArtifactId` prefix alternation in `packages/schemas/src/lineage.ts` and to `META_PREFIX_REGEX` in `packages/coverage-gates/src/checks.ts`. Contract ID emission format changes from `FN-${subject}-CONTRACT-${tag}` to `CONTRACT-${subject}-${tag}` in Pass 2 (`packages/compiler/src/passes/02-derive-contracts.ts`), with the matching lookup in Pass 3 (`packages/compiler/src/passes/03-derive-invariants.ts`) updated in lockstep. `compiler/types.ts` re-exports `FactoryMode` so compiler-local callers continue to import it from `./types.js` without reaching into schemas directly.

**Rationale:** `FactoryMode` is a Factory-wide concept (whitepaper §5, ConOps §4.1) — promoting it to `@factory/schemas` gives the enum one source of truth at the schema layer rather than the inter-package type derivation that previously made `@factory/coverage-gates` the de-facto owner of an enum it conceptually doesn't own. Contracts were previously emitted with IDs like `FN-META-GATE-1-COMPILE-COVERAGE-CONTRACT-CONSTRAINT`, collapsing them into the Function-ID namespace with an internal `-CONTRACT-` disambiguation segment — audit-unreadable once Coverage Reports accumulate. A dedicated `CONTRACT-` prefix makes Contracts first-class artifacts. `META_PREFIX_REGEX` in coverage-gates must stay in sync with the `ArtifactId` regex in schemas; invariant comment added in both files. No existing artifacts in `specs/` carry the old `FN-*-CONTRACT-*` format — the one prior bootstrap compile was superseded by a fresh compile run against the new schema, which again produced `overall: pass` across all five checks. Pass 2 (contract emission) and Pass 3 (contract lookup) now share an implicit contract on ID format; a follow-up PR should extract that into a shared helper to eliminate drift risk.

**Alternatives considered:** (a) Leave both as-is (ship the compiler MVP with `FN-*-CONTRACT-*` IDs and inline mode union). Originally accepted; reconsidered because contracts would enter the lineage graph under the wrong namespace and the lying-namespace-during-interim pattern is exactly what lineage-preservation discipline exists to prevent. (b) Add `CONTRACT` prefix only, leave FactoryMode derived. Rejected — same architectural-cleanliness argument applies to FactoryMode; bundling both into one paired schemas PR is cheaper than two sequential PRs. (c) Extract the shared contract-ID helper in this PR. Rejected for scope discipline — prefix rename and enum promotion are the scope; the helper refactor is a separate Class B change captured as a follow-up.

**Status:** Active.

## 2026-04-19: Extract shared `contractId` helper for Pass 2 and Pass 3

**Decision:** Extract contract-ID construction into a shared helper at `packages/compiler/src/passes/_shared.ts` exporting `contractId(prdId, tag)`. Both Pass 2 (emission, `02-derive-contracts.ts`) and Pass 3 (lookup, `03-derive-invariants.ts`) import the helper and call it at the single point where contract IDs are constructed. One source of truth for the `CONTRACT-${subject}-${tag}` format.

**Rationale:** The 2026-04-19 paired schemas PR (`fb5b3e8`) flagged that Pass 2 and Pass 3 duplicated contract-ID template-literal construction — the two sites must produce byte-identical strings for Pass 3's `.find()` lookup to resolve against Pass 2's emission, and independent template literals meant silent drift risk on any future format change. The refactor is zero-behavior-change: byte-identical Coverage Report verified between the pre-refactor compile (`CR-*-14-51-03-281Z.yaml`) and the post-refactor compile (`CR-*-15-09-33-804Z.yaml`), modulo the expected `id` and `timestamp` fields. With the helper, format changes (prefix rename, subject-derivation tweak, tag canonicalization) apply to both passes automatically; reviews of contract-ID-format changes have one file to read; the helper is unit-testable in isolation. 3 new unit tests (`_shared.test.ts`) cover the format contract directly, bringing the monorepo total to 86 tests green.

**Alternatives considered:** (a) Leave the two sites independent; rely on discipline + a code comment to keep them in sync. Rejected — the whole point of the paired-PR DECISIONS entry flagging this follow-up was that implicit contracts between passes are exactly the drift-risk surface the Factory's lineage-preservation discipline is meant to eliminate. (b) Inline the lookup into Pass 2 and have Pass 3 receive the constraint-contract reference directly. Rejected — Pass 2 returns a `Contract[]` with deterministic ordering; changing the return shape would ripple across the compiler orchestrator. The helper approach is the smaller surface-area change.

**Status:** Active.

## 2026-04-19: Document compiler-consumed vs informational PRD section convention

**Decision:** Amend `prd-compiler/SKILL.md` to name which PRD section titles are compiler-consumed by Pass 0 and which are conventionally informational (human-audience) and therefore silently dropped to `unrecognizedSections`. Three known informational title patterns documented: `## Shared <X> shape`, `## Schema <X> required` / `## Schema additions required`, `## Downstream artifacts <X> will enable`. Placement guidance added: informational sections go at `##` after the compiler-consumed block for readability. Convention is documentation, not enforcement.

**Rationale:** Two successive Factory PRDs (PRD-META-GATE-1-COMPILE-COVERAGE and PRD-META-DETECT-REGRESSION) have authored H2 sections that the compiler silently ignores — three such sections in the first ("Shared GateEvaluator shape", "Schema amendment required", "Downstream artifacts Gate 1 will enable"), two in the second ("Shared ControlFunction shape", "Schema additions required"), with overlapping titles across both. The pattern is now systematic, not a quirk of one PRD. The compiler's silence on these sections is intentional in the current MVP — they carry design communication, not pipeline input — but the silence is invisible to authors and downstream readers. Documenting the convention in the prd-compiler skill makes the compiler's intended behavior explicit and names which section patterns are safe for human-audience content versus which would be extraction losses. Version on prd-compiler/SKILL.md bumped 2026-04-18 → 2026-04-19.

**Alternatives considered:** (a) Relocate informational content into `## Notes` or the PRD frontmatter's `rationale` field. Rejected — imposes structural burden on every future PRD for no root-cause gain; authors will drift back to H2 out of habit and the compiler would still silently ignore the H2 title anyway. (b) Extend Pass 0 to emit UncertaintyEntry artifacts for every unrecognized section so the compiler's inaction is audit-trailed. Architecturally correct per the whitepaper's UncertaintyEntry design — this is exactly the "compiler cannot confidently produce" case UncertaintyEntry was designed for. Deferred as a future compiler amendment; the convention documented here matches current reality and unblocks skill-doc alignment immediately. The option-(b) work becomes a separate DECISIONS entry when Pass 0 gets its next real amendment.

**Status:** Active.

## 2026-04-19: Gate 1 general-case validation via PRD-META-DETECT-REGRESSION

**Observation:** Second meta-PRD compiled through the Stage 5 pipeline without modification and produced a passing Coverage Report at `specs/coverage-reports/CR-PRD-META-DETECT-REGRESSION-GATE1-2026-04-19T15-18-09-677Z.yaml`. Intermediates: 29 atoms, 3 contracts, 4 invariants, 0 dependencies, 4 validations. All five coverage checks (atom_coverage, invariant_coverage, validation_coverage, dependency_closure, bootstrap_prefix_check) pass. Compile commit `6412bc1`.

**What this establishes:** Semantic-content generality of Pass 0–7 across two PRDs with distinct subject matter — Gate 1's PRD is compile-time / structural / per-invocation; detect_regression's is runtime / evidence-driven / stateful. The compiler's pass logic is not co-evolved exclusively with Gate 1's content. Pass 3's EMISSION template fired for the first time on this PRD (Gate 1's emission wording was in AC section; detect_regression's is in Constraints section), confirming the constraint-category scoping is architecturally correct and the earlier non-firing was a PRD-authoring-scope consequence rather than a compiler gap.

**What this does NOT establish:** Authoring-convention generality. Both PRDs conform to the `prd-compiler` SKILL's section-title conventions (same six H2 titles, identical Constraints subsection structure, numbered AC lists). PRDs authored outside that convention surface would stress Pass 0's case-insensitive exact-match section mapping in ways neither compile tested. See the "compiler-consumed vs informational PRD section convention" DECISIONS entry above for the related documentation. The 29/29 atom-count identity across both PRDs is arithmetic (both happened to have ~15 ACs plus similar paragraph counts), not a compiler property — the compiler produces PRD-shape-proportional counts, not numerically-invariant counts.

**Side finding:** The self-rewrite hooks on `coverage-gate-1/SKILL.md` and `prd-compiler/SKILL.md` did not fire on this compile. Both hooks trigger on downstream failure traceable to a coverage miss the gate should have caught; Gate 1 passed cleanly on both PRDs; no downstream failure occurred. The hook mechanism is proven quiescent in the pass case — future firings can be interpreted as signal, not noise from overeager triggering.

**Status:** Observed.

**Status convention note:** This is the first DECISIONS entry with `Status: Observed`. Observed entries record empirical proof points that do not require Architect approval and do not impose any effect; they are captured for audit reference. Proposed/Active remain the status values for architectural decisions (entries that require approval and take effect on activation). Observed entries may use a different field structure from Proposed/Active entries (Observation / What this establishes / What this does NOT establish / optional Side finding / Status) reflecting the empirical-proof-point nature rather than the decision-lifecycle nature.

## 2026-04-19: Gate 1 architectural generality — three-compile empirical evidence

**Context:** Gate 1 was bootstrapped by compiling its own meta-PRD (PRD-META-GATE-1-COMPILE-COVERAGE) through the compiler it itself governs, which produced Gate 1: PASS. That result alone was self-referential and did not establish that Gate 1's coverage discipline would generalize to PRDs with different semantic shape. An earlier 2-compile Observed entry (commit `8bc3a11`) recorded the first generalization proof point against PRD-META-DETECT-REGRESSION. This entry extends that record with the third compile and tightens the claim against the atom-count-identity reading that the 2-compile evidence alone could not rule out.

**Observation:** Three non-failing compiles against semantically divergent PRDs, same compiler, no code changes between runs:

| Compile | PRD | Atoms | Contracts | Invariants | Dependencies | Validations | Verdict |
|---|---|---|---|---|---|---|---|
| 2026-04-19T13:56Z | PRD-META-GATE-1-COMPILE-COVERAGE | 29 | 3 | 3 | 0 | 3 | PASS |
| 2026-04-19T15:18Z | PRD-META-DETECT-REGRESSION | 29 | 3 | 4 | 0 | 4 | PASS |
| 2026-04-19T15:50Z | PRD-META-COMPILER-PASS-8 | 31 | 3 | 4 | 0 | 4 | PASS |

The three PRDs cover different semantic domains (compile-time structural, runtime stateful, execution assembly) and different Factory Function types (two control functions, one execution function). All five coverage checks passed on all three compiles with empty detail arrays. The invariant count varied with PRD content (3 vs 4 vs 4) rather than remaining constant, demonstrating that Pass 3's template matching is content-responsive rather than PRD-shape-patterning. The atom count broke the 29/29 identity from the first two compiles on the third (came in at 31), confirming that the prior identity was arithmetic-consequence-of-content-density rather than a compiler invariant.

**Claim established:** Gate 1's coverage discipline generalizes beyond the Gate 1 PRD. The compile pipeline is not fitted to its own specification. This is the whitepaper's central architectural commitment ("the Factory checks itself and checks things that aren't itself by the same discipline") and now has three independent compiles of evidence behind it. Generality claim scoped to semantic-content axis; authoring-convention generality remains unproven, per the 2026-04-19 compiler-consumed vs informational DECISIONS entry — all three PRDs conform to the prd-compiler SKILL's imposed section-title shape.

**Consequences:** No action required. This entry supersedes the 2-compile Observed entry at `8bc3a11` in scope (3 compiles > 2 compiles) but does not replace it; the earlier entry is preserved as the audit-trail record of the first generalization proof point, and this entry is the cumulative record. Subsequent failures on future compiles will be evaluated against this baseline — a rising rate of Gate 1 failures across divergent PRDs would be the signal that a specific template or derivation rule has narrowed in scope, not that Gate 1 itself is generally broken.

**Status:** Observed.

## 2026-04-19: EMISSION template firing is category-scoped by design

**Context:** Pass 3's invariant-derivation logic matches hand-crafted templates (DETERMINISM, FAIL-CLOSED, LINEAGE, EMISSION) against constraint-category atoms only. Acceptance-category and NFR-category atoms are not scanned for invariant-producing phrasing.

The first bootstrap compile (Gate 1's own PRD, 2026-04-19T13:56Z) produced three invariants — EMISSION did not fire because the PRD's emission wording lived in Acceptance Criterion 8 rather than in the Constraints section. This was initially flagged as a category-scoping concern warranting potential Pass 3 widening.

**Observation:** The two subsequent compiles resolved the concern empirically. Both PRD-META-DETECT-REGRESSION (2026-04-19T15:18Z) and PRD-META-COMPILER-PASS-8 (2026-04-19T15:50Z) produced four invariants including EMISSION, because both PRDs authored their emission disciplines in the Constraints section. The authorship convention is the discriminator — emission-class properties belong in Constraints as persistent system obligations, not in Acceptance Criteria as point-in-time behavioral observations.

The category-scoping of Pass 3's template matching therefore reflects a valid authorship convention rather than a compiler narrowness. A PRD author who places emission phrasing in AC produces a PRD without an emission invariant; this is a content-placement authorship decision, not a compiler gap.

**Claim:** The invariant-authoring skill's guidance ("emission-class phrasing belongs in Constraints, not AC") is retroactively validated by two independent compiles that followed the convention and produced the expected EMISSION invariant.

**Consequences:** No Pass 3 widening required. The category-scoping behavior is correct. The skill-doc nudge added at the MVP compiler PR stands as authoritative guidance. Future PRDs that omit the EMISSION invariant by placing emission wording in AC will produce a compile-time result with three invariants instead of four, which is intended behavior given the authorship convention.

**Status:** Observed.

## 2026-04-19: Pass 8 (assemble_workgraph) implemented; Factory end-to-end through Stage 5

**Decision:** Implement Stage 5 terminal compiler pass `assemble_workgraph` per PRD-META-COMPILER-PASS-8. New files: `packages/compiler/src/passes/08-assemble-workgraph.ts` (pure function), `packages/compiler/src/passes/_workgraph-emit.ts` (IO wrapper). Extended files: `packages/compiler/src/passes/_shared.ts` gains `workGraphId(prdId)` helper alongside existing `contractId`; `packages/compiler/src/passes/index.ts` re-exports the new pass; `packages/compiler/src/types.ts` extends `CompileResult` with `workgraph` and `workgraphPath` fields; `packages/compiler/src/compile.ts` conditionally runs Pass 8 iff Gate 1 passes; `packages/compiler/src/cli.ts` reports the WorkGraph path in stdout; `packages/compiler/src/compile.test.ts` adds three e2e assertions. New test file `08-assemble-workgraph.test.ts` with 15 unit tests. Total monorepo test count: 104 (25 schemas + 50 coverage-gates + 29 compiler).

**Rationale:** Closes the single largest gap between the whitepaper's pipeline and the MVP implementation. Every Factory compile to date produced a Coverage Report but never a WorkGraph — leaving every downstream Factory stage (harness-bridge, runtime, assurance-graph) architecturally unreachable because they had no input source. Pass 8 unblocks them. Implementation follows the PRD's 15 acceptance criteria, the deterministic node-type assignment rule set, and the edge-derivation rule set. Fail-closed on Gate 1 fail; defensive Zod re-validation at emission; determinism via sort-before-emit; no mutation of inputs; schema-conformant output. The pure/IO split mirrors the coverage-gates package (`runGate1` pure, `emitGate1Report` IO). Three meta-PRD recompiles through full Passes 0–8 pipeline all produced `Gate 1: PASS` plus a WorkGraph — 29/3/3/0/3 for Gate 1, 29/3/4/0/4 for detect_regression, 31/3/4/0/4 for Pass 8. Three WorkGraphs now live in specs/workgraphs/: WG-META-GATE-1-COMPILE-COVERAGE, WG-META-DETECT-REGRESSION, WG-META-COMPILER-PASS-8. The last is the second-order bootstrap proof — the WorkGraph for the pass that produced it. Factory's architectural pipeline is end-to-end through Stage 5.

**Alternatives considered:** (a) Implement all 8 passes including WorkGraph linking/optimization in one PR. Rejected per the PRD's scope discipline — Pass 8 is canonical assembly; optimization is a future pass. (b) Emit WorkGraphs alongside Coverage Reports even on Gate 1 fail. Rejected — Pass 8's fail-closed discipline is absolute (PRD AC-2); emitting a WorkGraph for a failed PRD would produce an executable artifact for an unsound specification. (c) Put workGraphId into a new `_ids.ts` module separate from `_shared.ts`. Rejected — `contractId` and `workGraphId` follow identical derivation patterns; co-locating them in `_shared.ts` is the minimal-file-split that still expresses the helper-family concept.

**Status:** Proposed. Pending Architect approval.

## 2026-04-19: Second-order bootstrap proof realized as physical artifact

**Observation:** `specs/workgraphs/WG-META-COMPILER-PASS-8.yaml` exists on disk. The Factory has compiled its own compiler's terminal pass through that compiler's own discipline. The WorkGraph describing Pass 8's execution topology was produced by Pass 8's first successful run against PRD-META-COMPILER-PASS-8.

**Claim:** Distinct from the Pass-8-implementation Observed entry above, which records the implementation landing, this entry records the physical artifact that manifests the architectural claim. The whitepaper's central commitment ("the Factory builds itself by the discipline it will apply to everything else") has moved from stated-intent to grep-able-on-disk evidence.

**Status:** Observed.

## 2026-04-19: v2 vertical selection — git-commit-triage

**Decision:** Git-commit triage is selected as v2. The Function classifies commits in a git repository against Conventional Commits taxonomy, detects domain-specific violations (missing scopes on feat commits, misattributed fix commits, etc.), and emits a CommitTriageReport.

**Rationale:** The 2026-04-18 "Factory built by Factory is v1" entry implicitly left v2 undetermined. Bootstrap-stage-5-complete has been reached (three meta-PRDs compiled through full Passes 0–8, three WorkGraphs on disk, second-order bootstrap proof realized at WG-META-COMPILER-PASS-8). v2 selection is now timely and architecturally load-bearing — the choice determines what the first non-meta compile exercises and therefore what the Factory's architecture-proving claim extends to. Git-commit triage was chosen against a three-criterion rubric (non-self-referential content, adapter boundary, domain-specific invariants). Rubric mapping: (1) classifier reads arbitrary repo history via git CLI, not Factory's `specs/`; (2) git CLI via `child_process.exec` is the first real shell-exec adapter the harness-bridge will implement, with the pattern transferring to every subsequent external-tool Function; (3) commit-message convention rules (Conventional Commits), repository-state invariants (resolvable SHAs, no shallow gaps), and classification-consistency rules derive from the vertical's domain, not from whitepaper §6.2 coverage discipline. The selection rubric recorded here is reusable for v3 selection and has been encoded into the factory-meta SKILL as durable decision support.

**Alternatives considered:** (a) Healthcare triage or RevOps analytics as v2 — rejected on timing grounds, not substantive grounds. Both were deferred in the 2026-04-18 DECISIONS entry because bootstrap had to come first; the rejection language in that entry ("too much domain onboarding," "not architecture-proving") should not be read as substantive foreclosure. Both remain valid future verticals (potentially v3 or later). (b) A business-facing vertical as v2 — rejected because v2 is architecturally load-bearing as the "first non-meta" proof, and conflating "first non-meta" with "first business-facing" weakens both proofs. v2 proves the Factory compiles non-meta work. v3 (future) should prove the Factory compiles business-facing work. Separating the two claims strengthens each.

**Status:** Proposed. Pending Architect approval.

## 2026-04-19: factory-meta SKILL amended — external-vertical Functions now permitted

**Decision:** Amend `.agent/skills/factory-meta/SKILL.md` to permit external-vertical Function proposals post-Bootstrap-stage-5-complete. Replace the frontmatter constraint from "do not propose external-vertical Functions before the Factory itself is complete" to a pointer into a new body section. Add the External-vertical Functions section to the body, including the vertical selection rubric (non-self-referential content, adapter boundary, domain-specific invariants) for reusable decision support on v3 and subsequent selections. Version bumped 2026-04-19 → 2026-04-19b.

**Rationale:** The original constraint was authored during Bootstrap phase 1, before any Factory meta-compile had succeeded. It prevented premature scope creep into business verticals while the Factory's own pipeline was unproven. Bootstrap-stage-5-complete has been reached; the constraint's original purpose is now satisfied. The amendment preserves the spirit (prevent unprincipled vertical sprawl) while honoring the new phase (external verticals are architecturally live). Encoding the three-criterion rubric in the SKILL itself turns one-off reasoning into reusable decision support; future v-number selections cite the rubric rather than re-deriving it.

**Alternatives considered:** (a) Remove the constraint entirely. Rejected — removal loses the intent ("prevent unprincipled sprawl") and leaves future readers without a framework for vertical selection. (b) Move the rubric into a separate skill. Rejected — vertical selection is factory-meta's operational concern (the Factory reasoning about its own expansion); no new skill warranted.

**Status:** Proposed. Pending Architect approval.

## 2026-04-19: Add CTR- ArtifactId prefix + CommitTriageReport schema (v2 precondition)

**Decision:** Add `CTR` to the `ArtifactId` prefix alternation in `packages/schemas/src/lineage.ts` and to `META_PREFIX_REGEX` in `packages/coverage-gates/src/checks.ts` (paired-PR lockstep, same discipline as CONTRACT). Add a new `CommitTriageReport` Zod schema to `packages/schemas/src/commit-triage.ts` extending Lineage with range fields, per-commit classifications, summary counts, and status enum. Colocated tests verify prefix acceptance, regression of existing prefixes, and schema structural validity.

**Rationale:** Precondition for the v2 vertical (git-commit-triage per DECISIONS 2026-04-19 v2 selection entry). Every Factory artifact has its own schema per "first-class output" discipline; the v2 Function's output artifact needs its own schema rather than embedding triage data in a generic ExecutionLog outcome payload. CTR- namespace is distinct from CR- (Coverage Reports) even though both are report-kind artifacts — CommitTriageReports and Coverage Reports are not interchangeable; keeping prefixes distinct preserves grep/audit clarity.

EL- prefix and ExecutionLog schema are explicitly deferred to a subsequent paired PR landing alongside harness-bridge implementation, when ExecutionLog has a consumer. That sequencing matches the "each artifact lands when consumer is ready" discipline that gated Pass 8 on prior generality proofs.

**Alternatives considered:** (a) Embed commit-triage output in the ExecutionLog's per-node outcome field without a dedicated schema. Rejected — collapses business output into execution plumbing, loses grep/query surface, breaks the "every artifact has its own schema" discipline. (b) Land CTR- and EL- together as one paired PR. Rejected — EL- has no consumer at this moment (harness-bridge is empty); schemas-with-no-consumers is the speculative-design anti-pattern DECISIONS entries elsewhere already reject.

**Status:** Proposed. Pending Architect approval.

## 2026-04-19: Retraction — generic-dispatch model for Stage 6 was miscast; chain removed

**Retraction.** The earlier framing of Stage 6 as a generic-adapter-dispatches-WorkGraph-nodes runtime was wrong. Whitepaper §3 Stage 6 specifies a five-role coding-agent topology (Planner/Coder/Critic/Tester/Verifier) that reads a WorkGraph as a specification and produces Function implementation code. WorkGraph nodes are not shell-command dispatch sites; Stage 6's output is code, not per-node execution records.

**Scope of retraction.** The following artifacts were authored under the miscast framing and have been removed in this commit-
- `specs/prds/PRD-META-HARNESS-EXECUTE.md` (generic-dispatch PRD)
- `specs/capabilities/BC-META-HARNESS-EXECUTE.yaml`
- `specs/functions/FP-META-HARNESS-EXECUTE.yaml`
- `specs/pressures/PRS-META-HARNESS-EXECUTE.yaml`
- `specs/workgraphs/WG-META-HARNESS-EXECUTE.yaml`
- `specs/coverage-reports/CR-PRD-META-HARNESS-EXECUTE-*.yaml`
- `packages/harness-bridge/` (empty scaffold named for the wrong concept)

**Prior DECISIONS entries partially invalidated.** The following entries cite the generic-dispatch framing and should be read with this retraction-
- 2026-04-19 "Pass 8 (assemble_workgraph) implemented" — mentions harness-bridge as a downstream stage slot; the slot survives but its contents are forthcoming under the correct Stage 6 topology.
- 2026-04-19 "v2 vertical selection — git-commit-triage" — cites "shell-exec adapter the harness-bridge will implement" as the adapter-boundary criterion. The three-criterion rubric stands; the specific phrasing of criterion #2 should be read as "external integration boundary," not "shell-exec adapter dispatched by harness-bridge." The factory-meta SKILL has been updated accordingly.
- 2026-04-19 "Add CTR- ArtifactId prefix + CommitTriageReport schema" — the deferred-EL- paragraph presupposed a generic-dispatch ExecutionLog that will not be implemented under the correct Stage 6 framing. CTR- schema stands on its own merits as v2's output artifact.

**What comes next.** A fresh meta-PRD authoring the Stage 6 coordinator (five-role coding-agent topology) from whitepaper §3 directly. The artifact-ID stem for that chain is pending Architect decision; no files from the retracted chain will be reused.

**Status:** Active (retraction; cannot be reversed without re-authorizing the wrong turn).

## 2026-04-19: Observed — Gate 1 PASS does not imply conceptual correctness

**Observation.** PRD-META-HARNESS-EXECUTE (now deleted; recoverable via `git show 81593a4^:specs/prds/PRD-META-HARNESS-EXECUTE.md`) compiled at Gate 1 PASS on 2026-04-19T17:32Z — 30 atoms, 3 contracts, 4 invariants, 0 dependencies, 4 validations, all coverage checks green. Every structural discipline held. The PRD's entire conceptual frame was nonetheless miscast- it specified Stage 6 as a "pure-plan / adapter-dispatch Function" with "HarnessAdapter identifier," "per-node execution outcomes," and "ExecutionLog artifact," when whitepaper §3 specifies Stage 6 as a five-role coding-agent topology (Planner/Coder/Critic/Tester/Verifier) that reads WorkGraphs as specifications and emits Function implementation code.

**Specific miscasts that Gate 1 did not catch, identified by re-reading the deleted PRD against §3-**
- Title- "Harness Execute (Stage 6 execution Function)." §3 Stage 6 is not an execution Function; it is code synthesis.
- Problem §1 line 2- "Stage 6 consumes those WorkGraphs and invokes their nodes in a runtime adapter so the specified behavior actually runs." §3 says Stage 6 *reads* WorkGraphs and produces code; nodes are not runtime dispatch sites.
- Goal- "Implement `harness_execute` as a pure-plan / adapter-dispatch Function... derives a deterministic execution plan (node dispatch order) from the WorkGraph... invokes the adapter with that plan." The word "plan" here means dispatch order, not the Planner role's execution plan.
- Operational constraints- "Adapter identifiers are canonical strings. The initial set is `dry-run`, `claude-code`, `cursor`." §3's five-role topology is not parameterized by adapter identifier; `claude-code` and `cursor` are *harnesses that can implement the whole topology*, not adapters dispatched per node.
- ExecutionLog per-node records- §3 does not specify per-node records as Stage 6 output. Stage 6 output is code (tests, configuration, documentation per ConOps §9.4). Per-node telemetry belongs in Stage 7 observation of deployed Functions, not Stage 6 emission.
- FunctionLifecycle transitions- "harness_execute may emit a transition hint as a separate artifact." The transition from `designed` → `in_progress` → `implemented` is driven by Stage 6 producing code, not by node dispatch completing.

**Claim.** Gate 1's four coverage checks (atom coverage, invariant coverage with detector, validation coverage, dependency closure) are structural. They do not verify that the PRD's prose aligns with the whitepaper's semantics. A PRD can be internally coherent by Gate 1's metrics while describing a conceptually wrong Function. The entire harness_execute PRD was proof of this by construction.

**Consequence.** Gate 1 is necessary but not sufficient for PRD acceptance. A semantic-alignment check — verification that the PRD's conceptual model matches whitepaper and ConOps ground truth — is a distinct concern. Whether this should be a Gate 1.5 (compile-time, automated), a human-authored Architect review gate, or an agent-assisted check (Critic role at authoring time, not just at Stage 6) is a future architectural decision and not resolved here.

**Not an immediate remediation for Gate 1.** Widening Gate 1 to semantic verification without a clear derivation rule would turn it into ad-hoc compliance checking. The right response is to acknowledge the known limit and let future PRDs fail on conceptual grounds through explicit Architect review rather than through Gate 1 arithmetic.

**Status:** Observed.
## 2026-04-24: Stage 6 artifact-ID stem is FUNCTION-SYNTHESIS

**Decision:** The PRS/BC/FP/PRD/WG chain for Stage 6 uses the artifact-ID
stem `FUNCTION-SYNTHESIS`. Full chain: `PRS-META-FUNCTION-SYNTHESIS`,
`BC-META-FUNCTION-SYNTHESIS`, `FP-META-FUNCTION-SYNTHESIS`,
`PRD-META-FUNCTION-SYNTHESIS`, `WG-META-FUNCTION-SYNTHESIS`. The stem
applies to the Stage 6 coordinator and the five-role topology it governs.

**Rationale:** Four candidates were evaluated: `STAGE-6-CODING-SWARM`,
`DARK-FACTORY`, `FUNCTION-SYNTHESIS`, `CODING-AGENT-TOPOLOGY`. Selection
criteria: (1) the stem should name what Stage 6 *produces*, not what it *is*
— the Factory's artifact-ID convention names the capability or output, not
the implementation topology; (2) the stem must be greppable across `specs/`
without false positives against existing chains; (3) the stem should be
stable under future implementation changes — if the five-role topology
evolves to six roles or three, the stem should still hold.
`FUNCTION-SYNTHESIS` satisfies all three: it names the output (a synthesized
Function — code plus tests, config, docs per ConOps §9.4), it has zero
existing matches in `specs/`, and it is topology-agnostic. `DARK-FACTORY`
was the most evocative but names the execution environment rather than the
output. `CODING-AGENT-TOPOLOGY` names the implementation shape, which is
exactly the thing most likely to change. `STAGE-6-CODING-SWARM` embeds a
stage number, creating a rename burden if stage numbering ever shifts.

**Alternatives considered:** See rationale above.
**Status:** Active.

## 2026-04-24: Stage 6 topology is hybrid with pluggable binding modes

**Decision:** Stage 6 (FUNCTION-SYNTHESIS) implements a hybrid topology: the
Factory specifies the five-role contract (Planner/Coder/Critic/Tester/
Verifier per whitepaper §3) as typed state-transform interfaces with strict
read/write/do-not/output contracts and JSON-only footers, and provides
pluggable binding modes that map those roles onto concrete execution
backends. Binding modes include at minimum: (a) delegation to an external
harness (Claude Code, Cursor, or equivalent) where the harness implements
the full topology internally, and (b) in-Factory role execution where each
role is a Factory-managed agent with its own context window. Additional
binding modes (e.g., mixed delegation where some roles run in-Factory and
others delegate) are permitted but not required at v1.

**Rationale:** Whitepaper §9 states "the Factory is harness-agnostic. When a
harness is good (Claude Code and Cursor both qualify), the Factory delegates
Stage 6 to it." This establishes delegation as a first-class mode, not a
fallback. Simultaneously, whitepaper §3 specifies the five-role topology
with enough detail (per-role read access, write access, do-not rules, output
contract) that an in-Factory implementation is architecturally derivable.
The hybrid approach lets the Factory own the contract layer (what each role
must do) while remaining agnostic about the execution layer (who does it).
This is the same separation the Factory applies everywhere else — WorkGraphs
specify, execution realizes. The PRD for FUNCTION-SYNTHESIS must specify the
role contracts as the primary deliverable and the binding-mode interface as
the secondary deliverable; implementation of any specific binding mode is a
downstream Function, not part of the FUNCTION-SYNTHESIS chain itself.

**Alternatives considered:** (a) Thin coordinator, delegates exclusively to
external harness. Rejected — makes the Factory dependent on external harness
capabilities matching the five-role contract exactly; if a harness doesn't
natively support the Verifier role's `pass / patch / resample / interrupt /
fail` decision set, the Factory has no recourse. (b) In-Factory
implementation only. Rejected — ignores whitepaper §9's explicit
endorsement of delegation and would require the Factory to manage agent
context windows, token budgets, and tool access for five concurrent roles
before any of the simpler delegation paths have been proven.

**Status:** Active.

## 2026-04-24: Semantic-alignment review via Critic-role involvement at PRD authoring

**Decision:** The semantic-alignment review mechanism — required to catch
PRDs that pass Gate 1 structurally but are conceptually miscast against
whitepaper and ConOps ground truth — is implemented as Critic-role
involvement during PRD authoring, not as a separate gate. Specifically:
before a PRD enters the Stage 5 compiler, the Critic role (as defined in
whitepaper §3's five-role topology) reviews the PRD's conceptual model
against the authoritative source material cited in its `source_refs` chain.
The Critic's output is a typed review artifact with a verdict
(`aligned / miscast / uncertain`) and specific citations to whitepaper or
ConOps sections that support or contradict the PRD's framing.

The Critic-at-authoring mechanism supplements Gate 1; it does not replace
it. Gate 1 remains the structural coverage gate. The Critic review is the
semantic coverage check. A PRD must pass both to proceed to Stage 6
execution.

**Rationale:** The 2026-04-19 Observed entry "Gate 1 PASS does not imply
conceptual correctness" documented the failure mode: PRD-META-HARNESS-
EXECUTE compiled Gate 1 PASS with 30 atoms, 3 contracts, 4 invariants,
all checks green, while its entire conceptual frame was wrong. The root
cause was not a Gate 1 deficiency — Gate 1's four structural checks are
correct and complete for their scope — but the absence of any mechanism
to verify that a PRD's prose aligns with the whitepaper's semantics.

Three options were evaluated: (a) Gate 1.5, an automated compile-time
check; (b) Architect review gate, a human checkpoint; (c) Critic-role
involvement at PRD authoring. Option (c) was selected because it places
the review at the point of maximum leverage (before compile, when the
PRD's conceptual frame is still malleable), it produces a typed artifact
(the review) that enters the lineage graph, and it reuses the Critic role
already specified in whitepaper §3 rather than introducing a new gate or
a new human bottleneck. Option (b) does not scale — the Architect
becomes a serial dependency on every PRD. Option (a) requires a
derivation rule for semantic alignment that does not currently exist and
risks becoming ad-hoc compliance checking (per the 2026-04-19 Observed
entry's own warning: "widening Gate 1 to semantic verification without a
clear derivation rule would turn it into ad-hoc compliance checking").

**Status:** Active.

## 2026-04-24: Bootstrap carve-out — Architect is Critic for PRD-META-FUNCTION-SYNTHESIS

**Decision:** The Critic role cannot review the PRD that instantiates the
Critic role. For the FUNCTION-SYNTHESIS chain specifically
(`PRS-META-FUNCTION-SYNTHESIS` through `PRD-META-FUNCTION-SYNTHESIS`), the
Architect fills the Critic role manually, performing semantic-alignment
review against whitepaper §3 before the PRD enters the Stage 5 compiler.
This carve-out applies exclusively to the FUNCTION-SYNTHESIS chain and
expires when the FUNCTION-SYNTHESIS WorkGraph has been executed and the
Critic role is operational.

**Rationale:** The 2026-04-24 "Semantic-alignment review via Critic-role
involvement" decision establishes the Critic as the semantic-alignment
reviewer for all PRDs. But the Critic role is defined inside Stage 6, and
Stage 6 is the subject of PRD-META-FUNCTION-SYNTHESIS. The Critic cannot
review its own specification — this is a genuine bootstrap circularity,
not a theoretical concern. It is structurally identical to the pattern
that allowed PRD-META-HARNESS-EXECUTE to pass Gate 1 unchallenged: no
reviewer existed for the thing being reviewed. The carve-out resolves the
circularity by substituting the Architect (the only agent with ground-
truth access to whitepaper §3) for the not-yet-existing Critic, for
exactly one chain. All subsequent PRDs — including any amendments to the
FUNCTION-SYNTHESIS chain — are subject to Critic review once operational.

The carve-out is recorded as a separate DECISIONS entry rather than a
footnote in the Critic-role entry because it imposes a concrete
obligation on a specific human (the Architect must review PRD-META-
FUNCTION-SYNTHESIS before compile) and has a concrete expiration
condition (Critic role operational). Burying it in the parent entry
risks the obligation being missed.

**Alternatives considered:** (a) No carve-out — let PRD-META-FUNCTION-
SYNTHESIS proceed without semantic review, relying on Gate 1 alone.
Rejected — this is precisely the failure mode the 2026-04-19 retraction
documented. (b) Defer the Critic-role decision until after Stage 6 is
implemented, then retroactively review. Rejected — retroactive review of
an already-compiled, possibly already-executed PRD has no remediation
path short of retraction and reauthoring, which is more expensive than
upfront review. (c) Use an automated semantic check for this one PRD.
Rejected — no derivation rule for automated semantic alignment exists
yet; the Architect's judgment against §3 is the only available ground
truth.

**Status:** Active. Expires when the FUNCTION-SYNTHESIS Critic role is
operational and has reviewed its first non-FUNCTION-SYNTHESIS PRD.

## 2026-04-24: Adopt crystallization-from-execution and memory-as-tool patterns (GenericAgent-informed)

**Decision:** Adopt two architectural patterns from the GenericAgent
framework (lsdefine/GenericAgent, reviewed 2026-04-24) into the Factory's
operational model:

1. **Crystallization from successful execution.** When a WorkGraph executes
   through all applicable gates and produces a passing Coverage Report, the
   Factory emits a reusable artifact — a template, a macro, or a new
   invariant — derived from the execution path. Crystallized artifacts
   enter `specs/` with full lineage back to the execution that produced
   them. The mechanism is: successful Gate 3 (assurance) passage triggers
   a crystallization check; if the execution path contains a novel pattern
   not already captured by an existing invariant or template, a new
   artifact is proposed (not auto-committed — it enters the Critic review
   flow). This replaces the current implicit assumption that all reusable
   patterns are hand-authored into SKILL.md files before execution.

2. **Memory writes as explicit, auditable tool calls.** Every write to
   `.agent/memory/` (episodic, semantic, personal, working) is performed
   through a typed tool call that the coverage gates can observe, audit,
   and include in lineage graphs. No implicit or side-effect memory writes.
   The tool interface is: `memory_write(layer, key, content, source_refs)`,
   where `source_refs` traces the write back to the Function, gate, or
   execution event that produced it. This makes memory mutations
   first-class artifacts subject to the same lineage-preservation
   discipline as every other Factory object.

**What is NOT adopted from GenericAgent:**

- **Deferred skill authoring.** GenericAgent writes zero skills upfront and
  accretes them only after successful task execution. The Factory's domain
  (formal PRD compilation with typed invariants and fail-closed gates)
  requires preloaded skills because the compiler passes, gate checks, and
  lineage rules are not discoverable from execution alone — they are
  derived from the whitepaper's formal specification. The eight existing
  SKILL.md files are architecturally correct for this domain. What changes
  is that they are no longer the *only* source of reusable patterns;
  crystallization supplements them with execution-derived patterns.

- **Flat tool surface.** GenericAgent exposes 7 atomic tools and derives
  all capability from composition. The Factory's typed artifact pipeline
  (Signals → Pressures → Capabilities → Functions → PRDs → WorkGraphs →
  Invariants → Coverage Reports) is not reducible to a flat tool surface
  without losing the lineage guarantees that are the Factory's distinctive
  claim. The Factory's tool surface remains typed and stage-aware.

- **Single-loop architecture.** GenericAgent's 92-line agent loop is its
  entire control flow. The Factory's multi-stage pipeline with
  interposition points (gates, Critic review, governance) is
  architecturally load-bearing and is not collapsed into a single loop.
  However, the Factory benefits from having a *canonical reference loop*
  — a single document or diagram that traces the irreducible path from
  Signal to deployed Function and back — as a legibility aid. This is
  served by the pipeline sequence in ARCHITECTURE.md §1, which should be
  kept current as the canonical loop reference.

**Rationale:** GenericAgent demonstrates that agent systems compound value
most effectively when successful execution paths are automatically
captured as reusable artifacts ("skills" in GA's terminology, "invariants"
or "templates" in Factory terminology). The Factory's current model relies
entirely on hand-authored SKILL.md files and hand-authored invariant
specs. This works during Bootstrap — the Architect is the primary author
and the artifact count is small — but does not scale to steady-state
operation where the Factory is producing Functions across multiple
verticals. Crystallization closes the gap: hand-authored skills remain
the seed; execution-derived artifacts are the growth mechanism.

The memory-as-tool pattern addresses a different GenericAgent insight:
GA's `update_working_checkpoint` and `start_long_term_update` are
explicit tool calls, not implicit side effects. This means every memory
mutation is observable, auditable, and attributable. The Factory's
`.agent/tools/memory_writer.ts` already exists as a file; this decision
formalizes that every memory write must route through it with typed
`source_refs`, and that coverage gates may inspect memory-write records
as part of their audit surface.

**Source material:** GenericAgent repository (github.com/lsdefine/
GenericAgent), specifically: `agent_loop.py` (crystallization trigger at
task completion), `tools/` (7 atomic tools including `update_working_
checkpoint` and `start_long_term_update`), `skills/` (5 seed skills,
execution-derived growth). Reviewed 2026-04-24 for architectural
applicability to the Factory; patterns adopted selectively per the
"What is NOT adopted" section above.

**Alternatives considered:** (a) Adopt GenericAgent's deferred-skill model
wholesale — write no SKILL.md files, let them accrete from execution.
Rejected — the Factory's formal pipeline (8 compiler passes, 3 fail-
closed gates, typed invariants with detector specs) is not discoverable
from execution; it is derived from a 42KB whitepaper specification.
Preloaded skills are the correct seed for this domain. (b) Adopt nothing
— treat GenericAgent as architecturally irrelevant. Rejected — the
crystallization pattern solves a real scaling problem (hand-authored
skills don't compound) and the memory-as-tool pattern solves a real
auditability problem (implicit memory writes break lineage). (c) Adopt
crystallization only, not memory-as-tool. Rejected — crystallized
artifacts will themselves produce memory writes (new invariants, new
templates, updated LESSONS.md entries); if those writes are implicit,
the crystallization artifacts have lineage but their memory-layer effects
do not, creating a two-tier auditability gap.

**Implementation notes:**

- Crystallization check logic belongs in `packages/runtime/` (Stage 7),
  not in `packages/coverage-gates/` — it triggers *after* Gate 3, not
  *as part of* Gate 3. Gate 3 is fail-closed on assurance; crystallization
  is an additive emit on success.
- The `memory_write` tool interface should be specified as a new entry in
  `.agent/protocols/tool_schemas/` alongside the existing `shell.schema
  .json`, `git.schema.json`, and `compiler.schema.json`.
- Crystallized artifacts use a new prefix (candidate: `CRY-` or `TPL-`)
  requiring a paired update to `packages/schemas/src/lineage.ts` and
  `packages/coverage-gates/src/checks.ts`. Prefix selection is deferred
  to the PRD that specifies the crystallization Function.

**Status:** Active.

## 2026-04-24: PiAgentBindingMode authorized as downstream Function under FUNCTION-SYNTHESIS

**Decision:** The first real binding mode (`PiAgentBindingMode`, implementing `BindingMode` interface from `@factory/function-synthesis`) is authorized for implementation as a downstream Function per the 2026-04-24 DECISIONS entry: "implementation of any specific binding mode is a downstream Function, not part of the FUNCTION-SYNTHESIS chain itself." No separate PRS/BC/FP/PRD chain is required. The binding mode uses `@mariozechner/pi-ai` (model routing) and `@mariozechner/pi-agent-core` (stateful agent execution) as its execution substrate.

**Implementation constraints (Architect-directed, 2026-04-24):**

1. **`beforeToolCall: enforceRoleContract` MUST block, not log-and-continue.** When a role attempts a tool call outside its contract, the hook returns `{ block: true, reason: "do_not violation: <role> attempted <tool>" }` and records the violation in the RoleAdherenceReport. Log-and-continue makes role contracts advisory; block-and-record makes them governed. The RoleAdherenceReport produced by blocking IS the audit artifact. This is the entire control Function expressed as a hook.

2. **Carve-out expiration requires BOTH conditions.** Step 6 (Critic reviews code during synthesis of WG-V2-CLASSIFY-COMMITS) proves the Critic can review patches. Step 7 (Critic reviews a real PRD for semantic alignment against whitepaper §3, producing `aligned / miscast / uncertain` with citations) proves the Critic can review conceptual framing. The carve-out does not expire until Step 7 produces a real verdict on a real PRD. Step 6 alone is insufficient.

3. **WG-V2-CLASSIFY-COMMITS is the first synthesis target.** It is small, non-meta, has domain-specific invariants (Conventional Commits taxonomy), and is already compiled through Gate 1. The commit-classification Function will require git CLI integration (`git log`). The Coder role's tool policy must account for this — either route through `@factory/controlled-effectors` (governed tool invocation) or treat it as a Stage 7 effector concern. The architectural choice between these is deferred to implementation but must be explicit in the binding-mode code.

4. **Run dual configurations as the first empirical CEF data point.** After the binding mode is operational, execute WG-V2-CLASSIFY-COMMITS with two ArchitectureCandidate configurations: (a) Haiku-everywhere (all five roles on claude-haiku-4-5), (b) Sonnet-mix (Coder + Verifier on claude-sonnet-4-6, Planner + Critic + Tester on claude-haiku-4-5). Diff the produced code. If the outputs are functionally equivalent, Haiku is sufficient for that Function class. That equivalence-or-divergence result is the first Signal from the CEF feedback loop — it feeds back as SIG-META-CEF-MODEL-SUFFICIENCY and may recalibrate the default routing table.

5. **BindingMode interface vindication noted.** The 2026-04-24 hybrid topology DECISIONS entry anticipated this moment. The orchestration logic (`orchestrate.ts`) does not change. The `StubBindingMode` swaps for `PiAgentBindingMode`. The 2,452 lines of function-synthesis implementation (role contracts, evidence emission, disagreement resolution, repair loops) become the system prompts, tool schemas, and beforeToolCall hooks for five real agents. The interface boundary held. Architectural validation.

**Scope:** ~600 LOC new code (PiAgentBindingMode + tool schemas + prompt rendering). Everything else exists in `@factory/function-synthesis`.

**Status:** Active.

## 2026-04-24: Bootstrap carve-out EXPIRED — Critic role operational

**Decision:** The bootstrap carve-out established in "Bootstrap carve-out —
Architect is Critic for PRD-META-FUNCTION-SYNTHESIS" (2026-04-24) is
expired as of commit `060db28`. Both conditions met:

1. The FUNCTION-SYNTHESIS WorkGraph has been executed. The five-role
   topology (Planner/Coder/Critic/Tester/Verifier) ran against
   WG-V2-CLASSIFY-COMMITS via PiAgentBindingMode with real Anthropic API
   calls through pi-ai (25-provider substrate). All five roles completed.
   Verifier rendered pass. Code produced on disk. Commit `80baaeb`.

2. The Critic role is operational. The Critic reviewed PRD-META-COMPILER-
   PASS-8 against whitepaper §3 via pi-ai, producing a typed verdict
   (miscast, confidence 0.92) with 8 citations to specific §3 text.
   The review was substantive — it identified a real pass-numbering
   discrepancy and a citation error. Commit `060db28`.

**Effect:** All PRDs from this point forward are subject to Critic review
before compilation. No exceptions. The Architect no longer fills the
Critic role manually. The Architect's role shifts from semantic reviewer
to the person who decides what to do when the Critic says miscast.

**Status:** Active.

## 2026-04-24: Observed — Critic finds pass-numbering discrepancy in PRD-META-COMPILER-PASS-8

**Observation.** The Critic's first operational PRD review (Step 7,
commit `060db28`) reviewed PRD-META-COMPILER-PASS-8 against whitepaper §3
and rendered verdict: miscast (confidence 0.92). Two findings:

1. **Pass-numbering discrepancy.** Whitepaper §3.5 describes an eight-pass
   compiler pipeline (normalize, extract atoms, derive contracts, derive
   invariants, derive dependencies, derive validations, consistency check,
   assemble WorkGraph). The PRD and implementation number these as Passes
   0–8 (nine passes), inserting Gate 1 as a discrete Pass 7 between
   consistency check and WorkGraph assembly. §3 does not name the gating
   step as a numbered compiler pass. The PRD's "Pass 8" is §3's eighth
   pass, not a ninth.

2. **Citation error.** The PRD's rationale cites "§3.2 for the execution
   Function type" but §3.2 (Business Capabilities) defines organizational
   transfer functions, not Function types. Function types (execution,
   control, evidence, integration) are defined in §3.4 (Capability Delta
   and Function Proposals).

**Assessment:** Amendment trigger, not retraction trigger. The conceptual
frame of PRD-META-COMPILER-PASS-8 — "assemble a WorkGraph from validated
compiler intermediates" — is correct. The implementation is correct. The
pass numbering is a documentation-level mismatch between the whitepaper's
narrative (which counts eight named activities) and the implementation
(which 0-indexes and inserts a gate as a discrete pass). Unlike the
HARNESS-EXECUTE retraction (where the entire conceptual frame was wrong),
here the frame is right and the numbering convention diverges. A future
amendment should reconcile the numbering convention — either by updating
the whitepaper to acknowledge the 0-indexed 9-pass implementation, or
by renaming the implementation's passes to match §3's eight named
activities with Gate 1 as an interposed gate rather than a numbered pass.

**Historical significance.** This is the first time the Factory's own
automated Critic has identified a finding in a previously-shipped
artifact. The 2026-04-19 Observed entry "Gate 1 PASS does not imply
conceptual correctness" predicted this capability would be needed. The
Critic just demonstrated it retroactively on a production artifact.

**Status:** Observed. Amendment deferred to a future PRD or whitepaper
revision. No retraction required.

## 2026-04-24: Universal Critic review before compilation — no exceptions

**Decision:** Every PRD entering the Stage 5 compiler is subject to
automated Critic review before Pass 0 (normalize). No exceptions. No
bypass. No "just this once." The Critic review is as mandatory as Gate 1.

**Mechanism:**
1. Before `pnpm compile <prd-path>`, the Critic reads the PRD + the
   whitepaper sections cited in its `source_refs` chain.
2. The Critic produces a typed `CRV-*` artifact at
   `specs/critic-reviews/CRV-<PRD-ID>-<timestamp>.yaml` with verdict
   (`aligned / miscast / uncertain`), confidence, citations, and summary.
3. Verdict gating:
   - `aligned` → compilation proceeds. CRV artifact committed for lineage.
   - `miscast` → compilation HALTS. CRV artifact committed. Architect
     decides: retract (like HARNESS-EXECUTE), amend (like the pass-
     numbering finding), or override with explicit rationale in DECISIONS.
   - `uncertain` → compilation proceeds with the CRV flagged for
     Architect review. The uncertainty is recorded, not suppressed.
4. The CRV artifact carries lineage (`source_refs` cites the PRD) and is
   a first-class Factory artifact subject to the same audit discipline as
   Coverage Reports.

**Model:** The Critic runs on the minimum-sufficient model — currently
Claude Haiku 4.5 via pi-ai at ~$0.02 per review. Model selection is
governed by the same ArchitectureCandidate.model_binding discipline as
Stage 6 roles; the Critic is not hardcoded to one model.

**Economics:** $0.02 per review vs the cost of one miscast retraction
(half a session-day for HARNESS-EXECUTE). Universal review is ~1000x
cheaper than one retraction. At 100 PRDs/year, universal review costs
$2/year. The economics are not marginal — they are overwhelming.

**Rationale:** The 2026-04-19 Observed entry documented the failure mode:
"A PRD can be internally coherent by Gate 1's metrics while describing a
conceptually wrong Function." The 2026-04-24 Critic review of
PRD-META-COMPILER-PASS-8 demonstrated the capability: Haiku at $0.019
found a real miscast (pass-numbering discrepancy) with 8 citations at
0.92 confidence. Universal review makes the demonstrated capability a
permanent, automated, fail-closed governance property.

**What this replaces:** The bootstrap carve-out (Architect fills Critic
role manually). That carve-out expired at `060db28`. This decision
formalizes what replaces it: automated Critic review, universal, before
every compile, at two cents per review.

**Status:** Active.
