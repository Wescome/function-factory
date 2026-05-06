import type { SynthesisMaterializationAudit } from './synthesis-pr-draft'

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
  workGraphId?: unknown
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
  workGraphId: string
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

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MergeReadinessPackError(`${field} is required`)
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
  assertNonEmpty(audit.workGraphId, 'audit.workGraphId')
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
  if (raw.workGraphId !== audit.workGraphId) {
    throw new MergeReadinessPackError('prOutcomeSignal.raw.workGraphId must match audit.workGraphId')
  }
}

function sourceRefs(audit: SynthesisMaterializationAudit, prOutcomeSignalId: string): string[] {
  return [
    audit.signalId,
    audit.pressureId,
    audit.capabilityId,
    audit.proposalId,
    audit.workGraphId,
    prOutcomeSignalId,
  ]
}

function makePackId(workGraphId: string, pullNumber: number): string {
  return `MRP-${workGraphId.replace(/^WG-/, '')}-${pullNumber}`
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
    return 'Synthesis passed, Gate 1 passed, all atoms passed, files were materialized, local verification passed, and observed PR CI passed.'
  }

  const names = failed.map(item => item.name).join(', ')
  const ciSuffix = ciStatus === 'passed' ? '' : ` CI status is ${ciStatus}.`
  return `Blocked by ${names}.${ciSuffix}`
}

export function buildMergeReadinessPack(input: BuildMergeReadinessPackInput): MergeReadinessPack {
  const { audit, prOutcomeSignal } = input
  assertAuditLineage(audit)
  assertOutcomeSignal(prOutcomeSignal)
  assertLineageMatches(audit, prOutcomeSignal.raw)

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

  const criteria = [
    criterion('functional-completeness', audit.runtimeStatus === 'synthesis-passed' && audit.gate1Passed && audit.materializedFiles.length > 0, [
      `runtime:${audit.runtimeStatus}`,
      `gate1:${audit.gate1Passed ? 'pass' : 'fail'}`,
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
    id: makePackId(audit.workGraphId, raw.pr.number),
    type: 'merge_readiness_pack',
    proposalId: audit.proposalId,
    workGraphId: audit.workGraphId,
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
