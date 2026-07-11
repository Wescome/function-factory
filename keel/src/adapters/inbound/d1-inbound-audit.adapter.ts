/**
 * OD-IN-5's per-invocation audit trail: one row per (caller, spec, nonce),
 * keyed by `auditKey` (never content-only), so two identical invocations of the
 * same registered spec by the same caller stay distinct — the fix for the
 * spike's content-hash collapse.
 */
export class D1InboundAuditAdapter {
  private ensured = false;
  constructor(private readonly db: D1Database) {}

  private async ensure(): Promise<void> {
    if (this.ensured) return;
    await this.db.prepare(
      `CREATE TABLE IF NOT EXISTS inbound_audit (
        audit_key TEXT PRIMARY KEY, caller TEXT NOT NULL, spec_name TEXT NOT NULL,
        nonce TEXT NOT NULL, do_name TEXT, state TEXT, created_at INTEGER NOT NULL
      )`,
    ).run();
    this.ensured = true;
  }

  async record(auditKey: string, caller: string, specName: string, nonce: string, doName: string | null, state: string | null): Promise<void> {
    await this.ensure();
    await this.db.prepare(
      `INSERT OR IGNORE INTO inbound_audit (audit_key, caller, spec_name, nonce, do_name, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(auditKey, caller, specName, nonce, doName, state, Date.now()).run();
  }
}
