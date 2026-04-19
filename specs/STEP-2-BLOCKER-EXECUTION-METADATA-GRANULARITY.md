# Step 2 Blocker — execution metadata granularity

**Status:** BLOCKED. Do not proceed with Step 2 (v2 PRD amendment + Pass 0/Pass 8 updates) until Wes resolves the fork below.

**Authored:** 2026-04-19 by a prior Claude Code session. Handoff doc for a fresh CC context.

---

## What Step 2 was supposed to do

Step 1 landed at commit `9120394`: added optional `WorkGraphNode.executable` field as a discriminated union (`kind: "shell"` with `command`+`args`, or `kind: "in_process"` with `handler_ref`). Zero behavior change; no existing WorkGraph populates the field.

Step 2 would (1) amend `specs/prds/PRD-V2-CLASSIFY-COMMITS.md` to add an `## Execution mapping` section enumerating which v2 nodes are shell-exec vs in-process, (2) teach Pass 0 (`packages/compiler/src/passes/00-normalize.ts`) to parse that section into a `NormalizedPRD.executionMapping` field, and (3) teach Pass 8 (`packages/compiler/src/passes/08-assemble-workgraph.ts`) to populate `WorkGraphNode.executable` from that map on matching nodes.

Wes's Step 2 spec flagged a "critical flag" precondition: **inspect the actual v2 WorkGraph and contract-derivation pipeline before committing to any path**. The spec offered three candidate paths (A/B/C) and told CC to stop and report if none fit.

---

## What the inspection found

### Pass 2 — `packages/compiler/src/passes/02-derive-contracts.ts`

Emits **exactly one Contract per atom category**. Categories are hardcoded: `acceptance`, `constraint`, `nfr`. For any PRD, Pass 2 therefore produces at most 3 contracts:

- `CONTRACT-<PRD-SUBJECT>-ACCEPTANCE` (from acceptance-category atoms)
- `CONTRACT-<PRD-SUBJECT>-CONSTRAINT` (from constraint-category atoms)
- `CONTRACT-<PRD-SUBJECT>-NFR` (from nfr-category atoms)

The file's own docstring acknowledges this is MVP-scope: *"A production compiler would cluster atoms by semantic relation and produce finer-grained contracts — one per behavior (e.g., pass behavior, fail behavior, emission, determinism). The MVP uses category-level clustering because it is mechanical, coverage-complete, and adequate for bootstrap proof."*

### Pass 3 — `packages/compiler/src/passes/03-derive-invariants.ts`

Template-matches four hardcoded invariant shapes against constraint-category atoms: `DETERMINISM`, `FAIL-CLOSED`, `LINEAGE`, `EMISSION`. These are **Factory-discipline properties, not Function behaviors**. The template `statement` strings even hardcode Gate-1-specific wording (`"Gate 1 produces byte-identical Gate1Report contents..."`) — this is a separate pre-existing scoping bug; see "Secondary issue" below.

For v2, Pass 3 produces 4 invariants:
- `INV-V2-CLASSIFY-COMMITS-DETERMINISM`
- `INV-V2-CLASSIFY-COMMITS-EMISSION`
- `INV-V2-CLASSIFY-COMMITS-FAIL-CLOSED`
- `INV-V2-CLASSIFY-COMMITS-LINEAGE`

### Pass 5 — validations 1:1 with invariants

For v2, produces 4 validations (`VAL-V2-CLASSIFY-COMMITS-VAL-01..04`), one per invariant.

### Pass 8 emits nodes from contracts + invariants + validations only

Contracts → `execution`/`control`/`interface` type (per contract.kind).
Invariants → `control` type.
Validations → `evidence` type.

**Atoms do NOT become WorkGraphNodes.** Pass 8's node-derivation loops over `contracts`, `invariants`, `validations` — not over `atoms`. Verify at `packages/compiler/src/passes/08-assemble-workgraph.ts` lines ~92–123.

### Live v2 WorkGraph — `specs/workgraphs/WG-V2-CLASSIFY-COMMITS.yaml`

Eleven nodes total. Inspect to confirm:

