/**
 * T12: Coordinator 9-node wiring tests — TDD.
 *
 * Verifies that coordinator.ts instantiates ArchitectAgent and CriticAgent
 * and passes them to GraphDeps, activating the 9-node topology.
 *
 * Strategy: coordinator.ts imports from 'cloudflare:workers' (via Agent SDK)
 * so it cannot be imported directly in vitest. We verify:
 *
 * 1. Source code structure: imports, instantiation, dep wiring (text inspection)
 * 2. Integration: graph with agent deps traverses the full 9-node path
 * 3. Shape: the deps object satisfies GraphDeps with architectAgent + criticAgent
 *
 * The existing graph-9node.test.ts validates graph behavior. These tests verify
 * the coordinator WIRES those agents into the graph.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSynthesisGraph, type GraphDeps } from './graph.js'
import { createInitialState, type GraphState } from './state.js'
import { ArchitectAgent, type BriefingScript } from '../agents/architect-agent.js'
import { CriticAgent, type CodeReviewInput } from '../agents/critic-agent.js'
import type { SemanticReviewResult } from '../types.js'
import type { CritiqueReport } from './state.js'

const coordinatorSrc = readFileSync(
  resolve(__dirname, './coordinator.ts'),
  'utf-8',
)

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    ...createInitialState('WG-T12', {
      id: 'WG-T12',
      title: 'T12 Coordinator 9-Node Wiring Test',
      atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
      invariants: [],
      dependencies: [],
    }),
    ...overrides,
  }
}

function makeStubCallModel() {
  return vi.fn().mockImplementation(async (taskKind: string) => {
    switch (taskKind) {
      case 'planner':
        return JSON.stringify({
          approach: 'Test plan',
          atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
          executorRecommendation: 'pi-sdk',
          estimatedComplexity: 'low',
        })
      case 'coder':
        return JSON.stringify({
          files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
          summary: 'Code output',
          testsIncluded: false,
        })
      case 'tester':
        return JSON.stringify({
          passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
          failures: [], summary: 'OK',
        })
      case 'verifier':
        return JSON.stringify({
          decision: 'pass', confidence: 1.0, reason: 'OK',
        })
      default:
        return JSON.stringify({ result: 'stub' })
    }
  })
}

function makeStubBriefingScript(): BriefingScript {
  return {
    goal: 'Test goal',
    successCriteria: ['criterion-1'],
    architecturalContext: 'Test context',
    strategicAdvice: 'Test advice',
    knownGotchas: ['gotcha-1'],
    validationLoop: 'Test validation',
  }
}

function makeStubSemanticReview(alignment: 'aligned' | 'miscast' | 'uncertain' = 'aligned'): SemanticReviewResult {
  return {
    alignment,
    confidence: 0.95,
    citations: ['spec-section-1'],
    rationale: 'Test rationale',
    timestamp: new Date().toISOString(),
  }
}

function makeStubCodeCritique(): CritiqueReport {
  return {
    passed: true,
    issues: [],
    mentorRuleCompliance: [{ ruleId: 'MR-001', compliant: true }],
    overallAssessment: 'Code looks good',
  }
}

// ────────────────────────────────────────────────────────────
// T12.1: Coordinator source imports ArchitectAgent and CriticAgent
// ────────────────────────────────────────────────────────────

describe('T12: coordinator 9-node wiring — source structure', () => {
  it('T12.1a: imports ArchitectAgent from agents/architect-agent', () => {
    expect(coordinatorSrc).toMatch(/import\s*\{[^}]*ArchitectAgent[^}]*\}\s*from\s*['"]\.\.\/agents\/architect-agent['"]/)
  })

  it('T12.1b: imports CriticAgent from agents/critic-agent', () => {
    expect(coordinatorSrc).toMatch(/import\s*\{[^}]*CriticAgent[^}]*\}\s*from\s*['"]\.\.\/agents\/critic-agent['"]/)
  })

  it('T12.1c: instantiates ArchitectAgent with { callModel }', () => {
    expect(coordinatorSrc).toMatch(/new\s+ArchitectAgent\(\s*\{\s*callModel\s*\}\s*\)/)
  })

  it('T12.1d: instantiates CriticAgent with { callModel }', () => {
    expect(coordinatorSrc).toMatch(/new\s+CriticAgent\(\s*\{\s*callModel\s*\}\s*\)/)
  })

  it('T12.1e: passes architectAgent to GraphDeps', () => {
    // The deps object should include architectAgent
    expect(coordinatorSrc).toMatch(/architectAgent\s*[:{]/)
  })

  it('T12.1f: passes criticAgent to GraphDeps', () => {
    // The deps object should include criticAgent
    expect(coordinatorSrc).toMatch(/criticAgent\s*[:{]/)
  })
})

// ────────────────────────────────────────────────────────────
// T12.2: ArchitectAgent/CriticAgent shape satisfies GraphDeps
// ────────────────────────────────────────────────────────────

describe('T12: agent shape satisfies GraphDeps', () => {
  it('T12.2a: ArchitectAgent.produceBriefingScript callable from GraphDeps.architectAgent shape', async () => {
    const callModel = vi.fn().mockResolvedValue(JSON.stringify(makeStubBriefingScript()))
    const architectAgent = new ArchitectAgent({ callModel })

    // Build the GraphDeps-compatible shape
    const depsShape: GraphDeps['architectAgent'] = {
      produceBriefingScript: (input) => architectAgent.produceBriefingScript(input),
    }

    const result = await depsShape!.produceBriefingScript({ signal: { test: true } })
    expect(result.goal).toBe('Test goal')
    expect(result.successCriteria).toEqual(['criterion-1'])
    expect(callModel).toHaveBeenCalledTimes(1)
  })

  it('T12.2b: CriticAgent.semanticReview callable from GraphDeps.criticAgent shape', async () => {
    const callModel = vi.fn().mockResolvedValue(JSON.stringify(makeStubSemanticReview()))
    const criticAgent = new CriticAgent({ callModel })

    const depsShape: GraphDeps['criticAgent'] = {
      semanticReview: (input) => criticAgent.semanticReview(input),
      codeReview: (input) => criticAgent.codeReview(input as CodeReviewInput),
    }

    const result = await depsShape!.semanticReview({ prd: { test: true } })
    expect(result.alignment).toBe('aligned')
    expect(result.confidence).toBe(0.95)
    expect(callModel).toHaveBeenCalledTimes(1)
  })

  it('T12.2c: CriticAgent.codeReview callable from GraphDeps.criticAgent shape', async () => {
    const callModel = vi.fn().mockResolvedValue(JSON.stringify(makeStubCodeCritique()))
    const criticAgent = new CriticAgent({ callModel })

    const depsShape: GraphDeps['criticAgent'] = {
      semanticReview: (input) => criticAgent.semanticReview(input),
      codeReview: (input) => criticAgent.codeReview(input as CodeReviewInput),
    }

    const result = await depsShape!.codeReview({
      code: { files: [], summary: 'test', testsIncluded: false },
      plan: { approach: 'test', atoms: [], executorRecommendation: 'pi-sdk', estimatedComplexity: 'low' },
      workGraph: { test: true },
      mentorRules: [],
    })
    expect(result.passed).toBe(true)
    expect(result.overallAssessment).toBe('Code looks good')
    expect(callModel).toHaveBeenCalledTimes(1)
  })
})

// ────────────────────────────────────────────────────────────
// T12.3: Integration — graph with real agent instances traverses 9-node path
// ────────────────────────────────────────────────────────────

describe('T12: integration — real agent instances drive 9-node graph', () => {
  it('T12.3a: graph with ArchitectAgent/CriticAgent instances traverses full 9-node path', async () => {
    // ArchitectAgent calls callModel with taskKind='architect'
    const architectCallModel = vi.fn().mockResolvedValue(JSON.stringify(makeStubBriefingScript()))

    // CriticAgent calls callModel with taskKind='critic' for both semantic and code review
    // We need to return the right shape based on call order:
    // first call = semanticReview, second call = codeReview
    let criticCallCount = 0
    const criticCallModel = vi.fn().mockImplementation(async () => {
      criticCallCount++
      if (criticCallCount === 1) {
        return JSON.stringify(makeStubSemanticReview())
      }
      return JSON.stringify(makeStubCodeCritique())
    })

    // Standard callModel for planner/coder/tester/verifier nodes
    const callModel = vi.fn().mockImplementation(async (taskKind: string) => {
      switch (taskKind) {
        case 'planner':
          return JSON.stringify({
            approach: 'Test plan',
            atoms: [{ id: 'atom-001', description: 'Stub', assignedTo: 'coder' }],
            executorRecommendation: 'pi-sdk',
            estimatedComplexity: 'low',
          })
        case 'coder':
          return JSON.stringify({
            files: [{ path: 'src/x.ts', content: '//', action: 'create' }],
            summary: 'Code output',
            testsIncluded: false,
          })
        case 'tester':
          return JSON.stringify({
            passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
            failures: [], summary: 'OK',
          })
        case 'verifier':
          return JSON.stringify({
            decision: 'pass', confidence: 1.0, reason: 'OK',
          })
        default:
          return JSON.stringify({ result: 'stub' })
      }
    })

    const architectAgent = new ArchitectAgent({ callModel: architectCallModel })
    const criticAgent = new CriticAgent({ callModel: criticCallModel })

    // Build deps the same way coordinator.ts should
    const deps: GraphDeps = {
      callModel,
      persistState: vi.fn().mockResolvedValue(undefined),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      architectAgent: {
        produceBriefingScript: (input) => architectAgent.produceBriefingScript(input),
      },
      criticAgent: {
        semanticReview: (input) => criticAgent.semanticReview(input),
        codeReview: (input) => criticAgent.codeReview(input as CodeReviewInput),
      },
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    const visited: string[] = []
    const finalState = await graph.run(state, {
      maxSteps: 50,
      onNodeStart: (name) => visited.push(name),
    })

    // Full 9-node path must execute
    expect(visited).toEqual([
      'budget-check',
      'architect',
      'semantic-critic',
      'compile',
      'gate-1',
      'planner',
      'coder',
      'code-critic',
      'tester',
      'verifier',
    ])

    expect(finalState.verdict?.decision).toBe('pass')
    expect(finalState.briefingScript).toBeDefined()
    expect(finalState.briefingScript).not.toBeNull()
  })

  it('T12.3b: budget-check routes to architect (not planner) on first pass with agent deps', async () => {
    const callModel = makeStubCallModel()
    const architectAgent = new ArchitectAgent({ callModel: vi.fn().mockResolvedValue(JSON.stringify(makeStubBriefingScript())) })
    // CriticAgent is called twice: first for semanticReview, then codeReview
    let criticCallCount2 = 0
    const criticCallModel2 = vi.fn().mockImplementation(async () => {
      criticCallCount2++
      if (criticCallCount2 === 1) return JSON.stringify(makeStubSemanticReview())
      return JSON.stringify(makeStubCodeCritique())
    })
    const criticAgent = new CriticAgent({ callModel: criticCallModel2 })

    const deps: GraphDeps = {
      callModel,
      persistState: vi.fn().mockResolvedValue(undefined),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      architectAgent: {
        produceBriefingScript: (input) => architectAgent.produceBriefingScript(input),
      },
      criticAgent: {
        semanticReview: (input) => criticAgent.semanticReview(input),
        codeReview: (input) => criticAgent.codeReview(input as CodeReviewInput),
      },
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState() // briefingScript: null → first pass

    const visited: string[] = []
    await graph.run(state, {
      maxSteps: 50,
      onNodeStart: (name) => visited.push(name),
    })

    // First two nodes: budget-check → architect (not planner)
    expect(visited[0]).toBe('budget-check')
    expect(visited[1]).toBe('architect')
  })

  it('T12.3c: code-critic runs between coder and tester with real CriticAgent', async () => {
    // Standard callModel for graph nodes (planner, coder, tester, verifier)
    const callModel = makeStubCallModel()

    // Use mock agents so we can track calls precisely
    const mockArchitect = {
      produceBriefingScript: vi.fn().mockResolvedValue(makeStubBriefingScript()),
    }
    const mockCritic = {
      semanticReview: vi.fn().mockResolvedValue(makeStubSemanticReview()),
      codeReview: vi.fn().mockResolvedValue(makeStubCodeCritique()),
    }

    const deps: GraphDeps = {
      callModel,
      persistState: vi.fn().mockResolvedValue(undefined),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      architectAgent: mockArchitect,
      criticAgent: mockCritic,
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    const visited: string[] = []
    await graph.run(state, {
      maxSteps: 50,
      onNodeStart: (name) => visited.push(name),
    })

    const coderIdx = visited.indexOf('coder')
    const codeCriticIdx = visited.indexOf('code-critic')
    const testerIdx = visited.indexOf('tester')

    // code-critic sits between coder and tester
    expect(codeCriticIdx).toBe(coderIdx + 1)
    expect(testerIdx).toBe(codeCriticIdx + 1)

    // CriticAgent.codeReview was actually called
    expect(mockCritic.codeReview).toHaveBeenCalledTimes(1)
  })

  it('T12.3d: dry-run traverses full 9-node path end-to-end', async () => {
    // Simulate what coordinator.synthesize() does in dry-run mode
    // Agents each get their own callModel (in practice they share the same one,
    // but taskKind differs: architect uses 'architect', critic uses 'critic')
    const architectDryRun = vi.fn().mockResolvedValue(JSON.stringify(makeStubBriefingScript()))

    let criticDryRunCount = 0
    const criticDryRun = vi.fn().mockImplementation(async () => {
      criticDryRunCount++
      if (criticDryRunCount === 1) return JSON.stringify(makeStubSemanticReview())
      return JSON.stringify(makeStubCodeCritique())
    })

    const dryRunCallModel = async (taskKind: string, _system: string, _user: string): Promise<string> => {
      switch (taskKind) {
        case 'planner':
          return JSON.stringify({
            approach: 'Dry-run implementation plan',
            atoms: [{ id: 'atom-001', description: 'Stub implementation', assignedTo: 'coder' }],
            executorRecommendation: 'pi-sdk',
            estimatedComplexity: 'low',
          })
        case 'coder':
          return JSON.stringify({
            files: [{ path: 'src/stub.ts', content: '// dry-run stub', action: 'create' }],
            summary: 'Dry-run code output',
            testsIncluded: false,
          })
        case 'tester':
          return JSON.stringify({
            passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
            failures: [], summary: 'Dry-run — all tests pass',
          })
        case 'verifier':
          return JSON.stringify({
            decision: 'pass', confidence: 1.0,
            reason: 'Dry-run — auto-pass',
          })
        default:
          return JSON.stringify({ result: 'dry-run stub' })
      }
    }

    // In dry-run mode, coordinator still creates agents with the dry-run callModel
    const architectAgent = new ArchitectAgent({ callModel: architectDryRun })
    const criticAgent = new CriticAgent({ callModel: criticDryRun })

    const deps: GraphDeps = {
      callModel: dryRunCallModel,
      persistState: vi.fn().mockResolvedValue(undefined),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      architectAgent: {
        produceBriefingScript: (input) => architectAgent.produceBriefingScript(input),
      },
      criticAgent: {
        semanticReview: (input) => criticAgent.semanticReview(input),
        codeReview: (input) => criticAgent.codeReview(input as CodeReviewInput),
      },
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    const visited: string[] = []
    const finalState = await graph.run(state, {
      maxSteps: 50,
      onNodeStart: (name) => visited.push(name),
    })

    // Must traverse all 9 nodes
    expect(visited).toEqual([
      'budget-check',
      'architect',
      'semantic-critic',
      'compile',
      'gate-1',
      'planner',
      'coder',
      'code-critic',
      'tester',
      'verifier',
    ])

    expect(finalState.verdict?.decision).toBe('pass')
    expect(finalState.briefingScript).toBeDefined()
    expect(finalState.briefingScript).not.toBeNull()
    expect(finalState.semanticReview).toBeDefined()
    expect(finalState.gate1Passed).toBe(true)
  })
})
