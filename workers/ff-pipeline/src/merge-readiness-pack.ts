import type { ArangoClient } from '@factory/arango-client'
import {
  MergeReadinessPack as CanonicalMergeReadinessPackSchema,
  type MergeReadinessPack as CanonicalMergeReadinessPack,
} from '@factory/schemas'
import {
  auditCoherenceVerificationPassed,
  type SynthesisMaterializationAudit,
} from './synthesis-pr-draft'

export type ReadinessVerdict = 'ready' | 'blocked'
export type ReadinessCriterionName =
  | 'functional-completeness'
  | 'sound-verification'
  | 'se-hygiene'
  | 'rationale'
  | 'auditability'

export interface PROutcomeSignalRecord {
  _key: string
  signalType: string
  source: string
  subtype: string
  sourceRefs?: string[]
  createdAt?: string
  raw?: PROutcomeRaw
}

export interface PROutcomeRaw {
  pipelineId?: unknown
  proposalId?: unknown
  executableSpecificationId?: unknown
  pr?: {
    number?: unknown
    url?: unknown
    title?: unknown
    state?: unknown
    draft?: unknown
    merged?: unknown
    headRefName?: unknown
    baseRefName?: unknown
    headSha?: unknown
  }
  outcome?: {
    prState?: unknown
    ciState?: unknown
    reviewState?: unknown
  }
  checks?: {
    passed?: unknown
    failed?: unknown
    pending?: unknown
  }
  observedAt?: unknown
}

export interface MergeReadinessCriterion {
  name: ReadinessCriterionName
  passed: boolean
  evidence: string[]
}

export interface MergeReadinessPack {
  id: string
  type: 'merge_readiness_pack'
  proposalId: string
  functionId: string
  executableSpecificationId: string
  pipelineId: string
  sourceRefs: string[]
  materializedFiles: SynthesisMaterializationAudit['materializedFiles']
  atomResults: SynthesisMaterializationAudit['atomResults']
  localVerification: string[]
  prEvidence: {
    signalId: string
    number: number
    url: string
    title: string
    headSha: string
    branch: string
    baseBranch: string
    state: string
    draft: boolean
    merged: boolean
    observedAt: string
  }
  ciEvidence: {
    status: 'passed' | 'failed' | 'pending'
    checksPassed: string[]
    checksFailed: string[]
    checksPending: string[]
    commitSha: string
    verifiedAt: string
  }
  criteria: MergeReadinessCriterion[]
  readinessVerdict: ReadinessVerdict
  verdictRationale: string
  createdAt: string
}

export type PersistedMergeReadinessVerdict = 'merge-ready' | 'needs-revision'

export interface PersistedMergeReadinessPack extends MergeReadinessPack {
  _key: string
  verdict: PersistedMergeReadinessVerdict
}

export interface CanonicalMRPEvidence {
  functionId?: string
  functionalCompleteness?: {
    acceptanceCriteria?: Array<{
      criterion: string
      met: boolean
      evidence: string
    }>
  }
  soundVerification?: {
    testPlan?: string
    newTestCases?: Array<{
      name: string
      type: 'unit' | 'integration' | 'property'
      result: 'pass' | 'fail'
    }>
    fidelityVerificationReportId?: string
    coveragePercentage?: number
  }
  seHygiene?: {
    mentorRuleCompliance?: Array<{
      ruleId: string
      rule: string
      compliant: boolean
      evidence?: string
    }>
    lintReport?: {
      errors: number
      warnings: number
    }
    complexityDelta?: {
      before: number
      after: number
    }
  }
  rationale?: {
    approach?: string
    tradeoffsConsidered?: string
    prDescription?: string
    crpsResolved?: string[]
  }
  auditability?: {
    prdId?: string
    semanticReviewId?: string
    coherenceVerificationReportId?: string
    fidelityVerificationReportId?: string
    sessionTreeId?: string
    modelBindings?: Record<string, { provider: string; model: string }>
    mentorRulesApplied?: string[]
    totalTokenUsage?: number
    totalCost?: number
    executionDurationMs?: number
  }
  resolution?: string
}

