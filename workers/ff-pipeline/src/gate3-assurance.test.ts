import { describe, expect, it } from 'vitest'
import { Gate3Report } from '@factory/schemas'
import {
  PersistenceVerificationError,
  evaluateGate3AssuranceRegistration,
  evaluatePersistenceVerificationRegistration,
  type Gate3AssuranceRegistrationInput,
} from './gate3-assurance'

function makeInput(overrides: Partial<Gate3AssuranceRegistrationInput> = {}): Gate3AssuranceRegistrationInput {
  return {
    functionId: 'FN-MOTDWVR2-W7UN',
    timestamp: '2026-05-07T22:00:00.000Z',
    sourceRefs: [
      'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      'MRP-MOTE4M1R-G7I0-71',
    ],
    detectors: [
      {
        invariantId: 'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
        detector: 'runtime-verification-smoke',
        lastReport: null,
        threshold: 'PT5M',
        stale: true,
      },
    ],
    evidenceSources: [
      {
        source: 'factory:runtime-verification',
        lastEmission: null,
        expectedCadence: 'on every monitored execution',
        quiet: true,
      },
    ],
    auditPipeline: {
      expected: 1,
      observed: 0,
    },
    ...overrides,
  }
}

describe('Gate 3 assurance registration', () => {
  it('exposes Persistence Verification aliases for new code', () => {
    expect(PersistenceVerificationError.name).toBe('Gate3AssuranceError')
    expect(evaluatePersistenceVerificationRegistration).toBe(evaluateGate3AssuranceRegistration)
  })

  it('emits a failing Gate3Report for incomplete assurance registration', () => {
    const report = evaluateGate3AssuranceRegistration(makeInput())

    expect(report).toMatchObject({
      id: 'CR-FN-MOTDWVR2-W7UN-GATE3-2026-05-07T22-00-00-000Z',
      gate: 3,
      function_id: 'FN-MOTDWVR2-W7UN',
      overall: 'fail',
      checks: {
        detector_freshness: {
          status: 'fail',
          stale_detectors: [
            {
              invariant_id: 'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
              detector: 'runtime-verification-smoke',
              last_report: null,
              threshold: 'PT5M',
            },
          ],
        },
        evidence_source_liveness: {
          status: 'fail',
          quiet_sources: [
            {
              source: 'factory:runtime-verification',
              last_emission: null,
              expected_cadence: 'on every monitored execution',
            },
          ],
        },
        audit_pipeline_integrity: {
          status: 'fail',
          expected_vs_observed: {
            expected: 1,
            observed: 0,
            divergence_pct: 1,
          },
        },
      },
    })
    expect(report.source_refs).toEqual(expect.arrayContaining([
      'FN-MOTDWVR2-W7UN',
      'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-33-20-000Z',
      'MRP-MOTE4M1R-G7I0-71',
      'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
    ]))
    expect(Gate3Report.safeParse(report).success).toBe(true)
  })
})
