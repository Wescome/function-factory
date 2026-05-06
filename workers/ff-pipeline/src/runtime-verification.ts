/**
 * Runtime verification records for deployed Stage 6 synthesis smoke results.
 *
 * This module materializes the code artifact produced by real-mode synthesis
 * for WG-MOTE4M1R-G7I0, with local repo style and explicit validation.
 */

export interface SynthesisLineage {
  atomId: string
  planId: string
  pipelineId: string
}

export type Gate1Verdict = 'pass' | 'fail' | 'pending'

export type AtomVerdict = 'success' | 'failure' | 'incomplete'

export interface SynthesisCompletionEvidence {
  targetFilesDeployed: string[]
  checksumsValid: boolean
  signaturesVerified: boolean
  timestamp: string
}

export interface SynthesisSmokeResult {
  lineage: SynthesisLineage
  gate1Verdict: Gate1Verdict
  atomVerdict: AtomVerdict
  evidence: SynthesisCompletionEvidence
}

export interface RuntimeVerificationRecord {
  id: string
  lineage: SynthesisLineage
  gate1Verdict: Gate1Verdict
  atomVerdict: AtomVerdict
  evidence: SynthesisCompletionEvidence
  recordedAt: string
  validationPassed: true
}

export class SynthesisValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SynthesisValidationError'
  }
}

const GATE_1_VERDICTS = new Set<Gate1Verdict>(['pass', 'fail', 'pending'])
const ATOM_VERDICTS = new Set<AtomVerdict>(['success', 'failure', 'incomplete'])

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    throw new SynthesisValidationError(message)
  }
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SynthesisValidationError(message)
  }
}

function assertIsoTimestamp(value: unknown, message: string): asserts value is string {
  assertNonEmptyString(value, message)
  const time = Date.parse(value)
  if (!Number.isFinite(time)) {
    throw new SynthesisValidationError(message)
  }
}

function generateRecordId(): string {
  return `rv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function validateSynthesisCompletionEvidence(
  evidence: unknown,
): asserts evidence is SynthesisCompletionEvidence {
  assertObject(evidence, 'Synthesis completion evidence is required')

  if (
    !Array.isArray(evidence.targetFilesDeployed)
    || evidence.targetFilesDeployed.length === 0
    || !evidence.targetFilesDeployed.every(path => typeof path === 'string' && path.trim().length > 0)
  ) {
    throw new SynthesisValidationError('At least one deployed target file is required')
  }

  if (evidence.checksumsValid !== true) {
    throw new SynthesisValidationError('Checksum validation must be explicitly true')
  }

  if (evidence.signaturesVerified !== true) {
    throw new SynthesisValidationError('Signature verification must be explicitly true')
  }

  assertIsoTimestamp(evidence.timestamp, 'Valid ISO timestamp is required in evidence')
}

export function recordSynthesisSmokeResult(result: unknown): RuntimeVerificationRecord {
  assertObject(result, 'Smoke result is required')

  validateSynthesisCompletionEvidence(result.evidence)

  assertObject(result.lineage, 'Complete lineage is required')
  assertNonEmptyString(result.lineage.atomId, 'lineage.atomId is required')
  assertNonEmptyString(result.lineage.planId, 'lineage.planId is required')
  assertNonEmptyString(result.lineage.pipelineId, 'lineage.pipelineId is required')

  if (!GATE_1_VERDICTS.has(result.gate1Verdict as Gate1Verdict)) {
    throw new SynthesisValidationError(`Invalid Gate 1 verdict: ${String(result.gate1Verdict)}`)
  }

  if (!ATOM_VERDICTS.has(result.atomVerdict as AtomVerdict)) {
    throw new SynthesisValidationError(`Invalid atom verdict: ${String(result.atomVerdict)}`)
  }

  return {
    id: generateRecordId(),
    lineage: {
      atomId: result.lineage.atomId,
      planId: result.lineage.planId,
      pipelineId: result.lineage.pipelineId,
    },
    gate1Verdict: result.gate1Verdict as Gate1Verdict,
    atomVerdict: result.atomVerdict as AtomVerdict,
    evidence: result.evidence,
    recordedAt: new Date().toISOString(),
    validationPassed: true,
  }
}

export default recordSynthesisSmokeResult
