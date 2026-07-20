/**
 * cross-run-index.port.ts — CrossRunIndexPort (driven, read-model write side).
 *
 * The per-run lineage lives in each Orchestrator's DO SQLite (the source of
 * truth, INV-A). This port fans the pure crossRunRecord projection out to a
 * shared index queryable ACROSS runs (D4's "CQRS read side / D1 projection").
 * It is a secondary read model: a write here failing must never break a run.
 */
import type { CrossRunRecord } from "../replay/projection";

export interface CrossRunListOptions {
  readonly terminal?: string; // filter, e.g. "ACCEPT" | "ESCALATE" | "PAUSE"
}

export interface CrossRunIndexPort {
  /** Upsert a run's cross-run record (idempotent on runId; last-write-wins). */
  record(r: CrossRunRecord): Promise<void>;
  /** Query records across all runs. */
  list(opts?: CrossRunListOptions): Promise<readonly CrossRunRecord[]>;
}
