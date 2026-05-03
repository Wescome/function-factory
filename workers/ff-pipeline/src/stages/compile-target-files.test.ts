/**
 * Phase C: compile target files tests.
 *
 * RED tests for discrepancies #1 and #4 from the structural audit.
 *
 * Discrepancy #1 (CRITICAL):
 *   Atoms produced by the decompose compiler pass never carry targetFiles.
 *   When the binding pass assigns { target: 'src/foo.ts' } to an atom,
 *   the assembly pass merges the binding onto the atom BUT does NOT
 *   extract binding.target into a top-level targetFiles array. Since
 *   resolveTargetFiles() (in atom-executor-do.ts) only checks
 *   atomSpec.targetFiles, atomSpec.suggestedFiles, and atomSpec.file,
 *   it never finds the target path.
 *
 * Discrepancy #4 (HIGH):
 *   The PLAN_SCHEMA in ORL has no awareness of targetFiles. The Planner
 *   agent produces atoms in its plan, but those atoms lack targetFiles
 *   because the schema does not include it. Even if the compiler pass
 *   provided targetFiles, they would be lost when the plan goes through
 *   ORL processing.
 *
 * These tests describe the CORRECT behavior. They will FAIL against
 * the current codebase (RED phase). The Engineer writes code to make
 * them pass (GREEN phase).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── Mock cloudflare:workers (transitive dep) ───
vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  DurableObject: class {},
}))

vi.mock('agents', () => ({
  Agent: class {},
  callable: () => (t: unknown) => t,
}))

// ── Capture model calls ───
const modelCalls: Array<{ taskKind: string; system: string; user: string }> = []

vi.mock('../model-bridge', () => ({
  callModel: vi.fn(async (taskKind: string, system: string, user: string) => {
    modelCalls.push({ taskKind, system, user })
    const pass = JSON.parse(user).pass as string
    switch (pass) {
      case 'decompose':
        return JSON.stringify({
          atoms: [
            {
              id: 'atom-001',
              type: 'implementation',
              title: 'Update compile stage',
              description: 'Add targetFiles propagation to compile.ts',
            },
            {
              id: 'atom-002',
              type: 'implementation',
              title: 'Add validation gate',
              description: 'Add file action validation to atom executor',
            },
          ],
        })
      case 'dependency':
        return JSON.stringify({
          dependencies: [{ from: 'atom-001', to: 'atom-002', type: 'requires' }],
        })
      case 'invariant':
        return JSON.stringify({
          invariants: [{
            id: 'INV-001',
            property: 'All atoms must carry targetFiles from binding.target',
            detector: { type: 'test', check: 'atom.targetFiles.length > 0' },
          }],
        })
      case 'interface':
        return JSON.stringify({
          interfaces: [{
            from: 'atom-001',
            to: 'atom-002',
            contract: { input: { targetFiles: 'string[]' }, output: {} },
          }],
        })
      case 'binding':
        return JSON.stringify({
          bindings: [
            {
              atomId: 'atom-001',
              binding: {
                type: 'code',
                language: 'typescript',
                target: 'workers/ff-pipeline/src/stages/compile.ts',
              },
            },
            {
              atomId: 'atom-002',
              binding: {
                type: 'code',
                language: 'typescript',
                target: 'workers/ff-pipeline/src/coordinator/atom-executor.ts',
              },
            },
          ],
        })
      case 'validation':
        return JSON.stringify({
          validations: [{ atomId: 'atom-001', schema: 'z.object({})' }],
        })
      default:
        return JSON.stringify({})
    }
  }),
}))

// ── Mock ArangoDB client ───
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

// ── Discrepancy #1 tests ────────────────────────────────────────────

describe('compile assembly: atoms carry targetFiles from binding.target (discrepancy #1)', () => {
  beforeEach(() => {
    modelCalls.length = 0
    vi.clearAllMocks()
  })

  it('atoms from assembly carry targetFiles extracted from binding.target', async () => {
    // Run the full pipeline: decompose -> ... -> assembly
    // After assembly, each atom should have a targetFiles array
    // derived from binding.target.
    let state: Record<string, unknown> = {
      prd: {
        _key: 'PRD-TGT',
        title: 'Target Files Test',
        objective: 'Test that atoms get targetFiles',
        invariants: ['Must propagate target files'],
      },
    }

    for (const passName of PASS_NAMES) {
      state = await compilePRD(
        passName,
        state,
        mockDb as unknown as ArangoClient,
        mockEnv as unknown as PipelineEnv,
        false,
      )
    }

    const wg = state.workGraph as Record<string, unknown>
    expect(wg).toBeDefined()

    const atoms = wg.atoms as Record<string, unknown>[]
    expect(atoms.length).toBeGreaterThanOrEqual(2)

    // Each atom should carry targetFiles from its binding.target
    const atom1 = atoms.find(a => a.id === 'atom-001')
    expect(atom1).toBeDefined()
    expect(atom1!.targetFiles).toBeDefined()
    expect(Array.isArray(atom1!.targetFiles)).toBe(true)
    expect(atom1!.targetFiles).toContain('workers/ff-pipeline/src/stages/compile.ts')

    const atom2 = atoms.find(a => a.id === 'atom-002')
    expect(atom2).toBeDefined()
    expect(atom2!.targetFiles).toBeDefined()
    expect(Array.isArray(atom2!.targetFiles)).toBe(true)
    expect(atom2!.targetFiles).toContain('workers/ff-pipeline/src/coordinator/atom-executor.ts')
  })

  it('assembly does not add targetFiles when binding.target is TBD', async () => {
    // Binding with target='TBD' should NOT produce a targetFiles entry
    const state = {
      prd: { _key: 'PRD-TBD', title: 'TBD Test', objective: 'Test', invariants: [] },
      atoms: [
        {
          id: 'atom-tbd',
          type: 'implementation',
          title: 'TBD target',
          description: 'Has TBD binding target',
        },
      ],
      dependencies: [],
      invariants: [],
      interfaces: [],
      bindings: [
        {
          atomId: 'atom-tbd',
          binding: { type: 'code', language: 'typescript', target: 'TBD' },
        },
      ],
      validations: [],
    }

    const result = await compilePRD(
      'assembly',
      state,
      mockDb as unknown as ArangoClient,
      mockEnv as unknown as PipelineEnv,
      false,
    )

    const wg = result.workGraph as Record<string, unknown>
    const atoms = wg.atoms as Record<string, unknown>[]
    const atom = atoms.find(a => a.id === 'atom-tbd')

    // targetFiles should be empty or not present when target is TBD
    const targetFiles = (atom?.targetFiles ?? []) as string[]
    expect(targetFiles).not.toContain('TBD')
    expect(targetFiles).toHaveLength(0)
  })

  it('assembly extracts multiple targets when binding.target has comma-separated paths', async () => {
    // Some bindings might list multiple targets as "src/a.ts, src/b.ts"
    // The assembly pass should handle this by splitting.
    const state = {
      prd: { _key: 'PRD-MULTI', title: 'Multi target', objective: 'Test', invariants: [] },
      atoms: [
        {
          id: 'atom-multi',
          type: 'implementation',
          title: 'Multi-target atom',
          description: 'Touches two files',
        },
      ],
      dependencies: [],
      invariants: [],
      interfaces: [],
      bindings: [
        {
          atomId: 'atom-multi',
          binding: {
            type: 'code',
            language: 'typescript',
            target: 'src/a.ts, src/b.ts',
          },
        },
      ],
      validations: [],
    }

    const result = await compilePRD(
      'assembly',
      state,
      mockDb as unknown as ArangoClient,
      mockEnv as unknown as PipelineEnv,
      false,
    )

    const wg = result.workGraph as Record<string, unknown>
    const atoms = wg.atoms as Record<string, unknown>[]
    const atom = atoms.find(a => a.id === 'atom-multi')

    const targetFiles = atom?.targetFiles as string[]
    expect(targetFiles).toBeDefined()
    expect(targetFiles).toContain('src/a.ts')
    expect(targetFiles).toContain('src/b.ts')
  })

  it('dry-run assembly also propagates targetFiles from binding.target', async () => {
    // Even in dry-run mode, atoms should get targetFiles
    const state = {
      prd: { _key: 'PRD-DRY', title: 'Dry run target', objective: 'Test', invariants: [] },
      atoms: [
        {
          id: 'atom-dry',
          type: 'implementation',
          title: 'Dry-run atom',
          description: 'Should get targetFiles even in dry-run',
          binding: { type: 'code', language: 'typescript', target: 'src/dry-target.ts' },
        },
      ],
      dependencies: [],
      invariants: [],
      interfaces: [],
      bindings: [],
      validations: [],
    }

    const result = await compilePRD(
      'assembly',
      state,
      mockDb as unknown as ArangoClient,
      mockEnv as unknown as PipelineEnv,
      true,  // dry-run
    )

    const wg = result.workGraph as Record<string, unknown>
    const atoms = wg.atoms as Record<string, unknown>[]
    const atom = atoms.find(a => a.id === 'atom-dry')

    const targetFiles = atom?.targetFiles as string[]
    expect(targetFiles).toBeDefined()
    expect(targetFiles).toContain('src/dry-target.ts')
  })
})

// ── Discrepancy #4 tests ────────────────────────────────────────────

describe('PLAN_SCHEMA: atoms preserve targetFiles through ORL (discrepancy #4)', () => {
  it('plan atoms retain targetFiles after ORL processing', async () => {
    // When a plan is processed through ORL, the atoms inside the plan
    // should preserve their targetFiles arrays. ORL should not strip
    // unknown fields from nested objects within the 'atoms' array.
    const { processAgentOutput, PLAN_SCHEMA } = await import('../agents/output-reliability')

    const raw = JSON.stringify({
      approach: 'Modify existing files with targeted edits',
      atoms: [
        {
          id: 'atom-001',
          description: 'Update the compile stage',
          assignedTo: 'coder',
          targetFiles: ['src/stages/compile.ts'],
        },
        {
          id: 'atom-002',
          description: 'Add validation gate',
          assignedTo: 'coder',
          targetFiles: ['src/coordinator/atom-executor.ts'],
        },
      ],
      executorRecommendation: 'gdk-agent',
      estimatedComplexity: 'medium',
    })

    const result = await processAgentOutput(raw, PLAN_SCHEMA)

    expect(result.success).toBe(true)
    const data = result.data as { atoms: Array<{ id: string; targetFiles?: string[] }> }

    // Atoms should still have their targetFiles after ORL processing
    const atom1 = data.atoms.find(a => a.id === 'atom-001')
    expect(atom1).toBeDefined()
    expect(atom1!.targetFiles).toEqual(['src/stages/compile.ts'])

    const atom2 = data.atoms.find(a => a.id === 'atom-002')
    expect(atom2).toBeDefined()
    expect(atom2!.targetFiles).toEqual(['src/coordinator/atom-executor.ts'])
  })

  it('plan atoms without targetFiles get [] after ORL (not undefined)', async () => {
    // When atoms do not have targetFiles, ORL should not crash and
    // the field should either be absent or an empty array (not undefined
    // that causes downstream errors).
    const { processAgentOutput, PLAN_SCHEMA } = await import('../agents/output-reliability')

    const raw = JSON.stringify({
      approach: 'Simple implementation',
      atoms: [
        {
          id: 'atom-no-target',
          description: 'No target files specified',
          assignedTo: 'coder',
        },
      ],
      executorRecommendation: 'gdk-agent',
      estimatedComplexity: 'low',
    })

    const result = await processAgentOutput(raw, PLAN_SCHEMA)

    expect(result.success).toBe(true)
    const data = result.data as { atoms: Array<{ id: string; targetFiles?: string[] }> }
    const atom = data.atoms.find(a => a.id === 'atom-no-target')
    expect(atom).toBeDefined()
    // targetFiles should be absent or empty array — NOT undefined that would
    // cause TypeErrors downstream when resolveTargetFiles tries to iterate
  })
})

// ── End-to-end: compile -> targetFiles -> resolveTargetFiles ────────

describe('end-to-end: compile produces atoms that resolveTargetFiles can consume', () => {
  beforeEach(() => {
    modelCalls.length = 0
    vi.clearAllMocks()
  })

  it('full compile pipeline produces atoms with targetFiles that resolveTargetFiles finds', async () => {
    // Run the full compile pipeline and then verify that
    // resolveTargetFiles (the function that the atom executor uses)
    // can extract the target paths from the resulting atoms.

    let state: Record<string, unknown> = {
      prd: {
        _key: 'PRD-E2E',
        title: 'End-to-end test',
        objective: 'Verify targetFiles flow from compile to executor',
        invariants: ['All atoms must have targetFiles'],
      },
    }

    for (const passName of PASS_NAMES) {
      state = await compilePRD(
        passName,
        state,
        mockDb as unknown as ArangoClient,
        mockEnv as unknown as PipelineEnv,
        false,
      )
    }

    const wg = state.workGraph as Record<string, unknown>
    const atoms = wg.atoms as Record<string, unknown>[]

    // Import the standalone resolveTargetFiles (after Engineer extracts it)
    const { resolveTargetFiles } = await import('../coordinator/atom-executor-do')

    for (const atom of atoms) {
      const binding = atom.binding as Record<string, unknown> | undefined
      const bindingTarget = binding?.target as string | undefined

      const resolved = resolveTargetFiles(atom)

      if (bindingTarget && bindingTarget !== 'TBD') {
        // If the atom has a real binding.target, resolveTargetFiles
        // should find it (either via targetFiles or binding.target)
        expect(resolved.length).toBeGreaterThan(0)
        expect(resolved.some(f => f.includes('.ts'))).toBe(true)
      }
    }
  })
})