export interface BuildMergeReadinessPackInput {
  audit: SynthesisMaterializationAudit
  prOutcomeSignal: PROutcomeSignalRecord
  createdAt?: string
}

export class MergeReadinessPackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MergeReadinessPackError'
  }
}

export class MissingCanonicalMRPEvidenceError extends MergeReadinessPackError {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`Missing canonical MRP evidence: ${missing.join(', ')}`)
    this.name = 'MissingCanonicalMRPEvidenceError'
    this.missing = missing
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MergeReadinessPackError(`${field} is required`)
  }
}

function assertNonEmptyStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MergeReadinessPackError(`${field} is required`)
  }
  for (const item of value) {
    assertNonEmpty(item, field)
  }
}

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new MergeReadinessPackError(`${field} is required`)
  }
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new MergeReadinessPackError(`${field} must be an array`)
  }
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (strings.length !== value.length) {
    throw new MergeReadinessPackError(`${field} must contain only strings`)
  }
  return strings
}

function assertAuditLineage(audit: SynthesisMaterializationAudit): void {
  assertNonEmpty(audit.pipelineId, 'audit.pipelineId')
  assertNonEmpty(audit.signalId, 'audit.signalId')
  assertNonEmpty(audit.pressureId, 'audit.pressureId')
  assertNonEmpty(audit.capabilityId, 'audit.capabilityId')
  assertNonEmpty(audit.proposalId, 'audit.proposalId')
  assertNonEmpty(audit.executableSpecificationId, 'audit.executableSpecificationId')
}

function assertOutcomeSignal(signal: PROutcomeSignalRecord): asserts signal is PROutcomeSignalRecord & { raw: PROutcomeRaw } {
  assertNonEmpty(signal._key, 'prOutcomeSignal._key')
  if (signal.signalType !== 'internal') {
    throw new MergeReadinessPackError('prOutcomeSignal.signalType must be internal')
  }
  if (signal.source !== 'factory:pr-outcome') {
    throw new MergeReadinessPackError('prOutcomeSignal.source must be factory:pr-outcome')
  }
  if (!signal.raw) {
    throw new MergeReadinessPackError('prOutcomeSignal.raw is required')
  }
}

function assertLineageMatches(audit: SynthesisMaterializationAudit, raw: PROutcomeRaw): void {
  if (raw.pipelineId !== audit.pipelineId) {
    throw new MergeReadinessPackError('prOutcomeSignal.raw.pipelineId must match audit.pipelineId')
  }
  if (raw.proposalId !== audit.proposalId) {
    throw new MergeReadinessPackError('prOutcomeSignal.raw.proposalId must match audit.proposalId')
  }
  if (raw.executableSpecificationId !== audit.executableSpecificationId) {
    throw new MergeReadinessPackError('prOutcomeSignal.raw.executableSpecificationId must match audit.executableSpecificationId')
  }
}

function sourceRefs(audit: SynthesisMaterializationAudit, prOutcomeSignalId: string): string[] {
  return [
    audit.signalId,
    audit.pressureId,
    audit.capabilityId,
    audit.proposalId,
    audit.executableSpecificationId,
    prOutcomeSignalId,
  ]
}

function makePackId(executableSpecificationId: string, pullNumber: number): string {
  return `MRP-${executableSpecificationId.replace(/^WG-/, '')}-${pullNumber}`
}

function criterion(
  name: ReadinessCriterionName,
  passed: boolean,
  evidence: string[],
): MergeReadinessCriterion {
  return { name, passed, evidence }
}

function hasPassedLocalVerification(audit: SynthesisMaterializationAudit): boolean {
  return audit.localVerification.some(item => /\btypecheck\b/i.test(item) && /\bpass(?:ed)?\b/i.test(item))
    && audit.localVerification.some(item => /\btest\b/i.test(item) && /\bpass(?:ed)?\b/i.test(item))
}

function verdictRationale(criteria: MergeReadinessCriterion[], ciStatus: string): string {
  const failed = criteria.filter(item => !item.passed)
  if (failed.length === 0) {
    return 'Synthesis passed, Coherence Verification passed, all atoms passed, files were materialized, local verification passed, and observed PR CI passed.'
  }

  const names = failed.map(item => item.name).join(', ')
  const ciSuffix = ciStatus === 'passed' ? '' : ` CI status is ${ciStatus}.`
  return `Blocked by ${names}.${ciSuffix}`
}

