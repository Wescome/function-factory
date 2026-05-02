/**
 * ADR-006: Workers AI Stream Adapter tests
 *
 * Validates:
 * 1. Basic text response → stream emits start + done with TextContent
 * 2. Tool call response → stream emits start + done with ToolCall content, stopReason 'toolUse'
 * 3. Error handling → stream emits error event
 * 4. I3: toolResult messages converted to { role: 'tool', tool_call_id } format
 * 5. I4: response_format only set when no tools in context
 * 6. G1: try-with-tools / catch-and-retry-without pattern
 */
import { describe, it, expect, vi } from 'vitest'
import { Type } from '@weops/gdk-ai'
import type { AssistantMessage, AssistantMessageEvent, Context, Model, TextContent, ToolCall } from '@weops/gdk-ai'
import { createWorkersAIStreamFn, detectTextToolCalls, type AIBinding } from './workers-ai-stream'

/** Minimal model fixture for Workers AI adapter */
function makeModel(id = '@cf/qwen/qwen2.5-coder-32b-instruct'): Model<any> {
  return {
    id,
    name: 'qwen2.5-coder-32b',
    api: 'workers-ai' as any,
    provider: 'cloudflare',
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 4096,
  }
}

/** Collect all events from an async iterable */
async function collectEvents(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
}

