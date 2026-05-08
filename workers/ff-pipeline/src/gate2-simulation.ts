import {
  Gate2Report,
  Gate2Verdict,
  type Gate2Report as Gate2ReportType,
  type Gate2Verdict as Gate2VerdictType,
} from '@factory/schemas'
import { validateTransition, type LifecycleState } from './lifecycle'

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

export interface Gate2ContractValidationOutcome {
  validationId: string
  passed: boolean
  summary: string
  details?: Record<string, unknown>
}

export interface Gate2ContractInput {
  synthesisRunId: string
  functionId: string
  workGraphId: string
  architectureCandidateId: string
  artifactPaths: string[]
  validationOutcomes: Gate2ContractValidationOutcome[]
  compileSummary: string
  testSummary: string
  scopeViolation: boolean
  constraintViolation: boolean
  repairLoopCount: number
  resampleSummary: string
  provenance: {
    bindingModeName: string
    promptPackVersion: string
    toolPolicyHash: string
    modelBindingHash: string
    startedAt: string
    completedAt: string
  }
}

export interface AdaptGate2InputOptions {
  prdId: string
  timestamp?: string
  sourceRefs?: string[]
}

export interface Gate2SimulationResult {
  report: Gate2ReportType
  verdict: Gate2VerdictType
}

export interface Gate2AcceptanceDryRunInput {
  currentState: LifecycleState
  report: Gate2ReportType
  verdict: Gate2VerdictType
}

export interface Gate2AcceptanceDryRun {
  from: LifecycleState
  to: 'accepted'
  gate: 'gate-2'
  gateReport: string
  wouldTransition: boolean
  mutationApplied: false
  reason: string
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

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Gate2SimulationError(`${field} is required`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Gate2SimulationError(`${field} is required`)
  }
  return value
}

function requireArrayValue(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Gate2SimulationError(`${field} must be an array`)
  }
  return value
}

function requireStringArray(value: unknown, field: string): string[] {
  const values = requireArray(value, field)
  if (!values.every(item => typeof item === 'string' && item.trim().length > 0)) {
    throw new Gate2SimulationError(`${field} must contain only strings`)
  }
  return values as string[]
}

function readBranch(value: unknown, field: string): Gate2Branch {
  const branch = requireRecord(value, field)
  assertNonEmpty(branch.workgraphNode, `${field}.workgraphNode`)
  if (branch.edge !== undefined && typeof branch.edge !== 'string') {
    throw new Gate2SimulationError(`${field}.edge must be a string`)
  }
  return {
    workgraphNode: branch.workgraphNode,
    ...(branch.edge ? { edge: branch.edge } : {}),
  }
}

function readInvariant(value: unknown, field: string): Gate2Invariant {
  const invariant = requireRecord(value, field)
  assertNonEmpty(invariant.id, `${field}.id`)
  assertNonEmpty(invariant.workgraphNode, `${field}.workgraphNode`)
  return {
    id: invariant.id,
    workgraphNode: invariant.workgraphNode,
  }
}

function readScenario(value: unknown, field: string): Gate2Scenario {
  const scenario = requireRecord(value, field)
  assertNonEmpty(scenario.id, `${field}.id`)
  if (scenario.kind !== 'positive' && scenario.kind !== 'negative') {
    throw new Gate2SimulationError(`${field}.kind must be positive or negative`)
  }
  if (typeof scenario.passed !== 'boolean') {
    throw new Gate2SimulationError(`${field}.passed must be boolean`)
  }
  return {
    id: scenario.id,
    kind: scenario.kind,
    passed: scenario.passed,
    coversBranches: requireArrayValue(scenario.coversBranches, `${field}.coversBranches`)
      .map((branch, index) => readBranch(branch, `${field}.coversBranches[${index}]`)),
    coversInvariants: requireStringArray(scenario.coversInvariants, `${field}.coversInvariants`),
  }
}

function pushUniqueBranch(branches: Gate2Branch[], branch: Gate2Branch): void {
  if (!branches.some(existing => sameBranch(existing, branch))) {
    branches.push(branch)
  }
}

function pushUniqueInvariant(invariants: Gate2Invariant[], invariant: Gate2Invariant): void {
  if (!invariants.some(existing => existing.id === invariant.id && existing.workgraphNode === invariant.workgraphNode)) {
    invariants.push(invariant)
  }
}

