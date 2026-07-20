import type { BaseBead, AnyBead } from './schemas.js';

// ── Helper ────────────────────────────────────────────────────────────────

function toBeadRow(row: Record<string, unknown>): BaseBead & { content: Record<string, unknown> } {
  return {
    bead_id:    row['id'] as string,
    org_id:     row['org_id'] as string,
    type:       row['type'] as string,
    parent_ids: [],  // reconstituted from bead_edges on demand
    written_by: row['written_by'] as string,
    ts:         row['ts'] as number,
    content:    JSON.parse(row['content'] as string) as Record<string, unknown>,
  };
}

// ── 15a: writeBead ────────────────────────────────────────────────────────

/**
 * Write a Bead and its parent edges atomically.
 * AuditBead must be included in the batch for non-audit writes (INV-BG-007).
 */
export function writeBead(
  sql: SqlStorage,
  bead: AnyBead,
  auditBead?: AnyBead  // required for all non-audit types
): void {
  if (bead.type !== 'audit' && !auditBead) {
    throw new Error(`writeBead: auditBead required for type=${bead.type}`);
  }

  // CF Workers DO SQLite: SQL BEGIN/COMMIT are forbidden — atomicity is handled
  // by the caller via storage.transactionSync() in do.ts (writeBead method).
  sql.exec(
    'INSERT OR IGNORE INTO beads (id, org_id, type, content, written_by, ts) VALUES (?, ?, ?, ?, ?, ?)',
    bead.bead_id, bead.org_id, bead.type,
    JSON.stringify((bead as unknown as { content: unknown }).content),
    bead.written_by, bead.ts
  );
  for (const parentId of bead.parent_ids) {
    sql.exec(
      'INSERT OR IGNORE INTO bead_edges (child_id, parent_id, rel) VALUES (?, ?, ?)',
      bead.bead_id, parentId, 'parent'
    );
  }
  if (auditBead) {
    sql.exec(
      'INSERT OR IGNORE INTO beads (id, org_id, type, content, written_by, ts) VALUES (?, ?, ?, ?, ?, ?)',
      auditBead.bead_id, auditBead.org_id, auditBead.type,
      JSON.stringify((auditBead as unknown as { content: unknown }).content),
      auditBead.written_by, auditBead.ts
    );
    sql.exec(
      'INSERT OR IGNORE INTO bead_edges (child_id, parent_id, rel) VALUES (?, ?, ?)',
      auditBead.bead_id, bead.bead_id, 'audits'
    );
  }
}

// ── 15b: getBead ──────────────────────────────────────────────────────────

export function getBead(
  sql: SqlStorage,
  beadId: string
): (BaseBead & { content: Record<string, unknown> }) | null {
  const rows = [...(sql.exec('SELECT * FROM beads WHERE id = ?', beadId) as Iterable<Record<string, unknown>>)];
  if (rows.length === 0) return null;
  const bead = toBeadRow(rows[0]!);
  // Reconstitute parent_ids from edges
  bead.parent_ids = [...(sql.exec(
    'SELECT parent_id FROM bead_edges WHERE child_id = ? AND rel = ?',
    beadId, 'parent'
  ) as Iterable<{ parent_id: string }>)].map(r => r.parent_id);
  return bead;
}

// ── 15c: getCurrentTrustBead ──────────────────────────────────────────────

/**
 * Get the current head TrustBead for a subject_id within an org.
 * "Head" = the TrustBead with no supersedes-child pointing to it.
 */
export function getCurrentTrustBead(
  sql: SqlStorage,
  orgId: string,
  subjectId: string
): (BaseBead & { content: Record<string, unknown> }) | null {
  const rows = [...(sql.exec(`
    SELECT b.*
    FROM beads b
    WHERE b.org_id = ?
      AND b.type = 'trust'
      AND json_extract(b.content, '$.subject_id') = ?
      AND NOT EXISTS (
        SELECT 1 FROM bead_edges e
        WHERE e.parent_id = b.id AND e.rel = 'supersedes'
      )
    ORDER BY b.ts DESC
    LIMIT 1
  `, orgId, subjectId) as Iterable<Record<string, unknown>>)];
  if (rows.length === 0) return null;
  return toBeadRow(rows[0]!);
}

