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
| CTE benchmark against DoltHub | CTE benchmark against `GET /artifacts/lineage` DO route — measures read latency only; does not exercise storage-growth/compaction (the dimension Dolt was rejected for; Prolly Tree reads stay fast regardless of history depth) |
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

## OD-005 — Dolt commit graph compaction (architectural record, 2026-05-31)

**Why this decision was closed before implementation:**

Dolt's storage engine is built on a Git-style commit graph of Prolly Trees (a novel B-tree variant with version-control properties, via Noms). Its MySQL-compatible surface is provided by Vitess. The commit graph is the storage cost — not the rows. Every `INSERT`/`UPDATE`/`DELETE` generates a Dolt commit. A deleted row's originating commit still exists in history. `dolt gc` reclaims unreferenced chunks but the commit graph itself grows forever. Full compaction requires `DELETE + rebase + gc`, not just `DELETE + gc`.

**Factory-specific risk:** Dolt commits are explicit (`dolt commit` / `dolt_commit()`); raw DML mutates the working set without minting a commit-graph node. The risk is the Factory's *commit cadence* — every Verification-Process step commits, every bead close commits, every lineage edge append commits. That per-step commit granularity grows the commit graph aggressively with no natural compaction boundary. At scale, `DELETE + rebase + gc` becomes a non-trivial operational pipeline that must be scheduled, monitored, and protected from mid-compaction reads.

**Production bead store note:** The current `bd`/Dolt bead store in production is already accumulating this commit graph today — every bead create/update/close in the Gas City loop is a committed write. This likely compounds the cold-start contention documented in `GAS-CITY-STARTUP-CONTENTION-ARCHITECTURE.md` (larger chunk store → slower gc → slower cold start). The DO migration is more urgent than the adoption-hang framing alone suggests.

**Resolution:** This risk, combined with the operational overhead of managing DoltHub or a self-hosted Dolt Container, was the deciding factor in superseding Dolt in favour of the `FactoryStore` DO SQLite. DO SQLite has no commit graph — storage cost is exactly the live row set. Deleting a row reclaims its storage immediately. No compaction strategy required.

**Status:** Closed. DoltHub never provisioned. OD-005 is documented as a permanent architectural record explaining why Dolt was rejected for the Factory's write profile.

---

## Implementation entry point

See `DO-BEAD-STORE-ARCHITECTURE.md` §9 WP-DO-1 (TypeScript DO) and WP-DO-4 (ff-pipeline wiring). The artifact migration work is WP-DO-5.
