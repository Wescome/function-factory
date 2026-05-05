import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  Tool,
} from './gdk-ai'

export type AgentMessage = Message

export interface AgentTool<TSchema = unknown, TResult = any> extends Tool<TSchema> {
  label?: string
  execute(toolCallId: string, params: any): Promise<TResult> | TResult
}

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[] }
  | { type: 'message'; message: AgentMessage }
  | { type: 'error'; error: unknown }

export interface AgentContext {
  systemPrompt: string
  messages: AgentMessage[]
  tools?: AgentTool[]
}

export interface AgentLoopConfig {
  model: Model
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>
  getApiKey?: (provider: string) => string | Promise<string | undefined> | undefined
  apiKey?: string
  maxTokens?: number
  onPayload?: (payload: unknown) => unknown | Promise<unknown>
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>
}

export interface EventStream<TEvent, TResult> extends AsyncIterable<TEvent> {
  result(): Promise<TResult>
}

export type StreamFn = (
  model: Model,
  context: Context,
  options?: SimpleStreamOptions,
) => any

export function agentLoop(
  _messages: AgentMessage[],
  _context: AgentContext,
  _config: AgentLoopConfig,
  _signal?: AbortSignal,
  _streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
  throw new Error('type boundary only')
}
