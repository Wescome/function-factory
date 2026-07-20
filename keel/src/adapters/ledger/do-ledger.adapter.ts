import type { LedgerStore, LedgerRecord } from "./store";

/** Matches `SqlStorage.exec` exactly (positional params, not a tagged
 *  template) — needed here, unlike the rest of the codebase's `this.sql`
 *  tagged-template convenience wrapper, because `ensure`'s atomicity proof
 *  depends on `SqlStorageCursor.rowsWritten`, which that wrapper discards
 *  (it spreads the cursor into a plain array and returns only the rows). */
interface SqlStorageCursor<T> { toArray(): T[]; rowsWritten: number; }
type SqlExec = <T = Record<string, unknown>>(query: string, ...bindings: unknown[]) => SqlStorageCursor<T>;

/** LedgerStore over the Orchestrator DO's own SQLite storage (same mechanism as
 *  lineage_nodes/lineage_events) — the "production form" MapLedgerStore's own
 *  doc comment calls for. In-memory state doesn't survive DO eviction between
 *  two separate /admit calls, which is exactly what the idempotency re-run
 *  needs to hold across. */
export class DoLedgerStore implements LedgerStore {
  constructor(private readonly exec: SqlExec) {
    this.exec("CREATE TABLE IF NOT EXISTS ledger_records (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value TEXT NOT NULL)");
  }
  async list(key: string): Promise<LedgerRecord[]> {
    return this.exec<{ value: string }>("SELECT value FROM ledger_records WHERE key = ?", key)
      .toArray().map((r) => ({ value: JSON.parse(r.value) }));
  }
  async put(key: string, value: unknown): Promise<void> {
    this.exec("INSERT INTO ledger_records (key, value) VALUES (?, ?)", key, JSON.stringify(value));
  }
  /** Atomic upsert as ONE statement — INSERT ... WHERE NOT EXISTS is a single
   *  SQLite statement, so there is no read-then-write gap for a concurrent
   *  `ensure` on the same key to land in (unlike a separate SELECT then
   *  conditional INSERT, which races). `rowsWritten` (read directly off the
   *  cursor SQLite's `exec` returns for THIS statement — not a separate
   *  `changes()` query, which does not reliably reflect a prior statement
   *  through this API) reports whether THIS call actually inserted a row. */
  async ensure(key: string, value: unknown): Promise<{ inserted: boolean }> {
    const cursor = this.exec(
      "INSERT INTO ledger_records (key, value) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM ledger_records WHERE key = ?)",
      key, JSON.stringify(value), key,
    );
    return { inserted: cursor.rowsWritten > 0 };
  }
}
