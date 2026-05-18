import { describe, expect, it } from 'vitest'
import {
  TOOL_PROBE_EXPECTED_CONTENT,
  assessToolCapabilityProbe,
  buildToolCapabilityProbePrompt,
  getToolCallStreamEventType,
  isToolExecutionEvent,
  requiresFilesystemAuthoring,
  summarizeAssistantMessage,
} from './tool-capability-probe.mjs'

describe('tool capability probe', () => {
  it('recognizes Pi RPC tool execution event names', () => {
    expect(isToolExecutionEvent({ type: 'tool_execution_start' })).toBe(true)
    expect(isToolExecutionEvent({ type: 'tool_execution_update' })).toBe(true)
    expect(isToolExecutionEvent({ type: 'tool_execution_end' })).toBe(true)
    expect(isToolExecutionEvent({ type: 'tool_call' })).toBe(false)
  })

  it('recognizes Pi assistant tool-call stream deltas', () => {
    expect(getToolCallStreamEventType({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start' } })).toBe('toolcall_start')
    expect(getToolCallStreamEventType({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta' } })).toBe('toolcall_delta')
    expect(getToolCallStreamEventType({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end' } })).toBe('toolcall_end')
    expect(getToolCallStreamEventType({ type: 'message_update', assistantMessageEvent: { type: 'text_delta' } })).toBeUndefined()
  })

  it('summarizes assistant tool-call content without persisting arguments', () => {
    expect(summarizeAssistantMessage({
      role: 'assistant',
      stopReason: 'toolUse',
      responseModel: 'moonshotai/kimi-k2',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'toolCall', id: 'call-1', name: 'write', arguments: { path: 'secret' } },
      ],
    })).toEqual({
      stopReason: 'toolUse',
      responseModel: 'moonshotai/kimi-k2',
      contentTypes: ['text', 'toolCall'],
      toolCallCount: 1,
      toolCalls: [{ id: 'call-1', name: 'write' }],
    })
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
      reason: 'no toolcall_* or tool_execution_* events observed during filesystem probe',
    })
  })

  it('distinguishes tool calls from tool execution failures', () => {
    expect(assessToolCapabilityProbe({
      toolExecutionEventCount: 0,
      toolCallEventCount: 2,
      fileContent: TOOL_PROBE_EXPECTED_CONTENT,
    })).toEqual({
      passed: false,
      reason: 'tool calls observed but no tool_execution_* events observed during filesystem probe',
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
