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
 *   G1-text: detect tool calls returned as plain text JSON (models without native function calling)
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
      const toolCalls = msg.content.filter(c => c.type === 'toolCall') as ToolCall[]
      const textParts = msg.content.filter(c => c.type === 'text') as TextContent[]
      const text = textParts.map(c => c.text).join('')

      if (toolCalls.length > 0) {
        // Workers AI doesn't support native tool_calls in conversation history.
        // Represent tool calls as text so the model sees its own prior output.
        const toolCallText = toolCalls.map(tc =>
          JSON.stringify({ name: tc.name, arguments: tc.arguments })
        ).join('\n')
        messages.push({ role: 'assistant', content: text ? `${text}\n${toolCallText}` : toolCallText })
      } else {
        messages.push({ role: 'assistant', content: text })
      }

    } else if (msg.role === 'toolResult') {
      // Workers AI doesn't support role: 'tool'. Convert to user message.
      const text = msg.content
        .filter(c => c.type === 'text')
        .map(c => (c as TextContent).text)
        .join('')
      messages.push({
        role: 'user',
        content: `Tool "${msg.toolName}" returned:\n${text}`,
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

/** Counter for generating unique tool call IDs across turns */
let toolCallCounter = 0

/**
 * Detect tool calls embedded as plain text JSON in the model response.
 *
 * Some models (e.g. qwen2.5-coder-32b) don't support native function calling
 * and instead return tool calls as plain text JSON objects. This function
 * parses those into structured ToolCall blocks.
 *
 * Conservative: only matches when the "name" field matches a tool the agent
 * actually has available. Returns null if no valid tool calls found.
 */
export function detectTextToolCalls(text: string, availableTools: string[]): ToolCall[] | null {
  if (availableTools.length === 0) return null

  const toolCalls: ToolCall[] = []

  // Strategy 1: Try to parse each line as a standalone JSON tool call object.
  // This handles the common case of one or more tool calls separated by newlines.
  const lines = text.trim().split('\n').filter(l => l.trim().length > 0)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (
        typeof parsed.name === 'string' &&
        availableTools.includes(parsed.name) &&
        (parsed.arguments !== undefined || parsed.parameters !== undefined)
      ) {
        const rawArgs = parsed.arguments ?? parsed.parameters
        const args = typeof rawArgs === 'string'
          ? JSON.parse(rawArgs)
          : rawArgs
        toolCalls.push({
          type: 'toolCall',
          id: `tc-${Date.now()}-${toolCallCounter++}`,
          name: parsed.name,
          arguments: args,
        })
      }
    } catch {
      // Not valid JSON on this line, skip
    }
  }

  if (toolCalls.length > 0) return toolCalls

  // Strategy 2: The entire text is a single JSON tool call (no newlines).
  try {
    const parsed = JSON.parse(text.trim())
    if (
      typeof parsed.name === 'string' &&
      availableTools.includes(parsed.name) &&
      parsed.arguments !== undefined
    ) {
      const args = typeof parsed.arguments === 'string'
        ? JSON.parse(parsed.arguments)
        : parsed.arguments
      toolCalls.push({
        type: 'toolCall',
        id: `tc-${Date.now()}-${toolCallCounter++}`,
        name: parsed.name,
        arguments: args,
      })
    }
  } catch {
    // Not a tool call
  }

  return toolCalls.length > 0 ? toolCalls : null
}

/**
 * Parse Workers AI response into AssistantMessage content blocks.
 *
 * Checks in order:
 *   1. Native structured tool_calls (model supports function calling)
 *   2. Text-based tool calls (G1 fallback — model returns tool call as plain text JSON)
 *   3. Regular text response
 */
function parseResponse(resp: unknown, availableToolNames: string[]): {
  content: AssistantMessage['content']
  stopReason: AssistantMessage['stopReason']
} {
  const parsed = typeof resp === 'object' && resp !== null
    ? resp as Record<string, unknown>
    : null

  // 1. Check for native tool_calls in the response (structured)
  if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
    const content: ToolCall[] = parsed.tool_calls.map((tc: any) => ({
      type: 'toolCall' as const,
      id: tc.id ?? `tc-${Date.now()}-${toolCallCounter++}`,
      name: tc.function?.name ?? 'unknown',
      arguments: typeof tc.function?.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function?.arguments ?? {},
    }))
    return { content, stopReason: 'toolUse' }
  }

  // Get the raw text
  const raw = typeof resp === 'string' ? resp : JSON.stringify(resp)

  // 2. Check for text-based tool calls (G1 fallback path)
  if (availableToolNames.length > 0) {
    const textToolCalls = detectTextToolCalls(raw, availableToolNames)
    if (textToolCalls) {
      return { content: textToolCalls, stopReason: 'toolUse' }
    }
  }

  // 3. Regular text response
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
        const availableToolNames = context.tools?.map(t => t.name) ?? []
        const { content, stopReason } = parseResponse(resp, availableToolNames)

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

/**
 * Create a StreamFn that wraps gdk-ai's streamSimple but adds text
 * tool call detection on the response. For models that express tool
 * calls as text JSON instead of structured tool_calls — even via REST API.
 */
export function createTextToolCallStreamFn(availableToolNames: string[]): StreamFn {
  return async (model, context, options) => {
    // Use gdk-ai's standard streamSimple for the HTTP call
    const { streamSimple } = await import('@weops/gdk-ai')
    const innerStream = streamSimple(model, context, options)
    const outerStream = new AssistantMessageEventStream()

    ;(async () => {
      try {
        let finalMessage: AssistantMessage | null = null

        for await (const event of innerStream) {
          if (event.type === 'done' || event.type === 'error') {
            finalMessage = event.type === 'done' ? event.message : event.error
            break
          }
          // Forward intermediate events
          outerStream.push(event)
        }

        if (!finalMessage) {
          finalMessage = await innerStream.result()
        }

        // Post-process: detect text tool calls in the final message
        const textParts = finalMessage.content.filter(c => c.type === 'text') as TextContent[]
        const text = textParts.map(c => c.text).join('')
        const toolCalls = finalMessage.content.filter(c => c.type === 'toolCall')

        if (toolCalls.length === 0 && text && availableToolNames.length > 0) {
          const detected = detectTextToolCalls(text, availableToolNames)
          if (detected && detected.length > 0) {
            // Replace text content with detected tool calls
            const newMessage: AssistantMessage = {
              ...finalMessage,
              content: detected,
              stopReason: 'toolUse',
            }
            outerStream.push({ type: 'start', partial: newMessage })
            outerStream.push({ type: 'done', reason: 'toolUse', message: newMessage })
            outerStream.end(newMessage)
            return
          }
        }

        // No text tool calls — forward as-is
        outerStream.push({ type: 'start', partial: finalMessage })
        if (finalMessage.stopReason === 'error' || finalMessage.stopReason === 'aborted') {
          outerStream.push({ type: 'error', reason: finalMessage.stopReason as any, error: finalMessage })
        } else {
          outerStream.push({ type: 'done', reason: finalMessage.stopReason as any, message: finalMessage })
        }
        outerStream.end(finalMessage)
      } catch (error) {
        const errorMsg: AssistantMessage = {
          role: 'assistant',
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        }
        outerStream.push({ type: 'error', reason: 'error', error: errorMsg })
        outerStream.end(errorMsg)
      }
    })()

    return outerStream
  }
}
