/**
 * OD-IN-5's per-invocation audit trail: one row per (caller, spec, nonce),
 * keyed by `auditKey` (never content-only), so two identical invocations of the
 * same registered spec by the same caller stay distinct — the fix for the
 * spike's content-hash collapse.
 *
 * OD-IN-6: the `status` column stores the domain's AuditStatus vocab
 * (admitted/paused/accepted/rejected), not a raw KEEL loop state — a paused
 * row transitions to its final outcome once `/approve` resolves the run,
 * via the SAME `resolveInvocationAudit` guard the domain test proves (a
 * terminal row is never re-resolved). Rows written before this fix used raw
 * KEEL states ("ACCEPT"/"PAUSE"/"ESCALATE"); `normalizeStatus` reads those
 * as their AuditStatus equivalent so historical rows resolve correctly too.
 *
 * OD-IN-3: `countSince` is the usage source the quota check counts over —
 * per (caller, spec) within a window, not global.
 */
import { resolveInvocationAudit, type AuditStatus, type InvocationAudit } from "../../domain/index";

function normalizeStatus(raw: string | null): AuditStatus {
  if (raw === "accepted" || raw === "rejected" || raw === "paused" || raw === "admitted") return raw;
  if (raw === "ACCEPT") return "accepted";
  if (raw === "PAUSE") return "paused";
  return "rejected"; // ESCALATE, null, or anything else non-verified
}

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

  async record(auditKey: string, caller: string, specName: string, nonce: string, doName: string | null, status: AuditStatus): Promise<void> {
    await this.ensure();
    await this.db.prepare(
      `INSERT OR IGNORE INTO inbound_audit (audit_key, caller, spec_name, nonce, do_name, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(auditKey, caller, specName, nonce, doName, status, Date.now()).run();
  }

  /** OD-IN-6: called from the /approve path once a paused run resolves. Finds
   *  every audit row for this DO (normally exactly one) and resolves it via
   *  the domain guard — a row already `accepted`/`rejected` is returned
   *  unchanged, so a second /approve on the same run cannot flip it. */
  async resolveByDoName(doName: string, outcome: "accepted" | "rejected"): Promise<void> {
    await this.ensure();
    const { results } = await this.db.prepare(
      `SELECT audit_key, caller, spec_name, state FROM inbound_audit WHERE do_name = ?`,
    ).bind(doName).all<{ audit_key: string; caller: string; spec_name: string; state: string | null }>();
    for (const row of results) {
      const current: InvocationAudit = { auditKey: row.audit_key, caller: row.caller, spec: row.spec_name, status: normalizeStatus(row.state) };
      const resolved = resolveInvocationAudit(current, outcome);
      if (resolved.status !== current.status) {
        await this.db.prepare(`UPDATE inbound_audit SET state = ? WHERE audit_key = ?`).bind(resolved.status, row.audit_key).run();
      }
    }
  }

  /** OD-IN-3's usage source: how many invocations this caller has made of this
   *  spec since `sinceMs` (epoch ms) — the count `evaluateQuota` checks against. */
  async countSince(caller: string, specName: string, sinceMs: number): Promise<number> {
    await this.ensure();
    const row = await this.db.prepare(
      `SELECT COUNT(*) as n FROM inbound_audit WHERE caller = ? AND spec_name = ? AND created_at >= ?`,
    ).bind(caller, specName, sinceMs).first<{ n: number }>();
    return row?.n ?? 0;
  }
}
