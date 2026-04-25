export interface Plan {
  approach: string
  atoms: { id: string; description: string; assignedTo: string }[]
  executorRecommendation: 'pi-sdk' | 'openhands' | 'aider'
  estimatedComplexity: 'low' | 'medium' | 'high'
}

export interface CodeArtifact {
  files: { path: string; content: string; action: 'create' | 'modify' | 'delete' }[]
  summary: string
  testsIncluded: boolean
}

export interface CritiqueReport {
  passed: boolean
  issues: { severity: 'critical' | 'major' | 'minor'; description: string; file?: string; line?: number }[]
  mentorRuleCompliance: { ruleId: string; compliant: boolean }[]
  overallAssessment: string
}

export interface TestReport {
  passed: boolean
  testsRun: number
  testsPassed: number
  testsFailed: number
  failures: { name: string; error: string }[]
  coverage?: { lines: number; branches: number; functions: number }
  summary: string
}

export type VerdictDecision = 'pass' | 'patch' | 'resample' | 'interrupt' | 'fail'

export interface Verdict {
  decision: VerdictDecision
  confidence: number
  reason: string
  notes?: string
  artifacts?: CodeArtifact
}

export interface GraphState {
  [key: string]: unknown
  workGraphId: string
  workGraph: Record<string, unknown>

  plan: Plan | null
  code: CodeArtifact | null
  critique: CritiqueReport | null
  tests: TestReport | null
  verdict: Verdict | null

  roleHistory: { role: string; output: unknown; tokenUsage: number; timestamp: string }[]

  repairCount: number
  tokenUsage: number
  maxRepairs: number
  maxTokens: number
}

export function createInitialState(
  workGraphId: string,
  workGraph: Record<string, unknown>,
  opts?: { maxRepairs?: number; maxTokens?: number },
): GraphState {
  return {
    workGraphId,
    workGraph,
    plan: null,
    code: null,
    critique: null,
    tests: null,
    verdict: null,
    roleHistory: [],
    repairCount: 0,
    tokenUsage: 0,
    maxRepairs: opts?.maxRepairs ?? 5,
    maxTokens: opts?.maxTokens ?? 150_000,
  }
}