| Node ID | Type | Represents |
|---|---|---|
| `CONTRACT-V2-CLASSIFY-COMMITS-ACCEPTANCE` | execution | Aggregate of acceptance criteria |
| `CONTRACT-V2-CLASSIFY-COMMITS-CONSTRAINT` | control | Aggregate of constraints |
| `CONTRACT-V2-CLASSIFY-COMMITS-NFR` | execution | Aggregate of NFRs |
| `INV-V2-CLASSIFY-COMMITS-DETERMINISM` | control | Factory property |
| `INV-V2-CLASSIFY-COMMITS-EMISSION` | control | Factory property |
| `INV-V2-CLASSIFY-COMMITS-FAIL-CLOSED` | control | Factory property |
| `INV-V2-CLASSIFY-COMMITS-LINEAGE` | control | Factory property |
| `VAL-V2-CLASSIFY-COMMITS-VAL-01..04` | evidence | Proof of the 4 invariants |

**None of these 11 nodes corresponds to a per-behavior action** like "resolve git range," "enumerate commits in range," or "classify one commit." The v2 WorkGraph, as currently emitted, has no places to attach per-behavior executable metadata.

---

## The fork — why each path fails

### Path A — executable metadata keyed on validation IDs

Wes's Step 2 spec proposed this path as its recommendation. The reasoning: "Validations are already 1:1 with invariants, which are near-1:1 with atoms-in-Constraints."

**Does not work.** The v2 validations validate Factory-correctness properties (determinism, fail-closed, lineage, emission), not behavioral actions. Mapping `git log --format=... <from>..<to>` to `VAL-V2-CLASSIFY-COMMITS-VAL-01` is a category error — VAL-01 is a proof that the classifier is deterministic, not a dispatch target for running git.

The spec's premise ("validations are near-1:1 with atoms-in-Constraints") does not hold at the v2 level because Pass 3 template-matches against a small set of Factory-discipline templates rather than expanding every constraint atom. Constraint atoms that do not match a template produce no invariant and therefore no validation node. The 1:1-with-invariants property is real but validations inherit invariants' Factory-property shape, not atoms' behavioral content.

### Path B — Pass 2 refactor to per-behavior contracts

Pass 2 rewritten to emit per-atom or per-behavior-cluster contracts instead of category aggregates.

**Architecturally large.** Would require:
- Pass 2 rewrite (cluster atoms by semantic relation rather than category, or emit per-atom contracts as a stopgap).
- Pass 3 re-anchoring. Invariants currently link `derivedFromContractIds` to the single constraint-category contract; per-behavior contracts would require per-invariant contract selection logic.
- Gate 1 atom_coverage re-verification. Atoms are currently covered by being cited in the category contract's `derivedFromAtomIds`; per-behavior clustering would need to preserve total coverage.
- Invariant-template refactor. The 4 Factory-discipline templates hardcode Gate-1 statements; for v2 they'd need to emit v2-specific invariants. (See "Secondary issue.")

Wes's Step 2 spec explicitly marked this as "probably out of scope for Step 2."

### Path C — executable on category contracts (coarse-grained)

Attach `executable: { kind: "shell", command: "git", args: [...] }` to `CONTRACT-V2-CLASSIFY-COMMITS-CONSTRAINT` (or ACCEPTANCE, or NFR).

**Semantically broken.** The `NodeExecutable` discriminated union carries a single command per node. v2 has at least 3 distinct shell invocations (`git rev-parse`, `git log`, `git rev-list`). No clean mapping from 3-commands-to-1-slot exists. A coarse-grained mapping would either silently lose commands or require a schema shape change that was explicitly rejected in Step 1's decision.

### Path D — new behavioral-action artifact type (not named in spec)

The v2 PRD grows a new section enumerating behavioral actions as first-class artifacts. Passes emit `ACTION-V2-...` (or `BEHAVIOR-V2-...`) nodes alongside contracts/invariants/validations. Each action has its own `executable` field naturally — one action, one command.

**Cleanest architectural fit.** But:
- New artifact type means new schema (Zod `Action` or `BehaviorSpec`).
- New ArtifactId prefix (paired-PR discipline like CTR/EL before it).
- New Pass 2.5 or Pass 6.5 that derives actions from some PRD section.
- New WorkGraphNode derivation path in Pass 8 emitting action-nodes.
- Choice about whether actions are dependent on contracts (edges from ACTION → CONTRACT) or standalone.

