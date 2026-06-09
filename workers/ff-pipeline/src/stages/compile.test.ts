/**
 * Intent-to-Executable compiler transformation tests.
 *
 * Validates:
 *   1. Each live pass sends MINIMAL context to the LLM (not full state)
 *   2. Assembly and verification passes are deterministic (no LLM call)
 *   3. Dry-run verification actually checks for real issues
 *   4. Pass prompts instruct delta-only output
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mock cloudflare:workers (transitive dep) ───
vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  DurableObject: class {},
}))

vi.mock('agents', () => ({
  Agent: class {},
  callable: () => (t: unknown) => t,
}))

// ─── Capture model calls to inspect context sent to LLM ───
const modelCalls: Array<{ taskKind: string; system: string; user: string }> = []

vi.mock('../model-bridge', () => ({
  callModel: vi.fn(async (taskKind: string, system: string, user: string) => {
    modelCalls.push({ taskKind, system, user })
    // Return minimal valid delta for each pass
    const pass = JSON.parse(user).pass as string
    switch (pass) {
      case 'decompose':
        return JSON.stringify({
          atoms: [{ id: 'atom-001', type: 'implementation', title: 'Test', description: 'Test atom' }],
        })
      case 'dependency':
        return JSON.stringify({ dependencies: [{ from: 'atom-001', to: 'atom-002', type: 'requires' }] })
      case 'invariant':
        return JSON.stringify({ invariants: [{ id: 'INV-001', property: 'Must be fast', detector: { type: 'test', check: 'perf < 100ms' } }] })
      case 'interface':
        return JSON.stringify({ interfaces: [{ from: 'atom-001', to: 'atom-002', contract: { input: {}, output: {} } }] })
      case 'binding':
        return JSON.stringify({ bindings: [{ atomId: 'atom-001', binding: { type: 'code', language: 'typescript', target: 'src/foo.ts' } }] })
      case 'validation':
        return JSON.stringify({ validations: [{ atomId: 'atom-001', schema: 'z.object({})' }] })
      default:
        return JSON.stringify({})
    }
  }),
}))

// ─── Mock ArangoDB client ───
const mockDb = {
  save: vi.fn(async () => ({ _key: 'mock-key' })),
  saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
  query: vi.fn(async () => []),
  setValidator: vi.fn(),
}

const mockEnv = {
  ARANGO_URL: 'http://localhost:8529',
  ARANGO_DATABASE: 'test',
  ARANGO_JWT: 'test-jwt',
  ENVIRONMENT: 'test',
  AI: { run: vi.fn() },
} as Record<string, unknown>

import { compileIntentSpecification, PASS_NAMES } from './compile'
import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv } from '../types'

describe('Intent-to-Executable compiler transformations', () => {
  beforeEach(() => {
    modelCalls.length = 0
    vi.clearAllMocks()
  })

  describe('pass names', () => {
    it('has exactly 8 passes in correct order', () => {
      expect(PASS_NAMES).toEqual([
        'decompose', 'dependency', 'invariant', 'interface',
        'binding', 'validation', 'assembly', 'verification',
      ])
    })
  })

  describe('minimal context per live pass', () => {
    const baseIntentSpecification = { _key: 'IS-001', title: 'Test Intent Specification', objective: 'Build something', invariants: ['Must work'] }

    it('decompose pass sends only Intent Specification to LLM', async () => {
      const state = { intentSpecification: baseIntentSpecification }
      await compileIntentSpecification('decompose', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('decompose')
      expect(context.intentSpecification).toBeDefined()
      // decompose should NOT receive atoms, dependencies, invariants, etc.
      expect(context.atoms).toBeUndefined()
      expect(context.dependencies).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.interfaces).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })

    it('dependency pass sends only atoms (not Intent Specification, invariants, interfaces, bindings)', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [{ id: 'atom-001', type: 'implementation', title: 'A', description: 'B' }],
      }
      await compileIntentSpecification('dependency', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('dependency')
      expect(context.atoms).toBeDefined()
      // dependency should NOT receive Intent Specification, invariants, interfaces, bindings
      expect(context.intentSpecification).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.interfaces).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })

    it('invariant pass sends only Intent Specification + atoms', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [{ id: 'atom-001', type: 'implementation', title: 'A', description: 'B' }],
        dependencies: [{ from: 'atom-001', to: 'atom-002', type: 'requires' }],
      }
      await compileIntentSpecification('invariant', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('invariant')
      expect(context.intentSpecification).toBeDefined()
      expect(context.atoms).toBeDefined()
      // invariant should NOT receive dependencies, interfaces, bindings
      expect(context.dependencies).toBeUndefined()
      expect(context.interfaces).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })

    it('interface pass sends only atoms + dependencies', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [{ id: 'atom-001' }],
        dependencies: [{ from: 'atom-001', to: 'atom-002', type: 'requires' }],
        invariants: [{ id: 'INV-001' }],
      }
      await compileIntentSpecification('interface', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('interface')
      expect(context.atoms).toBeDefined()
      expect(context.dependencies).toBeDefined()
      // interface should NOT receive Intent Specification, invariants, bindings
      expect(context.intentSpecification).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })

    it('binding pass sends only atoms', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [{ id: 'atom-001' }],
        dependencies: [{ from: 'atom-001', to: 'atom-002' }],
        invariants: [{ id: 'INV-001' }],
        interfaces: [{ from: 'atom-001', to: 'atom-002' }],
      }
      await compileIntentSpecification('binding', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('binding')
      expect(context.atoms).toBeDefined()
      // binding should NOT receive Intent Specification, dependencies, invariants, interfaces
      expect(context.intentSpecification).toBeUndefined()
      expect(context.dependencies).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.interfaces).toBeUndefined()
    })

    it('validation pass sends only atoms + interfaces', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [{ id: 'atom-001' }],
        dependencies: [],
        invariants: [],
        interfaces: [{ from: 'atom-001', to: 'atom-002', contract: { input: {}, output: {} } }],
        bindings: [{ atomId: 'atom-001', binding: { type: 'code' } }],
      }
      await compileIntentSpecification('validation', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('validation')
      expect(context.atoms).toBeDefined()
      expect(context.interfaces).toBeDefined()
      // validation should NOT receive Intent Specification, dependencies, invariants, bindings
      expect(context.intentSpecification).toBeUndefined()
      expect(context.dependencies).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })
  })

  describe('deterministic passes (no LLM call)', () => {
    const baseIntentSpecification = { _key: 'IS-001', title: 'Test Intent Specification', objective: 'Build something', invariants: ['Must work'] }

    it('assembly pass does NOT call the LLM', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [{ id: 'atom-001', type: 'implementation', title: 'A', description: 'B' }],
        dependencies: [],
        invariants: [],
        interfaces: [],
        bindings: [{ atomId: 'atom-001', binding: { type: 'code', language: 'typescript', target: 'src/a.ts' } }],
        validations: [],
      }

      await compileIntentSpecification('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      expect(modelCalls).toHaveLength(0)
    })

    it('assembly pass produces a executableSpecification with all fields merged', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [
          { id: 'atom-001', type: 'implementation', title: 'A', description: 'B' },
          { id: 'atom-002', type: 'config', title: 'C', description: 'D' },
        ],
        dependencies: [{ from: 'atom-001', to: 'atom-002', type: 'requires' }],
        invariants: [{ id: 'INV-001', property: 'Must work', detector: { type: 'test', check: 'pass' } }],
        interfaces: [{ from: 'atom-001', to: 'atom-002', contract: { input: {}, output: {} } }],
        bindings: [{ atomId: 'atom-001', binding: { type: 'code', language: 'typescript', target: 'src/a.ts' } }],
        validations: [{ atomId: 'atom-001', schema: 'z.object({})' }],
      }

      const result = await compileIntentSpecification('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      const executableSpecification = result.executableSpecification as Record<string, unknown>

      expect(executableSpecification).toBeDefined()
      expect(executableSpecification._key).toMatch(/^ES-/)
      expect(executableSpecification.type).toBe('executableSpecification')
      expect(executableSpecification.intentSpecificationId).toBe('IS-001')
      expect(executableSpecification.dependencies).toEqual(state.dependencies)
      expect(executableSpecification.invariants).toEqual(state.invariants)
      expect(executableSpecification.interfaces).toEqual(state.interfaces)
      expect(executableSpecification.validations).toEqual(state.validations)

      // Atoms should have bindings merged
      const atoms = executableSpecification.atoms as Record<string, unknown>[]
      expect(atoms).toHaveLength(2)
      const atom1 = atoms.find(a => a.id === 'atom-001')
      expect(atom1?.binding).toEqual({ type: 'code', language: 'typescript', target: 'src/a.ts' })
      expect(atom1?.implementation).toBe('bound')
    })

    it('assembly pass saves executableSpecification to db', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [{ id: 'atom-001', type: 'implementation', title: 'A', description: 'B' }],
        dependencies: [],
        invariants: [],
        interfaces: [],
        bindings: [],
        validations: [],
      }

      await compileIntentSpecification('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      expect(mockDb.save).toHaveBeenCalledWith('executable_specifications', expect.objectContaining({
        type: 'executableSpecification',
        intentSpecificationId: 'IS-001',
      }))
    })

    it('verification pass does NOT call the LLM', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [{ id: 'atom-001' }],
        executableSpecification: { _key: 'ES-001', atoms: [{ id: 'atom-001', binding: { type: 'code' } }] },
      }

      await compileIntentSpecification('verification', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      expect(modelCalls).toHaveLength(0)
    })

    it('verification dry-run returns verified: true', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        executableSpecification: { _key: 'ES-001', atoms: [{ id: 'atom-001', binding: { type: 'code' } }] },
      }

      const result = await compileIntentSpecification('verification', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, true)
      expect(result.verified).toBe(true)
      expect(result.verificationIssues).toEqual([])
    })
  })

  describe('atom criticality classification', () => {
    const baseIntentSpecification = { _key: 'IS-001', title: 'Test Intent Specification', objective: 'Build something', invariants: ['Must work'] }

    it('dry-run decompose produces atoms with critical field', async () => {
      const state = { intentSpecification: baseIntentSpecification }
      const result = await compileIntentSpecification('decompose', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, true)
      const atoms = result.atoms as Record<string, unknown>[]
      expect(atoms).toHaveLength(1)
      expect(atoms[0]!.critical).toBe(true) // implementation type = critical
    })

    it('assembly marks implementation atoms as critical and config as non-critical (test atoms stripped)', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [
          { id: 'atom-001', type: 'implementation', title: 'A', description: 'Impl' },
          { id: 'atom-002', type: 'config', title: 'B', description: 'Config' },
          { id: 'atom-003', type: 'test', title: 'C', description: 'Test' },
        ],
        dependencies: [],
        invariants: [],
        interfaces: [],
        bindings: [],
        validations: [],
      }

      const result = await compileIntentSpecification('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      const executableSpecification = result.executableSpecification as Record<string, unknown>
      const atoms = executableSpecification.atoms as Record<string, unknown>[]

      // Test atoms are stripped in assembly — only impl and config remain
      expect(atoms).toHaveLength(2)
      const impl = atoms.find(a => a.id === 'atom-001')
      const config = atoms.find(a => a.id === 'atom-002')

      expect(impl?.critical).toBe(true)
      expect(config?.critical).toBe(false)
    })

    it('assembly defaults unknown type atoms to critical (fail-safe)', async () => {
      const state = {
        intentSpecification: baseIntentSpecification,
        atoms: [
          { id: 'atom-001', title: 'No type', description: 'Missing type field' },
        ],
        dependencies: [],
        invariants: [],
        interfaces: [],
        bindings: [],
        validations: [],
      }

      const result = await compileIntentSpecification('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      const executableSpecification = result.executableSpecification as Record<string, unknown>
      const atoms = executableSpecification.atoms as Record<string, unknown>[]

      expect(atoms[0]?.critical).toBe(true) // fail-safe: unknown type is critical
    })
  })

  describe('pass prompts emphasize delta-only output', () => {
    const baseIntentSpecification = { _key: 'IS-001', title: 'Test Intent Specification', objective: 'Build something', invariants: ['Must work'] }

    it('each LLM pass prompt contains "Output ONLY" or "output ONLY"', async () => {
      // Run all LLM passes to capture their prompts
      const llmPasses = ['decompose', 'dependency', 'invariant', 'interface', 'binding', 'validation'] as const

      for (const pass of llmPasses) {
        modelCalls.length = 0
        const state: Record<string, unknown> = { intentSpecification: baseIntentSpecification }
        if (pass !== 'decompose') state.atoms = [{ id: 'atom-001' }]
        if (pass === 'interface' || pass === 'validation') state.dependencies = []
        if (pass === 'validation') state.interfaces = []

        await compileIntentSpecification(pass, state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

        expect(modelCalls).toHaveLength(1)
        const system = modelCalls[0]!.system
        expect(system.toLowerCase()).toContain('output only')
      }
    })
  })

  describe('full pipeline state accumulation', () => {
    it('running all 8 passes sequentially produces a complete ExecutableSpecification', async () => {
      let state: Record<string, unknown> = {
        intentSpecification: { _key: 'IS-001', title: 'Full Pipeline Test', objective: 'Test', invariants: ['Must pass'] },
      }

      for (const passName of PASS_NAMES) {
        state = await compileIntentSpecification(passName, state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      }

      // After all passes, state should have executableSpecification
      expect(state.executableSpecification).toBeDefined()
      const executableSpecification = state.executableSpecification as Record<string, unknown>
      expect(executableSpecification._key).toMatch(/^ES-/)

      // Should have called LLM exactly 6 times (not 8 — assembly and verification are deterministic)
      expect(modelCalls).toHaveLength(6)
    })
  })
})
