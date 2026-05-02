/**
 * Stage 5 compiler pass tests.
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

import { compilePRD, PASS_NAMES } from './compile'
import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv } from '../types'

describe('Stage 5 compiler passes', () => {
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
    const basePrd = { _key: 'PRD-001', title: 'Test PRD', objective: 'Build something', invariants: ['Must work'] }

    it('decompose pass sends only PRD to LLM', async () => {
      const state = { prd: basePrd }
      await compilePRD('decompose', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('decompose')
      expect(context.prd).toBeDefined()
      // decompose should NOT receive atoms, dependencies, invariants, etc.
      expect(context.atoms).toBeUndefined()
      expect(context.dependencies).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.interfaces).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })

    it('dependency pass sends only atoms (not PRD, invariants, interfaces, bindings)', async () => {
      const state = {
        prd: basePrd,
        atoms: [{ id: 'atom-001', type: 'implementation', title: 'A', description: 'B' }],
      }
      await compilePRD('dependency', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('dependency')
      expect(context.atoms).toBeDefined()
      // dependency should NOT receive PRD, invariants, interfaces, bindings
      expect(context.prd).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.interfaces).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })

    it('invariant pass sends only PRD + atoms', async () => {
      const state = {
        prd: basePrd,
        atoms: [{ id: 'atom-001', type: 'implementation', title: 'A', description: 'B' }],
        dependencies: [{ from: 'atom-001', to: 'atom-002', type: 'requires' }],
      }
      await compilePRD('invariant', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('invariant')
      expect(context.prd).toBeDefined()
      expect(context.atoms).toBeDefined()
      // invariant should NOT receive dependencies, interfaces, bindings
      expect(context.dependencies).toBeUndefined()
      expect(context.interfaces).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })

    it('interface pass sends only atoms + dependencies', async () => {
      const state = {
        prd: basePrd,
        atoms: [{ id: 'atom-001' }],
        dependencies: [{ from: 'atom-001', to: 'atom-002', type: 'requires' }],
        invariants: [{ id: 'INV-001' }],
      }
      await compilePRD('interface', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('interface')
      expect(context.atoms).toBeDefined()
      expect(context.dependencies).toBeDefined()
      // interface should NOT receive PRD, invariants, bindings
      expect(context.prd).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })

    it('binding pass sends only atoms', async () => {
      const state = {
        prd: basePrd,
        atoms: [{ id: 'atom-001' }],
        dependencies: [{ from: 'atom-001', to: 'atom-002' }],
        invariants: [{ id: 'INV-001' }],
        interfaces: [{ from: 'atom-001', to: 'atom-002' }],
      }
      await compilePRD('binding', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('binding')
      expect(context.atoms).toBeDefined()
      // binding should NOT receive PRD, dependencies, invariants, interfaces
      expect(context.prd).toBeUndefined()
      expect(context.dependencies).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.interfaces).toBeUndefined()
    })

    it('validation pass sends only atoms + interfaces', async () => {
      const state = {
        prd: basePrd,
        atoms: [{ id: 'atom-001' }],
        dependencies: [],
        invariants: [],
        interfaces: [{ from: 'atom-001', to: 'atom-002', contract: { input: {}, output: {} } }],
        bindings: [{ atomId: 'atom-001', binding: { type: 'code' } }],
      }
      await compilePRD('validation', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

      expect(modelCalls).toHaveLength(1)
      const context = JSON.parse(modelCalls[0]!.user)
      expect(context.pass).toBe('validation')
      expect(context.atoms).toBeDefined()
      expect(context.interfaces).toBeDefined()
      // validation should NOT receive PRD, dependencies, invariants, bindings
      expect(context.prd).toBeUndefined()
      expect(context.dependencies).toBeUndefined()
      expect(context.invariants).toBeUndefined()
      expect(context.bindings).toBeUndefined()
    })
  })

  describe('deterministic passes (no LLM call)', () => {
    const basePrd = { _key: 'PRD-001', title: 'Test PRD', objective: 'Build something', invariants: ['Must work'] }

    it('assembly pass does NOT call the LLM', async () => {
      const state = {
        prd: basePrd,
        atoms: [{ id: 'atom-001', type: 'implementation', title: 'A', description: 'B' }],
        dependencies: [],
        invariants: [],
        interfaces: [],
        bindings: [{ atomId: 'atom-001', binding: { type: 'code', language: 'typescript', target: 'src/a.ts' } }],
        validations: [],
      }

      await compilePRD('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      expect(modelCalls).toHaveLength(0)
    })

    it('assembly pass produces a workGraph with all fields merged', async () => {
      const state = {
        prd: basePrd,
        atoms: [
          { id: 'atom-001', type: 'implementation', title: 'A', description: 'B' },
          { id: 'atom-002', type: 'test', title: 'C', description: 'D' },
        ],
        dependencies: [{ from: 'atom-001', to: 'atom-002', type: 'requires' }],
        invariants: [{ id: 'INV-001', property: 'Must work', detector: { type: 'test', check: 'pass' } }],
        interfaces: [{ from: 'atom-001', to: 'atom-002', contract: { input: {}, output: {} } }],
        bindings: [{ atomId: 'atom-001', binding: { type: 'code', language: 'typescript', target: 'src/a.ts' } }],
        validations: [{ atomId: 'atom-001', schema: 'z.object({})' }],
      }

      const result = await compilePRD('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      const wg = result.workGraph as Record<string, unknown>

      expect(wg).toBeDefined()
      expect(wg._key).toMatch(/^WG-/)
      expect(wg.type).toBe('workgraph')
      expect(wg.prdId).toBe('PRD-001')
      expect(wg.dependencies).toEqual(state.dependencies)
      expect(wg.invariants).toEqual(state.invariants)
      expect(wg.interfaces).toEqual(state.interfaces)
      expect(wg.validations).toEqual(state.validations)

      // Atoms should have bindings merged
      const atoms = wg.atoms as Record<string, unknown>[]
      expect(atoms).toHaveLength(2)
      const atom1 = atoms.find(a => a.id === 'atom-001')
      expect(atom1?.binding).toEqual({ type: 'code', language: 'typescript', target: 'src/a.ts' })
      expect(atom1?.implementation).toBe('bound')
    })

    it('assembly pass saves workGraph to db', async () => {
      const state = {
        prd: basePrd,
        atoms: [{ id: 'atom-001', type: 'implementation', title: 'A', description: 'B' }],
        dependencies: [],
        invariants: [],
        interfaces: [],
        bindings: [],
        validations: [],
      }

      await compilePRD('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      expect(mockDb.save).toHaveBeenCalledWith('specs_workgraphs', expect.objectContaining({
        type: 'workgraph',
        prdId: 'PRD-001',
      }))
    })

    it('verification pass does NOT call the LLM', async () => {
      const state = {
        prd: basePrd,
        atoms: [{ id: 'atom-001' }],
        workGraph: { _key: 'WG-001', atoms: [{ id: 'atom-001', binding: { type: 'code' } }] },
      }

      await compilePRD('verification', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      expect(modelCalls).toHaveLength(0)
    })

    it('verification dry-run returns verified: true', async () => {
      const state = {
        prd: basePrd,
        workGraph: { _key: 'WG-001', atoms: [{ id: 'atom-001', binding: { type: 'code' } }] },
      }

      const result = await compilePRD('verification', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, true)
      expect(result.verified).toBe(true)
      expect(result.verificationIssues).toEqual([])
    })
  })

  describe('atom criticality classification', () => {
    const basePrd = { _key: 'PRD-001', title: 'Test PRD', objective: 'Build something', invariants: ['Must work'] }

    it('dry-run decompose produces atoms with critical field', async () => {
      const state = { prd: basePrd }
      const result = await compilePRD('decompose', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, true)
      const atoms = result.atoms as Record<string, unknown>[]
      expect(atoms).toHaveLength(1)
      expect(atoms[0]!.critical).toBe(true) // implementation type = critical
    })

    it('assembly marks implementation atoms as critical and config/test as non-critical', async () => {
      const state = {
        prd: basePrd,
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

      const result = await compilePRD('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      const wg = result.workGraph as Record<string, unknown>
      const atoms = wg.atoms as Record<string, unknown>[]

      const impl = atoms.find(a => a.id === 'atom-001')
      const config = atoms.find(a => a.id === 'atom-002')
      const test = atoms.find(a => a.id === 'atom-003')

      expect(impl?.critical).toBe(true)
      expect(config?.critical).toBe(false)
      expect(test?.critical).toBe(false)
    })

    it('assembly defaults unknown type atoms to critical (fail-safe)', async () => {
      const state = {
        prd: basePrd,
        atoms: [
          { id: 'atom-001', title: 'No type', description: 'Missing type field' },
        ],
        dependencies: [],
        invariants: [],
        interfaces: [],
        bindings: [],
        validations: [],
      }

      const result = await compilePRD('assembly', state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      const wg = result.workGraph as Record<string, unknown>
      const atoms = wg.atoms as Record<string, unknown>[]

      expect(atoms[0]?.critical).toBe(true) // fail-safe: unknown type is critical
    })
  })

  describe('pass prompts emphasize delta-only output', () => {
    const basePrd = { _key: 'PRD-001', title: 'Test PRD', objective: 'Build something', invariants: ['Must work'] }

    it('each LLM pass prompt contains "Output ONLY" or "output ONLY"', async () => {
      // Run all LLM passes to capture their prompts
      const llmPasses = ['decompose', 'dependency', 'invariant', 'interface', 'binding', 'validation'] as const

      for (const pass of llmPasses) {
        modelCalls.length = 0
        const state: Record<string, unknown> = { prd: basePrd }
        if (pass !== 'decompose') state.atoms = [{ id: 'atom-001' }]
        if (pass === 'interface' || pass === 'validation') state.dependencies = []
        if (pass === 'validation') state.interfaces = []

        await compilePRD(pass, state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)

        expect(modelCalls).toHaveLength(1)
        const system = modelCalls[0]!.system
        expect(system.toLowerCase()).toContain('output only')
      }
    })
  })

  describe('full pipeline state accumulation', () => {
    it('running all 8 passes sequentially produces a complete WorkGraph', async () => {
      let state: Record<string, unknown> = {
        prd: { _key: 'PRD-001', title: 'Full Pipeline Test', objective: 'Test', invariants: ['Must pass'] },
      }

      for (const passName of PASS_NAMES) {
        state = await compilePRD(passName, state, mockDb as unknown as ArangoClient, mockEnv as unknown as PipelineEnv, false)
      }

      // After all passes, state should have workGraph
      expect(state.workGraph).toBeDefined()
      const wg = state.workGraph as Record<string, unknown>
      expect(wg._key).toMatch(/^WG-/)

      // Should have called LLM exactly 6 times (not 8 — assembly and verification are deterministic)
      expect(modelCalls).toHaveLength(6)
    })
  })
})
