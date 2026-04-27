/**
 * Phase D — CRP auto-generation tests (TDD RED phase).
 *
 * Verifies that ConsultationRequestPacks are correctly created when
 * agent output has confidence < 0.7, per ontology constraint C7.
 *
 * Uses mock ArangoClient — same pattern as other pipeline tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCRP, type ConsultationRequestPack } from './crp'

// ── Mock ArangoClient ──────────────────────────────────────────────

function makeMockDb() {
  return {
    save: vi.fn().mockResolvedValue({ _key: 'mock-key' }),
    update: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(null),
    saveEdge: vi.fn().mockResolvedValue(undefined),
  }
}

describe('CRP auto-generation (C7)', () => {
  let db: ReturnType<typeof makeMockDb>

  beforeEach(() => {
    db = makeMockDb()
  })

  it('creates a CRP document with all required fields', async () => {
    const crp = await createCRP(db as any, {
      artifactKey: 'EA-WG-001-code',
      collection: 'execution_artifacts',
      confidence: 0.45,
      context: 'Coder produced low-confidence output during synthesis',
      agentRole: 'coder',
      workGraphId: 'WG-001',
    })

    expect(crp.type).toBe('crp')
    expect(crp.status).toBe('pending')
    expect(crp.relatedArtifact).toBe('EA-WG-001-code')
    expect(crp.relatedCollection).toBe('execution_artifacts')
    expect(crp.confidence).toBe(0.45)
    expect(crp.context).toBe('Coder produced low-confidence output during synthesis')
    expect(crp.agentRole).toBe('coder')
    expect(crp.workGraphId).toBe('WG-001')
    expect(crp.createdAt).toBeTruthy()
    expect(typeof crp.createdAt).toBe('string')
  })

  it('generates a unique _key with CRP prefix', async () => {
    const crp = await createCRP(db as any, {
      artifactKey: 'EA-WG-001-code',
      collection: 'execution_artifacts',
      confidence: 0.5,
      context: 'test',
      agentRole: 'coder',
      workGraphId: 'WG-001',
    })

    expect(crp._key).toMatch(/^CRP-/)
    expect(crp._key.length).toBeGreaterThan(4)
  })

  it('writes to consultation_requests collection', async () => {
    await createCRP(db as any, {
      artifactKey: 'EA-WG-002-code',
      collection: 'execution_artifacts',
      confidence: 0.3,
      context: 'test',
      agentRole: 'verifier',
      workGraphId: 'WG-002',
    })

    expect(db.save).toHaveBeenCalledTimes(1)
    expect(db.save).toHaveBeenCalledWith(
      'consultation_requests',
      expect.objectContaining({
        type: 'crp',
        status: 'pending',
        relatedArtifact: 'EA-WG-002-code',
        confidence: 0.3,
        agentRole: 'verifier',
        workGraphId: 'WG-002',
      }),
    )
  })

  it('generates different _keys for successive calls', async () => {
    const crp1 = await createCRP(db as any, {
      artifactKey: 'A1',
      collection: 'c1',
      confidence: 0.5,
      context: 'first',
      agentRole: 'coder',
      workGraphId: 'WG-001',
    })

    const crp2 = await createCRP(db as any, {
      artifactKey: 'A2',
      collection: 'c2',
      confidence: 0.4,
      context: 'second',
      agentRole: 'tester',
      workGraphId: 'WG-001',
    })

    expect(crp1._key).not.toBe(crp2._key)
  })

  it('does not set resolvedAt or resolution on new CRP', async () => {
    const crp = await createCRP(db as any, {
      artifactKey: 'A1',
      collection: 'c1',
      confidence: 0.6,
      context: 'test',
      agentRole: 'coder',
      workGraphId: 'WG-001',
    })

    expect(crp.resolvedAt).toBeUndefined()
    expect(crp.resolution).toBeUndefined()
  })

  it('sets createdAt to an ISO 8601 timestamp', async () => {
    const before = new Date().toISOString()
    const crp = await createCRP(db as any, {
      artifactKey: 'A1',
      collection: 'c1',
      confidence: 0.5,
      context: 'test',
      agentRole: 'coder',
      workGraphId: 'WG-001',
    })
    const after = new Date().toISOString()

    // The timestamp should be between before and after
    expect(crp.createdAt >= before).toBe(true)
    expect(crp.createdAt <= after).toBe(true)
  })

  it('CRP creation does not throw when db.save fails (non-blocking)', async () => {
    db.save.mockRejectedValue(new Error('ArangoDB unreachable'))

    // createCRP should catch the error and not throw
    // (CRP is informational, must not block pipeline)
    await expect(createCRP(db as any, {
      artifactKey: 'A1',
      collection: 'c1',
      confidence: 0.5,
      context: 'test',
      agentRole: 'coder',
      workGraphId: 'WG-001',
    })).resolves.toBeDefined()
  })
})