function pushUniqueScenario(scenarios: Gate2Scenario[], scenario: Gate2Scenario): void {
  if (!scenarios.some(existing => existing.id === scenario.id)) {
    scenarios.push(scenario)
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

export function adaptGate2Input(input: Gate2ContractInput, options: AdaptGate2InputOptions): Gate2SimulationInput {
  assertNonEmpty(input.functionId, 'functionId')
  assertNonEmpty(options.prdId, 'prdId')
  assertNonEmpty(input.workGraphId, 'workGraphId')
  assertNonEmpty(input.architectureCandidateId, 'architectureCandidateId')
  assertNonEmpty(input.provenance?.completedAt, 'provenance.completedAt')
  assertNonEmptyArray(input.validationOutcomes, 'validationOutcomes')

  const branches: Gate2Branch[] = []
  const invariants: Gate2Invariant[] = []
  const scenarios: Gate2Scenario[] = []
  const validationOutcomes: Gate2ValidationOutcome[] = []

  input.validationOutcomes.forEach((validation, validationIndex) => {
    assertNonEmpty(validation.validationId, `validationOutcomes[${validationIndex}].validationId`)
    if (typeof validation.passed !== 'boolean') {
      throw new Gate2SimulationError(`validationOutcomes[${validationIndex}].passed must be boolean`)
    }

    const details = requireRecord(
      validation.details,
      'normalized Gate2Input validationOutcomes.details',
    )
    const priority = details.priority === 'recommended' ? 'recommended' : details.priority === 'required' ? 'required' : undefined
    if (!priority) {
      throw new Gate2SimulationError('normalized Gate2Input validationOutcomes.details.priority is required')
    }

    const invariantIds = requireStringArray(
      details.invariantIds,
      'normalized Gate2Input validationOutcomes.details.invariantIds',
    )

    requireArray(details.branches, 'normalized Gate2Input validationOutcomes.details.branches')
      .map((branch, branchIndex) => readBranch(branch, `validationOutcomes[${validationIndex}].details.branches[${branchIndex}]`))
      .forEach(branch => pushUniqueBranch(branches, branch))

    requireArray(details.invariants, 'normalized Gate2Input validationOutcomes.details.invariants')
      .map((invariant, invariantIndex) => readInvariant(invariant, `validationOutcomes[${validationIndex}].details.invariants[${invariantIndex}]`))
      .forEach(invariant => pushUniqueInvariant(invariants, invariant))

    requireArray(details.scenarios, 'normalized Gate2Input validationOutcomes.details.scenarios')
      .map((scenario, scenarioIndex) => readScenario(scenario, `validationOutcomes[${validationIndex}].details.scenarios[${scenarioIndex}]`))
      .forEach(scenario => pushUniqueScenario(scenarios, scenario))

    validationOutcomes.push({
      id: validation.validationId,
      priority,
      status: validation.passed ? 'pass' : 'fail',
      invariantIds,
    })
  })

  assertNonEmptyArray(branches, 'normalized Gate2Input validationOutcomes.details.branches')
  assertNonEmptyArray(invariants, 'normalized Gate2Input validationOutcomes.details.invariants')
  assertNonEmptyArray(scenarios, 'normalized Gate2Input validationOutcomes.details.scenarios')

  return {
    functionId: input.functionId,
    prdId: options.prdId,
    workGraphId: input.workGraphId,
    candidateId: input.architectureCandidateId,
    timestamp: options.timestamp ?? input.provenance.completedAt,
    sourceRefs: options.sourceRefs ?? [],
    branches,
    invariants,
    scenarios,
    validationOutcomes,
  }
}

export function evaluateGate2FromContractInput(
  input: Gate2ContractInput,
  options: AdaptGate2InputOptions,
): Gate2SimulationResult {
  return evaluateGate2Simulation(adaptGate2Input(input, options))
}

export function dryRunGate2AcceptanceTransition(input: Gate2AcceptanceDryRunInput): Gate2AcceptanceDryRun {
  const validation = validateTransition(input.currentState, 'accepted')
  if (!validation.valid) {
    return {
      from: input.currentState,
      to: 'accepted',
      gate: 'gate-2',
      gateReport: input.report.id,
      wouldTransition: false,
      mutationApplied: false,
      reason: validation.error ?? `${input.currentState} -> accepted is not authorized.`,
    }
  }

  if (input.report.overall !== 'pass' || input.verdict.verdict !== 'accepted') {
    return {
      from: input.currentState,
      to: 'accepted',
      gate: 'gate-2',
      gateReport: input.report.id,
      wouldTransition: false,
      mutationApplied: false,
      reason: 'Gate 2 report did not pass; produced -> accepted is blocked.',
    }
  }

  return {
    from: input.currentState,
    to: 'accepted',
    gate: 'gate-2',
    gateReport: input.report.id,
    wouldTransition: true,
    mutationApplied: false,
    reason: 'Gate 2 report passed and verdict accepted; produced -> accepted is authorized.',
  }
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

export type FidelityVerificationScenarioKind = Gate2ScenarioKind
export type FidelityVerificationValidationPriority = Gate2ValidationPriority
export type FidelityVerificationValidationStatus = Gate2ValidationStatus
export type FidelityVerificationBranch = Gate2Branch
export type FidelityVerificationInvariant = Gate2Invariant
export type FidelityVerificationScenario = Gate2Scenario
export type FidelityVerificationValidationOutcome = Gate2ValidationOutcome
export type FidelityVerificationInput = Gate2SimulationInput
export type FidelityVerificationContractInput = Gate2ContractInput
export type FidelityVerificationResult = Gate2SimulationResult
export type FidelityVerificationAcceptanceDryRunInput = Gate2AcceptanceDryRunInput
export type FidelityVerificationAcceptanceDryRun = Gate2AcceptanceDryRun

export const FidelityVerificationError = Gate2SimulationError
export const adaptFidelityVerificationInput = adaptGate2Input
export const evaluateFidelityVerificationFromContractInput = evaluateGate2FromContractInput
export const dryRunFidelityAcceptanceTransition = dryRunGate2AcceptanceTransition
export const evaluateFidelityVerification = evaluateGate2Simulation
