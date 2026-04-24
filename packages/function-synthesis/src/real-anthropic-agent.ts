/**
 * Pi-ai-backed agent for the synthesis topology.
 *
 * Uses @mariozechner/pi-ai (22-provider unified LLM API) instead of raw
 * fetch() to api.anthropic.com. Preserves the same interface so
 * PiAgentBindingMode and run-live-synthesis.ts work unchanged.
 *
 * JTBD: When the Factory runs a live synthesis, I want any of 22 LLM
 * providers driving each role agent via pi-ai's unified API, so the
 * synthesis is provider-agnostic and gets native cost tracking for free.
 */

import {
  getModel as piGetModel,
  streamSimple,
  calculateCost,
  getProviders,
  type Model as PiModel,
  type Api,
  type Context,
  type Tool as PiTool,
  type Usage,
  type AssistantMessage as PiAssistantMessage,
  type ToolCall,
  type TextContent,
  type Message as PiMessage,
  type ToolResultMessage,
  type UserMessage,
} from "@mariozechner/pi-ai"

import type {
  Model,
  ModelResponse,
  ToolSchema,
  BeforeToolCallResult,
  AgentConfig,
  AgentMessage,
} from "./pi-agent-mock.js"

// ─── Token & Cost Tracking ──────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCost: number
}

const globalTokenUsage: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
}

export function getGlobalTokenUsage(): Readonly<TokenUsage> {
  return { ...globalTokenUsage }
}

export function resetGlobalTokenUsage(): void {
  globalTokenUsage.inputTokens = 0
  globalTokenUsage.outputTokens = 0
  globalTokenUsage.cacheReadTokens = 0
  globalTokenUsage.cacheWriteTokens = 0
  globalTokenUsage.totalCost = 0
}

const TOKEN_BUDGET = 150_000

export function isOverBudget(): boolean {
  return (globalTokenUsage.inputTokens + globalTokenUsage.outputTokens) > TOKEN_BUDGET
}

function accumulateUsage(usage: Usage): void {
  globalTokenUsage.inputTokens += usage.input
  globalTokenUsage.outputTokens += usage.output
  globalTokenUsage.cacheReadTokens += usage.cacheRead
  globalTokenUsage.cacheWriteTokens += usage.cacheWrite
  globalTokenUsage.totalCost += usage.cost.total
}

// ─── Available Providers ────────────────────────────────────────────

export function getAvailableProviders(): string[] {
  return getProviders()
}

// ─── Real Model (pi-ai backed) ─────────────────────────────────────

export function createRealModel(provider: string, modelId: string): Model {
  // Resolve the pi-ai model from the registry
  const piModel = piGetModel(provider as any, modelId as any)
  if (!piModel) {
    throw new Error(`pi-ai: model not found — provider="${provider}", modelId="${modelId}"`)
  }

  return {
    provider,
    modelId,
    async generate(prompt: string): Promise<ModelResponse> {
      const context: Context = {
        messages: [{ role: "user", content: prompt, timestamp: Date.now() } as UserMessage],
      }

      const stream = streamSimple(piModel, context, { maxTokens: 4096 })
      const result = await stream.result()

      // Calculate cost
      calculateCost(piModel, result.usage)
      accumulateUsage(result.usage)

      const text = result.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("")

      return {
        text,
        usage: {
          inputTokens: result.usage.input,
          outputTokens: result.usage.output,
        },
      }
    },
  }
}

// ─── Real Agent (pi-ai backed) ─────────────────────────────────────

export class RealAnthropicAgent {
  private readonly config: AgentConfig
  private readonly messages: AgentMessage[] = []
  private readonly conversationHistory: PiMessage[] = []
  private readonly piModel: PiModel<Api>
  private turnCount = 0
  private readonly maxTurns: number

  constructor(config: AgentConfig, maxTurns = 5) {
    this.config = config
    this.maxTurns = maxTurns

    // Resolve pi-ai model
    const model = piGetModel(config.model.provider as any, config.model.modelId as any)
    if (!model) {
      throw new Error(
        `pi-ai: model not found — provider="${config.model.provider}", modelId="${config.model.modelId}"`,
      )
    }
    this.piModel = model
  }

