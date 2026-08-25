/**
 * connector-registry.port.ts — ConnectorRegistryPort (driven).
 * Resolves connector names (from a Specification) to bound capabilities. D5:
 * the resolved set IS the action-space ceiling for the run.
 */
import type { EffectSignature } from "../effect/signature";

export interface ConnectorRef {
  readonly name: string;
  /** D8: whether a call to this connector aborts the action for approval.
   *  Connector-level (coarse); once backfilled, derives from whether ANY of
   *  `signatures` is `write-effectful` (OD-EFFECT-2/4). */
  readonly requiresApproval: boolean;
  /** Per-method effect signatures for this connector, additive/optional so a
   *  connector not yet backfilled still resolves (BRIEF-KEEL-EFFECT-
   *  SIGNATURE-001). One authority: this — not requiresApproval — is where
   *  D8/GatePolicy.effectful should eventually read from. */
  readonly signatures?: readonly EffectSignature[];
  /** OD-DESC-1 (BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001): whether this
   *  connector's effect is knowable per-method (an imported REST connector —
   *  one signature per operation, stable across calls) or only per-call (a
   *  connector whose effect depends on each invocation's own payload, e.g. a
   *  GraphQL or raw-SQL connector — not modeled by this brief; corollary,
   *  not now). Additive/optional; absent for hand-declared connectors that
   *  predate this field. */
  readonly effectDeclaration?: "per-method" | "per-call";
}

export interface ConnectorRegistryPort {
  resolve(names: readonly string[]): readonly ConnectorRef[];
}
