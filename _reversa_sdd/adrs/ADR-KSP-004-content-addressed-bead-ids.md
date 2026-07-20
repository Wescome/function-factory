# ADR-KSP-004: Content-Addressed Bead IDs (Deterministic SHA-256)

**Status**: Accepted
**Date**: 2026-06-10
**Deciders**: Wislet J. Celestin / Koales.ai
**Context**: SPEC-KSP-BEAD-GRAPH-001 §3, SPEC-KSP-ARCH-001 INV-KSP-002

---

## Context

The Bead graph is an append-only content-addressed DAG. Beads are never updated or deleted. When the same bead would logically be written twice (e.g., idempotent retry after a partial failure in Bridge Point 2 of the loop closure), the system must handle the duplicate write gracefully — either ignoring it or treating it as a no-op.

Two approaches exist for bead identity:

1. **Random UUID at write time**: simple to generate, guaranteed unique, but duplicate writes produce duplicate records. Detecting duplicates requires querying by content fields, adding complexity.

2. **Content-addressed hash**: compute `bead_id = SHA-256(type + canonical_json(content) + sorted(parent_ids))`. The same content with the same parents always produces the same ID. Writing the same bead twice is idempotent at the SQL layer via `INSERT OR IGNORE`.

---

## Decision

Use content-addressed bead IDs computed as:

```
bead_id = SHA-256(type + canonical_json(content) + sorted_join(parent_ids))
```

Where:
- `type` is the Bead type string (e.g., `'execution'`, `'trust'`)
- `canonical_json` is deterministic JSON serialization (keys sorted alphabetically, no whitespace)
- `sorted_join` is the alphabetically sorted concatenation of all parent `bead_id` values

Implementation in `src/bead-id.ts`:
```typescript
export function computeBeadId(
  type: string,
  content: Record<string, unknown>,
  parentIds: string[]
): string {
  const canonical =
    type +
    JSON.stringify(content, Object.keys(content).sort()) +
    [...parentIds].sort().join('');
  return createHash('sha256').update(canonical).digest('hex');
}
```

All storage operations use `INSERT OR IGNORE` — if a bead with the same ID already exists, the write silently succeeds without error.

---

## Rationale

**Idempotent writes enable safe retry**: the `LoopClosureService` recovery path for partial failures (Bridge Point 2: artifact graph write succeeds, bead graph write fails) requires idempotent retry. With content-addressed IDs and `INSERT OR IGNORE`, the retry write is always safe — it either inserts the bead or confirms it already exists. No duplicate bead records.

**Parent-order independence**: parent IDs are sorted before hashing. The same logical bead produces the same `bead_id` regardless of the order in which parent beads were received or processed. This matters for the amendment loop where multiple upstream beads (e.g., `buildOutcomeBead.bead_id` and `archDecisionBead.bead_id`) appear as parents — their arrival order must not affect the derived bead's identity.

**Immutability is enforced by identity**: a bead cannot be "updated" in place because any change to content or parents produces a different hash and therefore a different `bead_id`. The append-only invariant (INV-BG-001) is structurally enforced rather than relying solely on application-layer discipline.

**Integrity verification**: `computeBeadId()` is called before every write and the result is verified against `bead.bead_id`. Mismatch throws `BeadIntegrityError`. This catches content corruption, incorrect bead construction, and any code path that sets `bead_id` manually to a non-hash value.

**Cross-layer deduplication**: when the loop closure service writes a bead that has already been written (e.g., amendment adoption triggered twice due to a bug), the second write is a no-op. The artifact graph may acquire duplicate Specification nodes in this case (artifact graph uses `upsertNode` with `ON CONFLICT DO UPDATE`) but the bead graph will not acquire duplicate beads.

---

## Consequences

**Positive**:
- Idempotent write semantics at the storage layer.
- Append-only constraint structurally enforced through identity.
- Partial failure recovery in loop closure is safe to retry without duplicate data.
- Content integrity verifiable at write time.

**Negative**:
- Two beads with identical content and parents are indistinguishable — this is intentional but requires care when the same logical event occurs twice (the second occurrence is silently dropped).
- The SHA-256 computation is synchronous per-bead write. At high write volume, this adds a small per-write CPU cost.
- Any change to the canonical serialization function (`canonical_json`) would change all future bead IDs, breaking identity continuity. The function must be treated as frozen.
- Timestamp fields in content make two otherwise-identical beads non-equal. Any bead schema that includes `ts` in content will produce a unique hash even for logically duplicate writes — callers must ensure `ts` is set consistently for idempotent retry paths.

---

## Rejected Alternatives

**Random UUID**: duplicate writes produce duplicate records. Idempotent retry requires querying for existing records by content fields (expensive) or maintaining a separate deduplication index. Rejected.

**Sequential integer ID**: requires coordination across writers to assign IDs. Breaks the single-writer-per-DO assumption (INV-KSP-003) if multiple processes needed to write. Rejected.

**Application-layer deduplication (check before insert)**: adds a read-before-write on every bead write, doubling the SQLite transaction count. Content-addressed IDs provide the same guarantee with `INSERT OR IGNORE` in a single statement. Rejected.
