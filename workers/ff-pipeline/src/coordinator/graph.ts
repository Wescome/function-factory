import { StateGraph, END } from './graph-runner'
import { ROLE_CONTRACTS } from './contracts'
import type { RoleName } from './contracts'
import type { GraphState, Plan, Verdict, CritiqueReport, TestReport, CodeArtifact } from './state'
import type { BriefingScript } from '../agents/architect-agent'
import type { CoderInput } from '../agents/coder-agent'
import type { PlannerInput } from '../agents/planner-agent'
import type { TesterInput } from '../agents/tester-agent'
import type { SemanticReviewResult } from '../types'

export interface GraphDeps {
  callModel: (taskKind: string, system: string, user: string) => Promise<string>
  persistState: (state: GraphState, role: string) => Promise<void>
  fetchMentorRules: () => Promise<{ ruleId: string; rule: string }[]>
  /** Optional execution dispatch for coder/tester. When provided, overrides callModel fallback for those nodes. */
  executionRole?: (role: 'coder' | 'tester') => (state: GraphState) => Promise<Partial<GraphState>>

  // ── 9-node extensions (SS8) ──
  /** When provided, enables the architect pipeline (architect → semantic-critic → compile → gate-1). */
  architectAgent?: { produceBriefingScript: (input: { signal: Record<string, unknown>; specContent?: string }) => Promise<BriefingScript> }
  /** When provided, the planner node calls PlannerAgent instead of callModel. */
  plannerAgent?: { producePlan: (input: PlannerInput) => Promise<Plan> }
  /** When provided, the coder node calls CoderAgent instead of callModel. Priority: executionRole > coderAgent > callModel. */
  coderAgent?: { produceCode: (input: CoderInput) => Promise<CodeArtifact> }

  /** When provided, enables semantic-critic and code-critic nodes. */
  criticAgent?: {
    semanticReview: (input: { prd: Record<string, unknown>; specContent?: string }) => Promise<SemanticReviewResult>
    codeReview: (input: { code: unknown; plan: unknown; workGraph: Record<string, unknown>; mentorRules?: string[] }) => Promise<CritiqueReport>
  }
  /** When provided, the tester node uses the real TesterAgent (gdk-agent agentLoop) instead of callModel. */
  testerAgent?: { runTests: (input: TesterInput) => Promise<TestReport> }
  /** When provided, the verifier node uses the real VerifierAgent (gdk-agent agentLoop) instead of callModel. */
  verifierAgent?: { verify: (input: any) => Promise<Verdict> }

  /**
   * v5: When true, graph stops after planner (Phase 1 only).
   * Phase 2 (per-atom execution) is handled by the coordinator via layer-dispatch.
   * Requires 9-node mode (architectAgent + criticAgent).
   */
  verticalSlicing?: boolean
}

