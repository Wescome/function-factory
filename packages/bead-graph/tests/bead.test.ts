/**
 * bead.test.ts — Tests for @factory/bead-graph
 *
 * Five required test scenarios from SPEC-KSP-BEAD-GRAPH-001 §11 step 11.
 *
 * Uses better-sqlite3 for an in-memory SqlStorage adapter (same pattern as
 * artifact-graph tests). KV is mocked with a simple Map.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

import { computeBeadId } from '../src/bead-id.js';
import { writeBead, retrieveKnowingState } from '../src/bead-queries.js';
import { KnowingStateSDKImpl, SessionNotInitialized } from '../src/sdk.js';
import type { AnyBead } from '../src/schemas.js';
import type { Session } from '../src/sdk.js';

// ── SqlStorage adapter backed by better-sqlite3 ───────────────────────────

function createSqlStorage(db: Database.Database): SqlStorage {
  const execFn = (query: string, ...params: unknown[]): Iterable<Record<string, unknown>> => {
    const sql = query.trim();

    // Detect DML/DDL statements that don't return rows
    const isDML = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|BEGIN|COMMIT|ROLLBACK)/i.test(sql);

    if (params.length === 0) {
      if (isDML) {
        try {
          // Multi-statement DDL: use exec()
          db.exec(sql);
        } catch {
          // already handled
        }
        return [];
      }
      try {
        const stmt = db.prepare(sql);
        return stmt.all() as Record<string, unknown>[];
      } catch {
        db.exec(sql);
        return [];
      }
    }

    const stmt = db.prepare(sql);
    if (isDML) {
      stmt.run(...(params as Parameters<typeof stmt.run>));
      return [];
    }
    return stmt.all(...(params as Parameters<typeof stmt.all>)) as Record<string, unknown>[];
  };
  return { exec: execFn } as unknown as SqlStorage;
}

// ── In-memory DB with bead-graph schema ───────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS beads (
      id          TEXT    PRIMARY KEY,
      org_id      TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      written_by  TEXT    NOT NULL,
      ts          INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bead_edges (
      child_id    TEXT    NOT NULL REFERENCES beads(id),
      parent_id   TEXT    NOT NULL REFERENCES beads(id),
      rel         TEXT    NOT NULL,
      PRIMARY KEY (child_id, parent_id, rel)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_beads_org_type ON beads(org_id, type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_beads_org_ts   ON beads(org_id, ts)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_child    ON bead_edges(child_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_parent   ON bead_edges(parent_id)`);

  return db;
}

// ── KV mock ───────────────────────────────────────────────────────────────

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
    getWithMetadata: async (key: string) => ({ value: store.get(key) ?? null, metadata: null }),
  } as unknown as KVNamespace;
}

// ── DO mock ───────────────────────────────────────────────────────────────

function createMockDO(
  sql: SqlStorage,
  options: { failRetrieve?: boolean } = {}
) {
  return {
    writeBead: async (bead: AnyBead, auditBead?: AnyBead) => {
      writeBead(sql, bead, auditBead);
    },
    getBead: async (beadId: string) => {
      const { getBead } = await import('../src/bead-queries.js');
      return getBead(sql, beadId);
    },
    getCurrentTrustBead: async (orgId: string, subjectId: string) => {
      const { getCurrentTrustBead } = await import('../src/bead-queries.js');
      return getCurrentTrustBead(sql, orgId, subjectId);
    },
    getActiveConsent: async (orgId: string, roleId: string) => {
      const { getActiveConsent } = await import('../src/bead-queries.js');
      return getActiveConsent(sql, orgId, roleId);
    },
    getTrustLineage: async (orgId: string, subjectId: string) => {
      const { getTrustLineage } = await import('../src/bead-queries.js');
      return getTrustLineage(sql, orgId, subjectId);
    },
    getOpenAmendments: async (orgId: string) => {
      const { getOpenAmendments } = await import('../src/bead-queries.js');
      return getOpenAmendments(sql, orgId);
    },
    retrieveKnowingState: async (orgId: string, roleId: string, category?: string) => {
      if (options.failRetrieve) {
        throw new Error('DO unavailable (simulated failure)');
      }
      return retrieveKnowingState(sql, orgId, roleId, category);
    },
    computeBeadId: (type: string, content: Record<string, unknown>, parentIds: string[]) =>
      computeBeadId(type, content, parentIds),
  };
}

// ── Helper: make a minimal TrustBead ─────────────────────────────────────

function makeTrustBead(orgId: string, subjectId: string, extra: Partial<AnyBead> = {}): AnyBead {
  const content = {
    subject_id: subjectId,
    subject_type: 'vendor',
    status: 'APPROVED' as const,
    trust_score: 0.8,
    rationale: 'test',
    evidence_refs: [],
  };
  const beadId = computeBeadId('trust', content as unknown as Record<string, unknown>, []);
  return {
    bead_id: beadId,
    org_id: orgId,
    type: 'trust',
    parent_ids: [],
    written_by: 'test-agent',
    ts: Date.now(),
    content,
    ...extra,
  } as AnyBead;
}

function makeAuditBead(audited: AnyBead, sessionId: string): AnyBead {
  const content = {
    audited_bead_id: audited.bead_id,
    audited_type: audited.type,
    action: 'CREATE' as const,
    actor_id: audited.written_by,
    session_id: sessionId,
    ts: audited.ts,
  };
  const beadId = computeBeadId('audit', content as unknown as Record<string, unknown>, [audited.bead_id]);
  return {
    bead_id: beadId,
    org_id: audited.org_id,
    type: 'audit',
    parent_ids: [audited.bead_id],
    written_by: audited.written_by,
    ts: audited.ts,
    content,
  } as AnyBead;
}

// ── Test 1: computeBeadId determinism ─────────────────────────────────────

describe('Test 1 — computeBeadId determinism', () => {
  it('is deterministic and parent-order-independent', () => {
    const id1 = computeBeadId('trust', { a: 1, b: 2 }, ['aaa', 'bbb']);
    const id2 = computeBeadId('trust', { b: 2, a: 1 }, ['bbb', 'aaa']);
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(64); // SHA-256 hex
  });

  it('produces the same result on identical calls', () => {
    const id1 = computeBeadId('trust', { a: 1, b: 2 }, ['x', 'y']);
    const id2 = computeBeadId('trust', { a: 1, b: 2 }, ['x', 'y']);
    expect(id1).toBe(id2);
  });
});

// ── Test 2: writeBead idempotency on duplicate hash ───────────────────────

describe('Test 2 — writeBead idempotency on duplicate bead_id', () => {
  let db: Database.Database;
  let sql: SqlStorage;

  beforeEach(() => {
    db = createTestDb();
    sql = createSqlStorage(db);
  });

  it('writing the same bead twice does not create a second row', () => {
    const trustBead = makeTrustBead('org1', 'vendor-1');
    const auditBead = makeAuditBead(trustBead, 'session-1');

    // Write once
    writeBead(sql, trustBead, auditBead);
    // Write again — should be idempotent (INSERT OR IGNORE)
    writeBead(sql, trustBead, auditBead);

    // Row count in beads should be 2: the trust bead + the audit bead (not 4)
    const rows = db.prepare('SELECT COUNT(*) as cnt FROM beads WHERE id = ?').get(trustBead.bead_id) as { cnt: number };
    expect(rows.cnt).toBe(1);
  });
});

// ── Test 3: retrieveKnowingState returns empty on empty DB ────────────────

describe('Test 3 — retrieveKnowingState returns empty on empty DB', () => {
  let sql: SqlStorage;

  beforeEach(() => {
    const db = createTestDb();
    sql = createSqlStorage(db);
  });

  it('returns null policy and empty trustedSubjects on empty DB', () => {
    const result = retrieveKnowingState(sql, 'org1', 'role1');
    expect(result.policy).toBeNull();
    expect(result.trustedSubjects).toHaveLength(0);
    expect(result.consent).toBeNull();
  });
});

// ── Test 4: writeExecutionBead throws when ksRetrievedAt not set ──────────

describe('Test 4 — writeExecutionBead throws SessionNotInitialized when ksRetrievedAt not set', () => {
  let sql: SqlStorage;
  let sdk: KnowingStateSDKImpl<
    Record<string, unknown>,
    Record<string, unknown>,
    {
      subject_id: string;
      action: string;
      autonomy_level: 'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL';
      trust_bead_id: string;
      policy_bead_id: string;
      rationale: string;
    },
    {
      execution_bead_id: string;
      status: 'SUCCESS' | 'PARTIAL' | 'FAILURE' | 'DISPUTED';
      summary: string;
      triggers_amendment: boolean;
    }
  >;

  beforeEach(() => {
    const db = createTestDb();
    sql = createSqlStorage(db);
    const mockDO = createMockDO(sql);
    const mockKV = createMockKV();
    sdk = new KnowingStateSDKImpl(mockDO, mockKV);
  });

  it('throws SessionNotInitialized when ksRetrievedAt not set', async () => {
    const session = await sdk.openSession('org1', 'role1', 'agent1');

    // Do NOT call retrieveKnowingState — skip straight to writeExecutionBead
    const payload = {
      subject_id: 'vendor-1',
      action: 'purchase',
      autonomy_level: 'EXECUTE_FULL' as const,
      trust_bead_id: 'trust-1',
      policy_bead_id: 'policy-1',
      rationale: 'test',
    };

    await expect(sdk.writeExecutionBead(session.sessionId, payload))
      .rejects.toThrow(SessionNotInitialized);
  });
});

// ── Test 5: autonomyFloor degrades to SUGGEST on retrieval failure ─────────

describe('Test 5 — autonomyFloor degrades to SUGGEST when retrieveKnowingState fails', () => {
  let sql: SqlStorage;

  beforeEach(() => {
    const db = createTestDb();
    sql = createSqlStorage(db);
  });

  it('sets autonomyFloor to SUGGEST when DO throws during retrieveKnowingState', async () => {
    // Create SDK with a DO that fails on retrieveKnowingState
    const failingDO = createMockDO(sql, { failRetrieve: true });
    const mockKV = createMockKV();
    const sdk = new KnowingStateSDKImpl(failingDO, mockKV);

    const session = await sdk.openSession('org1', 'role1', 'agent1');

    // Attempt retrieval — it will fail and should set autonomyFloor = 'SUGGEST'
    await sdk.retrieveKnowingState(session.sessionId).catch(() => {});

    // Re-read session from KV
    const raw = await (mockKV as unknown as { get: (k: string) => Promise<string | null> })
      .get(`session:${session.sessionId}`);
    expect(raw).not.toBeNull();
    const updatedSession = JSON.parse(raw!) as Session;
    expect(updatedSession.autonomyFloor).toBe('SUGGEST');
  });
});