describe('createWorkersAIStreamFn', () => {
  describe('basic text response', () => {
    it('emits start + done with TextContent when AI returns text', async () => {
      const mockAI: AIBinding = {
        run: vi.fn().mockResolvedValue({
          response: '{"goal":"test","status":"ok"}',
        }),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
      }

      const stream = await streamFn(model, context, { maxTokens: 2048 })
      const events = await collectEvents(stream)

      // Should have start + done events
      expect(events.length).toBe(2)
      expect(events[0]!.type).toBe('start')
      expect(events[1]!.type).toBe('done')

      // Final message should have text content
      const finalMsg = await stream.result()
      expect(finalMsg.role).toBe('assistant')
      expect(finalMsg.stopReason).toBe('stop')
      expect(finalMsg.content.length).toBe(1)
      expect(finalMsg.content[0]!.type).toBe('text')
      expect((finalMsg.content[0] as TextContent).text).toBe('{"goal":"test","status":"ok"}')
    })
  })

  describe('tool call response', () => {
    it('emits start + done with ToolCall content and stopReason toolUse', async () => {
      const mockAI: AIBinding = {
        run: vi.fn().mockResolvedValue({
          response: {
            tool_calls: [{
              id: 'tc1',
              function: {
                name: 'arango_query',
                arguments: '{"query":"FOR x IN y RETURN x"}',
              },
            }],
          },
        }),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'You are helpful.',
        messages: [{ role: 'user', content: 'Query the DB', timestamp: Date.now() }],
        tools: [{
          name: 'arango_query',
          description: 'Run AQL query',
          parameters: Type.Object({ query: Type.String() }),
        }],
      }

      const stream = await streamFn(model, context, { maxTokens: 2048 })
      const events = await collectEvents(stream)

      expect(events.length).toBe(2)
      expect(events[0]!.type).toBe('start')
      expect(events[1]!.type).toBe('done')

      const finalMsg = await stream.result()
      expect(finalMsg.stopReason).toBe('toolUse')
      expect(finalMsg.content.length).toBe(1)
      expect(finalMsg.content[0]!.type).toBe('toolCall')

      const tc = finalMsg.content[0] as ToolCall
      expect(tc.id).toBe('tc1')
      expect(tc.name).toBe('arango_query')
      expect(tc.arguments).toEqual({ query: 'FOR x IN y RETURN x' })
    })
  })

  describe('error handling', () => {
    it('emits error event when AI.run throws', async () => {
      const mockAI: AIBinding = {
        run: vi.fn().mockRejectedValue(new Error('model overloaded')),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
      }

      const stream = await streamFn(model, context)
      const events = await collectEvents(stream)

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe('error')

      const finalMsg = await stream.result()
      expect(finalMsg.stopReason).toBe('error')
      expect(finalMsg.errorMessage).toContain('model overloaded')
    })
  })

  describe('I3: toolResult conversion', () => {
    it('converts toolResult messages to user messages for Workers AI compatibility', async () => {
      let capturedInput: Record<string, unknown> | null = null
      const mockAI: AIBinding = {
        run: vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
          capturedInput = input
          return { response: '{"result":"done"}' }
        }),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'You are helpful.',
        messages: [
          { role: 'user', content: 'Hello', timestamp: Date.now() },
          {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tc-42', name: 'arango_query', arguments: { query: 'RETURN 1' } }],
            api: 'workers-ai' as any,
            provider: 'cloudflare',
            model: '@cf/qwen/qwen2.5-coder-32b-instruct',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'toolUse',
            timestamp: Date.now(),
          },
          {
            role: 'toolResult',
            toolCallId: 'tc-42',
            toolName: 'arango_query',
            content: [{ type: 'text', text: '[{"x":1}]' }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
      }

      const stream = await streamFn(model, context)
      await collectEvents(stream)

      // Verify toolResult was converted correctly (I3 amendment)
      expect(capturedInput).toBeTruthy()
      const messages = capturedInput!.messages as { role: string; tool_call_id?: string; content: string }[]

      // Tool result converted to user message (Workers AI doesn't support role: 'tool')
      const toolMsg = messages.find(m => m.role === 'user' && m.content.includes('Tool "arango_query"'))
      expect(toolMsg).toBeTruthy()
      expect(toolMsg!.content).toContain('[{"x":1}]')
    })
  })

  describe('I4: response_format conditional', () => {
    it('sets response_format json_object when no tools', async () => {
      let capturedInput: Record<string, unknown> | null = null
      const mockAI: AIBinding = {
        run: vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
          capturedInput = input
          return { response: '{"ok":true}' }
        }),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'Return JSON.',
        messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
        // No tools
      }

      const stream = await streamFn(model, context)
      await collectEvents(stream)

      expect(capturedInput).toBeTruthy()
      expect((capturedInput as any).response_format).toEqual({ type: 'json_object' })
    })

    it('does NOT set response_format when tools are provided', async () => {
      let capturedInput: Record<string, unknown> | null = null
      const mockAI: AIBinding = {
        run: vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
          capturedInput = input
          return { response: '{"result":"done"}' }
        }),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'You have tools.',
        messages: [{ role: 'user', content: 'Query something', timestamp: Date.now() }],
        tools: [{
          name: 'arango_query',
          description: 'Run AQL query',
          parameters: Type.Object({ query: Type.String() }),
        }],
      }

      const stream = await streamFn(model, context)
      await collectEvents(stream)

      expect(capturedInput).toBeTruthy()
      expect((capturedInput as any).response_format).toBeUndefined()
    })
  })

  describe('G1: try-with-tools / catch-and-retry-without', () => {
    it('retries without tools when AI.run fails with tools', async () => {
      let callCount = 0
      const mockAI: AIBinding = {
        run: vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
          callCount++
          if (callCount === 1 && input.tools) {
            // First call with tools fails (model doesn't support function calling)
            throw new Error('tools parameter not supported')
          }
          // Second call without tools succeeds
          return { response: '{"goal":"fallback result"}' }
        }),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
        tools: [{
          name: 'arango_query',
          description: 'Run AQL query',
          parameters: Type.Object({ query: Type.String() }),
        }],
      }

      const stream = await streamFn(model, context)
      const events = await collectEvents(stream)

      // Should succeed after retry
      expect(callCount).toBe(2)
      expect(events.some(e => e.type === 'done')).toBe(true)

      const finalMsg = await stream.result()
      expect(finalMsg.stopReason).toBe('stop')
      expect(finalMsg.content[0]!.type).toBe('text')
      expect((finalMsg.content[0] as TextContent).text).toContain('fallback result')
    })

    it('does not retry when AI.run fails without tools', async () => {
      const mockAI: AIBinding = {
        run: vi.fn().mockRejectedValue(new Error('model overloaded')),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
        // No tools — no retry possible
      }

      const stream = await streamFn(model, context)
      const events = await collectEvents(stream)

      // Should fail with error, no retry
      expect(mockAI.run).toHaveBeenCalledTimes(1)
      expect(events[0]!.type).toBe('error')
    })
  })

  describe('message conversion', () => {
    it('converts system/user/assistant messages to Workers AI format', async () => {
      let capturedInput: Record<string, unknown> | null = null
      const mockAI: AIBinding = {
        run: vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
          capturedInput = input
          return { response: '{"ok":true}' }
        }),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'Be helpful.',
        messages: [
          { role: 'user', content: 'Hello', timestamp: Date.now() },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi there' }],
            api: 'workers-ai' as any,
            provider: 'cloudflare',
            model: '@cf/qwen/qwen2.5-coder-32b-instruct',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'stop',
            timestamp: Date.now(),
          },
          { role: 'user', content: 'Thanks', timestamp: Date.now() },
        ],
      }

      const stream = await streamFn(model, context)
      await collectEvents(stream)

      const messages = capturedInput!.messages as { role: string; content: string }[]
      expect(messages[0]!.role).toBe('system')
      expect(messages[0]!.content).toContain('Be helpful.')
      expect(messages[1]!.role).toBe('user')
      expect(messages[1]!.content).toBe('Hello')
      expect(messages[2]!.role).toBe('assistant')
      expect(messages[2]!.content).toBe('Hi there')
      expect(messages[3]!.role).toBe('user')
      expect(messages[3]!.content).toBe('Thanks')
    })

    it('handles assistant messages with tool_calls for Workers AI format', async () => {
      let capturedInput: Record<string, unknown> | null = null
      const mockAI: AIBinding = {
        run: vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
          capturedInput = input
          return { response: '{"ok":true}' }
        }),
      }

      const streamFn = createWorkersAIStreamFn(mockAI)
      const model = makeModel()
      const context: Context = {
        systemPrompt: 'You have tools.',
        messages: [
          { role: 'user', content: 'Query the DB', timestamp: Date.now() },
          {
            role: 'assistant',
            content: [
              { type: 'toolCall', id: 'tc-1', name: 'arango_query', arguments: { query: 'RETURN 1' } },
            ],
            api: 'workers-ai' as any,
            provider: 'cloudflare',
            model: '@cf/qwen/qwen2.5-coder-32b-instruct',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'toolUse',
            timestamp: Date.now(),
          },
          {
            role: 'toolResult',
            toolCallId: 'tc-1',
            toolName: 'arango_query',
            content: [{ type: 'text', text: '[1]' }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
      }

      const stream = await streamFn(model, context)
      await collectEvents(stream)

      const messages = capturedInput!.messages as any[]

      // Assistant message with tool calls as text (Workers AI doesn't support native tool_calls)
      const assistantMsg = messages.find((m: any) => m.role === 'assistant')
      expect(assistantMsg).toBeTruthy()
      expect(assistantMsg.content).toContain('arango_query')

      // Tool result as user message (Workers AI doesn't support role: 'tool')
      const toolResultMsgs = messages.filter((m: any) => m.role === 'user' && m.content.includes('Tool "'))
      expect(toolResultMsgs.length).toBeGreaterThan(0)
    })
  })

  describe('G1-text: text-based tool call detection', () => {
    describe('detectTextToolCalls unit', () => {
      it('detects a single tool call JSON in plain text', () => {
        const text = '{"name": "arango_query", "arguments": {"query": "FOR d IN memory_semantic RETURN d"}}'
        const result = detectTextToolCalls(text, ['arango_query'])
        expect(result).not.toBeNull()
        expect(result!.length).toBe(1)
        expect(result![0]!.type).toBe('toolCall')
        expect(result![0]!.name).toBe('arango_query')
        expect(result![0]!.arguments).toEqual({ query: 'FOR d IN memory_semantic RETURN d' })
        expect(result![0]!.id).toMatch(/^tc-/)
      })

      it('detects multiple tool calls separated by newlines', () => {
        const text = [
          '{"name": "arango_query", "arguments": {"query": "FOR d IN col1 RETURN d"}}',
          '{"name": "arango_query", "arguments": {"query": "FOR d IN col2 RETURN d"}}',
        ].join('\n')
        const result = detectTextToolCalls(text, ['arango_query'])
        expect(result).not.toBeNull()
        expect(result!.length).toBe(2)
        expect(result![0]!.arguments).toEqual({ query: 'FOR d IN col1 RETURN d' })
        expect(result![1]!.arguments).toEqual({ query: 'FOR d IN col2 RETURN d' })
        // IDs must be unique
        expect(result![0]!.id).not.toBe(result![1]!.id)
      })

      it('returns null when tool name is not in available tools', () => {
        const text = '{"name": "unknown_tool", "arguments": {"x": 1}}'
        const result = detectTextToolCalls(text, ['arango_query', 'store_memory'])
        expect(result).toBeNull()
      })

      it('returns null for regular text/JSON that is not a tool call', () => {
        const text = '{"goal": "answer the question", "status": "done"}'
        const result = detectTextToolCalls(text, ['arango_query'])
        expect(result).toBeNull()
      })

      it('returns null for empty available tools list', () => {
        const text = '{"name": "arango_query", "arguments": {"query": "RETURN 1"}}'
        const result = detectTextToolCalls(text, [])
        expect(result).toBeNull()
      })

      it('handles arguments as nested objects with special characters', () => {
        const text = '{"name": "arango_query", "arguments": {"query": "FOR d IN memory_semantic FILTER d.type == \'decision\' RETURN { key: d._key }"}}'
        const result = detectTextToolCalls(text, ['arango_query'])
        expect(result).not.toBeNull()
        expect(result!.length).toBe(1)
        expect(result![0]!.name).toBe('arango_query')
      })
    })

    describe('adapter integration with text tool calls', () => {
      it('detects text tool call from G1 fallback and returns ToolCall content', async () => {
        // Simulate: first call with tools fails, fallback returns text-based tool call
        let callCount = 0
        const mockAI: AIBinding = {
          run: vi.fn().mockImplementation(async (_model: string, input: Record<string, unknown>) => {
            callCount++
            if (callCount === 1 && input.tools) {
              throw new Error('tools parameter not supported')
            }
            // Fallback returns plain text that is a tool call
            return {
              response: '{"name": "arango_query", "arguments": {"query": "FOR d IN decisions RETURN d"}}',
            }
          }),
        }

        const streamFn = createWorkersAIStreamFn(mockAI)
        const model = makeModel()
        const context: Context = {
          systemPrompt: 'You are helpful.',
          messages: [{ role: 'user', content: 'Show me decisions', timestamp: Date.now() }],
          tools: [{
            name: 'arango_query',
            description: 'Run AQL query',
            parameters: Type.Object({ query: Type.String() }),
          }],
        }

        const stream = await streamFn(model, context)
        const events = await collectEvents(stream)

        expect(callCount).toBe(2) // tried with tools, then fallback
        expect(events.some(e => e.type === 'done')).toBe(true)

        const finalMsg = await stream.result()
        expect(finalMsg.stopReason).toBe('toolUse')
        expect(finalMsg.content.length).toBe(1)
        expect(finalMsg.content[0]!.type).toBe('toolCall')

        const tc = finalMsg.content[0] as ToolCall
        expect(tc.name).toBe('arango_query')
        expect(tc.arguments).toEqual({ query: 'FOR d IN decisions RETURN d' })
      })

      it('treats text as regular response when tool name not in available tools', async () => {
        const mockAI: AIBinding = {
          run: vi.fn().mockResolvedValue({
            response: '{"name": "unknown_tool", "arguments": {"x": 1}}',
          }),
        }

        const streamFn = createWorkersAIStreamFn(mockAI)
        const model = makeModel()
        const context: Context = {
          systemPrompt: 'You are helpful.',
          messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
          tools: [{
            name: 'arango_query',
            description: 'Run AQL query',
            parameters: Type.Object({ query: Type.String() }),
          }],
        }

        const stream = await streamFn(model, context)
        const finalMsg = await stream.result()

        expect(finalMsg.stopReason).toBe('stop')
        expect(finalMsg.content[0]!.type).toBe('text')
      })

      it('detects text tool call even when native tool calling succeeds (model returns text)', async () => {
        // Model supports tools parameter but returns tool call as text anyway
        const mockAI: AIBinding = {
          run: vi.fn().mockResolvedValue({
            response: '{"name": "arango_query", "arguments": {"query": "RETURN 1"}}',
          }),
        }

        const streamFn = createWorkersAIStreamFn(mockAI)
        const model = makeModel()
        const context: Context = {
          systemPrompt: 'You are helpful.',
          messages: [{ role: 'user', content: 'Run query', timestamp: Date.now() }],
          tools: [{
            name: 'arango_query',
            description: 'Run AQL query',
            parameters: Type.Object({ query: Type.String() }),
          }],
        }

        const stream = await streamFn(model, context)
        const finalMsg = await stream.result()

        expect(finalMsg.stopReason).toBe('toolUse')
        expect(finalMsg.content[0]!.type).toBe('toolCall')
        expect((finalMsg.content[0] as ToolCall).name).toBe('arango_query')
      })

      it('does NOT detect text tool calls when no tools in context', async () => {
        // Even if text looks like a tool call, without tools in context, treat as text
        const mockAI: AIBinding = {
          run: vi.fn().mockResolvedValue({
            response: '{"name": "arango_query", "arguments": {"query": "RETURN 1"}}',
          }),
        }

        const streamFn = createWorkersAIStreamFn(mockAI)
        const model = makeModel()
        const context: Context = {
          systemPrompt: 'You are helpful.',
          messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
          // No tools
        }

        const stream = await streamFn(model, context)
        const finalMsg = await stream.result()

        expect(finalMsg.stopReason).toBe('stop')
        expect(finalMsg.content[0]!.type).toBe('text')
      })
    })
  })
})
