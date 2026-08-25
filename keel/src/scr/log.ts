/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 1/2: `EventLog` + `InMemoryEventLog` lifted
 * from SCR (log.ts) verbatim. `SqliteEventLog` (node:sqlite `DatabaseSync`)
 * is deliberately NOT ported -- it's SCR's own Node-local-file dev/test
 * convenience, irrelevant to KEEL's Workers runtime. Its role (a real,
 * durable, trigger-guarded backing store) is played here by Track 2's
 * `DoReviewLog` (`src/adapters/persistence/scr-review-log-do.adapter.ts`),
 * which implements this SAME `EventLog` port against DO SQLite instead.
 *
 * INV-8 APPEND-ONLY-REVIEW-LOG.
 *
 * The port exposes append and read. There is deliberately no update and no
 * delete. `appendAtomic` exists because INV-6 requires a land to be one
 * transaction.
 */
import type { ReviewEvent } from './events';

export interface EventLog {
  append(e: ReviewEvent): void;
  appendAtomic(events: ReviewEvent[]): void;
  all(): ReviewEvent[];
  /** The most recent event, for chaining the next one onto it (INV-12). */
  tail(): ReviewEvent | undefined;
}

export class InMemoryEventLog implements EventLog {
  #events: ReviewEvent[] = [];

  append(e: ReviewEvent): void {
    this.#events.push(e);
  }

  appendAtomic(events: ReviewEvent[]): void {
    // Single-threaded; the array push is the transaction.
    this.#events.push(...events);
  }

  all(): ReviewEvent[] {
    return [...this.#events];
  }

  tail(): ReviewEvent | undefined {
    return this.#events[this.#events.length - 1];
  }
}
