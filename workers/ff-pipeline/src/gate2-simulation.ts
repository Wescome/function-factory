import {
  Gate2Report,
  Gate2Verdict,
  type Gate2Report as Gate2ReportType,
  type Gate2Verdict as Gate2VerdictType,
} from '@factory/schemas'

export type Gate2ScenarioKind = 'positive' | 'negative'
export type Gate2ValidationPriority = 'required' | 'recommended'
export type Gate2ValidationStatus = 'pass' | 'fail'

export interface Gate2Branch {
  workgraphNode: string
  edge?: string
}

export interface Gate2Invariant {
  id: string
  workgraphNode: string
}

export interface Gate2Scenario {
  id: string
  kind: Gate2ScenarioKind
  passed: boolean
  coversBranches: Gate2Branch[]
  coversInvariants: string[]
}

export interface Gate2ValidationOutcome {
  id: string
  priority: Gate2ValidationPriority
  status: Gate2ValidationStatus
  invariantIds: string[]
}

export interface Gate2SimulationInput {
  functionId: string
  prdId: string
  workGraphId: string
  candidateId: string
  timestamp: string
  sourceRefs: string[]
  branches: Gate2Branch[]
  invariants: Gate2Invariant[]
  scenarios: Gate2Scenario[]
  validationOutcomes: Gate2ValidationOutcome[]
}

export interface Gate2SimulationResult {
  report: Gate2ReportType
  verdict: Gate2VerdictType
}

export class Gate2SimulationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Gate2SimulationError'
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Gate2SimulationError(`${field} is required`)
  }
}

function assertNonEmptyArray<T>(value: T[], field: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Gate2SimulationError(`${field} is required`)
  }
}

function reportId(functionId: string, timestamp: string): string {
  return `CR-${functionId}-GATE2-${timestamp.replace(/[:.]/g, '-')}`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function sameBranch(left: Gate2Branch, right: Gate2Branch): boolean {
  return left.workgraphNode === right.workgraphNode && (left.edge ?? '') === (right.edge ?? '')
}

function branchDetail(branch: Gate2Branch): { workgraph_node: string; edge?: string; reason: string } {
  const detail = {
    workgraph_node: branch.workgraphNode,
    reason: 'no passing scenario exercises this branch',
  }
  return branch.edge ? { ...detail, edge: branch.edge } : detail
}

function remediation(
  branchesUnexercised: Gate2ReportType['checks']['scenario_coverage']['branches_unexercised'],
  invariantsWithoutNegativeTests: string[],
  failingValidations: string[],
): string {
  const notes: string[] = []
  if (branchesUnexercised.length > 0) {
    notes.push(`Add passing scenarios for ${branchesUnexercised.length} unexercised branch(es).`)
  }
  if (invariantsWithoutNegativeTests.length > 0) {
    notes.push(`Add negative scenarios for invariants: ${invariantsWithoutNegativeTests.join(', ')}.`)
  }
  if (failingValidations.length > 0) {
    notes.push(`Fix failing required validations: ${failingValidations.join(', ')}.`)
  }
  return notes.length > 0 ? notes.join(' ') : 'Gate 2 simulation coverage passed.'
}

export function evaluateGate2Simulation(input: Gate2SimulationInput): Gate2SimulationResult {
  assertNonEmpty(input.functionId, 'functionId')
  assertNonEmpty(input.prdId, 'prdId')
  assertNonEmpty(input.workGraphId, 'workGraphId')
  assertNonEmpty(input.candidateId, 'candidateId')
  assertNonEmpty(input.timestamp, 'timestamp')
  assertNonEmptyArray(input.sourceRefs, 'sourceRefs')
  assertNonEmptyArray(input.invariants, 'invariants')
  assertNonEmptyArray(input.validationOutcomes, 'validationOutcomes')

  const passingScenarios = input.scenarios.filter(scenario => scenario.passed)
  const branchesUnexercised = input.branches
    .filter(branch => !passingScenarios.some(scenario => scenario.coversBranches.some(covered => sameBranch(covered, branch))))
    .map(branchDetail)

  const invariantsWithPassingScenario = input.invariants.filter(invariant =>
    passingScenarios.some(scenario => scenario.coversInvariants.includes(invariant.id)),
  )
  const invariantsWithNegativeScenario = input.invariants.filter(invariant =>
    input.scenarios.some(scenario => scenario.kind === 'negative' && scenario.coversInvariants.includes(invariant.id)),
  )
  const invariantsWithoutNegativeTests = input.invariants
    .filter(invariant => !invariantsWithNegativeScenario.some(covered => covered.id === invariant.id))
    .map(invariant => invariant.id)

  const requiredValidations = input.validationOutcomes.filter(validation => validation.priority === 'required')
  const failingValidations = requiredValidations
    .filter(validation => validation.status !== 'pass')
    .map(validation => validation.id)
  const requiredPassRate = requiredValidations.length === 0
    ? 0
    : (requiredValidations.length - failingValidations.length) / requiredValidations.length

  const scenarioCoveragePassed = branchesUnexercised.length === 0
    && invariantsWithPassingScenario.length === input.invariants.length
  const invariantExercisePassed = invariantsWithoutNegativeTests.length === 0
  const requiredValidationPassed = requiredValidations.length > 0 && failingValidations.length === 0
  const overall = scenarioCoveragePassed && invariantExercisePassed && requiredValidationPassed ? 'pass' : 'fail'
  const remediationText = remediation(branchesUnexercised, invariantsWithoutNegativeTests, failingValidations)

  const report = Gate2Report.parse({
    id: reportId(input.functionId, input.timestamp),
    gate: 2,
    function_id: input.functionId,
    timestamp: input.timestamp,
    overall,
    checks: {
      scenario_coverage: {
        status: scenarioCoveragePassed ? 'pass' : 'fail',
        details: [],
        branches_unexercised: branchesUnexercised,
      },
      invariant_exercise: {
        status: invariantExercisePassed ? 'pass' : 'fail',
        details: [],
        invariants_without_negative_tests: invariantsWithoutNegativeTests,
      },
      required_validation_pass_rate: {
        status: requiredValidationPassed ? 'pass' : 'fail',
        details: [],
        rate: requiredPassRate,
        failing_validations: failingValidations,
      },
    },
    remediation: remediationText,
    source_refs: unique([
      input.functionId,
      input.prdId,
      input.workGraphId,
      input.candidateId,
      ...input.sourceRefs,
      ...invariantsWithoutNegativeTests,
      ...failingValidations,
    ]),
    explicitness: 'inferred',
    rationale: 'Gate 2 simulation coverage report produced from normalized simulation evidence.',
  })

  const scenarioCoverageScore = input.invariants.length === 0 ? 0 : invariantsWithPassingScenario.length / input.invariants.length
  const invariantExerciseRate = input.invariants.length === 0 ? 0 : invariantsWithNegativeScenario.length / input.invariants.length
  const verdict = Gate2Verdict.parse({
    verdict: overall === 'pass' ? 'accepted' : 'rejected',
    evidence_reviewed: [
      report.id,
      ...input.validationOutcomes.map(validation => validation.id),
    ],
    scenario_coverage_score: scenarioCoverageScore,
    invariant_exercise_rate: invariantExerciseRate,
    remediation_notes: remediationText === 'Gate 2 simulation coverage passed.' ? [] : remediationText.split('. ').filter(Boolean),
  })

  return { report, verdict }
}
