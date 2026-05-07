import { describe, expect, it } from 'vitest'
import { Gate2Report, Gate2Verdict } from '@factory/schemas'
import {
  Gate2SimulationError,
  adaptGate2Input,
  dryRunGate2AcceptanceTransition,
  evaluateGate2FromContractInput,
  evaluateGate2Simulation,
  type Gate2ContractInput,
  type Gate2SimulationInput,
} from './gate2-simulation'

function makeInput(overrides: Partial<Gate2SimulationInput> = {}): Gate2SimulationInput {
  return {
    functionId: 'FN-MOTDWVR2-W7UN',
    prdId: 'PRD-META-FUNCTION-SYNTHESIS',
    workGraphId: 'WG-META-FUNCTION-SYNTHESIS',
    candidateId: 'AC-META-ARCHITECTURE-CANDIDATE-EXECUTION',
    timestamp: '2026-05-07T21:30:00.000Z',
    sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
    branches: [
      { workgraphNode: 'atom-001', edge: 'success' },
    ],
    invariants: [
      {
        id: 'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
        workgraphNode: 'atom-001',
      },
    ],
    scenarios: [
      {
        id: 'SCN-RUNTIME-VERIFICATION-PASS',
        kind: 'positive',
        passed: true,
        coversBranches: [{ workgraphNode: 'atom-001', edge: 'success' }],
        coversInvariants: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
      },
      {
        id: 'SCN-RUNTIME-VERIFICATION-NEGATIVE',
        kind: 'negative',
        passed: true,
        coversBranches: [],
        coversInvariants: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
      },
    ],
    validationOutcomes: [
      {
        id: 'VAL-META-RUNTIME-VERIFICATION-SMOKE',
        priority: 'required',
        status: 'pass',
        invariantIds: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
      },
    ],
    ...overrides,
  }
}

function makeContractInput(overrides: Partial<Gate2ContractInput> = {}): Gate2ContractInput {
  return {
    synthesisRunId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
    functionId: 'FN-MOTDWVR2-W7UN',
    workGraphId: 'WG-META-FUNCTION-SYNTHESIS',
    architectureCandidateId: 'AC-META-ARCHITECTURE-CANDIDATE-EXECUTION',
    artifactPaths: ['workers/ff-pipeline/src/runtime-verification.ts'],
    validationOutcomes: [
      {
        validationId: 'VAL-META-RUNTIME-VERIFICATION-SMOKE',
        passed: true,
        summary: 'Runtime verification smoke scenario passed',
        details: {
          priority: 'required',
          invariantIds: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
          branches: [
            { workgraphNode: 'atom-001', edge: 'success' },
          ],
          invariants: [
            {
              id: 'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
              workgraphNode: 'atom-001',
            },
          ],
          scenarios: [
            {
              id: 'SCN-RUNTIME-VERIFICATION-PASS',
              kind: 'positive',
              passed: true,
              coversBranches: [{ workgraphNode: 'atom-001', edge: 'success' }],
              coversInvariants: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
            },
            {
              id: 'SCN-RUNTIME-VERIFICATION-NEGATIVE',
              kind: 'negative',
              passed: true,
              coversBranches: [],
              coversInvariants: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
            },
          ],
        },
      },
    ],
    compileSummary: 'pass',
    testSummary: 'pass',
    scopeViolation: false,
    constraintViolation: false,
    repairLoopCount: 0,
    resampleSummary: 'none',
    provenance: {
      bindingModeName: 'factory-runtime',
      promptPackVersion: 'observed',
      toolPolicyHash: 'observed',
      modelBindingHash: 'observed',
      startedAt: '2026-05-07T21:33:00.000Z',
      completedAt: '2026-05-07T21:33:20.000Z',
    },
    ...overrides,
  }
}

