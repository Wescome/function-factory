/**
 * run-dispatch.port.ts — RunDispatchPort (driven).
 * INTENT/admission. Encodes D7 at the domain boundary WITHOUT leaking the
 * primitive: the adapter uses startFiber(idempotencyKey), but the domain sees
 * only "admit this run idempotently".
 */
import type { ContentHash } from "../lineage/contract";

export interface AdmitResult {
  /** D7: false means the idempotencyKey matched an existing run — no
   *  double-start. The startFiber `accepted` field, surfaced by intent. */
  readonly accepted: boolean;
  readonly status: string;
}

export interface RunDispatchPort {
  /**
   * Admit a run, idempotent on the Specification id. A repeat admit with the
   * same id returns accepted:false and the existing run's status. No Claim
   * node, no external lock (D7). The startFiber primitive never appears here.
   */
  admit(specification: ContentHash): Promise<AdmitResult>;
}