  /**
   * Convert our ToolSchema[] (JSON Schema inputSchema) to pi-ai Tool[] format.
   * pi-ai expects TypeBox schemas in `parameters`, but also accepts raw JSON Schema
   * objects since TypeBox compiles down to JSON Schema.
   */
  private convertTools(): PiTool[] {
    return this.config.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as any, // JSON Schema is TypeBox-compatible at runtime
    }))
  }

  /**
   * Send a prompt to the agent. Makes real LLM API calls via pi-ai
   * with tools. Handles tool-use loops up to maxTurns.
   */
  async prompt(text: string): Promise<AgentMessage[]> {
    if (isOverBudget()) {
      const msg: AgentMessage = {
        role: "assistant",
        content: "[TOKEN BUDGET EXCEEDED - halting]",
      }
      this.messages.push(msg)
      return [msg]
    }

    // Add user message to conversation
    this.conversationHistory.push({
      role: "user",
      content: text,
      timestamp: Date.now(),
    } as UserMessage)

    const newMessages: AgentMessage[] = []
    const piTools = this.convertTools()

    // Agentic loop: keep going while the model wants to use tools
    let continueLoop = true
    while (continueLoop && this.turnCount < this.maxTurns && !isOverBudget()) {
      this.turnCount++

      // Build pi-ai context
      const context: Context = {
        systemPrompt: this.config.systemPrompt,
        messages: [...this.conversationHistory],
        ...(piTools.length > 0 ? { tools: piTools } : {}),
      }

      const stream = streamSimple(this.piModel, context, {
        maxTokens: 4096,
        reasoning: "low",
      })

      const result = await stream.result()

      // Calculate cost and accumulate tokens
      calculateCost(this.piModel, result.usage)
      accumulateUsage(result.usage)

      // Check for error
      if (result.stopReason === "error" || result.stopReason === "aborted") {
        const errMsg: AgentMessage = {
          role: "assistant",
          content: `[API Error: ${result.errorMessage ?? "unknown error"}]`,
        }
        newMessages.push(errMsg)
        this.messages.push(errMsg)
        return newMessages
      }

      // Add assistant message to conversation history
      this.conversationHistory.push(result)

      // Extract text content
      const textParts = result.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("")

      if (textParts) {
        newMessages.push({ role: "assistant", content: textParts })
      }

      // Extract tool calls
      const toolCalls = result.content.filter((c): c is ToolCall => c.type === "toolCall")

      if (result.stopReason === "toolUse" && toolCalls.length > 0) {
        // Process each tool call
        for (const tc of toolCalls) {
          const toolName = tc.name
          const toolInput = (tc.arguments ?? {}) as Record<string, unknown>

          // Check beforeToolCall hook (BLOCKING enforcement)
          if (this.config.beforeToolCall) {
            const hookResult = this.config.beforeToolCall(toolName, toolInput)
            if (hookResult.block) {
              const blockedResult = `BLOCKED: ${hookResult.reason ?? "unauthorized"}`
              newMessages.push({
                role: "tool",
                content: blockedResult,
                toolCall: {
                  name: toolName,
                  input: toolInput,
                  output: { blocked: true, reason: hookResult.reason ?? "unauthorized" },
                },
              })
              // Send tool result back to pi-ai conversation
              this.conversationHistory.push({
                role: "toolResult",
                toolCallId: tc.id,
                toolName,
                content: [{ type: "text", text: blockedResult }],
                isError: true,
                timestamp: Date.now(),
              } as ToolResultMessage)
              continue
            }
          }

          // Execute the tool
          const tool = this.config.tools.find((t) => t.name === toolName)
          if (tool) {
            try {
              const output = await tool.execute(toolInput)

              // afterToolCall hook
              if (this.config.afterToolCall) {
                this.config.afterToolCall(toolName, toolInput, output)
              }

              const outputStr = JSON.stringify(output)
              newMessages.push({
                role: "tool",
                content: outputStr,
                toolCall: { name: toolName, input: toolInput, output },
              })

              // Send tool result to pi-ai conversation
              this.conversationHistory.push({
                role: "toolResult",
                toolCallId: tc.id,
                toolName,
                content: [{ type: "text", text: outputStr }],
                isError: false,
                timestamp: Date.now(),
              } as ToolResultMessage)
            } catch (err) {
              const errStr = `Tool error: ${err instanceof Error ? err.message : String(err)}`
              this.conversationHistory.push({
                role: "toolResult",
                toolCallId: tc.id,
                toolName,
                content: [{ type: "text", text: errStr }],
                isError: true,
                timestamp: Date.now(),
              } as ToolResultMessage)
            }
          } else {
            this.conversationHistory.push({
              role: "toolResult",
              toolCallId: tc.id,
              toolName,
              content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
              isError: true,
              timestamp: Date.now(),
            } as ToolResultMessage)
          }
        }

        // Continue the loop only if the model stopped for tool use
        continueLoop = true
      } else {
        // Model stopped normally (stop, length) — done
        continueLoop = false
      }
    }

    this.messages.push(...newMessages)
    return newMessages
  }

  getMessages(): readonly AgentMessage[] {
    return this.messages
  }
}