describe('Gate 2 simulation evaluator', () => {
  it('adapts normalized Gate2Input evidence into simulation input', () => {
    const adapted = adaptGate2Input(makeContractInput(), {
      prdId: 'PRD-META-FUNCTION-SYNTHESIS',
      sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
    })

    expect(adapted).toMatchObject({
      functionId: 'FN-MOTDWVR2-W7UN',
      prdId: 'PRD-META-FUNCTION-SYNTHESIS',
      workGraphId: 'WG-META-FUNCTION-SYNTHESIS',
      candidateId: 'AC-META-ARCHITECTURE-CANDIDATE-EXECUTION',
      timestamp: '2026-05-07T21:33:20.000Z',
      sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
      branches: [
        { workgraphNode: 'atom-001', edge: 'success' },
      ],
      invariants: [
        {
          id: 'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
          workgraphNode: 'atom-001',
        },
      ],
      scenarios: [
        {
          id: 'SCN-RUNTIME-VERIFICATION-PASS',
          kind: 'positive',
          passed: true,
        },
        {
          id: 'SCN-RUNTIME-VERIFICATION-NEGATIVE',
          kind: 'negative',
          passed: true,
        },
      ],
      validationOutcomes: [
        {
          id: 'VAL-META-RUNTIME-VERIFICATION-SMOKE',
          priority: 'required',
          status: 'pass',
          invariantIds: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
        },
      ],
    })

    const result = evaluateGate2FromContractInput(makeContractInput(), {
      prdId: 'PRD-META-FUNCTION-SYNTHESIS',
      sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
    })
    expect(result.report.overall).toBe('pass')
    expect(result.verdict.verdict).toBe('accepted')
  })

  it('fails closed when normalized Gate2Input coverage details are missing', () => {
    const contractInput = makeContractInput({
      validationOutcomes: [
        {
          validationId: 'VAL-META-RUNTIME-VERIFICATION-SMOKE',
          passed: true,
          summary: 'Runtime verification smoke scenario passed',
          details: {
            priority: 'required',
            invariantIds: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
            branches: [{ workgraphNode: 'atom-001', edge: 'success' }],
            invariants: [
              {
                id: 'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
                workgraphNode: 'atom-001',
              },
            ],
          },
        },
      ],
    })

    expect(() => adaptGate2Input(contractInput, {
      prdId: 'PRD-META-FUNCTION-SYNTHESIS',
      sourceRefs: ['MRP-MOTE4M1R-G7I0-71'],
    })).toThrow(new Gate2SimulationError('normalized Gate2Input validationOutcomes.details.scenarios is required'))
  })

  it('dry-runs the produced to accepted lifecycle transition from Gate 2 evidence', () => {
    const result = evaluateGate2Simulation(makeInput())

    expect(dryRunGate2AcceptanceTransition({
      currentState: 'produced',
      report: result.report,
      verdict: result.verdict,
    })).toEqual({
      from: 'produced',
      to: 'accepted',
      gate: 'gate-2',
      gateReport: result.report.id,
      wouldTransition: true,
      mutationApplied: false,
      reason: 'Gate 2 report passed and verdict accepted; produced -> accepted is authorized.',
    })
  })

  it('dry-run blocks accepted lifecycle transition when Gate 2 rejects', () => {
    const result = evaluateGate2Simulation(makeInput({
      validationOutcomes: [
        {
          id: 'VAL-META-RUNTIME-VERIFICATION-SMOKE',
          priority: 'required',
          status: 'fail',
          invariantIds: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
        },
      ],
    }))

    expect(dryRunGate2AcceptanceTransition({
      currentState: 'produced',
      report: result.report,
      verdict: result.verdict,
    })).toMatchObject({
      from: 'produced',
      to: 'accepted',
      gate: 'gate-2',
      gateReport: result.report.id,
      wouldTransition: false,
      mutationApplied: false,
      reason: 'Gate 2 report did not pass; produced -> accepted is blocked.',
    })
  })

  it('emits a passing Gate2Report and accepted verdict when coverage is complete', () => {
    const result = evaluateGate2Simulation(makeInput())

    expect(result.report).toMatchObject({
      id: 'CR-FN-MOTDWVR2-W7UN-GATE2-2026-05-07T21-30-00-000Z',
      gate: 2,
      function_id: 'FN-MOTDWVR2-W7UN',
      overall: 'pass',
      checks: {
        scenario_coverage: {
          status: 'pass',
          branches_unexercised: [],
        },
        invariant_exercise: {
          status: 'pass',
          invariants_without_negative_tests: [],
        },
        required_validation_pass_rate: {
          status: 'pass',
          rate: 1,
          failing_validations: [],
        },
      },
    })
    expect(result.verdict).toMatchObject({
      verdict: 'accepted',
      scenario_coverage_score: 1,
      invariant_exercise_rate: 1,
    })
    expect(Gate2Report.safeParse(result.report).success).toBe(true)
    expect(Gate2Verdict.safeParse(result.verdict).success).toBe(true)
  })

  it('fails closed when scenarios, negative tests, or required validations are missing', () => {
    const result = evaluateGate2Simulation(makeInput({
      scenarios: [
        {
          id: 'SCN-RUNTIME-VERIFICATION-PASS',
          kind: 'positive',
          passed: true,
          coversBranches: [],
          coversInvariants: [],
        },
      ],
      validationOutcomes: [
        {
          id: 'VAL-META-RUNTIME-VERIFICATION-SMOKE',
          priority: 'required',
          status: 'fail',
          invariantIds: ['INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE'],
        },
      ],
    }))

    expect(result.report).toMatchObject({
      overall: 'fail',
      checks: {
        scenario_coverage: {
          status: 'fail',
          branches_unexercised: [
            {
              workgraph_node: 'atom-001',
              edge: 'success',
              reason: 'no passing scenario exercises this branch',
            },
          ],
        },
        invariant_exercise: {
          status: 'fail',
          invariants_without_negative_tests: [
            'INV-META-RUNTIME-VERIFICATION-COVERS-SMOKE',
          ],
        },
        required_validation_pass_rate: {
          status: 'fail',
          rate: 0,
          failing_validations: [
            'VAL-META-RUNTIME-VERIFICATION-SMOKE',
          ],
        },
      },
    })
    expect(result.verdict).toMatchObject({
      verdict: 'rejected',
      scenario_coverage_score: 0,
      invariant_exercise_rate: 0,
    })
    expect(result.verdict.remediation_notes).toEqual(expect.arrayContaining([
      expect.stringContaining('Add passing scenarios'),
      expect.stringContaining('Add negative scenarios'),
      expect.stringContaining('Fix failing required validations'),
    ]))
    expect(Gate2Report.safeParse(result.report).success).toBe(true)
    expect(Gate2Verdict.safeParse(result.verdict).success).toBe(true)
  })
})