// ── 15d: getActiveConsent ─────────────────────────────────────────────────

/**
 * Get active ConsentBead for a role.
 */
export function getActiveConsent(
  sql: SqlStorage,
  orgId: string,
  roleId: string
): (BaseBead & { content: Record<string, unknown> }) | null {
  const rows = [...(sql.exec(`
    SELECT b.*
    FROM beads b
    WHERE b.org_id = ?
      AND b.type = 'consent'
      AND json_extract(b.content, '$.role_id') = ?
      AND json_extract(b.content, '$.status') = 'ACTIVE'
    ORDER BY b.ts DESC
    LIMIT 1
  `, orgId, roleId) as Iterable<Record<string, unknown>>)];
  if (rows.length === 0) return null;
  return toBeadRow(rows[0]!);
}

// ── 15e: getTrustLineage ──────────────────────────────────────────────────

/**
 * Get the full trust lineage for a subject (all TrustBeads, superseded chain).
 */
export function getTrustLineage(
  sql: SqlStorage,
  orgId: string,
  subjectId: string
): (BaseBead & { content: Record<string, unknown> })[] {
  return [...(sql.exec(`
    SELECT b.*
    FROM beads b
    WHERE b.org_id = ?
      AND b.type IN ('trust', 'outcome', 'amendment')
      AND json_extract(b.content, '$.subject_id') = ?
    ORDER BY b.ts ASC
  `, orgId, subjectId) as Iterable<Record<string, unknown>>)].map(toBeadRow);
}

// ── 15f: getOpenAmendments ────────────────────────────────────────────────

/**
 * Get all open amendments for an org.
 */
export function getOpenAmendments(
  sql: SqlStorage,
  orgId: string
): (BaseBead & { content: Record<string, unknown> })[] {
  return [...(sql.exec(`
    SELECT b.*
    FROM beads b
    WHERE b.org_id = ?
      AND b.type = 'amendment'
      AND json_extract(b.content, '$.status') = 'PENDING'
    ORDER BY b.ts DESC
  `, orgId) as Iterable<Record<string, unknown>>)].map(toBeadRow);
}

// ── 15g: retrieveKnowingState ─────────────────────────────────────────────

/**
 * Retrieve the full knowing-state for a session: policy + approved trust beads.
 * This is the I2 retrieval call. Called at session open.
 */
export function retrieveKnowingState(
  sql: SqlStorage,
  orgId: string,
  roleId: string,
  category?: string
): {
  policy: (BaseBead & { content: Record<string, unknown> }) | null;
  trustedSubjects: (BaseBead & { content: Record<string, unknown> })[];
  consent: (BaseBead & { content: Record<string, unknown> }) | null;
} {
  // Policy: most recent active policy for this org/role scope
  const policyRows = [...(sql.exec(`
    SELECT b.*
    FROM beads b
    WHERE b.org_id = ?
      AND b.type = 'policy'
      AND (json_extract(b.content, '$.scope') = ? OR json_extract(b.content, '$.scope') = 'org')
    ORDER BY b.ts DESC
    LIMIT 1
  `, orgId, roleId) as Iterable<Record<string, unknown>>)];

  // Approved trust beads (no superseded head)
  let trustQuery = `
    SELECT b.*
    FROM beads b
    WHERE b.org_id = ?
      AND b.type = 'trust'
      AND json_extract(b.content, '$.status') = 'APPROVED'
      AND NOT EXISTS (
        SELECT 1 FROM bead_edges e WHERE e.parent_id = b.id AND e.rel = 'supersedes'
      )
  `;
  const trustParams: unknown[] = [orgId];
  if (category) {
    trustQuery += ` AND json_extract(b.content, '$.subject_type') = ?`;
    trustParams.push(category);
  }
  trustQuery += ` ORDER BY json_extract(b.content, '$.trust_score') DESC`;

  return {
    policy: policyRows.length > 0 ? toBeadRow(policyRows[0]!) : null,
    trustedSubjects: [...(sql.exec(trustQuery, ...trustParams) as Iterable<Record<string, unknown>>)].map(toBeadRow),
    consent: getActiveConsent(sql, orgId, roleId),
  };
}
