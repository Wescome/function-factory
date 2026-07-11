/**
 * query.port.ts — QueryPort (DRIVING, read-side). Named in ARCH-KEEL-000 §15.1,
 * deferred at M1, implemented at M4. Additive: it changes no existing frozen
 * port. Realized by the composition root over the replay projection.
 */
import type { ContentHash } from "../lineage/contract";
import type { TimelineEntry, ReplaySnapshot, ReplayConsistency, CrossRunRecord } from "../replay/projection";

export interface CustodyView {
  readonly runId: ContentHash | null;
  readonly nodes: readonly { readonly id: ContentHash; readonly kind: string }[];
  readonly events: number;
  readonly terminal: string | null;
}

export interface QueryPort {
  readRun(): Promise<CustodyView>;
  timeline(): Promise<readonly TimelineEntry[]>;
  replayTo(index: number): Promise<ReplaySnapshot>;
  verifyReplay(): Promise<ReplayConsistency>;
  crossRun(): Promise<CrossRunRecord>;
}
