import { describe, expect, it, vi } from 'vitest'
import { ArangoClient, createD1Client, createClientFromEnv } from './index.js'
import type { D1Database, D1PreparedStatement } from './index.js'

// ── Minimal D1 mock ───────────────────────────────────────────────────────────

function makeStmt(overrides: Partial<D1PreparedStatement> = {}): D1PreparedStatement {
  const stmt: D1PreparedStatement = {
    bind: vi.fn().mockReturnThis() as unknown as D1PreparedStatement['bind'],
    first: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue({ results: [] }),
    all: vi.fn().mockResolvedValue({ results: [] }),
    ...overrides,
  }
  return stmt
}

function makeDb(stmtOverrides: Partial<D1PreparedStatement> = {}): D1Database {
  const stmt = makeStmt(stmtOverrides)
  return {
    prepare: vi.fn().mockReturnValue(stmt),
  }
}

// ── ensureCollection / ensureIndex are no-ops ─────────────────────────────────

describe('ArangoClient no-op schema helpers', () => {
  it('ensureCollection resolves without touching DB', async () => {
    const db = makeDb()
    const client = new ArangoClient(db)
    await expect(client.ensureCollection('lifecycle_transitions', { type: 'edge' })).resolves.toBeUndefined()
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('ensureIndex resolves without touching DB', async () => {
    const db = makeDb()
    const client = new ArangoClient(db)
    await expect(client.ensureIndex('completion_events', {
      type: 'persistent',
      fields: ['bead_id'],
      unique: true,
      name: 'idx_completion_events_bead_id',
    })).resolves.toBeUndefined()
    expect(db.prepare).not.toHaveBeenCalled()
  })
})

// ── get ───────────────────────────────────────────────────────────────────────

describe('ArangoClient.get', () => {
  it('returns null when row not found', async () => {
    const db = makeDb({ first: vi.fn().mockResolvedValue(null) })
    const client = new ArangoClient(db)
    const result = await client.get('beads', 'missing-key')
    expect(result).toBeNull()
  })

  it('parses JSON from the row', async () => {
    const doc = { _key: 'abc', name: 'test' }
    const db = makeDb({ first: vi.fn().mockResolvedValue({ json: JSON.stringify(doc) }) })
    const client = new ArangoClient(db)
    const result = await client.get<typeof doc>('beads', 'abc')
    expect(result).toEqual(doc)
  })
})

// ── save ──────────────────────────────────────────────────────────────────────

describe('ArangoClient.save', () => {
  it('uses the provided _key', async () => {
    const db = makeDb()
    const client = new ArangoClient(db)
    const result = await client.save('beads', { _key: 'MYKEY', name: 'test' })
    expect((result as Record<string, unknown>)._key).toBe('MYKEY')
  })

  it('generates a key when _key is absent', async () => {
    const db = makeDb()
    const client = new ArangoClient(db)
    const result = await client.save('beads', { name: 'no-key' })
    const key = (result as Record<string, unknown>)._key as string
    expect(typeof key).toBe('string')
    expect(key.length).toBe(16)
  })
})

// ── update ────────────────────────────────────────────────────────────────────

describe('ArangoClient.update', () => {
  it('merges patch with existing document', async () => {
    const existing = { _key: 'K1', a: 1, b: 2 }
    const stmt = makeStmt({
      first: vi.fn().mockResolvedValue({ json: JSON.stringify(existing) }),
      run: vi.fn().mockResolvedValue({ results: [] }),
    })
    const db: D1Database = { prepare: vi.fn().mockReturnValue(stmt) }
    const client = new ArangoClient(db)
    const result = await client.update<Record<string, unknown>>('beads', 'K1', { b: 99 })
    expect(result).toEqual({ _key: 'K1', a: 1, b: 99 })
  })
})

// ── traverse throws ───────────────────────────────────────────────────────────

describe('ArangoClient.traverse', () => {
  it('throws not-supported error', () => {
    const db = makeDb()
    const client = new ArangoClient(db)
    expect(() => client.traverse('v/1', 'edges', 'OUTBOUND', 1, 3)).toThrow(
      'traverse() not supported in D1 backend',
    )
  })
})

// ── factory functions ─────────────────────────────────────────────────────────

describe('createD1Client', () => {
  it('returns an ArangoClient', () => {
    const db = makeDb()
    expect(createD1Client(db)).toBeInstanceOf(ArangoClient)
  })
})

describe('createClientFromEnv', () => {
  it('returns an ArangoClient bound to env.DB', () => {
    const db = makeDb()
    expect(createClientFromEnv({ DB: db })).toBeInstanceOf(ArangoClient)
  })
})
