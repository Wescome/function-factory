import { describe, expect, it } from 'vitest'
import {
  SynthesisValidationError,
  recordSynthesisSmokeResult,
  validateSynthesisCompletionEvidence,
  type SynthesisSmokeResult,
} from './runtime-verification'

function makeResult(overrides: Partial<SynthesisSmokeResult> = {}): SynthesisSmokeResult {
  return {
    lineage: {
      atomId: 'atom-001',
      planId: 'ES-MOTE4M1R-G7I0',
      pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
    },
    coherenceVerificationVerdict: 'pass',
    atomVerdict: 'success',
    evidence: {
      targetFilesDeployed: ['workers/ff-pipeline/src/runtime-verification.ts'],
      checksumsValid: true,
      signaturesVerified: true,
      timestamp: '2026-05-06T01:44:17.000Z',
    },
    ...overrides,
  }
}

describe('runtime verification synthesis smoke records', () => {
  it('records a validated synthesis smoke result', () => {
    const result = makeResult()

    const record = recordSynthesisSmokeResult(result)

    expect(record).toMatchObject({
      lineage: result.lineage,
      coherenceVerificationVerdict: 'pass',
      atomVerdict: 'success',
      evidence: result.evidence,
      validationPassed: true,
    })
    expect(record.id).toMatch(/^rv-\d+-[a-z0-9]+$/)
    expect(Date.parse(record.recordedAt)).not.toBeNaN()
  })

  it('exports evidence validation separately', () => {
    expect(() => validateSynthesisCompletionEvidence(makeResult().evidence)).not.toThrow()
  })

  it('requires a smoke result object', () => {
    expect(() => recordSynthesisSmokeResult(null)).toThrow(SynthesisValidationError)
  })

  it('requires completion evidence', () => {
    const result = makeResult()
    expect(() => recordSynthesisSmokeResult({ ...result, evidence: null })).toThrow(
      /evidence is required/i,
    )
  })

  it('requires at least one deployed target file', () => {
    const result = makeResult({
      evidence: { ...makeResult().evidence, targetFilesDeployed: [] },
    })
    expect(() => recordSynthesisSmokeResult(result)).toThrow(/deployed target file/i)
  })

  it('rejects blank deployed target file paths', () => {
    const result = makeResult({
      evidence: { ...makeResult().evidence, targetFilesDeployed: [''] },
    })
    expect(() => recordSynthesisSmokeResult(result)).toThrow(/deployed target file/i)
  })

  it('requires checksum validation to be explicitly true', () => {
    const result = makeResult({
      evidence: { ...makeResult().evidence, checksumsValid: false },
    })
    expect(() => recordSynthesisSmokeResult(result)).toThrow(/checksum/i)
  })

  it('requires signature verification to be explicitly true', () => {
    const result = makeResult({
      evidence: { ...makeResult().evidence, signaturesVerified: false },
    })
    expect(() => recordSynthesisSmokeResult(result)).toThrow(/signature/i)
  })

  it('requires a parseable evidence timestamp', () => {
    const result = makeResult({
      evidence: { ...makeResult().evidence, timestamp: 'not-a-date' },
    })
    expect(() => recordSynthesisSmokeResult(result)).toThrow(/timestamp/i)
  })

  it('requires lineage', () => {
    const result = makeResult()
    expect(() => recordSynthesisSmokeResult({ ...result, lineage: null })).toThrow(/lineage/i)
  })

  it('requires lineage atomId', () => {
    const result = makeResult({
      lineage: { ...makeResult().lineage, atomId: '' },
    })
    expect(() => recordSynthesisSmokeResult(result)).toThrow(/atomId/i)
  })

  it('requires lineage planId', () => {
    const result = makeResult({
      lineage: { ...makeResult().lineage, planId: '' },
    })
    expect(() => recordSynthesisSmokeResult(result)).toThrow(/planId/i)
  })

  it('requires lineage pipelineId', () => {
    const result = makeResult({
      lineage: { ...makeResult().lineage, pipelineId: '' },
    })
    expect(() => recordSynthesisSmokeResult(result)).toThrow(/pipelineId/i)
  })

  it('rejects invalid verdict enums', () => {
    const result = makeResult()
    expect(() => recordSynthesisSmokeResult({ ...result, coherenceVerificationVerdict: 'maybe' })).toThrow(
      /Coherence Verification verdict/i,
    )
    expect(() => recordSynthesisSmokeResult({ ...result, atomVerdict: 'maybe' })).toThrow(
      /atom verdict/i,
    )
  })

})
