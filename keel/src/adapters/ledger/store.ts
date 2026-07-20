/** Ledger store abstraction. MapLedgerStore = in-memory (tests/demo); a DO-storage
 *  impl is the production form. `put` always appends (store.append's raw write;
 *  "exactly one" there is a property the TASK must maintain via read-before-
 *  write, and the oracle verifies via read-back). `ensure` is a SEPARATE,
 *  storage-level atomic upsert (store.ensure, write-idempotent) — insert iff
 *  absent, as ONE operation, never a read-then-conditional-write at the
 *  connector level. That atomicity is the entire basis for skipping D8's
 *  approval gate: two concurrent `ensure` calls for the same key must not be
 *  able to both observe "absent" and both insert (the TOCTOU stacking hazard
 *  a naive check-then-write has). */
export interface LedgerRecord { readonly value: unknown; }
export interface LedgerStore {
  list(key: string): Promise<LedgerRecord[]>;
  put(key: string, value: unknown): Promise<void>;
  /** Atomic: insert exactly one record for `key` iff none exists yet, as a
   *  single storage operation. Returns whether THIS call performed the insert. */
  ensure(key: string, value: unknown): Promise<{ inserted: boolean }>;
}
export class MapLedgerStore implements LedgerStore {
  private readonly m = new Map<string, LedgerRecord[]>();
  async list(key: string): Promise<LedgerRecord[]> { return [...(this.m.get(key) ?? [])]; }
  async put(key: string, value: unknown): Promise<void> {
    const arr = this.m.get(key) ?? []; arr.push({ value }); this.m.set(key, arr); // append (duplicates possible if misused)
  }
  async ensure(key: string, value: unknown): Promise<{ inserted: boolean }> {
    // No `await` between the check and the write: this function body runs to
    // completion in one synchronous pass before yielding, so two "concurrent"
    // calls for the same key cannot interleave between them (single-threaded
    // JS — the race requires a yield point between check and write; there is none).
    const existing = this.m.get(key);
    if (existing && existing.length > 0) return { inserted: false };
    this.m.set(key, [{ value }]);
    return { inserted: true };
  }
}