function persistedVerdict(verdict: ReadinessVerdict): PersistedMergeReadinessVerdict {
  if (verdict === 'ready') return 'merge-ready'
  if (verdict === 'blocked') return 'needs-revision'
  throw new MergeReadinessPackError('readinessVerdict must be ready or blocked')
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

function deriveFunctionIdFromProposalId(proposalId: string): string | null {
  return proposalId.startsWith('FP-') && proposalId.length > 3
    ? `FN-${proposalId.slice(3)}`
    : null
}

function requireFunctionIdFromProposalId(proposalId: string, field: string): string {
  const functionId = deriveFunctionIdFromProposalId(proposalId)
  if (!functionId) {
    throw new MergeReadinessPackError(`${field} must start with FP- for Merge Readiness functionId derivation`)
  }
  return functionId
}

function requiredCanonicalFields(pack: MergeReadinessPack, evidence: CanonicalMRPEvidence): string[] {
  const missing: string[] = []

  if (!isNonEmptyString(evidence.functionId) && !deriveFunctionIdFromProposalId(pack.proposalId)) {
    missing.push('functionId')
  }
  if (!isNonEmptyArray(evidence.functionalCompleteness?.acceptanceCriteria)) {
    missing.push('functionalCompleteness.acceptanceCriteria')
  }
  if (!isNonEmptyString(evidence.soundVerification?.testPlan)) missing.push('soundVerification.testPlan')
  if (!isNonEmptyArray(evidence.soundVerification?.newTestCases)) missing.push('soundVerification.newTestCases')
  if (!isNonEmptyString(fidelityVerificationReportId(evidence.soundVerification))) {
    missing.push('soundVerification.fidelityVerificationReportId')
  }
  if (!isNonEmptyArray(evidence.seHygiene?.mentorRuleCompliance)) missing.push('seHygiene.mentorRuleCompliance')
  if (!isNonEmptyString(evidence.rationale?.approach)) missing.push('rationale.approach')
  if (!isNonEmptyString(evidence.rationale?.tradeoffsConsidered)) missing.push('rationale.tradeoffsConsidered')
  if (!isNonEmptyString(evidence.rationale?.prDescription)) missing.push('rationale.prDescription')
  if (!isNonEmptyString(evidence.auditability?.prdId)) missing.push('auditability.prdId')
  if (!isNonEmptyString(evidence.auditability?.semanticReviewId)) missing.push('auditability.semanticReviewId')
  if (!isNonEmptyString(coherenceVerificationReportId(evidence.auditability))) {
    missing.push('auditability.coherenceVerificationReportId')
  }
  if (!isNonEmptyString(fidelityVerificationReportId(evidence.auditability))) {
    missing.push('auditability.fidelityVerificationReportId')
  }
  if (!evidence.auditability?.modelBindings || Object.keys(evidence.auditability.modelBindings).length === 0) {
    missing.push('auditability.modelBindings')
  }
  if (typeof evidence.auditability?.totalTokenUsage !== 'number') missing.push('auditability.totalTokenUsage')
  if (typeof evidence.auditability?.totalCost !== 'number') missing.push('auditability.totalCost')
  if (typeof evidence.auditability?.executionDurationMs !== 'number') missing.push('auditability.executionDurationMs')

  return missing
}

function canonicalVerdict(pack: MergeReadinessPack): CanonicalMergeReadinessPack['verdict'] {
  return pack.readinessVerdict === 'ready' ? 'merge-ready' : 'needs-revision'
}

function canonicalFunctionId(pack: MergeReadinessPack, evidence: CanonicalMRPEvidence): string {
  const derived = requireFunctionIdFromProposalId(pack.proposalId, 'pack.proposalId')
  if (isNonEmptyString(evidence.functionId) && evidence.functionId !== derived) {
    throw new MergeReadinessPackError('evidence.functionId must match the Merge Readiness functionId derived from pack.proposalId')
  }
  return derived
}

export function withFidelityVerificationReportEvidence(
  evidence: CanonicalMRPEvidence,
  fidelityVerificationReportId: string,
): CanonicalMRPEvidence {
  assertNonEmpty(fidelityVerificationReportId, 'fidelityVerificationReportId')
  return {
    ...evidence,
    soundVerification: {
      ...evidence.soundVerification,
      fidelityVerificationReportId,
    },
    auditability: {
      ...evidence.auditability,
      fidelityVerificationReportId,
    },
  }
}

function fidelityVerificationReportId(
  evidence: { fidelityVerificationReportId?: string } | undefined,
): string | undefined {
  return evidence?.fidelityVerificationReportId
}

function coherenceVerificationReportId(
  evidence: { coherenceVerificationReportId?: string } | undefined,
): string | undefined {
  return evidence?.coherenceVerificationReportId
}

function assertPackReadyForPersistence(pack: MergeReadinessPack): void {
  assertNonEmpty(pack.id, 'pack.id')
  if (!pack.id.startsWith('MRP-')) {
    throw new MergeReadinessPackError('pack.id must start with MRP-')
  }
  if (pack.type !== 'merge_readiness_pack') {
    throw new MergeReadinessPackError('pack.type must be merge_readiness_pack')
  }
  assertNonEmpty(pack.proposalId, 'pack.proposalId')
  assertNonEmpty(pack.functionId, 'pack.functionId')
  assertNonEmpty(pack.executableSpecificationId, 'pack.executableSpecificationId')
  assertNonEmpty(pack.pipelineId, 'pack.pipelineId')
  assertNonEmpty(pack.createdAt, 'pack.createdAt')
  assertNonEmpty(pack.verdictRationale, 'pack.verdictRationale')
  assertNonEmptyStringArray(pack.sourceRefs, 'pack.sourceRefs')
  if (!Array.isArray(pack.criteria) || pack.criteria.length === 0) {
    throw new MergeReadinessPackError('pack.criteria is required')
  }
  persistedVerdict(pack.readinessVerdict)
}

function existingHeadSha(existing: Record<string, unknown>): string | null {
  const prEvidence = existing.prEvidence
  if (typeof prEvidence !== 'object' || prEvidence === null) return null
  const headSha = (prEvidence as { headSha?: unknown }).headSha
  return typeof headSha === 'string' && headSha.length > 0 ? headSha : null
}

export function buildMergeReadinessPack(input: BuildMergeReadinessPackInput): MergeReadinessPack {
  const { audit, prOutcomeSignal } = input
  assertAuditLineage(audit)
  assertOutcomeSignal(prOutcomeSignal)
  assertLineageMatches(audit, prOutcomeSignal.raw)
  const functionId = requireFunctionIdFromProposalId(audit.proposalId, 'audit.proposalId')

  const raw = prOutcomeSignal.raw
  assertPositiveInteger(raw.pr?.number, 'prOutcomeSignal.raw.pr.number')
  assertNonEmpty(raw.pr?.url, 'prOutcomeSignal.raw.pr.url')
  assertNonEmpty(raw.pr?.title, 'prOutcomeSignal.raw.pr.title')
  assertNonEmpty(raw.pr?.headSha, 'prOutcomeSignal.raw.pr.headSha')
  assertNonEmpty(raw.pr?.headRefName, 'prOutcomeSignal.raw.pr.headRefName')
  assertNonEmpty(raw.pr?.baseRefName, 'prOutcomeSignal.raw.pr.baseRefName')
  assertNonEmpty(raw.pr?.state, 'prOutcomeSignal.raw.pr.state')
  assertNonEmpty(raw.outcome?.ciState, 'prOutcomeSignal.raw.outcome.ciState')
  assertNonEmpty(raw.outcome?.prState, 'prOutcomeSignal.raw.outcome.prState')
  assertNonEmpty(raw.outcome?.reviewState, 'prOutcomeSignal.raw.outcome.reviewState')
  assertNonEmpty(raw.observedAt, 'prOutcomeSignal.raw.observedAt')

  const checksPassed = asStringArray(raw.checks?.passed ?? [], 'prOutcomeSignal.raw.checks.passed')
  const checksFailed = asStringArray(raw.checks?.failed ?? [], 'prOutcomeSignal.raw.checks.failed')
  const checksPending = asStringArray(raw.checks?.pending ?? [], 'prOutcomeSignal.raw.checks.pending')
  const ciStatus = raw.outcome.ciState === 'passed'
    ? 'passed'
    : raw.outcome.ciState === 'failed'
      ? 'failed'
      : 'pending'
  const coherencePassed = auditCoherenceVerificationPassed(audit)

  const criteria = [
    criterion('functional-completeness', audit.runtimeStatus === 'synthesis-passed' && coherencePassed && audit.materializedFiles.length > 0, [
      `runtime:${audit.runtimeStatus}`,
      `coherenceVerification:${coherencePassed ? 'pass' : 'fail'}`,
      `files:${audit.materializedFiles.length}`,
    ]),
    criterion('sound-verification', audit.atomResults.every(atom => atom.decision === 'pass') && hasPassedLocalVerification(audit) && ciStatus === 'passed', [
      ...audit.atomResults.map(atom => `${atom.atomId}:${atom.decision}:${atom.tests}`),
      ...audit.localVerification,
      `ci:${ciStatus}`,
    ]),
    criterion('se-hygiene', ciStatus === 'passed' && checksFailed.length === 0 && checksPending.length === 0, [
      `checks-passed:${checksPassed.join(', ')}`,
      `checks-failed:${checksFailed.join(', ')}`,
      `checks-pending:${checksPending.join(', ')}`,
    ]),
    criterion('rationale', typeof audit.notes === 'string' && audit.notes.trim().length > 0, [
      audit.notes ?? '',
    ]),
    criterion('auditability', sourceRefs(audit, prOutcomeSignal._key).every(ref => ref.length > 0), [
      ...sourceRefs(audit, prOutcomeSignal._key),
      `pr:${raw.pr.url}`,
      `head:${raw.pr.headSha}`,
    ]),
  ]

  const readinessVerdict: ReadinessVerdict = criteria.every(item => item.passed) ? 'ready' : 'blocked'

  return {
    id: makePackId(audit.executableSpecificationId, raw.pr.number),
    type: 'merge_readiness_pack',
    proposalId: audit.proposalId,
    functionId,
    executableSpecificationId: audit.executableSpecificationId,
    pipelineId: audit.pipelineId,
    sourceRefs: sourceRefs(audit, prOutcomeSignal._key),
    materializedFiles: audit.materializedFiles,
    atomResults: audit.atomResults,
    localVerification: audit.localVerification,
    prEvidence: {
      signalId: prOutcomeSignal._key,
      number: raw.pr.number,
      url: raw.pr.url,
      title: raw.pr.title,
      headSha: raw.pr.headSha,
      branch: raw.pr.headRefName,
      baseBranch: raw.pr.baseRefName,
      state: raw.pr.state,
      draft: raw.pr.draft === true,
      merged: raw.pr.merged === true,
      observedAt: raw.observedAt,
    },
    ciEvidence: {
      status: ciStatus,
      checksPassed,
      checksFailed,
      checksPending,
      commitSha: raw.pr.headSha,
      verifiedAt: raw.observedAt,
    },
    criteria,
    readinessVerdict,
    verdictRationale: verdictRationale(criteria, ciStatus),
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export function toCanonicalMergeReadinessPack(
  pack: MergeReadinessPack,
  evidence: CanonicalMRPEvidence = {},
): CanonicalMergeReadinessPack {
  const missing = requiredCanonicalFields(pack, evidence)
  if (missing.length > 0) {
    throw new MissingCanonicalMRPEvidenceError(missing)
  }
  const functionId = canonicalFunctionId(pack, evidence)
  const soundVerificationReportId = fidelityVerificationReportId(evidence.soundVerification)
  const auditabilityVerificationReportId = fidelityVerificationReportId(evidence.auditability)
  const auditabilityCoherenceReportId = coherenceVerificationReportId(evidence.auditability)

  const canonical = {
    _key: pack.id,
    id: pack.id,
    functionId,
    executableSpecificationId: pack.executableSpecificationId,
    pipelineInstanceId: pack.pipelineId,
    functionalCompleteness: {
      passed: pack.criteria.find(item => item.name === 'functional-completeness')?.passed ?? false,
      acceptanceCriteria: evidence.functionalCompleteness?.acceptanceCriteria,
    },
    soundVerification: {
      passed: pack.criteria.find(item => item.name === 'sound-verification')?.passed ?? false,
      testPlan: evidence.soundVerification?.testPlan,
      newTestCases: evidence.soundVerification?.newTestCases,
      fidelityVerificationReportId: soundVerificationReportId,
      ...(typeof evidence.soundVerification?.coveragePercentage === 'number'
        ? { coveragePercentage: evidence.soundVerification.coveragePercentage }
        : {}),
    },
    seHygiene: {
      passed: pack.criteria.find(item => item.name === 'se-hygiene')?.passed ?? false,
      mentorRuleCompliance: evidence.seHygiene?.mentorRuleCompliance,
      ...(evidence.seHygiene?.lintReport ? { lintReport: evidence.seHygiene.lintReport } : {}),
      ...(evidence.seHygiene?.complexityDelta ? { complexityDelta: evidence.seHygiene.complexityDelta } : {}),
    },
    rationale: {
      approach: evidence.rationale?.approach,
      tradeoffsConsidered: evidence.rationale?.tradeoffsConsidered,
      prDescription: evidence.rationale?.prDescription,
      crpsResolved: evidence.rationale?.crpsResolved ?? [],
    },
    auditability: {
      prdId: evidence.auditability?.prdId,
      executableSpecificationId: pack.executableSpecificationId,
      semanticReviewId: evidence.auditability?.semanticReviewId,
      coherenceVerificationReportId: auditabilityCoherenceReportId,
      fidelityVerificationReportId: auditabilityVerificationReportId,
      ...(evidence.auditability?.sessionTreeId ? { sessionTreeId: evidence.auditability.sessionTreeId } : {}),
      modelBindings: evidence.auditability?.modelBindings,
      mentorRulesApplied: evidence.auditability?.mentorRulesApplied ?? [],
      totalTokenUsage: evidence.auditability?.totalTokenUsage,
      totalCost: evidence.auditability?.totalCost,
      executionDurationMs: evidence.auditability?.executionDurationMs,
    },
    ciEvidence: {
      status: pack.ciEvidence.status,
      checksPassed: pack.ciEvidence.checksPassed,
      checksFailed: pack.ciEvidence.checksFailed.map(name => ({
        name,
        conclusion: 'failure',
        logUrl: pack.prEvidence.url,
      })),
      commitSha: pack.ciEvidence.commitSha,
      verifiedAt: pack.ciEvidence.verifiedAt,
    },
    verdict: canonicalVerdict(pack),
    verdictRationale: pack.verdictRationale,
    ...(evidence.resolution ? { resolution: evidence.resolution } : {}),
    createdAt: pack.createdAt,
  }

  const parsed = CanonicalMergeReadinessPackSchema.safeParse(canonical)
  if (!parsed.success) {
    throw new MergeReadinessPackError(`Canonical MRP schema validation failed: ${parsed.error.message}`)
  }
  return parsed.data
}

export async function ingestMergeReadinessPack(
  pack: MergeReadinessPack,
  db: ArangoClient,
): Promise<Record<string, unknown>> {
  assertPackReadyForPersistence(pack)

  const existing = await db.queryOne<Record<string, unknown>>(
    `FOR mrp IN merge_readiness_packs
       FILTER mrp.id == @id
       LIMIT 1
       RETURN mrp`,
    { id: pack.id },
  )

  const persisted: PersistedMergeReadinessPack = {
    ...pack,
    _key: pack.id,
    verdict: persistedVerdict(pack.readinessVerdict),
  }

  if (existing) {
    if (existingHeadSha(existing) === pack.prEvidence.headSha) {
      return existing
    }

    const patch = {
      ...persisted,
      refreshedAt: pack.createdAt,
    }
    await db.update('merge_readiness_packs', pack.id, patch as unknown as Record<string, unknown>)
    return patch as unknown as Record<string, unknown>
  }

  await db.save('merge_readiness_packs', persisted as unknown as Record<string, unknown>)
  return persisted as unknown as Record<string, unknown>
}
