import {
  FidelityVerificationReport,
  FidelityVerificationVerdict,
  type FidelityVerificationReport as FidelityVerificationReportType,
  type FidelityVerificationVerdict as FidelityVerificationVerdictType,
} from '@factory/schemas'
import { validateTransition, type LifecycleState } from './lifecycle'

export type FidelityVerificationScenarioKind = 'positive' | 'negative'
export type FidelityVerificationValidationPriority = 'required' | 'recommended'
export type FidelityVerificationValidationStatus = 'pass' | 'fail'

export interface FidelityVerificationBranch {
  executableSpecificationNode: string
  edge?: string
}

export interface FidelityVerificationInvariant {
  id: string
  executableSpecificationNode: string
}

export interface FidelityVerificationScenario {
  id: string
  kind: FidelityVerificationScenarioKind
  passed: boolean
  coversBranches: FidelityVerificationBranch[]
  coversInvariants: string[]
}

export interface FidelityVerificationValidationOutcome {
  id: string
  priority: FidelityVerificationValidationPriority
  status: FidelityVerificationValidationStatus
  invariantIds: string[]
}

export interface FidelityVerificationInput {
  functionId: string
  prdId: string
  executableSpecificationId: string
  candidateId: string
  packetId: string
  packetHash: string
  timestamp: string
  sourceRefs: string[]
  branches: FidelityVerificationBranch[]
  invariants: FidelityVerificationInvariant[]
  scenarios: FidelityVerificationScenario[]
  validationOutcomes: FidelityVerificationValidationOutcome[]
}

export interface FidelityVerificationContractValidationOutcome {
  validationId: string
  passed: boolean
  summary: string
  details?: Record<string, unknown>
}

export interface FidelityVerificationContractInput {
  synthesisRunId: string
  functionId: string
  executableSpecificationId: string
  architectureCandidateId: string
  packetId: string
  packetHash: string
  artifactPaths: string[]
  validationOutcomes: FidelityVerificationContractValidationOutcome[]
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

export interface AdaptFidelityVerificationInputOptions {
  prdId: string
  timestamp?: string
  sourceRefs?: string[]
}

export interface FidelityVerificationResult {
  report: FidelityVerificationReportType
  verdict: FidelityVerificationVerdictType
}

export interface FidelityVerificationAcceptanceDryRunInput {
  currentState: LifecycleState
  report: FidelityVerificationReportType
  verdict: FidelityVerificationVerdictType
}

export interface FidelityVerificationAcceptanceDryRun {
  from: LifecycleState
  to: 'accepted'
  verification: 'fidelity-verification'
  verificationReport: string
  wouldTransition: boolean
  mutationApplied: false
  reason: string
}

export class FidelityVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FidelityVerificationError'
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FidelityVerificationError(`${field} is required`)
  }
}

function assertNonEmptyArray<T>(value: T[], field: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FidelityVerificationError(`${field} is required`)
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FidelityVerificationError(`${field} is required`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FidelityVerificationError(`${field} is required`)
  }
  return value
}

function requireArrayValue(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new FidelityVerificationError(`${field} must be an array`)
  }
  return value
}

function requireStringArray(value: unknown, field: string): string[] {
  const values = requireArray(value, field)
  if (!values.every(item => typeof item === 'string' && item.trim().length > 0)) {
    throw new FidelityVerificationError(`${field} must contain only strings`)
  }
  return values as string[]
}

function readBranch(value: unknown, field: string): FidelityVerificationBranch {
  const branch = requireRecord(value, field)
  assertNonEmpty(branch.executableSpecificationNode, `${field}.executableSpecificationNode`)
  if (branch.edge !== undefined && typeof branch.edge !== 'string') {
    throw new FidelityVerificationError(`${field}.edge must be a string`)
  }
  return {
    executableSpecificationNode: branch.executableSpecificationNode,
    ...(branch.edge ? { edge: branch.edge } : {}),
  }
}

function readInvariant(value: unknown, field: string): FidelityVerificationInvariant {
  const invariant = requireRecord(value, field)
  assertNonEmpty(invariant.id, `${field}.id`)
  assertNonEmpty(invariant.executableSpecificationNode, `${field}.executableSpecificationNode`)
  return {
    id: invariant.id,
    executableSpecificationNode: invariant.executableSpecificationNode,
  }
}

