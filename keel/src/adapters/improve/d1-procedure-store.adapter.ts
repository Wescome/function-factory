/**
 * Promotion store for the improvement loop (BRIEF-KEEL-IMPROVE-001,
 * INV-IMPROVE-REVERSIBLE): every transition is a NEW versioned row, append-only
 * — never an update to an existing row's identity. Rollback deactivates the
 * current version and reactivates the prior one; nothing is ever deleted, so
 * the full promotion history (and the gate's stated reason for each one)
 * stays in the record.
 *
 * AMENDMENT A2 (OD-IMP-2): a `disposition:"human"` (effectful) candidate has no
 * spec-loop root, so it does not belong in the 6a backlog. It lives HERE
 * instead, as a third status — `proposed`: mined, awaiting a human to
 * authorize the verification replay. Promotion to `active` still requires an
 * oracle-ACCEPT on that (human-authorized) replay — the human gates the
 * effect, the oracle still gates correctness. A failed authorized replay
 * becomes `rejected` — a conclusive, inspectable outcome, not a silent drop.
 */
export type ProcedureStatus = "proposed" | "active" | "inactive" | "rejected";
export interface ProcedureRecord {
  readonly id: number;
  readonly key: string;
  readonly code: string;
  readonly connectors: readonly string[];
  readonly content: unknown; // full SpecificationContent, JSON — self-contained for later replay
  readonly version: number;
  readonly status: ProcedureStatus;
  readonly reason: string;
  readonly promotedAt: number;
}

type Row = { id: number; key: string; code: string; connectors: string; content: string; version: number; status: string; reason: string; promoted_at: number };
const fromRow = (r: Row): ProcedureRecord => ({
  id: r.id, key: r.key, code: r.code, connectors: JSON.parse(r.connectors), content: JSON.parse(r.content),
  version: r.version, status: r.status as ProcedureStatus, reason: r.reason, promotedAt: r.promoted_at,
});

export class D1ProcedureStore {
  private ensured = false;
  constructor(private readonly db: D1Database) {}

