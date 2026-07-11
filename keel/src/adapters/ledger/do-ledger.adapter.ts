import type { LedgerStore, LedgerRecord } from "./store";

type Sql = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Iterable<T>;

/** LedgerStore over the Orchestrator DO's own SQLite storage (same mechanism as
 *  lineage_nodes/lineage_events) — the "production form" MapLedgerStore's own
 *  doc comment calls for. In-memory state doesn't survive DO eviction between
 *  two separate /admit calls, which is exactly what the idempotency re-run
 *  needs to hold across. */
export class DoLedgerStore implements LedgerStore {
  constructor(private readonly sql: Sql) {
    this.sql`CREATE TABLE IF NOT EXISTS ledger_records (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value TEXT NOT NULL)`;
  }
  async list(key: string): Promise<LedgerRecord[]> {
    return [...this.sql<{ value: string }>`SELECT value FROM ledger_records WHERE key = ${key}`]
      .map((r) => ({ value: JSON.parse(r.value) }));
  }
  async put(key: string, value: unknown): Promise<void> {
    this.sql`INSERT INTO ledger_records (key, value) VALUES (${key}, ${JSON.stringify(value)})`;
  }
}
