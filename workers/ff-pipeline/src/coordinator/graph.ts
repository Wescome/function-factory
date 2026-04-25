import { StateGraph, END } from './graph-runner'
import { ROLE_CONTRACTS } from './contracts'
import type { RoleName } from './contracts'
import type { GraphState, Verdict } from './state'

export interface GraphDeps {
  callModel: (taskKind: string, system: string, user: string) => Promise<string>
  persistState: (state: GraphState, role: string) => Promise<void>
  fetchMentorRules: () => Promise<{ ruleId: string; rule: string }[]>
}

export function buildSynthesisGraph(deps: GraphDeps): StateGraph<GraphState> {
  const graph = new StateGraph<GraphState>()

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

  for (const roleName of ['planner', 'coder', 'critic', 'tester', 'verifier'] as RoleName[]) {
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

      if (roleName === 'planner' && state.repairCount > 0 && state.verdict?.decision === 'resample') {
        updated.repairCount = state.repairCount
      }

      await deps.persistState({ ...state, ...updated } as GraphState, roleName)

      return updated
    })
  }

  graph.setEntryPoint('budget-check')
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
