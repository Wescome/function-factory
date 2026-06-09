import { describe, expect, it } from 'vitest'
import { normalizePiContainerExecuteInput } from './pi-container-execute.js'

describe('normalizePiContainerExecuteInput', () => {
  // AC-PI1: an AC-RQ1 execution request envelope (snake_case) is translated to
  // WorkerInput with the field renames applied.
  it('translates the AC-RQ1 envelope to WorkerInput', () => {
    const out = normalizePiContainerExecuteInput({
      step_name: 'GeneratePatch',
      role_name: 'Coder',
      session_id: 'run-1',
      purpose: 'Produce CandidatePatch from SeedWorkspace.',
      inputs: { SeedWorkspace: 'tarball-ref' },
      declared_outputs: ['Patch'],
      verifier_contract: { declared_output_match: [{ artifact: 'Patch', kind: 'text' }] },
      runtime_config: { model_route: 'openrouter/moonshotai/kimi-k2', max_repair_rounds: 1, execution_surface: 'rpc' },
      context_refs: { fn_id: 'FN-1', is_id: 'IS-1' },
    })
    expect(out).not.toBeNull()
    expect(out?.stageName).toBe('GeneratePatch')
    expect(out?.roleName).toBe('Coder')
    expect(out?.runId).toBe('run-1')
    expect(out?.context.inputArtifacts.SeedWorkspace).toBe('tarball-ref')
    expect(out?.context.taskText).toBe('Produce CandidatePatch from SeedWorkspace.')
    expect(out?.declaredOutputs).toEqual(['Patch'])
    expect(out?.outputContracts).toEqual([{ artifact: 'Patch', kind: 'text' }])
    expect(out?.model).toEqual({ id: 'openrouter/moonshotai/kimi-k2' })
    expect(out?.maxRepairRounds).toBe(1)
    expect(out?.executionSurface).toBe('rpc')
  })

  it('forces autonomous_filesystem authoring mode when policy filesystem_scope includes /workspace', () => {
    const out = normalizePiContainerExecuteInput({
      step_name: 'GeneratePatch',
      session_id: 'run-1',
      policy: {
        filesystem_scope: ['/workspace'],
      },
    })

    expect(out?.execution).toEqual({ authoringMode: 'autonomous_filesystem' })
  })

  // A WorkerInput (camelCase) passes through unchanged.
  it('passes a WorkerInput through unchanged', () => {
    const input = {
      stageName: 'GeneratePatch',
      roleName: 'Coder',
      runId: 'run-1',
      context: { inputArtifacts: {} },
      declaredOutputs: ['Patch'],
    }
    const out = normalizePiContainerExecuteInput(input)
    expect(out).toBe(input)
  })

  // Fail closed: missing step/stage name.
  it('returns null when the stage name is missing', () => {
    expect(normalizePiContainerExecuteInput({ session_id: 'run-1' })).toBeNull()
  })

  // Fail closed: missing session/run id.
  it('returns null when the run id is missing', () => {
    expect(normalizePiContainerExecuteInput({ step_name: 'GeneratePatch' })).toBeNull()
  })

  // roleName defaults to 'Agent' when neither role field is present.
  it('defaults roleName to Agent', () => {
    const out = normalizePiContainerExecuteInput({ step_name: 'S', session_id: 'r' })
    expect(out?.roleName).toBe('Agent')
  })
})
