import type { BacklogStore, BacklogEntry, BacklogStatus, GateTier, SpecificationContent } from "../../domain/index";

// Backlog over D1 (production form; InMemoryBacklog is the test/single-DO
// fallback). BacklogStore's port carries no scoping key, so — unlike the
// cross-run index, which is intentionally global — this adapter owns its own
// runId scope and filters every query by it, keeping one DO's deferred specs
// from leaking into another's.
export class D1BacklogAdapter implements BacklogStore {
  private ensured = false;
  constructor(private readonly db: D1Database, private readonly runId: string) {}

  private async ensure(): Promise<void> {
    if (this.ensured) return;
    await this.db.prepare(
      `CREATE TABLE IF NOT EXISTS spec_backlog (
        id TEXT PRIMARY KEY, run_id TEXT, spec TEXT, tier TEXT,
        lease_expires_at INTEGER, status TEXT
      )`,
    ).run();
    this.ensured = true;
  }

  async enqueue(spec: SpecificationContent, tier: GateTier, leaseExpiresAt: number): Promise<BacklogEntry> {
    await this.ensure();
    const id = `bl-${this.runId}-${crypto.randomUUID()}`;
    await this.db.prepare(
      `INSERT INTO spec_backlog (id, run_id, spec, tier, lease_expires_at, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    ).bind(id, this.runId, JSON.stringify(spec), tier, leaseExpiresAt).run();
    return { id, spec, tier, leaseExpiresAt, status: "pending" };
  }

  async listPending(): Promise<readonly BacklogEntry[]> {
    await this.ensure();
    const { results } = await this.db.prepare(
      `SELECT id, spec, tier, lease_expires_at, status FROM spec_backlog WHERE run_id = ? AND status = 'pending'`,
    ).bind(this.runId).all<{ id: string; spec: string; tier: string; lease_expires_at: number; status: string }>();
    return results.map((r) => ({
      id: r.id,
      spec: JSON.parse(r.spec) as SpecificationContent,
      tier: r.tier as GateTier,
      leaseExpiresAt: r.lease_expires_at,
      status: r.status as BacklogStatus,
    }));
  }

  async dispose(id: string, status: BacklogStatus): Promise<void> {
    await this.ensure();
    await this.db.prepare(`UPDATE spec_backlog SET status = ? WHERE id = ? AND run_id = ?`).bind(status, id, this.runId).run();
  }

  async expireStale(now: number): Promise<number> {
    await this.ensure();
    const res = await this.db.prepare(
      `UPDATE spec_backlog SET status = 'expired' WHERE run_id = ? AND status = 'pending' AND lease_expires_at <= ?`,
    ).bind(this.runId, now).run();
    return res.meta.changes ?? 0;
  }
}