export function buildSynthesisGraph(deps: GraphDeps): StateGraph<GraphState> {
  const graph = new StateGraph<GraphState>()

  const has9Node = !!(deps.architectAgent && deps.criticAgent)
  const verticalSlicing = !!(deps.verticalSlicing && has9Node)

  // ── Budget-check node (unchanged logic) ──
  graph.addNode('budget-check', async (state) => {
    if (state.repairCount >= state.maxRepairs) {
      return {
        verdict: {
          decision: 'fail' as const,
          confidence: 1.0,
          reason: `Repair cap exceeded (${state.repairCount}/${state.maxRepairs})`,
        } satisfies Verdict,
      }
    }
    if (state.tokenUsage >= state.maxTokens) {
      return {
        verdict: {
          decision: 'interrupt' as const,
          confidence: 1.0,
          reason: `Token budget exceeded (${state.tokenUsage}/${state.maxTokens})`,
        } satisfies Verdict,
      }
    }
    return {}
  })

  // ── Architect pipeline nodes (only when 9-node mode) ──
  if (has9Node) {
    // architect — calls ArchitectAgent.produceBriefingScript()
    graph.addNode('architect', async (state) => {
      const briefingScript = await deps.architectAgent!.produceBriefingScript({
        signal: state.workGraph as Record<string, unknown>,
        ...(state.specContent ? { specContent: state.specContent } : {}),
      })
      const updated: Partial<GraphState> = {
        briefingScript,
        roleHistory: [
          ...state.roleHistory,
          { role: 'architect', output: briefingScript, tokenUsage: 0, timestamp: new Date().toISOString() },
        ],
      }
      await deps.persistState({ ...state, ...updated } as GraphState, 'architect')
      return updated
    })

    // semantic-critic — calls CriticAgent.semanticReview()
    graph.addNode('semantic-critic', async (state) => {
      const review = await deps.criticAgent!.semanticReview({
        prd: state.workGraph as Record<string, unknown>,
        ...(state.specContent ? { specContent: state.specContent } : {}),
      })
      const updated: Partial<GraphState> = {
        semanticReview: review,
        roleHistory: [
          ...state.roleHistory,
          { role: 'semantic-critic', output: review, tokenUsage: 0, timestamp: new Date().toISOString() },
        ],
      }
      // If miscast, set verdict=fail so the conditional edge routes to END
      if (review.alignment === 'miscast') {
        updated.verdict = {
          decision: 'fail' as const,
          confidence: review.confidence,
          reason: `Semantic review: miscast — ${review.rationale}`,
        }
      }
      await deps.persistState({ ...state, ...updated } as GraphState, 'semantic-critic')
      return updated
    })

    // compile — passthrough stub (real compiler is in the Workflow's Stage 5)
    graph.addNode('compile', async (state) => {
      const compiledPrd = {
        source: 'graph-compile-stub',
        workGraphId: state.workGraphId,
        timestamp: new Date().toISOString(),
      }
      const updated: Partial<GraphState> = {
        compiledPrd,
        roleHistory: [
          ...state.roleHistory,
          { role: 'compile', output: compiledPrd, tokenUsage: 0, timestamp: new Date().toISOString() },
        ],
      }
      await deps.persistState({ ...state, ...updated } as GraphState, 'compile')
      return updated
    })

    // gate-1 — stub (real Gate 1 is in the Workflow)
    graph.addNode('gate-1', async (state) => {
      const gate1Report = {
        gate: 1,
        passed: true,
        timestamp: new Date().toISOString(),
        workGraphId: state.workGraphId,
        checks: [{ name: 'stub-check', passed: true, detail: 'Graph-internal gate-1 stub' }],
        summary: 'Gate 1 passed (stub)',
      }
      const updated: Partial<GraphState> = {
        gate1Passed: true,
        gate1Report,
        roleHistory: [
          ...state.roleHistory,
          { role: 'gate-1', output: gate1Report, tokenUsage: 0, timestamp: new Date().toISOString() },
        ],
      }
      await deps.persistState({ ...state, ...updated } as GraphState, 'gate-1')
      return updated
    })

    // code-critic — calls CriticAgent.codeReview() between coder and tester
    // Not added in verticalSlicing mode (handled per-atom in Phase 2)
    if (!verticalSlicing) {
      graph.addNode('code-critic', async (state) => {
        const mentorRules = await deps.fetchMentorRules()
        const critique = await deps.criticAgent!.codeReview({
          code: state.code,
          plan: state.plan,
          workGraph: state.workGraph as Record<string, unknown>,
          mentorRules: mentorRules.map(r => `${r.ruleId}: ${r.rule}`),
        })
        const updated: Partial<GraphState> = {
          critique,
          roleHistory: [
            ...state.roleHistory,
            { role: 'code-critic', output: critique, tokenUsage: 0, timestamp: new Date().toISOString() },
          ],
        }
        await deps.persistState({ ...state, ...updated } as GraphState, 'code-critic')
        return updated
      })
    }
  }

  // ── Standard role nodes ──
  // In vertical-slicing mode: only planner (coder/tester/verifier handled per-atom by layer-dispatch)
  // In 9-node mode: planner, coder, tester, verifier (critic replaced by code-critic)
  // In 5-node mode: planner, coder, critic, tester, verifier
  const standardRoles: RoleName[] = verticalSlicing
    ? ['planner']
    : has9Node
      ? ['planner', 'coder', 'tester', 'verifier']
      : ['planner', 'coder', 'critic', 'tester', 'verifier']

  for (const roleName of standardRoles) {
    // Use executionRole dispatch for coder/tester when provided
    if ((roleName === 'coder' || roleName === 'tester') && deps.executionRole) {
      graph.addNode(roleName, deps.executionRole(roleName))
      continue
    }

    // Use PlannerAgent when provided (real agent with tools, like ArchitectAgent)
    if (roleName === 'planner' && deps.plannerAgent) {
      graph.addNode(roleName, async (state) => {
        const plannerInput: PlannerInput = {
          workGraph: state.workGraph,
          briefingScript: (state.briefingScript ?? {}) as Record<string, unknown>,
          ...(state.specContent ? { specContent: state.specContent } : {}),
          ...(state.verdict?.decision === 'patch' && state.verdict.notes ? {
            repairNotes: state.verdict.notes,
            previousPlan: state.plan ?? undefined,
          } : {}),
          ...(state.verdict?.decision === 'resample' ? {
            resampleReason: state.verdict.reason,
          } : {}),
          // v4.1: pass per-atom failure info so planner can scope its plan
          ...(state.failedAtomIds ? { failedAtomIds: state.failedAtomIds } : {}),
        }

        const plan = await deps.plannerAgent!.producePlan(plannerInput)

        const updated: Partial<GraphState> = {
          plan,
          roleHistory: [
            ...state.roleHistory,
            { role: 'planner', output: plan, tokenUsage: 0, timestamp: new Date().toISOString() },
          ],
        }

        if (state.repairCount > 0 && state.verdict?.decision === 'resample') {
          updated.repairCount = state.repairCount
        }

        await deps.persistState({ ...state, ...updated } as GraphState, 'planner')
        return updated
      })
      continue
    }

    // Use CoderAgent when provided (real agent with tools, like ArchitectAgent)
    // Priority: executionRole (Phase C sandbox) > coderAgent (Phase A agentLoop) > callModel
    if (roleName === 'coder' && deps.coderAgent) {
      graph.addNode(roleName, async (state) => {
        const coderInput: CoderInput = {
          workGraph: state.workGraph,
          plan: state.plan!,
          ...(state.specContent ? { specContent: state.specContent } : {}),
          ...(state.verdict?.decision === 'patch' && state.verdict.notes ? {
            repairNotes: state.verdict.notes,
            previousCode: state.code ?? undefined,
            critiqueIssues: state.critique?.issues,
          } : {}),
        }

        const code = await deps.coderAgent!.produceCode(coderInput)

        const updated: Partial<GraphState> = {
          code,
          roleHistory: [
            ...state.roleHistory,
            { role: 'coder', output: code, tokenUsage: 0, timestamp: new Date().toISOString() },
          ],
        }

        await deps.persistState({ ...state, ...updated } as GraphState, 'coder')
        return updated
      })
      continue
    }

    // Use TesterAgent when provided (real agent with tools, like ArchitectAgent)
    if (roleName === 'tester' && deps.testerAgent) {
      graph.addNode(roleName, async (state) => {
        const testerInput: TesterInput = {
          workGraph: state.workGraph,
          plan: state.plan ?? {},
          code: state.code ?? {},
          ...(state.critique ? { critique: state.critique } : {}),
        }

        const tests = await deps.testerAgent!.runTests(testerInput)

        const updated: Partial<GraphState> = {
          tests,
          roleHistory: [
            ...state.roleHistory,
            { role: 'tester', output: tests, tokenUsage: 0, timestamp: new Date().toISOString() },
          ],
        }

        await deps.persistState({ ...state, ...updated } as GraphState, 'tester')
        return updated
      })
      continue
    }

    // Use VerifierAgent when provided (real agent with tools, like ArchitectAgent)
    if (roleName === 'verifier' && deps.verifierAgent) {
      graph.addNode(roleName, async (state) => {
        const verdict = await deps.verifierAgent!.verify({
          workGraph: state.workGraph,
          plan: state.plan,
          code: state.code,
          critique: state.critique,
          tests: state.tests,
          repairCount: state.repairCount,
          maxRepairs: state.maxRepairs,
          tokenUsage: state.tokenUsage,
          maxTokens: state.maxTokens,
        })

        const updated: Partial<GraphState> = {
          verdict,
          // v4.1: propagate per-atom failure info from verdict to state
          failedAtomIds: verdict.failedAtomIds ?? null,
          roleHistory: [
            ...state.roleHistory,
            { role: 'verifier', output: verdict, tokenUsage: 0, timestamp: new Date().toISOString() },
          ],
        }

        await deps.persistState({ ...state, ...updated } as GraphState, 'verifier')
        return updated
      })
      continue
    }

    graph.addNode(roleName, async (state) => {
      const contract = ROLE_CONTRACTS[roleName]

      const userMessage = buildRoleMessage(roleName, state, await deps.fetchMentorRules())

      const rawResult = await deps.callModel(
        contract.taskKind,
        contract.systemPrompt,
        userMessage,
      )

      const parsed = contract.parse(rawResult)

      const estimatedTokens = Math.ceil(
        (contract.systemPrompt.length + userMessage.length + rawResult.length) / 4,
      )

      const updated: Partial<GraphState> = {
        [contract.outputChannel]: parsed,
        tokenUsage: state.tokenUsage + estimatedTokens,
        roleHistory: [
          ...state.roleHistory,
          { role: roleName, output: parsed, tokenUsage: estimatedTokens, timestamp: new Date().toISOString() },
        ],
      }

      // v4.1: propagate per-atom failure info from verdict to state (callModel fallback)
      if (roleName === 'verifier' && parsed && typeof parsed === 'object') {
        const v = parsed as Verdict
        updated.failedAtomIds = v.failedAtomIds ?? null
      }

      if (roleName === 'planner' && state.repairCount > 0 && state.verdict?.decision === 'resample') {
        updated.repairCount = state.repairCount
      }

      await deps.persistState({ ...state, ...updated } as GraphState, roleName)

      return updated
    })
  }

  // ── Entry point ──
  graph.setEntryPoint('budget-check')

  // ── Edges ──
  if (verticalSlicing) {
    // v5: Phase 1 only — graph stops after planner
    // Architect pipeline edges
    graph.addEdge('architect', 'semantic-critic')
    graph.addEdge('compile', 'gate-1')
    graph.addEdge('gate-1', 'planner')

    // Planner goes to END — Phase 2 handled by coordinator via layer-dispatch
    graph.addEdge('planner', END)

    // Semantic-critic conditional: miscast → END, else → compile
    graph.addConditionalEdge('semantic-critic', (state) => {
      if (state.verdict?.decision === 'fail') return END
      return 'compile'
    })

    // Budget-check conditional: fail/interrupt → END, else → architect
    graph.addConditionalEdge('budget-check', (state) => {
      if (state.verdict?.decision === 'fail' || state.verdict?.decision === 'interrupt') {
        return END
      }
      // First pass: no briefingScript yet → architect pipeline
      if (!state.briefingScript) return 'architect'
      // Repair: briefingScript already set → skip to planner
      return 'planner'
    })
  } else if (has9Node) {
    // Architect pipeline edges
    graph.addEdge('architect', 'semantic-critic')
    graph.addEdge('compile', 'gate-1')
    graph.addEdge('gate-1', 'planner')

    // Inner loop edges
    graph.addEdge('planner', 'coder')
    graph.addEdge('coder', 'code-critic')
    graph.addEdge('code-critic', 'tester')
    graph.addEdge('tester', 'verifier')

    // Semantic-critic conditional: miscast → END, else → compile
    graph.addConditionalEdge('semantic-critic', (state) => {
      if (state.verdict?.decision === 'fail') return END
      return 'compile'
    })

    // Budget-check conditional: fail/interrupt → END, first pass → architect, repair → planner
    graph.addConditionalEdge('budget-check', (state) => {
      if (state.verdict?.decision === 'fail' || state.verdict?.decision === 'interrupt') {
        return END
      }
      // First pass: no briefingScript yet → architect pipeline
      if (!state.briefingScript) return 'architect'
      // Repair: briefingScript already set → skip to planner
      return 'planner'
    })
  } else {
    // Original 5-node edges
    graph.addEdge('planner', 'coder')
    graph.addEdge('coder', 'critic')
    graph.addEdge('critic', 'tester')
    graph.addEdge('tester', 'verifier')

    graph.addConditionalEdge('budget-check', (state) => {
      if (state.verdict?.decision === 'fail' || state.verdict?.decision === 'interrupt') {
        return END
      }
      return 'planner'
    })
  }

  // Verifier routing (shared between non-verticalSlicing topologies)
  // In verticalSlicing mode, there is no verifier node in the graph —
  // per-atom verification is handled by executeAtomSlice in Phase 2.
  if (!verticalSlicing) {
    graph.addConditionalEdge('verifier', (state) => {
      if (!state.verdict) return END
      switch (state.verdict.decision) {
        case 'pass':
        case 'interrupt':
        case 'fail':
          return END
        case 'patch':
        case 'resample':
          return 'budget-check'
        default:
          return END
      }
    })
  }

  return graph
}

