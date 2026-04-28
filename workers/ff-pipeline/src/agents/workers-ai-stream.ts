/**
 * ADR-006: Workers AI Stream Adapter for gdk-agent
 *
 * Custom StreamFn that wraps Cloudflare Workers AI env.AI.run() binding
 * for use with gdk-agent's agentLoop. Eliminates HTTP dependency for
 * agent synthesis — zero cost, in-binding calls.
 *
 * Amendments applied:
 *   I1: StreamFn imported from @weops/gdk-agent (not gdk-ai)
 *   I3: toolResult → { role: 'tool', tool_call_id, content } (OpenAI format)
 *   I4: response_format only when no tools in context
 *   G1: try-with-tools / catch-and-retry-without fallback
 */

import type { StreamFn } from '@weops/gdk-agent'  // I1: correct import
import { AssistantMessageEventStream } from '@weops/gdk-ai'
import type {
  AssistantMessage,
  Context,
  SimpleStreamOptions,
  Model,
  TextContent,
  ToolCall,
} from '@weops/gdk-ai'

export type AIBinding = {
  run(model: string, input: Record<string, unknown>): Promise<Record<string, unknown>>
}

/** Workers AI message format (OpenAI-compatible) */
type WorkersAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: WorkersAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type WorkersAIToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type WorkersAIToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}

/**
 * Convert gdk-ai Context messages to Workers AI format.
 *
 * I3 amendment: toolResult messages become { role: 'tool', tool_call_id, content }
 * (the Workers AI / OpenAI standard format).
 */
function convertMessages(context: Context): WorkersAIMessage[] {
  const messages: WorkersAIMessage[] = []

  if (context.systemPrompt) {
    messages.push({
      role: 'system',
      content: context.systemPrompt + '\n\nRespond ONLY with valid JSON.',
    })
  }

  for (const msg of context.messages) {
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(c => c.type === 'text').map(c => (c as TextContent).text).join('\n')
      messages.push({ role: 'user', content })

    } else if (msg.role === 'assistant') {
      // Check for tool calls in the assistant message
      const toolCalls = msg.content.filter(c => c.type === 'toolCall') as ToolCall[]
      const textParts = msg.content.filter(c => c.type === 'text') as TextContent[]
      const text = textParts.map(c => c.text).join('')

      if (toolCalls.length > 0) {
        // Assistant message with tool_calls (OpenAI format)
        const aiToolCalls: WorkersAIToolCall[] = toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }))
        messages.push({
          role: 'assistant',
          content: text || '',
          tool_calls: aiToolCalls,
        })
      } else {
        messages.push({ role: 'assistant', content: text })
      }

    } else if (msg.role === 'toolResult') {
      // I3: Convert to OpenAI tool result format
      const text = msg.content
        .filter(c => c.type === 'text')
        .map(c => (c as TextContent).text)
        .join('')
      messages.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: text,
      })
    }
  }

  return messages
}

/**
 * Convert gdk-ai tool definitions to Workers AI format.
 */
