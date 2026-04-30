/**
 * @module ontology-loader tests
 *
 * TDD: RED phase — these tests define the contract for the ontology loader.
 * Tests validate:
 *   1. Correct number of classes, properties, constraints, instances seeded
 *   2. Query helpers return expected results
 *   3. ontology_query tool dispatches correctly
 *   4. Edge cases (missing data, unknown keys)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ONTOLOGY_CLASSES,
  ONTOLOGY_PROPERTIES,
  ONTOLOGY_CONSTRAINTS,
  ONTOLOGY_INSTANCES,
  seedOntology,
  getConstraintsForClass,
  getRoleSpec,
  getLifecycleState,
  getPendingCRPs,
  getPersistenceTarget,
  buildOntologyTool,
} from './index.js'
import type { OntologyClass, OntologyProperty, OntologyConstraint, OntologyInstance } from './index.js'

// ── Mock ArangoClient ────────────────────────────────────────────────

function createMockDb() {
  const collections: Record<string, Record<string, unknown>[]> = {}

  return {
    _collections: collections,
    save: vi.fn(async (collection: string, doc: Record<string, unknown>) => {
      if (!collections[collection]) collections[collection] = []
      collections[collection].push(doc)
      return { _key: doc._key, _id: `${collection}/${doc._key}` }
    }),
    query: vi.fn(async <T = unknown>(aql: string, bindVars: Record<string, unknown> = {}): Promise<T[]> => {
      // Simulate AQL queries based on patterns
      if (aql.includes('ontology_constraints') && aql.includes('targetClasses')) {
        const className = bindVars.className as string
        const constraints = (collections['ontology_constraints'] ?? []) as unknown as OntologyConstraint[]
        return constraints.filter(c =>
          c.targetClasses?.includes(className)
        ) as unknown as T[]
      }
      if (aql.includes('ontology_instances') && aql.includes('@key')) {
        const key = bindVars.key as string
        const instances = (collections['ontology_instances'] ?? []) as unknown as OntologyInstance[]
        return instances.filter(i => i._key === key) as unknown as T[]
      }
      if (aql.includes('specs_functions') && aql.includes('lifecycleState')) {
        const key = bindVars.key as string
        // Simulate no lifecycle state stored
        return [] as unknown as T[]
      }
      if (aql.includes('consultation_requests') && aql.includes('pending')) {
        return [] as unknown as T[]
      }
      if (aql.includes('ontology_classes') && aql.includes('persistsIn')) {
        const className = bindVars.className as string
        const classes = (collections['ontology_classes'] ?? []) as unknown as OntologyClass[]
        const cls = classes.find(c => c._key === className)
        if (cls?.persistsIn) {
          return [{ persistsIn: cls.persistsIn }] as unknown as T[]
        }
        return [] as unknown as T[]
      }
      return [] as unknown as T[]
    }),
    queryOne: vi.fn(async <T = unknown>(aql: string, bindVars: Record<string, unknown> = {}): Promise<T | null> => {
      if (aql.includes('ontology_instances') && aql.includes('@key')) {
        const key = bindVars.key as string
        const instances = (collections['ontology_instances'] ?? []) as unknown as OntologyInstance[]
        const found = instances.find(i => i._key === key)
        return (found as unknown as T) ?? null
      }
      if (aql.includes('specs_functions') && aql.includes('lifecycleState')) {
        return null
      }
      if (aql.includes('ontology_classes') && aql.includes('persistsIn')) {
        const className = bindVars.className as string
        const classes = (collections['ontology_classes'] ?? []) as unknown as OntologyClass[]
        const cls = classes.find(c => c._key === className)
        if (cls?.persistsIn) {
          return { persistsIn: cls.persistsIn } as unknown as T
        }
        return null
      }
      return null
    }),
  }
}

// ═══════════════════════════════════════════════════════════════════
// DATA INTEGRITY TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Ontology data constants', () => {
  it('has classes from all 7 domains', () => {
    const domains = new Set(ONTOLOGY_CLASSES.map(c => c.domain))
    expect(domains).toContain('signals')
    expect(domains).toContain('specification')
    expect(domains).toContain('governance')
    expect(domains).toContain('execution')
    expect(domains).toContain('dialogue')
    expect(domains).toContain('agents')
    expect(domains).toContain('infrastructure')
  })

  it('has at least 40 classes (ontology has ~60 OWL classes)', () => {
    expect(ONTOLOGY_CLASSES.length).toBeGreaterThanOrEqual(40)
  })

  it('every class has required fields', () => {
    for (const cls of ONTOLOGY_CLASSES) {
      expect(cls._key, `class ${cls._key} missing _key`).toBeTruthy()
      expect(cls.uri, `class ${cls._key} missing uri`).toBeTruthy()
      expect(cls.label, `class ${cls._key} missing label`).toBeTruthy()
      expect(cls.domain, `class ${cls._key} missing domain`).toBeTruthy()
      expect(cls.comment, `class ${cls._key} missing comment`).toBeTruthy()
    }
  })

  it('key classes are present', () => {
    const keys = new Set(ONTOLOGY_CLASSES.map(c => c._key))
    expect(keys).toContain('Signal')
    expect(keys).toContain('Pressure')
    expect(keys).toContain('BusinessCapability')
    expect(keys).toContain('FunctionProposal')
    expect(keys).toContain('WorkGraph')
    expect(keys).toContain('BriefingScript')
    expect(keys).toContain('Gate')
    expect(keys).toContain('AgentRole')
    expect(keys).toContain('ConsultationRequestPack')
    expect(keys).toContain('MentorScript')
  })

  it('has at least 15 properties', () => {
    expect(ONTOLOGY_PROPERTIES.length).toBeGreaterThanOrEqual(15)
  })

  it('every property has required fields', () => {
    for (const prop of ONTOLOGY_PROPERTIES) {
      expect(prop._key, `property missing _key`).toBeTruthy()
      expect(prop.uri, `property ${prop._key} missing uri`).toBeTruthy()
      expect(prop.label, `property ${prop._key} missing label`).toBeTruthy()
      expect(prop.propertyType, `property ${prop._key} missing propertyType`).toMatch(/^(object|datatype)$/)
    }
  })

  it('has all 16 constraints (C1-C16)', () => {
    expect(ONTOLOGY_CONSTRAINTS.length).toBe(16)
    const ids = ONTOLOGY_CONSTRAINTS.map(c => c.constraintId)
    for (let i = 1; i <= 16; i++) {
      expect(ids, `Missing constraint C${i}`).toContain(`C${i}`)
    }
  })

  it('every constraint has required fields', () => {
    for (const c of ONTOLOGY_CONSTRAINTS) {
      expect(c._key, `constraint missing _key`).toBeTruthy()
      expect(c.constraintId, `constraint ${c._key} missing constraintId`).toBeTruthy()
      expect(c.name, `constraint ${c._key} missing name`).toBeTruthy()
      expect(c.severity, `constraint ${c._key} missing severity`).toMatch(/^(violation|warning|info)$/)
      expect(c.message, `constraint ${c._key} missing message`).toBeTruthy()
    }
  })

  it('has instances for all 6 agent roles', () => {
    const roleInstances = ONTOLOGY_INSTANCES.filter(i => i.type === 'AgentRole')
    expect(roleInstances.length).toBe(6)
    const keys = new Set(roleInstances.map(i => i._key))
    expect(keys).toContain('ArchitectRole')
    expect(keys).toContain('PlannerRole')
    expect(keys).toContain('CoderRole')
    expect(keys).toContain('CriticRole')
    expect(keys).toContain('TesterRole')
    expect(keys).toContain('VerifierRole')
  })

  it('ArchitectRole has correct tools and permissions from ontology', () => {
    const architect = ONTOLOGY_INSTANCES.find(i => i._key === 'ArchitectRole')!
    expect(architect).toBeTruthy()
    expect(architect.tools).toContain('FileReadTool')
    expect(architect.tools).toContain('GrepSearchTool')
    expect(architect.tools).toContain('ArangoQueryTool')
    expect(architect.permissions).toContain('ReadOnly')
    expect(architect.memoryAccess).toContain('DecisionsMemory')
    expect(architect.memoryAccess).toContain('LessonsMemory')
    expect(architect.memoryAccess).toContain('MentorRulesMemory')
    expect(architect.memoryAccess).toContain('CodebaseAccess')
    expect(architect.runsIn).toBe('V8Isolate')
  })

  it('CoderRole runs in SandboxContainer with write permissions', () => {
    const coder = ONTOLOGY_INSTANCES.find(i => i._key === 'CoderRole')!
    expect(coder).toBeTruthy()
    expect(coder.runsIn).toBe('SandboxContainer')
    expect(coder.tools).toContain('FileWriteTool')
    expect(coder.tools).toContain('BashExecuteTool')
    expect(coder.tools).toContain('GitTool')
    expect(coder.permissions).toContain('CanRead')
    expect(coder.permissions).toContain('CanWrite')
    expect(coder.permissions).toContain('CanExecute')
  })

  it('has infrastructure instances', () => {
    const infraInstances = ONTOLOGY_INSTANCES.filter(i =>
      ['Worker', 'Workflow', 'DurableObject', 'Container', 'Queue', 'R2Bucket'].includes(i.type)
    )
    expect(infraInstances.length).toBeGreaterThanOrEqual(7)
  })

  it('has ArangoCollection instances', () => {
    const collections = ONTOLOGY_INSTANCES.filter(i => i.type === 'ArangoCollection')
    expect(collections.length).toBeGreaterThanOrEqual(15)
  })

  it('persistence mappings are present in classes', () => {
    const signal = ONTOLOGY_CLASSES.find(c => c._key === 'Signal')!
    expect(signal.persistsIn).toBe('specs_signals')

    const pressure = ONTOLOGY_CLASSES.find(c => c._key === 'Pressure')!
    expect(pressure.persistsIn).toBe('specs_pressures')

    const wg = ONTOLOGY_CLASSES.find(c => c._key === 'WorkGraph')!
    expect(wg.persistsIn).toBe('specs_workgraphs')
  })
})

// ═══════════════════════════════════════════════════════════════════
// SEED FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════

describe('seedOntology', () => {
  it('seeds all ontology data into the correct collections', async () => {
    const db = createMockDb()
    const result = await seedOntology(db as any)

    expect(result.classes).toBe(ONTOLOGY_CLASSES.length)
    expect(result.properties).toBe(ONTOLOGY_PROPERTIES.length)
    expect(result.constraints).toBe(ONTOLOGY_CONSTRAINTS.length)
    expect(result.instances).toBe(ONTOLOGY_INSTANCES.length)
  })

  it('calls db.save for every document', async () => {
    const db = createMockDb()
    await seedOntology(db as any)

    const totalDocs = ONTOLOGY_CLASSES.length +
      ONTOLOGY_PROPERTIES.length +
      ONTOLOGY_CONSTRAINTS.length +
      ONTOLOGY_INSTANCES.length

    expect(db.save).toHaveBeenCalledTimes(totalDocs)
  })

  it('saves classes to ontology_classes collection', async () => {
    const db = createMockDb()
    await seedOntology(db as any)

    const classeSaves = db.save.mock.calls.filter(
      ([coll]) => coll === 'ontology_classes'
    )
    expect(classeSaves.length).toBe(ONTOLOGY_CLASSES.length)
  })

  it('saves constraints to ontology_constraints collection', async () => {
    const db = createMockDb()
    await seedOntology(db as any)

    const constraintSaves = db.save.mock.calls.filter(
      ([coll]) => coll === 'ontology_constraints'
    )
    expect(constraintSaves.length).toBe(ONTOLOGY_CONSTRAINTS.length)
  })

  it('handles save errors gracefully', async () => {
    const db = createMockDb()
    let callCount = 0
    db.save = vi.fn(async () => {
      callCount++
      if (callCount === 3) throw new Error('unique constraint violated')
      return { _key: 'test', _id: 'mock/test' }
    })

    // Should not throw
    const result = await seedOntology(db as any)
    // Should continue seeding despite individual errors
    expect(result.classes + result.properties + result.constraints + result.instances).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════
// QUERY HELPER TESTS
// ═══════════════════════════════════════════════════════════════════

describe('getConstraintsForClass', () => {
  it('returns constraints that target the given class', async () => {
    const db = createMockDb()
    await seedOntology(db as any)

    const constraints = await getConstraintsForClass(db as any, 'WorkGraph')
    expect(constraints.length).toBeGreaterThan(0)
    // WorkGraph is targeted by C1 (lineage), C6 (reviewed), C13 (has atoms)
    const ids = constraints.map(c => c.constraintId)
    expect(ids).toContain('C1')
    expect(ids).toContain('C6')
    expect(ids).toContain('C13')
  })

  it('returns empty array for unknown class', async () => {
    const db = createMockDb()
    await seedOntology(db as any)

    const constraints = await getConstraintsForClass(db as any, 'NonExistentClass')
    expect(constraints).toEqual([])
  })
})

describe('getRoleSpec', () => {
  it('returns the role instance for a known role', async () => {
    const db = createMockDb()
    await seedOntology(db as any)

    const role = await getRoleSpec(db as any, 'ArchitectRole')
    expect(role).not.toBeNull()
    expect(role!._key).toBe('ArchitectRole')
    expect(role!.type).toBe('AgentRole')
    expect(role!.tools).toContain('FileReadTool')
  })

  it('returns null for unknown role', async () => {
    const db = createMockDb()
    await seedOntology(db as any)

    const role = await getRoleSpec(db as any, 'NonExistentRole')
    expect(role).toBeNull()
  })
})

describe('getLifecycleState', () => {
  it('returns null when function has no lifecycle state', async () => {
    const db = createMockDb()
    const state = await getLifecycleState(db as any, 'FN-001')
    expect(state).toBeNull()
  })
})

describe('getPendingCRPs', () => {
  it('returns empty array when no pending CRPs', async () => {
    const db = createMockDb()
    const crps = await getPendingCRPs(db as any)
    expect(crps).toEqual([])
  })
})

describe('getPersistenceTarget', () => {
  it('returns collection name for a known class', async () => {
    const db = createMockDb()
    await seedOntology(db as any)

    const target = await getPersistenceTarget(db as any, 'Signal')
    expect(target).toBe('specs_signals')
  })

  it('returns null for unknown class', async () => {
    const db = createMockDb()
    await seedOntology(db as any)

    const target = await getPersistenceTarget(db as any, 'NonExistentClass')
    expect(target).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════
// ONTOLOGY TOOL TESTS
// ═══════════════════════════════════════════════════════════════════

describe('buildOntologyTool', () => {
  it('creates a tool with correct name and description', () => {
    const db = createMockDb()
    const tool = buildOntologyTool(db as any)
    expect(tool.name).toBe('ontology_query')
    expect(tool.label).toBe('Query Factory Ontology')
    expect(tool.description).toBeTruthy()
  })

  it('dispatches constraints_for_class query', async () => {
    const db = createMockDb()
    await seedOntology(db as any)
    const tool = buildOntologyTool(db as any)

    const result = await tool.execute('call-1', {
      queryType: 'constraints_for_class',
      argument: 'Pressure',
    })

    expect(result.content).toBeDefined()
    expect(result.content.length).toBeGreaterThan(0)
    // Should return text content with constraint data
    expect(result.content[0].type).toBe('text')
  })

  it('dispatches role_spec query', async () => {
    const db = createMockDb()
    await seedOntology(db as any)
    const tool = buildOntologyTool(db as any)

    const result = await tool.execute('call-2', {
      queryType: 'role_spec',
      argument: 'ArchitectRole',
    })

    expect(result.content).toBeDefined()
    expect(result.content[0].type).toBe('text')
    const text = result.content[0].type === 'text' ? result.content[0].text : ''
    expect(text).toContain('ArchitectRole')
  })

  it('dispatches lifecycle_state query', async () => {
    const db = createMockDb()
    const tool = buildOntologyTool(db as any)

    const result = await tool.execute('call-3', {
      queryType: 'lifecycle_state',
      argument: 'FN-001',
    })

    expect(result.content).toBeDefined()
    expect(result.content[0].type).toBe('text')
  })

  it('dispatches pending_crps query', async () => {
    const db = createMockDb()
    const tool = buildOntologyTool(db as any)

    const result = await tool.execute('call-4', {
      queryType: 'pending_crps',
      argument: '',
    })

    expect(result.content).toBeDefined()
    expect(result.content[0].type).toBe('text')
  })

  it('dispatches persistence_target query', async () => {
    const db = createMockDb()
    await seedOntology(db as any)
    const tool = buildOntologyTool(db as any)

    const result = await tool.execute('call-5', {
      queryType: 'persistence_target',
      argument: 'Signal',
    })

    expect(result.content).toBeDefined()
    expect(result.content[0].type).toBe('text')
  })
})