function buildRoleMessage(
  role: RoleName,
  state: GraphState,
  mentorRules: { ruleId: string; rule: string }[],
): string {
  const base: Record<string, unknown> = {
    workGraphId: state.workGraphId,
    workGraph: {
      title: state.workGraph.title,
      atoms: state.workGraph.atoms,
      invariants: state.workGraph.invariants,
      dependencies: state.workGraph.dependencies,
    },
    repairCount: state.repairCount,
    maxRepairs: state.maxRepairs,
  }

  switch (role) {
    case 'planner':
      return JSON.stringify({
        ...base,
        ...(state.verdict?.decision === 'patch' && {
          repairNotes: state.verdict.notes,
          previousPlan: state.plan,
          previousCritique: state.critique?.overallAssessment,
        }),
        ...(state.verdict?.decision === 'resample' && {
          resampleReason: state.verdict.reason,
          previousApproach: state.plan?.approach,
        }),
        // v4.1: scope repair to failing atoms when known
        ...(state.failedAtomIds ? { failedAtomIds: state.failedAtomIds } : {}),
      })
    case 'coder':
      return JSON.stringify({
        ...base,
        plan: state.plan,
        ...(state.verdict?.decision === 'patch' && {
          repairNotes: state.verdict.notes,
          previousCode: state.code?.summary,
          critiqueIssues: state.critique?.issues,
        }),
      })
    case 'critic':
      return JSON.stringify({
        ...base,
        code: state.code,
        plan: state.plan,
        mentorRules: mentorRules.map(r => `${r.ruleId}: ${r.rule}`),
      })
    case 'tester':
      return JSON.stringify({
        ...base,
        code: state.code,
        plan: state.plan,
        critique: state.critique,
      })
    case 'verifier':
      return JSON.stringify({
        ...base,
        plan: state.plan,
        code: state.code,
        critique: state.critique,
        tests: state.tests,
        repairCount: state.repairCount,
        maxRepairs: state.maxRepairs,
        tokenUsage: state.tokenUsage,
        maxTokens: state.maxTokens,
      })
  }
}
