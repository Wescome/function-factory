---
id: IS-TESSERA-GOVERNANCE-ADAPTER
version: 1
title: "Tessera Governance Adapter — index WeOps PDP rules, purposes, and tiers as a queryable policy graph"
sourceCapabilityId: BC-TESSERA-GOVERNANCE-ADAPTER
sourceFunctionId: FP-TESSERA-GOVERNANCE-ADAPTER
source_refs:
  - TESSERA-CF-SPEC
  - BC-TESSERA-GOVERNANCE-ADAPTER
  - IS-TESSERA-SPEC-ADAPTER
  - IS-TESSERA-SKILLS-ADAPTER
  - IS-TESSERA-ARANGO-SCHEMA
  - IS-TESSERA-INDEXER
  - IS-TESSERA-IMPACT
explicitness: explicit
rationale: >
  Tessera's DomainAdapter interface is implemented for `code`, `management`,
  `spec` (IS-TESSERA-SPEC-ADAPTER), and `skills` (IS-TESSERA-SKILLS-ADAPTER). The
  governance adapter is a fifth DomainAdapter that indexes the WeOps governance
  layer — the Policy Decision Point (PDP) rules, the purpose taxonomy, the autonomy
  tiers, and the domain-pack classification rules — as a graph of policy nodes.
  Indexed into the same per-repo slug as the skills adapter, the governance graph
  connects to the `Skill` nodes via `GOVERNS` edges, producing the full governed
  capability graph: a policy engineer can run `tessera_impact` on a classification
  rule and see every purpose, tier binding, and skill invocation it affects.

  This IS adds no new Tessera interface and no new tool. It composes the existing
  per-repo ArangoDB collections (IS-TESSERA-ARANGO-SCHEMA), the existing ingest
  path (IS-TESSERA-INDEXER), and the existing impact traversal (IS-TESSERA-IMPACT)
  by supplying one more DomainAdapter implementation. The governance source of
  truth is Go: `pkg/taxonomy/taxonomy.go` (the DOMAIN.ACTION purpose tree),
  `pkg/pdp/pdp.go` (the autonomy-tier gate, T0=0…T4=4), `pkg/classification/`
  (the ClassificationRule framework), and `domain_packs/*/classification_rules.go`
  (domain-specific rules). The adapter is read-only — it never evaluates policy,
  it only graphs the rule definitions.
---

# Tessera Governance Adapter (fifth DomainAdapter — policy graph)

## JTBD

When a policy engineer changes a classification rule or an autonomy-tier
definition, they want to know what skills, purposes, and role bindings are
affected, so governance changes don't silently break tool invocations across the
system.

## Problem

WeOps governance is a 10-layer ABAC Policy Decision Point. Every skill invocation
is evaluated against a Role, a Purpose (from the taxonomy), an Autonomy Tier
(T0=draft … T4), and Domain bindings. The rules that drive those decisions live
across several Go files:
- `pkg/taxonomy/taxonomy.go` — the DOMAIN.ACTION purpose vocabulary (e.g.
  `TREATMENT.CARE_COORDINATION`, `OPERATIONS.QUALITY_SAFETY`).
- `pkg/pdp/pdp.go` — the autonomy gate (`checkAutonomyGate`: `tier == "T0" &&
  Action.Type == "tool.invoke"` → DENY) and the tier ordinal scale
  (`tierOrdinal`: T0=0, T1=1, T2=2, T3=3, T4=4).
- `pkg/classification/` — the `ClassificationRule` framework (Domain, Action,
  Purpose, Keywords, BaseConf, ContextReq).
