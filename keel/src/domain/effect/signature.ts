/**
 * effect/signature.ts — the per-method effect declaration (OD-EFFECT-1).
 * Pure data shape, substrate-free. `ledger.list` and `ledger.put` share a
 * connector but not a signature — this is why the shape is per-METHOD, not
 * per-connector (the flat `GatePolicy.effectful` list and the hand-set
 * `ConnectorRef.requiresApproval` flag both collapse to connector granularity
 * today; a signature is the finer-grained authority both derive from).
 *
 * `response`/`argSchema` reuse the foreign-tool policy's schema vocabulary
 * (OD-EFFECT-7) rather than inventing a second one: `response` is exactly a
 * `ResponseSchema` (already used to bound foreign-tool output), and
 * `argSchema` is exactly `SchemaFields` (the named-field record `FieldSpec`
 * values live in) — the input-side mirror of the same shape.
 */
import type { EffectClass } from "./lattice";
import type { IdempotencyClass } from "./idempotency";
import type { ErrorClass } from "./errors";
import type { ResponseSchema, SchemaFields } from "../foreign/policy";

/** A read/write reference's origin (OD-EFFECT-3), mirroring how
 *  `isAllowedServer` binds a foreign call to an exact origin rather than a
 *  name — so a signature's declared reach is identity-bound, not a label. */
export interface ReadRef { readonly origin: string; readonly description?: string; }
export interface WriteRef { readonly origin: string; readonly description?: string; }

/** BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001 v1.1 (FU-DESC-1): orthogonal to
 *  `IdempotencyClass` (the MECHANISM — how a repeat is made safe). This is
 *  WHO GUARANTEES it holds:
 *   - 'by-construction': KEEL itself implements the atomic write and it's
 *     concurrency-tested (INV-EFFECT-IDEMPOTENT-WRITE-ATOMIC) — e.g.
 *     `store.ensure`'s single-statement upsert. Earned, not stamped.
 *   - 'by-claim': the connector (a spec, an imported OpenAPI doc, any third
 *     party) merely ASSERTS idempotence. KEEL cannot verify it structurally.
 *  Only meaningful when `effectClass === "write-idempotent"`. Absent is NOT
 *  the same as 'by-construction' — `requiresApprovalFor` treats a missing
 *  value as 'by-claim' (fail-safe default, INV-DESC-FOREIGN-IDEMPOTENCE-
 *  UNOWNED). */
export type IdempotenceProvenance = "by-construction" | "by-claim";

export interface EffectSignature {
  readonly connector: string;
  readonly method: string;
  readonly effectClass: EffectClass;
  readonly reads: readonly ReadRef[];
  readonly writes: readonly WriteRef[];
  readonly response: ResponseSchema;
  readonly idempotency: IdempotencyClass;
  readonly idempotenceProvenance?: IdempotenceProvenance;
  readonly errors: readonly ErrorClass[];
  readonly argSchema: SchemaFields;
}