  private async ensure(): Promise<void> {
    if (this.ensured) return;
    await this.db.prepare(
      `CREATE TABLE IF NOT EXISTS improve_procedures (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, code TEXT NOT NULL,
        connectors TEXT NOT NULL, content TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL,
        active INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        reason TEXT NOT NULL, promoted_at INTEGER NOT NULL
      )`,
    ).run();
    // Retrofit for rows created before `content`/`status` existed (CREATE TABLE IF
    // NOT EXISTS is a no-op against an already-created table).
    for (const stmt of [
      `ALTER TABLE improve_procedures ADD COLUMN content TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE improve_procedures ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
    ]) {
      try { await this.db.prepare(stmt).run(); } catch { /* already has the column */ }
    }
    await this.db.prepare(`UPDATE improve_procedures SET status = 'inactive' WHERE active = 0 AND status = 'active'`).run();
    this.ensured = true;
  }

  private async nextVersion(key: string): Promise<number> {
    const { results } = await this.db.prepare(
      `SELECT MAX(version) as v FROM improve_procedures WHERE key = ?`,
    ).bind(key).all<{ v: number | null }>();
    return (results[0]?.v ?? 0) + 1;
  }

  /** Promote a new ACTIVE version for `key` directly (reversible, non-effectful
   *  procedures only — the auto-disposition path). Deactivates the current
   *  active version, if any; never overwrites a row. */
  async promote(key: string, code: string, connectors: readonly string[], content: unknown, reason: string): Promise<ProcedureRecord> {
    await this.ensure();
    const current = await this.active(key);
    const version = await this.nextVersion(key);
    if (current) await this.db.prepare(`UPDATE improve_procedures SET active = 0, status = 'inactive' WHERE id = ?`).bind(current.id).run();
    const now = Date.now();
    const res = await this.db.prepare(
      `INSERT INTO improve_procedures (key, code, connectors, content, version, active, status, reason, promoted_at) VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)`,
    ).bind(key, code, JSON.stringify(connectors), JSON.stringify(content), version, reason, now).run();
    return { id: Number(res.meta.last_row_id), key, code, connectors, content, version, status: "active", reason, promotedAt: now };
  }

  /** AMENDMENT A2: record an effectful candidate as `proposed` — mined,
   *  awaiting a human to authorize the verification replay. NOT active; the
   *  oracle has not yet confirmed it (that would require performing the
   *  effect, which replay never does unattended). */
  async propose(key: string, code: string, connectors: readonly string[], content: unknown, reason: string): Promise<ProcedureRecord> {
    await this.ensure();
    const version = await this.nextVersion(key);
    const now = Date.now();
    const res = await this.db.prepare(
      `INSERT INTO improve_procedures (key, code, connectors, content, version, active, status, reason, promoted_at) VALUES (?, ?, ?, ?, ?, 0, 'proposed', ?, ?)`,
    ).bind(key, code, JSON.stringify(connectors), JSON.stringify(content), version, reason, now).run();
    return { id: Number(res.meta.last_row_id), key, code, connectors, content, version, status: "proposed", reason, promotedAt: now };
  }

  /** The human-authorized replay's verdict: on oracle-ACCEPT, proposed -> active
   *  (deactivating whatever was active before). On failure, proposed -> rejected
   *  — a conclusive outcome, not a silent drop. Either way, append-only: this
   *  updates the STATUS of the existing proposed row (its content/code never
   *  change), it does not create a new version. */
  async resolveProposal(id: number, accepted: boolean, reason: string): Promise<ProcedureRecord | null> {
    await this.ensure();
    const { results } = await this.db.prepare(`SELECT * FROM improve_procedures WHERE id = ? AND status = 'proposed'`).bind(id).all<Row>();
    const row = results[0];
    if (!row) return null;
    if (accepted) {
      const current = await this.active(row.key);
      if (current) await this.db.prepare(`UPDATE improve_procedures SET active = 0, status = 'inactive' WHERE id = ?`).bind(current.id).run();
      await this.db.prepare(`UPDATE improve_procedures SET active = 1, status = 'active', reason = ? WHERE id = ?`).bind(reason, id).run();
      return fromRow({ ...row, status: "active", reason });
    }
    await this.db.prepare(`UPDATE improve_procedures SET status = 'rejected', reason = ? WHERE id = ?`).bind(reason, id).run();
    return fromRow({ ...row, status: "rejected", reason });
  }

  async getById(id: number): Promise<ProcedureRecord | null> {
    await this.ensure();
    const { results } = await this.db.prepare(`SELECT * FROM improve_procedures WHERE id = ?`).bind(id).all<Row>();
    const r = results[0];
    return r ? fromRow(r) : null;
  }

  async proposed(key?: string): Promise<readonly ProcedureRecord[]> {
    await this.ensure();
    const stmt = key
      ? this.db.prepare(`SELECT * FROM improve_procedures WHERE status = 'proposed' AND key = ? ORDER BY promoted_at DESC`).bind(key)
      : this.db.prepare(`SELECT * FROM improve_procedures WHERE status = 'proposed' ORDER BY promoted_at DESC`);
    const { results } = await stmt.all<Row>();
    return results.map(fromRow);
  }

  /** Roll back `key` to its prior ACTIVE version. No-op (null) if there's none. */
  async rollback(key: string): Promise<ProcedureRecord | null> {
    await this.ensure();
    const current = await this.active(key);
    if (!current) return null;
    const { results } = await this.db.prepare(
      `SELECT * FROM improve_procedures WHERE key = ? AND version < ? AND status IN ('active','inactive') ORDER BY version DESC LIMIT 1`,
    ).bind(key, current.version).all<Row>();
    const prior = results[0];
    if (!prior) return null;
    await this.db.prepare(`UPDATE improve_procedures SET active = 0, status = 'inactive' WHERE id = ?`).bind(current.id).run();
    await this.db.prepare(`UPDATE improve_procedures SET active = 1, status = 'active' WHERE id = ?`).bind(prior.id).run();
    return fromRow({ ...prior, status: "active" });
  }

  async active(key: string): Promise<ProcedureRecord | null> {
    await this.ensure();
    const { results } = await this.db.prepare(
      `SELECT * FROM improve_procedures WHERE key = ? AND status = 'active' ORDER BY version DESC LIMIT 1`,
    ).bind(key).all<Row>();
    const r = results[0];
    return r ? fromRow(r) : null;
  }

  async history(key: string): Promise<readonly ProcedureRecord[]> {
    await this.ensure();
    const { results } = await this.db.prepare(`SELECT * FROM improve_procedures WHERE key = ? ORDER BY version DESC`).bind(key).all<Row>();
    return results.map(fromRow);
  }
}
