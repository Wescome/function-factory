import type { CrossRunIndexPort, CrossRunListOptions, CrossRunRecord } from "../../domain/index";

// Cross-run index over D1. CREATE TABLE IF NOT EXISTS on first use (no migration
// file needed). Upsert keyed on runId (content hash) — idempotent.
export class D1CrossRunAdapter implements CrossRunIndexPort {
  private ensured = false;
  constructor(private readonly db: D1Database) {}

  private async ensure(): Promise<void> {
    if (this.ensured) return;
    await this.db.prepare(
      `CREATE TABLE IF NOT EXISTS cross_run (
        run_id TEXT PRIMARY KEY, intent TEXT, terminal TEXT,
        attempts INTEGER, node_counts TEXT, updated_at INTEGER, depends_on TEXT
      )`,
    ).run();
    // CREATE TABLE IF NOT EXISTS is a no-op against an already-created table, so
    // an already-deployed cross_run (pre-6a) won't pick up depends_on from the
    // statement above. Retrofit it; ignore "duplicate column" if it's already there.
    try {
      await this.db.prepare(`ALTER TABLE cross_run ADD COLUMN depends_on TEXT`).run();
    } catch {
      // already has the column
    }
    this.ensured = true;
  }

  async record(r: CrossRunRecord): Promise<void> {
    await this.ensure();
    await this.db.prepare(
      `INSERT INTO cross_run (run_id, intent, terminal, attempts, node_counts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         intent=excluded.intent, terminal=excluded.terminal,
         attempts=excluded.attempts, node_counts=excluded.node_counts,
         updated_at=excluded.updated_at`,
    ).bind(r.runId, r.intent, r.terminal, r.attempts, JSON.stringify(r.nodeCounts), Date.now()).run();
  }

  /** Phase 6a: record a derived run's parent/root links, written by the wiring
   *  that admitted it into its OWN DO — independent of that run's own record()
   *  call (whichever happens first; ON CONFLICT here only ever touches
   *  depends_on, so it never clobbers the other columns' state). */
  async recordDependsOn(runId: string, parent: string, root: string): Promise<void> {
    await this.ensure();
    await this.db.prepare(
      `INSERT INTO cross_run (run_id, depends_on) VALUES (?, ?)
       ON CONFLICT(run_id) DO UPDATE SET depends_on=excluded.depends_on`,
    ).bind(runId, JSON.stringify({ parent, root })).run();
  }

  async list(opts?: CrossRunListOptions): Promise<readonly CrossRunRecord[]> {
    await this.ensure();
    const stmt = opts?.terminal
      ? this.db.prepare(`SELECT * FROM cross_run WHERE terminal=? ORDER BY updated_at DESC`).bind(opts.terminal)
      : this.db.prepare(`SELECT * FROM cross_run ORDER BY updated_at DESC`);
    const { results } = await stmt.all<{ run_id: string; intent: string; terminal: string; attempts: number; node_counts: string; depends_on: string | null }>();
    return results.map((row) => ({
      runId: row.run_id as CrossRunRecord["runId"],
      intent: row.intent,
      terminal: row.terminal as CrossRunRecord["terminal"],
      attempts: row.attempts,
      nodeCounts: JSON.parse(row.node_counts ?? "{}"),
      ...(row.depends_on ? { dependsOn: JSON.parse(row.depends_on) } : {}),
    }));
  }
}
