---
id: IS-TESSERA-MANAGEMENT-ADAPTER
version: 1
title: "Tessera Management Adapter — Register proven SR adapter in cloud indexer"
sourceCapabilityId: BC-TESSERA-MANAGEMENT-ADAPTER
sourceFunctionId: FP-TESSERA-MANAGEMENT-ADAPTER
source_refs:
  - TESSERA-CF-SPEC
  - BC-TESSERA-MANAGEMENT-ADAPTER
  - IS-TESSERA-ARANGO-SCHEMA
  - IS-TESSERA-INDEXER
explicitness: explicit
rationale: >
  The management adapter already exists and is proven:
  tessera/src/adapters/management/management-adapter.ts (921 lines),
  46 passing tests, validated against real Strategy.Recipes data
  (modularity 0.4356, 11 communities on a 36-entity recipe).
  This IS is not a new implementation — it is registration of the
  existing adapter in the cloud indexer (IS-TESSERA-INDEXER) so it
  runs on GitHub push events alongside the code adapter.

  The scope is narrow by design: copy the adapter to the Worker,
  register it in the LanguageProvider/DomainAdapter registry, add
  the SR file pattern, verify with the existing 46 test fixtures.
  No new extraction logic. No schema changes. The local adapter is
  the ground truth — this IS ports it to cloud without modifying it.
---

# Tessera Management Adapter (cloud registration)

## JTBD

When a Strategy.Recipes workspace is pushed to GitHub, the Factory wants
to index its strategic entities and relations into the Tessera graph, so
agents can run impact analysis on Decisions, Constraints, and Initiatives
from anywhere — not just from a developer's local machine.

## Problem

The management adapter exists and is proven locally. It is not registered
in the cloud indexer. Today:

- Pushing a Strategy.Recipes workspace to GitHub triggers no indexing.
- An agent in ff-pipeline or GasCity cannot run `tessera_impact` on a
  strategic Decision — the graph doesn't exist in the cloud.
- The 46 test fixtures pass locally. The cloud indexer only knows the
  code adapter.

The domain-neutrality Tessera was designed to prove is undeployed.

## Goal

1. Copy `management-adapter.ts` to
   `workers/tessera-worker/src/adapters/management-adapter.ts` unchanged.
2. Register the adapter in the Tessera Worker's adapter registry alongside
   the code adapter, with filePatterns targeting Strategy.Recipes JSON files.
3. Verify all 46 existing management adapter tests pass against the copied
   implementation (no regressions).
4. After indexing a Strategy.Recipes workspace, `tessera_impact` returns
   correct results for a Constraint node.

## Scope

**In scope:**
- `workers/tessera-worker/src/adapters/management-adapter.ts` — copy of
  the existing adapter, no modifications to extraction logic
- `workers/tessera-worker/src/adapter-registry.ts` — register
  ManagementAdapter with filePatterns `**/*.json` filtered by SR
  schemaVersion detection (AC-REG2)
- `workers/tessera-worker/src/adapters/management-adapter.test.ts` —
  port the 46 existing tests, all must pass

**Out of scope:**
- No changes to extraction logic, normalization, or confidence scoring
- No changes to the DomainAdapter interface
- No new entity kinds or relation types beyond what the adapter already produces
- Strategy.Recipes schema migration or version upgrades (V2)

## Acceptance Criteria

### Registration (AC-REG*)

**AC-REG1.** `ManagementAdapter` is instantiated and registered in the
Tessera Worker's adapter registry. `registry.get('management')` returns
the adapter instance.

**AC-REG2.** The adapter's `filePatterns` includes `**/*.json`. The
registry routes a `.json` file containing `"schemaVersion": "strategy-recipes.graph.*"`
to the management adapter, not the code adapter. Files without that
schemaVersion field are not routed to the management adapter.

**AC-REG3.** The code adapter's existing file patterns are unchanged.
Both adapters coexist in the same registry.

### Extraction parity (AC-EXT*)

**AC-EXT1.** All 46 existing management adapter tests pass against the
copied `workers/tessera-worker/src/adapters/management-adapter.ts`
without modification.

**AC-EXT2.** The adapter produces the following entity kinds (matching
the proven local implementation):
`signal`, `thesis`, `constraint`, `stakeholder`, `assumption`, `decision`,
`initiative`, `metric`, `risk`, `evidence`.

**AC-EXT3.** The adapter produces the following relation types (prefixed
`management:`):
`motivates`, `supports`, `constrains`, `depends_on`, `validates`,
`threatens`, `tradeoff_with`, `owns`, `measures`, `decomposes_into`,
`supersedes`.

**AC-EXT4.** Legacy alias normalization is preserved:
`claim` → `thesis`, `note` → `evidence`, `raises` → `threatens`,
`measures` → `validates` (from LEGACY_OBJECT_TYPE_ALIASES and
LEGACY_RELATIONSHIP_TYPE_ALIASES in the adapter).

**AC-EXT5.** Confidence scoring from evidence quality is preserved:
`supported=1.0`, `partially_supported=0.6`, `unsupported=0.2`,
`disputed=0.1` (EVIDENCE_QUALITY_SCORES).

### End-to-end (AC-E2E*)

**AC-E2E1.** Indexing the `management-recipe-demo` repo (1 file,
36 entities, 127 edges — currently indexed locally) via the cloud
indexer produces `tessera_meta` with `nodes >= 36` and `edges >= 100`.

**AC-E2E2.** `POST /repos/management-recipe-demo/impact` with
`{ target: "execution_core", direction: "upstream" }` returns a
non-empty impacted set (community detection proven on this fixture:
modularity 0.4356, 11 communities including execution_core,
sequence_strategy, qualification_logic).

**AC-E2E3.** `POST /repos/management-recipe-demo/query` with
`{ query: "constraint" }` returns at least one `constraint` kind entity.

### Tests (AC-T*)

**AC-T1.** All 46 existing management adapter tests pass with the
copied implementation:
`workers/tessera-worker/src/adapters/management-adapter.test.ts`.

**AC-T2.** A new registration test confirms the adapter is routed
correctly: a JSON file with `"schemaVersion": "strategy-recipes.graph.v0"`
is routed to ManagementAdapter; a `.ts` file is routed to the code
adapter; a plain JSON without SR schemaVersion is not routed to either.

**AC-T3.** All existing Tessera Worker tests continue to pass
(`npm test` in `workers/tessera-worker/`).

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var | ArangoDB database name |

No additional env vars beyond what IS-TESSERA-ARANGO-SCHEMA and
IS-TESSERA-INDEXER already require.

## Non-negotiables

- The adapter's extraction logic is NOT modified — the local
  implementation is the ground truth. If the 46 tests pass, the
  extraction is correct.
- SchemaVersion detection must be used for routing — do NOT route
  all JSON files to the management adapter (would break code adapter
  JSON config files).
- Legacy alias normalization (LEGACY_OBJECT_TYPE_ALIASES,
  LEGACY_RELATIONSHIP_TYPE_ALIASES) must be preserved exactly.
- The DomainAdapter interface is NOT changed.

## Success Metrics

Indexing a Strategy.Recipes workspace in the cloud produces the same
graph as the local adapter: same entity kinds, same relation types,
same confidence scores. All 46 existing tests pass. The 46-test suite
is the acceptance gate — if it passes, the adapter is correct.

`tessera_impact` on a strategic entity returns a non-empty impacted set,
proving that community detection, BFS traversal, and risk scoring all
run on management data in the cloud exactly as they do locally.
