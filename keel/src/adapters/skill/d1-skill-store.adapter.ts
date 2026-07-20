import type { SkillStorePort, SkillRecord, SkillKind } from "../../domain/index";

/**
 * D1-backed SkillStorePort (BRIEF-KEEL-SKILL-001). Versioned, append-only —
 * mirrors `d1-cross-run.adapter.ts`'s CREATE-TABLE-IF-NOT-EXISTS pattern, but
 * unlike cross-run's upsert-by-runId, a skill row is NEVER updated in place
 * (OD-SKILL-2): retiring a skill APPENDS a new row at a higher version with
 * `status:'retired'`. `activeFor` therefore can't just filter `WHERE
 * status='active'` — an old, superseded version would still literally say
 * 'active' forever. It resolves the LATEST version per `id` first, then
 * checks THAT row's status.
 */
export class D1SkillStoreAdapter implements SkillStorePort {
  private ensured = false;
  constructor(private readonly db: D1Database) {}

  private async ensure(): Promise<void> {
    if (this.ensured) return;
    await this.db.prepare(
      `CREATE TABLE IF NOT EXISTS skills (
        id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, evidence TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY (id, version)
      )`,
    ).run();
    this.ensured = true;
  }

  /** INV-SKILL-EARNED's only writer path calls this — after a promotion gate
   *  (evaluateImprovement/evaluateHarnessFix/evaluateProcedure) returns
   *  promote:true. INSERT OR IGNORE: (id, version) is the primary key, so a
   *  retry of an already-recorded promotion is a no-op, never a silent
   *  overwrite of a DIFFERENT row at that version. */
  async append(record: SkillRecord): Promise<void> {
    await this.ensure();
    await this.db.prepare(
      `INSERT OR IGNORE INTO skills (id, kind, key, content, version, status, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      record.id, record.kind, record.key, record.content, record.version,
      record.status, JSON.stringify(record.evidence), Date.now(),
    ).run();
  }

  async activeFor(connectors: readonly string[], intent: string): Promise<readonly SkillRecord[]> {
    await this.ensure();
    if (connectors.length === 0 && !intent) return [];
    const connectorPlaceholders = connectors.map(() => "?").join(", ");
    const query = `
      SELECT s.* FROM skills s
      INNER JOIN (SELECT id, MAX(version) as maxv FROM skills GROUP BY id) latest
        ON s.id = latest.id AND s.version = latest.maxv
      WHERE s.status = 'active' AND (
        ${connectors.length ? `(s.kind = 'connector-doc' AND s.key IN (${connectorPlaceholders}))` : "0"}
        OR (s.kind IN ('procedure', 'amend-prompt') AND s.key = ?)
      )`;
    const { results } = await this.db.prepare(query).bind(...connectors, intent).all<{
      id: string; kind: string; key: string; content: string; version: number; status: string; evidence: string | null;
    }>();
    return results.map((r) => ({
      id: r.id, kind: r.kind as SkillKind, key: r.key, content: r.content,
      version: r.version, status: r.status as "active" | "retired",
      evidence: r.evidence ? JSON.parse(r.evidence) : null,
    }));
  }
}