Materially larger than Step 2's stated scope, but smaller than a full Pass 2 refactor (Path B) because it adds rather than rewrites.

---

## Secondary issue — orthogonal but worth flagging

Pass 3's invariant templates (`packages/compiler/src/passes/03-derive-invariants.ts`) hardcode **Gate-1-specific statements**:

```ts
statement: "Gate 1 produces byte-identical Gate1Report contents for identical validated inputs modulo id and timestamp",
```

When v2 compiles, Pass 3 produces `INV-V2-CLASSIFY-COMMITS-DETERMINISM` with that exact Gate-1-flavored statement — **even though v2 is git-commit-triage, not Gate 1.** Verify by opening any of `specs/workgraphs/WG-V2-CLASSIFY-COMMITS.yaml`'s INV-* nodes and reading the `title` / invariant `statement`.

This is a separate pre-existing bug, not caused by Step 1 or Step 2. Worth a future DECISIONS entry and a Pass 3 fix (template statements should parameterize by PRD subject, or templates should be opt-in per PRD, or the whole template mechanism needs rethinking). Not blocking the Step 2 fork decision but relevant context because Path B's scope includes fixing this.

---

## What needs deciding

Wes must choose one:

1. **Path A** — override the blocker, adopt validation-keyed mapping anyway, accept that executable metadata on `VAL-*` nodes is semantically incoherent (validations validate; they do not dispatch). **Not recommended.**

2. **Path B** — expand Step 2 scope to include Pass 2 refactor. Probably becomes a Step 2a / Step 2b split, with 2a being the Pass 2 + Pass 3 rework and 2b being the PRD amendment + Pass 0 + Pass 8 propagation on the new contract shape.

3. **Path C** — accept coarse-grained mapping, alter Step 1's schema to allow multiple commands per node (would require revisiting the discriminated-union decision). **Not recommended** — invalidates Step 1's decision.

4. **Path D** — new behavioral-action artifact type. Larger than Step 2 as specified but architecturally cleanest. Would need its own paired-PR spec.

5. **Defer Step 2 entirely** — ship the Step 1 schema addition as-is (already committed at `9120394`), come back to PRD-authoring-level execution metadata after a broader design session on WorkGraph node granularity.

---

## What the next CC session MUST NOT do without resolution

- **Do not amend `specs/prds/PRD-V2-CLASSIFY-COMMITS.md`** with an `## Execution mapping` section. The spec's proposed section assumes contract IDs like `CONTRACT-V2-CLASSIFY-COMMITS-GIT-RESOLVE-RANGE` which do not exist in the live compiler output.
- **Do not touch `packages/compiler/src/passes/00-normalize.ts`**. Adding execution-mapping parsing prematurely would add dead code until the fork is resolved.
- **Do not touch `packages/compiler/src/passes/08-assemble-workgraph.ts`**. Populating `executable` fields requires knowing which nodes they belong to; that's the fork.
- **Do not attempt a fifth / hybrid path ad-hoc.** If none of A/B/C/D feels right, say so and stop.

---

## State at handoff

- Baseline commit: `9120394` — Step 1 landed, `WorkGraphNode.executable` optional field added.
- Test count: 170 (schemas: 71, coverage-gates: 50, compiler: 29, harness-bridge: 20).
- All 5 prior PRDs compile Gate 1 PASS; WorkGraphs emitted in `specs/workgraphs/`.
- First ExecutionLog on disk: `specs/execution-logs/EL-WG-V2-CLASSIFY-COMMITS-2026-04-19T19-03-52-792Z.yaml` (dry-run adapter, 11 nodes simulated).
- No uncommitted changes in the working tree at the time this doc was written.

Reverify by running:

```bash
git log --oneline -5
pnpm -r typecheck
pnpm -r test
cat specs/workgraphs/WG-V2-CLASSIFY-COMMITS.yaml
cat packages/compiler/src/passes/02-derive-contracts.ts
cat packages/compiler/src/passes/03-derive-invariants.ts
```

If any of those conflict with the claims in this doc, trust the live files — this handoff is a snapshot.