function readScenario(value: unknown, field: string): FidelityVerificationScenario {
  const scenario = requireRecord(value, field)
  assertNonEmpty(scenario.id, `${field}.id`)
  if (scenario.kind !== 'positive' && scenario.kind !== 'negative') {
    throw new FidelityVerificationError(`${field}.kind must be positive or negative`)
  }
  if (typeof scenario.passed !== 'boolean') {
    throw new FidelityVerificationError(`${field}.passed must be boolean`)
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

function pushUniqueBranch(branches: FidelityVerificationBranch[], branch: FidelityVerificationBranch): void {
  if (!branches.some(existing => sameBranch(existing, branch))) {
    branches.push(branch)
  }
}

function pushUniqueInvariant(invariants: FidelityVerificationInvariant[], invariant: FidelityVerificationInvariant): void {
  if (!invariants.some(existing => existing.id === invariant.id && existing.executableSpecificationNode === invariant.executableSpecificationNode)) {
    invariants.push(invariant)
  }
}

function pushUniqueScenario(scenarios: FidelityVerificationScenario[], scenario: FidelityVerificationScenario): void {
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

function sameBranch(left: FidelityVerificationBranch, right: FidelityVerificationBranch): boolean {
  return left.executableSpecificationNode === right.executableSpecificationNode && (left.edge ?? '') === (right.edge ?? '')
}

function branchDetail(branch: FidelityVerificationBranch): { executableSpecification_node: string; edge?: string; reason: string } {
  const detail = {
    executableSpecification_node: branch.executableSpecificationNode,
    reason: 'no passing scenario exercises this branch',
  }
  return branch.edge ? { ...detail, edge: branch.edge } : detail
}

function remediation(
  branchesUnexercised: FidelityVerificationReportType['checks']['scenario_coverage']['branches_unexercised'],
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
  return notes.length > 0 ? notes.join(' ') : 'Fidelity Verification passed.'
}

export function adaptFidelityVerificationInput(
  input: FidelityVerificationContractInput,
  options: AdaptFidelityVerificationInputOptions,
): FidelityVerificationInput {
  assertNonEmpty(input.functionId, 'functionId')
  assertNonEmpty(options.prdId, 'prdId')
  assertNonEmpty(input.executableSpecificationId, 'executableSpecificationId')
  assertNonEmpty(input.architectureCandidateId, 'architectureCandidateId')
  assertNonEmpty(input.packetId, 'packetId')
  assertNonEmpty(input.packetHash, 'packetHash')
  assertNonEmpty(input.provenance?.completedAt, 'provenance.completedAt')
  assertNonEmptyArray(input.validationOutcomes, 'validationOutcomes')

  const branches: FidelityVerificationBranch[] = []
  const invariants: FidelityVerificationInvariant[] = []
  const scenarios: FidelityVerificationScenario[] = []
  const validationOutcomes: FidelityVerificationValidationOutcome[] = []

  input.validationOutcomes.forEach((validation, validationIndex) => {
    assertNonEmpty(validation.validationId, `validationOutcomes[${validationIndex}].validationId`)
    if (typeof validation.passed !== 'boolean') {
      throw new FidelityVerificationError(`validationOutcomes[${validationIndex}].passed must be boolean`)
    }

    const details = requireRecord(
      validation.details,
      'normalized FidelityVerificationInput validationOutcomes.details',
    )
    const priority = details.priority === 'recommended' ? 'recommended' : details.priority === 'required' ? 'required' : undefined
    if (!priority) {
      throw new FidelityVerificationError('normalized FidelityVerificationInput validationOutcomes.details.priority is required')
    }

    const invariantIds = requireStringArray(
      details.invariantIds,
      'normalized FidelityVerificationInput validationOutcomes.details.invariantIds',
    )

    requireArray(details.branches, 'normalized FidelityVerificationInput validationOutcomes.details.branches')
      .map((branch, branchIndex) => readBranch(branch, `validationOutcomes[${validationIndex}].details.branches[${branchIndex}]`))
      .forEach(branch => pushUniqueBranch(branches, branch))

    requireArray(details.invariants, 'normalized FidelityVerificationInput validationOutcomes.details.invariants')
      .map((invariant, invariantIndex) => readInvariant(invariant, `validationOutcomes[${validationIndex}].details.invariants[${invariantIndex}]`))
      .forEach(invariant => pushUniqueInvariant(invariants, invariant))

    requireArray(details.scenarios, 'normalized FidelityVerificationInput validationOutcomes.details.scenarios')
      .map((scenario, scenarioIndex) => readScenario(scenario, `validationOutcomes[${validationIndex}].details.scenarios[${scenarioIndex}]`))
      .forEach(scenario => pushUniqueScenario(scenarios, scenario))

    validationOutcomes.push({
      id: validation.validationId,
      priority,
      status: validation.passed ? 'pass' : 'fail',
      invariantIds,
    })
  })

  assertNonEmptyArray(branches, 'normalized FidelityVerificationInput validationOutcomes.details.branches')
  assertNonEmptyArray(invariants, 'normalized FidelityVerificationInput validationOutcomes.details.invariants')
  assertNonEmptyArray(scenarios, 'normalized FidelityVerificationInput validationOutcomes.details.scenarios')

  return {
    functionId: input.functionId,
    prdId: options.prdId,
    executableSpecificationId: input.executableSpecificationId,
    candidateId: input.architectureCandidateId,
    packetId: input.packetId,
    packetHash: input.packetHash,
    timestamp: options.timestamp ?? input.provenance.completedAt,
    sourceRefs: options.sourceRefs ?? [],
    branches,
    invariants,
    scenarios,
    validationOutcomes,
  }
}

export function evaluateFidelityVerificationFromContractInput(
  input: FidelityVerificationContractInput,
  options: AdaptFidelityVerificationInputOptions,
): FidelityVerificationResult {
  return evaluateFidelityVerification(adaptFidelityVerificationInput(input, options))
}

export function dryRunFidelityAcceptanceTransition(
  input: FidelityVerificationAcceptanceDryRunInput,
): FidelityVerificationAcceptanceDryRun {
  const validation = validateTransition(input.currentState, 'accepted')
  if (!validation.valid) {
    return {
      from: input.currentState,
      to: 'accepted',
      verification: 'fidelity-verification',
      verificationReport: input.report.id,
      wouldTransition: false,
      mutationApplied: false,
      reason: validation.error ?? `${input.currentState} -> accepted is not authorized.`,
    }
  }

  if (input.report.overall !== 'pass' || input.verdict.verdict !== 'accepted') {
    return {
      from: input.currentState,
      to: 'accepted',
      verification: 'fidelity-verification',
      verificationReport: input.report.id,
      wouldTransition: false,
      mutationApplied: false,
      reason: 'Fidelity Verification report did not pass; produced -> accepted is blocked.',
    }
  }

  return {
    from: input.currentState,
    to: 'accepted',
    verification: 'fidelity-verification',
    verificationReport: input.report.id,
    wouldTransition: true,
    mutationApplied: false,
    reason: 'Fidelity Verification report passed and verdict accepted; produced -> accepted is authorized.',
  }
}

export function evaluateFidelityVerification(input: FidelityVerificationInput): FidelityVerificationResult {
  assertNonEmpty(input.functionId, 'functionId')
  assertNonEmpty(input.prdId, 'prdId')
  assertNonEmpty(input.executableSpecificationId, 'executableSpecificationId')
  assertNonEmpty(input.candidateId, 'candidateId')
  assertNonEmpty(input.packetId, 'packetId')
  assertNonEmpty(input.packetHash, 'packetHash')
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

  const report = FidelityVerificationReport.parse({
    id: reportId(input.functionId, input.timestamp),
    verification: "fidelity",
    function_id: input.functionId,
    timestamp: input.timestamp,
    overall,
    checks: {
      scenario_coverage: {
        status: scenarioCoveragePassed ? 'pass' : 'fail',
        details: [{ packetId: input.packetId, packetHash: input.packetHash }],
        branches_unexercised: branchesUnexercised,
      },
      invariant_exercise: {
        status: invariantExercisePassed ? 'pass' : 'fail',
        details: [{ packetId: input.packetId, packetHash: input.packetHash }],
        invariants_without_negative_tests: invariantsWithoutNegativeTests,
      },
      required_validation_pass_rate: {
        status: requiredValidationPassed ? 'pass' : 'fail',
        details: [{ packetId: input.packetId, packetHash: input.packetHash }],
        rate: requiredPassRate,
        failing_validations: failingValidations,
      },
    },
    remediation: remediationText,
    source_refs: unique([
      input.functionId,
      input.prdId,
      input.executableSpecificationId,
      input.candidateId,
      input.packetId,
      ...input.sourceRefs,
      ...invariantsWithoutNegativeTests,
      ...failingValidations,
    ]),
    explicitness: 'inferred',
    rationale: 'Fidelity Verification report produced from normalized simulation evidence.',
  })

  const scenarioCoverageScore = input.invariants.length === 0 ? 0 : invariantsWithPassingScenario.length / input.invariants.length
  const invariantExerciseRate = input.invariants.length === 0 ? 0 : invariantsWithNegativeScenario.length / input.invariants.length
  const verdict = FidelityVerificationVerdict.parse({
    verdict: overall === 'pass' ? 'accepted' : 'rejected',
    evidence_reviewed: [
      report.id,
      ...input.validationOutcomes.map(validation => validation.id),
    ],
    scenario_coverage_score: scenarioCoverageScore,
    invariant_exercise_rate: invariantExerciseRate,
    remediation_notes: remediationText === 'Fidelity Verification passed.' ? [] : remediationText.split('. ').filter(Boolean),
  })

  return { report, verdict }
}
