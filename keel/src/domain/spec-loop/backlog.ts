/**
 * Phase 6a backlog — derived-but-not-disposed specs. INV-SPEC-LEASED: every entry
 * carries a lease; undisposed proposals past their lease expire fail-closed
 * (stale pending authority is a measured risk). The port; adapters back it with
 * D1 (production) or memory (tests).
 */
import type { SpecificationContent } from "../lineage/nodes";
import type { GateTier } from "./gate";

export type BacklogStatus = "pending" | "admitted" | "deferred" | "rejected" | "expired";

export interface BacklogEntry {
  readonly id: string;
  readonly spec: SpecificationContent;
  readonly tier: GateTier;
  readonly leaseExpiresAt: number; // epoch ms
  readonly status: BacklogStatus;
}

export interface BacklogStore {
  enqueue(spec: SpecificationContent, tier: GateTier, leaseExpiresAt: number): Promise<BacklogEntry>;
  listPending(): Promise<readonly BacklogEntry[]>;
  dispose(id: string, status: BacklogStatus): Promise<void>;
  /** Mark every pending entry past its lease as expired. Returns how many. */
  expireStale(now: number): Promise<number>;
}
