import {
  PersistenceVerificationReport,
  type PersistenceVerificationReport as PersistenceVerificationReportType,
} from '@factory/schemas'

export interface PersistenceVerificationDetectorRegistration {
  invariantId: string
  detector: string
  lastReport: string | null
  threshold: string
  stale: boolean
}

export interface PersistenceVerificationEvidenceSourceRegistration {
  source: string
  lastEmission: string | null
  expectedCadence: string
  quiet: boolean
}

export interface PersistenceVerificationRegistrationInput {
  functionId: string
  packetId: string
  packetHash: string
  timestamp: string
  sourceRefs: string[]
  detectors: PersistenceVerificationDetectorRegistration[]
  evidenceSources: PersistenceVerificationEvidenceSourceRegistration[]
  auditPipeline: {
    expected: number
    observed: number
  }
}

export class PersistenceVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceVerificationError'
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PersistenceVerificationError(`${field} is required`)
  }
}

function assertArray<T>(value: T[], field: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PersistenceVerificationError(`${field} is required`)
  }
}

function reportId(functionId: string, timestamp: string): string {
  return `VR-${functionId}-PERSISTENCE-${timestamp.replace(/[:.]/g, '-')}`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function divergencePct(expected: number, observed: number): number {
  if (expected === 0) return observed === 0 ? 0 : 100
  return Math.abs(expected - observed) / expected
}

export function evaluatePersistenceVerificationRegistration(input: PersistenceVerificationRegistrationInput): PersistenceVerificationReportType {
  assertNonEmpty(input.functionId, 'functionId')
  assertNonEmpty(input.packetId, 'packetId')
  assertNonEmpty(input.packetHash, 'packetHash')
  assertNonEmpty(input.timestamp, 'timestamp')
  assertArray(input.sourceRefs, 'sourceRefs')
  assertArray(input.detectors, 'detectors')
  assertArray(input.evidenceSources, 'evidenceSources')

  const staleDetectors = input.detectors
    .filter(detector => detector.stale)
    .map(detector => {
      assertNonEmpty(detector.invariantId, 'detectors.invariantId')
      assertNonEmpty(detector.detector, 'detectors.detector')
      assertNonEmpty(detector.threshold, 'detectors.threshold')
      return {
        invariant_id: detector.invariantId,
        detector: detector.detector,
        last_report: detector.lastReport,
        threshold: detector.threshold,
      }
    })

  const quietSources = input.evidenceSources
    .filter(source => source.quiet)
    .map(source => {
      assertNonEmpty(source.source, 'evidenceSources.source')
      assertNonEmpty(source.expectedCadence, 'evidenceSources.expectedCadence')
      return {
        source: source.source,
        last_emission: source.lastEmission,
        expected_cadence: source.expectedCadence,
      }
    })

  const expected = input.auditPipeline.expected
  const observed = input.auditPipeline.observed
  if (!Number.isInteger(expected) || expected < 0) {
    throw new PersistenceVerificationError('auditPipeline.expected must be a nonnegative integer')
  }
  if (!Number.isInteger(observed) || observed < 0) {
    throw new PersistenceVerificationError('auditPipeline.observed must be a nonnegative integer')
  }

  const divergence = divergencePct(expected, observed)
  const detectorFreshnessPassed = staleDetectors.length === 0
  const evidenceSourceLivenessPassed = quietSources.length === 0
  const auditPipelineIntegrityPassed = divergence === 0
  const overall = detectorFreshnessPassed && evidenceSourceLivenessPassed && auditPipelineIntegrityPassed ? 'pass' : 'fail'
  const remediation = overall === 'pass'
    ? 'Persistence Verification passed.'
    : 'Register active detectors, restore quiet evidence sources, and reconcile audit-pipeline event divergence before monitored promotion.'

  return PersistenceVerificationReport.parse({
    id: reportId(input.functionId, input.timestamp),
    verification: "persistence",
    function_id: input.functionId,
    timestamp: input.timestamp,
    overall,
    checks: {
      detector_freshness: {
        status: detectorFreshnessPassed ? 'pass' : 'fail',
        details: [{ packetId: input.packetId, packetHash: input.packetHash }],
        stale_detectors: staleDetectors,
      },
      evidence_source_liveness: {
        status: evidenceSourceLivenessPassed ? 'pass' : 'fail',
        details: [{ packetId: input.packetId, packetHash: input.packetHash }],
        quiet_sources: quietSources,
      },
      audit_pipeline_integrity: {
        status: auditPipelineIntegrityPassed ? 'pass' : 'fail',
        details: [{ packetId: input.packetId, packetHash: input.packetHash }],
        expected_vs_observed: {
          expected,
          observed,
          divergence_pct: divergence,
        },
      },
    },
    remediation,
    source_refs: unique([
      input.functionId,
      input.packetId,
      ...input.sourceRefs,
      ...staleDetectors.map(detector => detector.invariant_id),
    ]),
    explicitness: 'inferred',
    rationale: 'Persistence Verification report produced from normalized detector and evidence-source registration.',
  })
}
