/**
 * Runtime Verification Module for Function Factory Pipeline
 *
 * Records deployed synthesis smoke results with explicit validation
 * for synthesis completion evidence, lineage, Gate 1 verdict, and atom verdict.
 */

export interface SynthesisLineage {
  /** Unique identifier for the atom under verification */
  atomId: string;
  /** Unique identifier for the execution plan */
  planId: string;
  /** Unique identifier for the pipeline run */
  pipelineId: string;
}

export type Gate1Verdict = 'pass' | 'fail' | 'pending';

export type AtomVerdict = 'success' | 'failure' | 'incomplete';

/**
 * Explicit evidence required to prove synthesis completed successfully.
 */
export interface SynthesisCompletionEvidence {
  /** List of target files that were deployed */
  targetFilesDeployed: string[];
  /** Whether deployed artifact checksums match expected values */
  checksumsValid: boolean;
  /** Whether cryptographic signatures were verified */
  signaturesVerified: boolean;
  /** ISO timestamp when the evidence was generated */
  timestamp: string;
}

export interface SynthesisSmokeResult {
  lineage: SynthesisLineage;
  gate1Verdict: Gate1Verdict;
  atomVerdict: AtomVerdict;
  evidence: SynthesisCompletionEvidence;
}

export interface RuntimeVerificationRecord {
  id: string;
  lineage: SynthesisLineage;
  gate1Verdict: Gate1Verdict;
  atomVerdict: AtomVerdict;
  evidence: SynthesisCompletionEvidence;
  recordedAt: string;
  validationPassed: boolean;
}

export class SynthesisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SynthesisValidationError';
  }
}

function generateRecordId(): string {
  return `rv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Performs explicit validation of synthesis completion evidence.
 * Throws SynthesisValidationError if any required evidence is missing or invalid.
 */
export function validateSynthesisCompletionEvidence(
  evidence: SynthesisCompletionEvidence
): void {
  if (!evidence) {
    throw new SynthesisValidationError(
      'Synthesis completion evidence is required but was not provided'
    );
  }

  if (
    !Array.isArray(evidence.targetFilesDeployed) ||
    evidence.targetFilesDeployed.length === 0
  ) {
    throw new SynthesisValidationError(
      'At least one target file must be present in targetFilesDeployed'
    );
  }

  if (
    typeof evidence.checksumsValid !== 'boolean' ||
    evidence.checksumsValid !== true
  ) {
    throw new SynthesisValidationError(
      'Checksum validation must be explicitly true'
    );
  }

  if (
    typeof evidence.signaturesVerified !== 'boolean' ||
    evidence.signaturesVerified !== true
  ) {
    throw new SynthesisValidationError(
      'Signature verification must be explicitly true'
    );
  }

  if (!evidence.timestamp || isNaN(Date.parse(evidence.timestamp))) {
    throw new SynthesisValidationError(
      'Valid ISO timestamp is required in evidence'
    );
  }
}

/**
 * Records a deployed synthesis smoke result after validating all inputs
 * and explicit synthesis completion evidence.
 *
 * @param result - The smoke result to record
 * @returns A RuntimeVerificationRecord with the validated result
 * @throws SynthesisValidationError if validation fails
 */
export function recordSynthesisSmokeResult(
  result: SynthesisSmokeResult
): RuntimeVerificationRecord {
  if (!result) {
    throw new SynthesisValidationError('Smoke result is required');
  }

  // Explicit validation for synthesis completion evidence
  validateSynthesisCompletionEvidence(result.evidence);

  // Validate lineage completeness
  if (
    !result.lineage ||
    typeof result.lineage.atomId !== 'string' ||
    result.lineage.atomId.length === 0 ||
    typeof result.lineage.planId !== 'string' ||
    result.lineage.planId.length === 0 ||
    typeof result.lineage.pipelineId !== 'string' ||
    result.lineage.pipelineId.length === 0
  ) {
    throw new SynthesisValidationError(
      'Complete lineage (atomId, planId, pipelineId) is required'
    );
  }

  // Validate Gate 1 verdict
  const validGate1Verdicts: Gate1Verdict[] = ['pass', 'fail', 'pending'];
  if (!validGate1Verdicts.includes(result.gate1Verdict)) {
    throw new SynthesisValidationError(
      `Invalid Gate 1 verdict: ${String(result.gate1Verdict)}`
    );
  }

  // Validate atom verdict
  const validAtomVerdicts: AtomVerdict[] = ['success', 'failure', 'incomplete'];
  if (!validAtomVerdicts.includes(result.atomVerdict)) {
    throw new SynthesisValidationError(
      `Invalid atom verdict: ${String(result.atomVerdict)}`
    );
  }

  const recordedAt = new Date().toISOString();

  const record: RuntimeVerificationRecord = {
    id: generateRecordId(),
    lineage: result.lineage,
    gate1Verdict: result.gate1Verdict,
    atomVerdict: result.atomVerdict,
    evidence: result.evidence,
    recordedAt,
    validationPassed: true,
  };

  return record;
}

export default recordSynthesisSmokeResult;
