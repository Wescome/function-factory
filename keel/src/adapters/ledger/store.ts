/** Ledger store abstraction. MapLedgerStore = in-memory (tests/demo); a DO-storage
 *  impl is the production form. Records are appended; "exactly one" is a property
 *  the TASK must maintain (read-before-write), and the oracle verifies via read-back. */
export interface LedgerRecord { readonly value: unknown; }
export interface LedgerStore {
  list(key: string): Promise<LedgerRecord[]>;
  put(key: string, value: unknown): Promise<void>;
}
export class MapLedgerStore implements LedgerStore {
  private readonly m = new Map<string, LedgerRecord[]>();
  async list(key: string): Promise<LedgerRecord[]> { return [...(this.m.get(key) ?? [])]; }
  async put(key: string, value: unknown): Promise<void> {
    const arr = this.m.get(key) ?? []; arr.push({ value }); this.m.set(key, arr); // append (duplicates possible if misused)
  }
}
