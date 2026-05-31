# SPEC-ARANGO-RETIRE-001 — ArangoDB Retirement

Date: 2026-05-31
Status: Superseded by DO-BEAD-STORE-ARCHITECTURE.md
Original: `/Users/wes/Downloads/SPEC-ARANGO-RETIRE-001.docx`

---

## Supersession Note

This spec originally proposed migrating ArangoDB artifacts to **DoltHub managed**.

That target is superseded. The artifact store is now the **`FactoryStore` Durable Object** (`artifacts.db`) defined in `DO-BEAD-STORE-ARCHITECTURE.md`. DoltHub is never provisioned.

All migration phases, invariants, schemas, and acceptance criteria from the original spec remain valid with the following substitutions:

| Original | Replaced by |
|----------|-------------|
| DoltHub managed instance | `FactoryStore` DO, one SQLite DB, knowledge plane tables |
| `DOLT_HTTP_URL` env var | DO binding via Service Binding from ff-pipeline |
| `DoltClient` class | `ArtifactClient` HTTP wrapper for `/artifacts/*` DO routes |
| `dolt sql < schema.sql` | knowledge plane tables in `FactoryStore.initSchema()` |
| `DualWriteAdapter` (Arango + Dolt) | `DualWriteAdapter` (Arango + DO `/artifacts/*` routes) |
| CTE benchmark against DoltHub | CTE benchmark against `GET /artifacts/lineage` DO route |
| Separate schema, no cross-references | `emission_bead_id REFERENCES beads(id)` on every artifact table — real FK to execution plane |

## What carries over unchanged

- **All invariants** (INV-RETIRE-001 through INV-RETIRE-005) — same semantics, different target
- **All migration phases** (Phase 0–5) — same sequence, Dolt target replaced by DO
- **CTE benchmark** (§6) — same 100ms / 10-hop criterion, run against DO route
- **Collection inventory** (§3) — same 21 collections, same priorities
- **Zod schemas** (§4.2) — same schemas, DO artifact client uses same validation
- **Open decisions** — OD-001 resolved (DO, not DoltHub), OD-002/003/004 unchanged

## Phase 0 target (updated)

Instead of provisioning DoltHub:
1. `FactoryStore` DO deployed (covered by WP-DO-1 in DO-BEAD-STORE-ARCHITECTURE.md)
2. `artifacts.db` schema initialized in `initArtifactsSchema()`
3. `ArtifactClient` scaffolded in `workers/ff-pipeline/src/artifact-client.ts`
4. Smoke-test: insert one synthetic Verdict row via `/artifacts/verdicts`, read back, assert round-trip

**Verification-Process:** VP-DOLT-INFRA-001 → retargeted as VP-DO-ARTIFACTS-001. Same criterion.

## Implementation entry point

See `DO-BEAD-STORE-ARCHITECTURE.md` §9 WP-DO-1 (TypeScript DO) and WP-DO-4 (ff-pipeline wiring). The artifact migration work is WP-DO-5.
