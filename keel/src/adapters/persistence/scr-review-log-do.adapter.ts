/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 2 (INV-8, OD-PORT-3): SCR's `EventLog`
 * port, backed by DO SQLite -- the review log's real, distinct home. Mirrors
 * SCR's own `SqliteEventLog` (`node:sqlite`) schema/trigger pattern exactly,
 * ported onto `SqlStorage` (`state.storage.sql`) instead: same table shape,
 * same append-only triggers, same atomic-batch-via-explicit-transaction
 * behavior for `appendAtomic` (INV-6).
 *
 * `review_log` is a NEW, SEPARATE table from KEEL's own `lineage_nodes`/
 * `lineage_events` (Orchestrator's run log) -- never folded together
 * (OD-PORT-3: "a review log is a distinct DO namespace... joined to the run
 * log only at the slice→Change boundary", which is PORT-4, not this).
 *
 * Synchronous by construction, matching SCR's own `EventLog` port exactly
 * (`append(e): void`, not `Promise<void>`) -- DO SQLite (`SqlStorage.exec`)
 * is itself synchronous, so no signature had to change, which is what lets
 * `service.ts` (Track 1) stay unmodified: an async EventLog would have
 * forced every `ReviewService` public method to become async too.
 *
 * Empirically confirmed (not assumed), against the real DO substrate
 * (vitest-pool-workers' real workerd, via `runInDurableObject`): DO SQLite
 * supports `CREATE TRIGGER ... BEFORE UPDATE/DELETE ... RAISE(ABORT, ...)`
 * exactly like real SQLite (a blocked UPDATE surfaces as
 * `SQLITE_CONSTRAINT_TRIGGER`) -- but a raw `BEGIN`/`COMMIT`/`ROLLBACK` over
 * `storage.sql.exec` is REJECTED outright ("please use
 * state.storage.transaction()/transactionSync() instead... interacts
 * correctly with Durable Objects' automatic atomic write coalescing").
 * `appendAtomic` uses `storage.transactionSync()` instead -- DO's own
 * synchronous transaction primitive, which auto-rolls-back on a thrown
 * exception (SCR's own `SqliteEventLog` used raw SQL BEGIN/COMMIT/ROLLBACK
 * because `node:sqlite` has no equivalent JS-level API; the DO platform
 * does, and the platform's own guidance is to prefer it).
 */
import { InvariantViolation, type ReviewEvent } from "../../scr/events";
import type { EventLog } from "../../scr/log";

export class DoReviewLog implements EventLog {
  private readonly sql: SqlStorage;

  constructor(private readonly storage: DurableObjectStorage) {
    this.sql = storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS review_log (
        ord        INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id   TEXT NOT NULL UNIQUE,
        type       TEXT NOT NULL,
        at         INTEGER NOT NULL,
        payload    TEXT NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TRIGGER IF NOT EXISTS review_log_no_update
        BEFORE UPDATE ON review_log
        BEGIN SELECT RAISE(ABORT, 'INV-8: review log is append-only'); END
    `);
    this.sql.exec(`
      CREATE TRIGGER IF NOT EXISTS review_log_no_delete
        BEFORE DELETE ON review_log
        BEGIN SELECT RAISE(ABORT, 'INV-8: review log is append-only'); END
    `);
  }

  append(e: ReviewEvent): void {
    this.appendAtomic([e]);
  }

  appendAtomic(events: ReviewEvent[]): void {
    try {
      this.storage.transactionSync(() => {
        for (const e of events) {
          this.sql.exec(
            "INSERT INTO review_log (event_id, type, at, payload) VALUES (?, ?, ?, ?)",
            e.eventId, e.type, e.at, JSON.stringify(e),
          );
        }
      });
    } catch (err) {
      throw new InvariantViolation("INV-6", `land transaction rolled back: ${String(err)}`);
    }
  }

  all(): ReviewEvent[] {
    const rows = this.sql.exec<{ payload: string }>("SELECT payload FROM review_log ORDER BY ord").toArray();
    return rows.map((r) => JSON.parse(r.payload) as ReviewEvent);
  }

  tail(): ReviewEvent | undefined {
    const rows = this.sql.exec<{ payload: string }>("SELECT payload FROM review_log ORDER BY ord DESC LIMIT 1").toArray();
    return rows[0] ? (JSON.parse(rows[0].payload) as ReviewEvent) : undefined;
  }
}