- `domain_packs/*/classification_rules.go` — domain-specific rules (e.g.
  healthcare's TREATMENT rules).

The k-dense harness validated 134 skills with 10 test cases each — 1,340 test
cases. The last run logged 1,206 passing and 938 assertion failures, driven by a
T0/T1 tier-evaluation bug and a deny-reason surfacing gap (`tasks/kdense-tier-fix`,
`tasks/kdense-harness-deny-trace`). The common root cause: governance changes have
non-obvious blast radius. Nothing surfaces which purposes a tier change re-gates,
or which skills a classification-rule edit re-routes.

Tessera already solves this graph-impact shape. What is missing is a
`DomainAdapter` that turns the governance rule definitions into nodes and edges.

## Goal

1. Implement `GovernanceAdapter` in
   `workers/tessera-worker/src/adapters/governance-adapter.ts` implementing the
   existing `DomainAdapter` interface (the same interface as the code, spec, and
   skills adapters in `tessera/src/core/domain-adapter.ts`).
2. The adapter parses the governance Go sources and emits nodes: `Purpose`
   (DOMAIN.ACTION), `Domain` (TREATMENT, OPERATIONS, …), `Action`
   (CARE_COORDINATION, …), `Tier` (T0…T4), `ClassificationRule`, and `DomainPack`.
3. The adapter emits edges: `GOVERNS` (Purpose → Skill), `PERMITS` (Tier →
   Purpose / action kind), `DENIES` (Tier → action kind), `PART_OF` (Action →
   Domain), `APPLIES_TO` (ClassificationRule → Domain).
4. Register the adapter in the Tessera Worker so the indexer uses it when
   `language = "governance"` or when file patterns
   `pkg/taxonomy/**/*.go,domain_packs/**/*_rules.go,pkg/pdp/pdp.go,pkg/classification/**/*.go`
   are matched.
5. After indexing, `tessera_impact` on a `ClassificationRule` returns the
   `Purpose` nodes it resolves to; `tessera_context` on `Tier.T0` shows its
   `DENIES` edges to `tool.invoke` purposes.

## Scope

**In scope:**
- `workers/tessera-worker/src/adapters/governance-adapter.ts` — new file:
  `GovernanceAdapter` implementing `DomainAdapter`.
- filePatterns: `pkg/taxonomy/**/*.go`, `domain_packs/**/*_rules.go`,
  `pkg/pdp/pdp.go`, `pkg/classification/**/*.go`.
- `Purpose` nodes from the taxonomy `Taxonomy` map (DOMAIN.ACTION) and the
  `Purpose` constants; `Domain` and `Action` nodes derived from the same map.
- `Tier` nodes T0…T4 parsed from the `tierOrdinal` switch and `checkAutonomyGate`
  in `pdp.go`, with `PERMITS` / `DENIES` edges.
- `ClassificationRule` nodes parsed from each `ClassificationRules()` function in
  the domain packs, with `properties = { domain, action, baseConf, keywords }`.
- `DomainPack` nodes (e.g. `healthcare`) and the rules that belong to them.
- `GOVERNS` / `PERMITS` / `DENIES` / `PART_OF` / `APPLIES_TO` edges from the rule
  definitions.
- Registration of the adapter in the indexer (selected on `language = "governance"`
  or the governance file-pattern match).

**Out of scope:**
- Runtime PDP evaluation — read-only graph analysis only. The adapter never calls
  `Evaluate`, never constructs an `EvaluationRequest`, and never decides
  PERMIT/DENY at index time.
- Policy simulation or "what-if" analysis (V2).
- Indexing the other nine PDP layers' code paths beyond the autonomy gate, the
  taxonomy, and the classification rules (V2).
- Any change to the `DomainAdapter` interface itself — the adapter conforms to the
  existing shape, it does not extend it.
- Resolving `Skill` nodes itself — `GOVERNS` edges target `Skill` node names
  produced by IS-TESSERA-SKILLS-ADAPTER; this adapter emits the edge and tolerates
  an unresolved target when indexed alone (AC-ROB2).

**Cross-adapter:** When indexed alongside the skills adapter into the same slug,
`tessera_context` on a `Skill` returns its governing `Purpose` nodes via the
inbound `GOVERNS` edges, and `tessera_impact` on a `ClassificationRule` traverses
ClassificationRule → Purpose → (GOVERNS) → Skill.

## Acceptance Criteria

### Interface conformance (AC-GV*)

**AC-GV1.** `GovernanceAdapter` implements the `DomainAdapter` interface — `id`,
`name`, `filePatterns`, `extract()`, `resolveRelations()` — with the exact
signatures of the existing code, spec, and skills adapters
(`tessera/src/core/domain-adapter.ts`). No interface member is added, removed, or
re-typed.

**AC-GV2.** `extract()` emits one `Purpose` node per DOMAIN.ACTION entry in the
taxonomy `Taxonomy` map (and the `Purpose` constants), `kind = "Purpose"`,
`name` = the full DOMAIN.ACTION string (e.g. `TREATMENT.CARE_COORDINATION`),
`properties = { domain, action, description }`. It also emits one `Domain` node
per top-level domain (`kind = "Domain"`) and one `Action` node per action
(`kind = "Action"`), with `Action PART_OF Domain` edges.

**AC-GV3.** `extract()` emits `Tier` nodes `T0`, `T1`, `T2`, `T3`, `T4` parsed
from the `tierOrdinal` switch in `pdp.go`, `kind = "Tier"`,
`properties = { ordinal }`. From `checkAutonomyGate`, `Tier.T0` emits a `DENIES`
edge to the `tool.invoke` action kind, and `T1`…`T4` emit `PERMITS` edges to
`tool.invoke` (T0 is the only tier that prohibits execution in the current gate).

**AC-GV4.** `extract()` emits one `ClassificationRule` node per entry returned by
each `ClassificationRules()` function in `domain_packs/**/*_rules.go` (and
`pkg/classification` `DefaultRules()`), `kind = "ClassificationRule"`,
`properties = { domain, action, baseConf, keywords }`. Node name is composite,
e.g. `ClassificationRule:TREATMENT.CARE_COORDINATION`.

**AC-GV5.** After indexing, `tessera_impact` on
`ClassificationRule{domain:TREATMENT, action:CARE_COORDINATION}` returns the
`Purpose` node `TREATMENT.CARE_COORDINATION` (the rule's `Purpose` field) and,
when the skills graph is co-indexed, the `Skill` nodes that `Purpose` `GOVERNS`.

**AC-GV6.** `tessera_context` on `Tier.T0` shows its `DENIES` edge to the
`tool.invoke` action kind — matching the harness TC-03 / TC-04 deny cases
(`tier == "T0" && Action.Type == "tool.invoke"` → DENY). `tessera_context` on
`Tier.T1` shows a `PERMITS` edge to `tool.invoke`.

**AC-GV7.** `tessera_detect_changes` on a modified
`domain_packs/healthcare/classification_rules.go` returns the affected
`ClassificationRule` node(s) and the `Purpose` node(s) they resolve to in the
changed set — and nothing else (no unrelated taxonomy or tier nodes).

### Edges (AC-EDG*)

**AC-EDG1.** Each `ClassificationRule` emits `APPLIES_TO` (rule → its `Domain`
node) and a resolution edge to its `Purpose` node (rule → Purpose, used by
AC-GV5's impact traversal).

**AC-EDG2.** Each `Purpose` emits a `GOVERNS` edge to the `Skill` nodes it
governs. In V1 the governing relationship is the harness binding: a `Purpose`
`GOVERNS` a `Skill` when the harness test plan invokes that skill under that
purpose (e.g. `OPERATIONS.QUALITY_SAFETY` governs the harness-tested skills). When
no skills graph is co-indexed, the `GOVERNS` edge target is unresolved and skipped
(AC-ROB2).

**AC-EDG3.** Each `DomainPack` node (e.g. `healthcare`) emits a containment edge
to every `ClassificationRule` it defines, so `tessera_impact` on a `DomainPack`
returns all rules, purposes, and skills it reaches.

### Robustness (AC-ROB*)

**AC-ROB1.** A Go source that parses but yields no recognizable taxonomy entry,
tier, or `ClassificationRules()` function is skipped — no node is created and no
error is thrown. (Same tolerance as IS-TESSERA-SPEC-ADAPTER AC-ROB1.)

**AC-ROB2.** A `GOVERNS` edge whose target `Skill` name does not resolve to an
indexed node (governance indexed without the skills graph) is skipped, not
errored. The `Purpose` node and its other edges are still emitted. (Same tolerance
as IS-TESSERA-SPEC-ADAPTER AC-ROB2.)

**AC-ROB3.** A `Purpose` constant present in `pkg/taxonomy` but absent from the
`Taxonomy` map (e.g. a BCO purpose like `AI_GOVERNANCE_RISK`) is still emitted as
a `Purpose` node with `properties.format = "BCO"` and no `Action PART_OF Domain`
edge. The non-DOMAIN.ACTION shape is tolerated, not errored.

## Registration

The adapter is selected by the indexer in two equivalent ways (either is
acceptable; document which is wired):
- Explicit: `language = "governance"` on the IndexJob selects `GovernanceAdapter`.
- Pattern: a tarball whose tracked files match
  `pkg/taxonomy/**/*.go,domain_packs/**/*_rules.go,pkg/pdp/pdp.go,pkg/classification/**/*.go`
  routes through `GovernanceAdapter.filePatterns`.

The adapter writes into the same per-repo collections as every other domain
(`tessera_nodes_{slug}`, `tessera_edges_{slug}`) via IS-TESSERA-ARANGO-SCHEMA; for
the WeOps governance corpus the slug is `weops-enterprise` — the same slug used by
IS-TESSERA-SKILLS-ADAPTER, so the policy graph and the skill graph share one
queryable graph.

## Node kinds and edge types

| Source | Graph element | Value |
|--------|---------------|-------|
| Taxonomy DOMAIN.ACTION entry | node `kind`, `name` | `Purpose`, e.g. `TREATMENT.CARE_COORDINATION` |
| Top-level domain | node `kind` | `Domain`, e.g. `TREATMENT` |
| Action within a domain | node `kind` | `Action`, e.g. `CARE_COORDINATION` |
| `tierOrdinal` switch (T0…T4) | node `kind` | `Tier` |
| `ClassificationRules()` entry | node `kind` | `ClassificationRule` |
| Domain pack module | node `kind` | `DomainPack`, e.g. `healthcare` |
| Purpose → governed skill | edge | `GOVERNS` |
| Tier → permitted action kind | edge | `PERMITS` |
| Tier (T0) → prohibited action kind | edge | `DENIES` |
| Action → Domain | edge | `PART_OF` |
| ClassificationRule → Domain | edge | `APPLIES_TO` |

## Environment dependencies

Same as IS-TESSERA-ARANGO-SCHEMA (inherits the ArangoDB env vars). No additional
env vars.

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_USERNAME` | secret | ArangoDB user (basic auth) |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var (`"weops_enterprise"`) | ArangoDB database name (shared with the skills adapter graph) |

## Non-negotiables

- `GovernanceAdapter` implements the exact `DomainAdapter` interface — no interface
  changes.
- Read-only: the adapter never evaluates policy, never constructs an
  `EvaluationRequest`, never decides PERMIT/DENY at index time. It graphs rule
  definitions only.
- `GOVERNS` edges only connect to skills in the same index run (dangling targets
  are skipped, not errors) (AC-ROB2).
- The tier model is taken verbatim from `pdp.go`: T0=0…T4=4 and the single
  `checkAutonomyGate` rule (`T0 + tool.invoke` → DENY). The adapter does not invent
  tier semantics not present in the source.
- File patterns must match only the governance sources listed in Scope — no other
  Go packages are indexed.
- BCO / non-DOMAIN.ACTION purposes are tolerated as `Purpose` nodes, not errors
  (AC-ROB3).

## Success Metrics

`GovernanceAdapter` conforms to the existing `DomainAdapter` interface and is
selected by the indexer for the WeOps governance corpus without any change to the
interface or the ingest pipeline. After one index run, the policy graph —
purposes, domains, actions, tiers, classification rules, and domain packs — is
queryable through the unchanged Tessera MCP tools.

`tessera_impact` on a `ClassificationRule` returns the purposes it resolves to and,
when co-indexed with the skills graph, the skills those purposes govern — so a
policy engineer sees the full blast radius of a rule change before editing.
`tessera_context` on `Tier.T0` shows the `tool.invoke` deny edge that drove the
harness TC-03 / TC-04 cases, making the tier-gate behavior inspectable rather than
buried in `checkAutonomyGate`. `tessera_detect_changes` on a modified
`classification_rules.go` returns exactly the affected rule and purpose nodes.

Indexed into the same slug as IS-TESSERA-SKILLS-ADAPTER, the governance nodes and
the skill nodes form one graph: the 938 harness assertion failures would have been
foreseeable as a tier-change blast radius across the governed `tool.invoke`
purposes, instead of surfacing only at run time.