function convertTools(context: Context): WorkersAIToolDef[] | undefined {
  if (!context.tools || context.tools.length === 0) return undefined

  return context.tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

/**
 * Build the Workers AI input payload.
 *
 * I4 amendment: response_format only when no tools in context.
 * When tools are provided, let the model use native function calling
 * without JSON mode constraint.
 */
function buildPayload(
  context: Context,
  options?: SimpleStreamOptions,
): Record<string, unknown> {
  const messages = convertMessages(context)
  const tools = convertTools(context)
  const hasTools = tools !== undefined && tools.length > 0

  const payload: Record<string, unknown> = {
    messages,
    max_tokens: options?.maxTokens ?? 2048,
  }

  if (hasTools) {
    payload.tools = tools
    // I4: do NOT set response_format when tools are present
  } else {
    // I4: only set json_object when no tools
    payload.response_format = { type: 'json_object' }
  }

  return payload
}

/**
 * Build the payload for retry without tools (G1 fallback).
 * Injects tool descriptions into system prompt instead.
 */
function buildFallbackPayload(
  context: Context,
  options?: SimpleStreamOptions,
): Record<string, unknown> {
  const messages = convertMessages(context)

  // Inject tool descriptions into system prompt
  if (context.tools && context.tools.length > 0) {
    const toolDesc = context.tools.map(t =>
      `Tool: ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.parameters)}`,
    ).join('\n\n')

    const systemIdx = messages.findIndex(m => m.role === 'system')
    if (systemIdx !== -1) {
      messages[systemIdx] = {
        role: 'system',
        content: (messages[systemIdx] as { content: string }).content +
          '\n\nAvailable tools (call by including a tool_calls array in your JSON response):\n' + toolDesc,
      }
    }
  }

  return {
    messages,
    max_tokens: options?.maxTokens ?? 2048,
    response_format: { type: 'json_object' },
  }
}

/** Build a zero-cost usage block */
function zeroUsage(): AssistantMessage['usage'] {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/**
 * Parse Workers AI response into AssistantMessage content blocks.
 */
function parseResponse(resp: unknown): {
  content: AssistantMessage['content']
  stopReason: AssistantMessage['stopReason']
} {
  const parsed = typeof resp === 'object' && resp !== null
    ? resp as Record<string, unknown>
    : null

  // Check for tool_calls in the response
  if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
    const content: ToolCall[] = parsed.tool_calls.map((tc: any) => ({
      type: 'toolCall' as const,
      id: tc.id ?? `call-${Date.now()}`,
      name: tc.function?.name ?? 'unknown',
      arguments: typeof tc.function?.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function?.arguments ?? {},
    }))
    return { content, stopReason: 'toolUse' }
  }

  // Plain text response
  const raw = typeof resp === 'string' ? resp : JSON.stringify(resp)
  const content: TextContent[] = [{ type: 'text', text: raw }]
  return { content, stopReason: 'stop' }
}

/**
 * Create a Workers AI StreamFn adapter.
 *
 * G1 amendment: handles both cases:
 *   (a) Workers AI supports function calling → uses `tools` parameter
 *   (b) It doesn't → falls back to prompt-based tool invocation
 *   Includes try-with-tools / catch-and-retry-without pattern.
 */
export function createWorkersAIStreamFn(ai: AIBinding): StreamFn {
  return (model: Model<any>, context: Context, options?: SimpleStreamOptions) => {
    const stream = new AssistantMessageEventStream()
    const hasTools = !!(context.tools && context.tools.length > 0)

    queueMicrotask(async () => {
      try {
        let result: Record<string, unknown>

        if (hasTools) {
          // G1: try with tools first
          try {
            const payload = buildPayload(context, options)
            result = await ai.run(model.id, payload)
          } catch (toolsError) {
            // G1: tools not supported — retry without tools parameter,
            // inject tool descriptions into system prompt instead
            const fallbackPayload = buildFallbackPayload(context, options)
            result = await ai.run(model.id, fallbackPayload)
          }
        } else {
          const payload = buildPayload(context, options)
          result = await ai.run(model.id, payload)
        }

        const resp = result.response
        const { content, stopReason } = parseResponse(resp)

        const message: AssistantMessage = {
          role: 'assistant',
          content,
          api: 'workers-ai' as any,
          provider: 'cloudflare',
          model: model.id,
          usage: zeroUsage(),
          stopReason,
          timestamp: Date.now(),
        }

        stream.push({ type: 'start', partial: message })
        if (stopReason === 'stop' || stopReason === 'length' || stopReason === 'toolUse') {
          stream.push({ type: 'done', reason: stopReason, message })
        }
        stream.end(message)
      } catch (error) {
        const errorMessage: AssistantMessage = {
          role: 'assistant',
          content: [],
          api: 'workers-ai' as any,
          provider: 'cloudflare',
          model: model.id,
          usage: zeroUsage(),
          stopReason: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        }
        stream.push({ type: 'error', reason: 'error', error: errorMessage })
        stream.end(errorMessage)
      }
    })

    return stream
  }
}
