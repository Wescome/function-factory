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
import { CoderAgent } from '../agents/coder-agent.js'
import { CriticAgent, type CodeReviewInput } from '../agents/critic-agent.js'
import type { SemanticReviewResult } from '../types.js'
import type { CodeArtifact, CritiqueReport } from './state.js'

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
          executorRecommendation: 'gdk-agent',
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

  it('T12.1c: instantiates ArchitectAgent with db and apiKey (Phase 0 spike)', () => {
    expect(coordinatorSrc).toMatch(/new\s+ArchitectAgent\(\s*\{/)
    expect(coordinatorSrc).toContain('db:')
    expect(coordinatorSrc).toContain('apiKey:')
  })

  it('T12.1d: instantiates CriticAgent with db and apiKey (Phase 0 spike)', () => {
    expect(coordinatorSrc).toMatch(/new\s+CriticAgent\(\s*\{/)
    expect(coordinatorSrc).toContain('db:')
    expect(coordinatorSrc).toContain('apiKey:')
  })

  it('T12.1g: imports CoderAgent from agents/coder-agent', () => {
    expect(coordinatorSrc).toMatch(/import\s*\{[^}]*CoderAgent[^}]*\}\s*from\s*['"]\.\.\/agents\/coder-agent['"]/)
  })

  it('T12.1h: instantiates CoderAgent with db and apiKey', () => {
    expect(coordinatorSrc).toMatch(/new\s+CoderAgent\(\s*\{/)
  })

  it('T12.1i: passes coderAgent to GraphDeps', () => {
    expect(coordinatorSrc).toMatch(/coderAgent\s*[:{]/)
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
    const architectAgent = new ArchitectAgent({ db: {} as any, apiKey: 'test', dryRun: true })

    const depsShape: GraphDeps['architectAgent'] = {
      produceBriefingScript: (input) => architectAgent.produceBriefingScript(input),
    }

    const result = await depsShape!.produceBriefingScript({ signal: { test: true } })
    expect(result.goal).toBe('Dry-run goal')
    expect(result.successCriteria).toEqual(['Dry-run criterion'])
  })

  it('T12.2b: CriticAgent.semanticReview callable from GraphDeps.criticAgent shape', async () => {
    const criticAgent = new CriticAgent({ db: {} as any, apiKey: 'test', dryRun: true })

    const depsShape: GraphDeps['criticAgent'] = {
      semanticReview: (input) => criticAgent.semanticReview(input),
      codeReview: (input) => criticAgent.codeReview(input as CodeReviewInput),
    }

    const result = await depsShape!.semanticReview({ prd: { test: true } })
    expect(result.alignment).toBe('aligned')
    expect(result.confidence).toBe(1.0)
  })

  it('T12.2d: CoderAgent.produceCode callable from GraphDeps.coderAgent shape', async () => {
    const coderAgent = new CoderAgent({ db: {} as any, apiKey: 'test', dryRun: true })

    const depsShape: GraphDeps['coderAgent'] = {
      produceCode: (input) => coderAgent.produceCode(input),
    }

    const result = await depsShape!.produceCode({
      workGraph: { test: true },
      plan: { approach: 'test', atoms: [], executorRecommendation: 'gdk-agent', estimatedComplexity: 'low' },
    })
    expect(result.files).toBeDefined()
    expect(Array.isArray(result.files)).toBe(true)
    expect(result.summary).toBe('Dry-run code output')
    expect(result.testsIncluded).toBe(false)
  })

  it('T12.2c: CriticAgent.codeReview callable from GraphDeps.criticAgent shape', async () => {
    const criticAgent = new CriticAgent({ db: {} as any, apiKey: 'test', dryRun: true })

    const depsShape: GraphDeps['criticAgent'] = {
      semanticReview: (input) => criticAgent.semanticReview(input),
      codeReview: (input) => criticAgent.codeReview(input as CodeReviewInput),
    }

    const result = await depsShape!.codeReview({
      code: { files: [], summary: 'test', testsIncluded: false },
      plan: { approach: 'test', atoms: [], executorRecommendation: 'gdk-agent', estimatedComplexity: 'low' },
      workGraph: { test: true },
      mentorRules: [],
    })
    expect(result.passed).toBe(true)
    expect(result.overallAssessment).toContain('Dry-run')
  })
})

// ────────────────────────────────────────────────────────────
// T12.3: Integration — graph with real agent instances traverses 9-node path
// ────────────────────────────────────────────────────────────

describe('T12: integration — real agent instances drive 9-node graph', () => {
  it('T12.3a: graph with ArchitectAgent/CriticAgent instances traverses full 9-node path', async () => {
    const callModel = makeStubCallModel()

    const architectAgent = new ArchitectAgent({ db: {} as any, apiKey: 'test', dryRun: true })
    const criticAgent = new CriticAgent({ db: {} as any, apiKey: 'test', dryRun: true })

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
    const architectAgent = new ArchitectAgent({ db: {} as any, apiKey: 'test', dryRun: true })
    const criticAgent = new CriticAgent({ db: {} as any, apiKey: 'test', dryRun: true })

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

  it('T12.3e: coderAgent dispatch produces code when provided in deps', async () => {
    const callModel = makeStubCallModel()
    const coderAgent = new CoderAgent({ db: {} as any, apiKey: 'test', dryRun: true })
    const architectAgent = new ArchitectAgent({ db: {} as any, apiKey: 'test', dryRun: true })
    const criticAgent = new CriticAgent({ db: {} as any, apiKey: 'test', dryRun: true })

    const deps: GraphDeps = {
      callModel,
      persistState: vi.fn().mockResolvedValue(undefined),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      architectAgent: {
        produceBriefingScript: (input) => architectAgent.produceBriefingScript(input),
      },
      coderAgent: {
        produceCode: (input) => coderAgent.produceCode(input),
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

    // Coder node must execute
    expect(visited).toContain('coder')

    // Code must come from CoderAgent dry-run (not callModel)
    expect(finalState.code).toBeDefined()
    expect(finalState.code!.summary).toBe('Dry-run code output')
    expect(finalState.code!.files[0].path).toBe('src/stub.ts')

    // callModel should NOT have been called with taskKind 'coder'
    const coderCalls = (callModel as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([taskKind]: [string]) => taskKind === 'coder',
    )
    expect(coderCalls).toHaveLength(0)
  })

  it('T12.3f: executionRole takes priority over coderAgent', async () => {
    const callModel = makeStubCallModel()
    const coderAgent = new CoderAgent({ db: {} as any, apiKey: 'test', dryRun: true })
    const mockArchitect = {
      produceBriefingScript: vi.fn().mockResolvedValue(makeStubBriefingScript()),
    }
    const mockCritic = {
      semanticReview: vi.fn().mockResolvedValue(makeStubSemanticReview()),
      codeReview: vi.fn().mockResolvedValue(makeStubCodeCritique()),
    }

    const executionRoleCode: CodeArtifact = {
      files: [{ path: 'src/sandbox.ts', content: '// sandbox code', action: 'create' }],
      summary: 'Sandbox execution output',
      testsIncluded: false,
    }

    const deps: GraphDeps = {
      callModel,
      persistState: vi.fn().mockResolvedValue(undefined),
      fetchMentorRules: vi.fn().mockResolvedValue([]),
      executionRole: (role) => async (state) => {
        if (role === 'coder') {
          return { code: executionRoleCode }
        }
        // tester fallback
        return {
          tests: {
            passed: true, testsRun: 1, testsPassed: 1, testsFailed: 0,
            failures: [], summary: 'sandbox tester',
          },
        }
      },
      architectAgent: mockArchitect,
      coderAgent: {
        produceCode: (input) => coderAgent.produceCode(input),
      },
      criticAgent: mockCritic,
    }

    const graph = buildSynthesisGraph(deps)
    const state = makeState()

    const visited: string[] = []
    const finalState = await graph.run(state, {
      maxSteps: 50,
      onNodeStart: (name) => visited.push(name),
    })

    // executionRole should have produced the code, not coderAgent
    expect(finalState.code).toBeDefined()
    expect(finalState.code!.summary).toBe('Sandbox execution output')
  })

  it('T12.3d: dry-run traverses full 9-node path end-to-end', async () => {
    // Simulate what coordinator.synthesize() does in dry-run mode
    // Both agents handle dry-run internally (no callModel needed)
    const dryRunCallModel = makeStubCallModel()

    const architectAgent = new ArchitectAgent({ db: {} as any, apiKey: 'test', dryRun: true })
    const criticAgent = new CriticAgent({ db: {} as any, apiKey: 'test', dryRun: true })

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
