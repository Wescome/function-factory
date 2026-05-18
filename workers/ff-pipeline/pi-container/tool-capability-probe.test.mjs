import { describe, expect, it } from 'vitest'
import {
  TOOL_PROBE_EXPECTED_CONTENT,
  assessToolCapabilityProbe,
  buildToolCapabilityProbePrompt,
  isToolExecutionEvent,
  requiresFilesystemAuthoring,
} from './tool-capability-probe.mjs'

describe('tool capability probe', () => {
  it('recognizes Pi RPC tool execution event names', () => {
    expect(isToolExecutionEvent({ type: 'tool_execution_start' })).toBe(true)
    expect(isToolExecutionEvent({ type: 'tool_execution_update' })).toBe(true)
    expect(isToolExecutionEvent({ type: 'tool_execution_end' })).toBe(true)
    expect(isToolExecutionEvent({ type: 'tool_call' })).toBe(false)
  })

  it('requires a probe only when declared output files are still missing', () => {
    expect(requiresFilesystemAuthoring({ missing: ['CandidatePatch'] }, ['CandidatePatch'])).toBe(true)
    expect(requiresFilesystemAuthoring({ missing: [] }, ['CandidatePatch'])).toBe(false)
    expect(requiresFilesystemAuthoring({ missing: ['CandidatePatch'] }, [])).toBe(false)
  })

  it('builds an explicit filesystem write probe prompt', () => {
    const prompt = buildToolCapabilityProbePrompt()

    expect(prompt).toContain('filesystem tool capability probe')
    expect(prompt).toContain('./.pi-tool-use-probe')
    expect(prompt).toContain(JSON.stringify(TOOL_PROBE_EXPECTED_CONTENT))
  })

  it('fails closed when no tool execution events were observed', () => {
    expect(assessToolCapabilityProbe({
      toolExecutionEventCount: 0,
      fileContent: TOOL_PROBE_EXPECTED_CONTENT,
    })).toEqual({
      passed: false,
      reason: 'no tool_execution_* events observed during filesystem probe',
    })
  })

  it('requires the expected probe file content', () => {
    expect(assessToolCapabilityProbe({
      toolExecutionEventCount: 2,
      fileContent: 'wrong\n',
    })).toMatchObject({
      passed: false,
      reason: expect.stringContaining('probe file content mismatch'),
    })

    expect(assessToolCapabilityProbe({
      toolExecutionEventCount: 2,
      fileContent: TOOL_PROBE_EXPECTED_CONTENT,
    })).toEqual({
      passed: true,
      reason: 'filesystem tool probe passed',
    })
  })
})
