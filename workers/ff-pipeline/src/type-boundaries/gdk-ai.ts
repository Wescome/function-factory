export type Api = string

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens?: number
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

export interface Model<TApi = Api> {
  id: string
  name: string
  api: TApi
  provider: string
  baseUrl?: string
  reasoning: boolean
  input: string[]
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  contextWindow: number
  maxTokens: number
}

export interface TextContent {
  type: 'text'
  text: string
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
  thinkingSignature?: string
}

export interface ImageContent {
  type: 'image'
  mimeType: string
  data: string
}

export interface ToolCall {
  type: 'toolCall'
  id: string
  name: string
  arguments: unknown
}

export interface UserMessage {
  role: 'user'
  content: string | Array<TextContent | ImageContent>
  timestamp: number
}

export interface AssistantMessage {
  role: 'assistant'
  content: Array<TextContent | ThinkingContent | ToolCall>
  api: Api
  provider: string
  model: string
  usage: Usage
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'
  errorMessage?: string
  timestamp: number
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId?: string
  toolName: string
  content: TextContent[]
  isError?: boolean
  timestamp: number
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage

export interface Tool<TSchema = unknown> {
  name: string
  description: string
  parameters: TSchema
}

export interface Context {
  systemPrompt: string
  messages: Message[]
  tools?: Tool[]
}

export interface StreamOptions {
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  apiKey?: string
  sessionId?: string
  onPayload?: (payload: unknown, model: Model) => unknown | Promise<unknown>
  metadata?: Record<string, unknown>
}

export type SimpleStreamOptions = StreamOptions

export type AssistantMessageEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'delta'; delta: unknown }
  | { type: 'done'; reason: AssistantMessage['stopReason']; message: AssistantMessage }
  | { type: 'error'; reason: 'error' | 'aborted'; error: AssistantMessage }

export interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  push(event: AssistantMessageEvent): void
  end(message: AssistantMessage): void
  result(): Promise<AssistantMessage>
}

export function createAssistantMessageEventStream(): AssistantMessageEventStream {
  throw new Error('type boundary only')
}

export function streamSimple(
  _model: Model,
  _context: Context,
  _options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  throw new Error('type boundary only')
}

export const Type = {
  Object: (_properties: Record<string, unknown>) => ({ type: 'object' }),
  String: (_options?: Record<string, unknown>) => ({ type: 'string' }),
}

export interface FauxProviderRegistration {
  setResponses(responses: AssistantMessage[]): void
  getModel(): Model
  unregister(): void
}

export function registerFauxProvider(): FauxProviderRegistration {
  throw new Error('type boundary only')
}

export function fauxText(text: string): TextContent {
  return { type: 'text', text }
}

export function fauxAssistantMessage(
  content: AssistantMessage['content'] | TextContent | string,
  opts?: Partial<Pick<AssistantMessage, 'stopReason' | 'errorMessage'>>,
): AssistantMessage {
  const normalizedContent = typeof content === 'string'
    ? [fauxText(content)]
    : Array.isArray(content)
      ? content
      : [content]

  return {
    role: 'assistant',
    content: normalizedContent,
    api: 'faux',
    provider: 'faux',
    model: 'faux',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: opts?.stopReason ?? 'stop',
    ...(opts?.errorMessage ? { errorMessage: opts.errorMessage } : {}),
    timestamp: Date.now(),
  }
}
