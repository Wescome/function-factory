/**
 * Real Anthropic API integration for the synthesis topology.
 *
 * Replaces pi-agent-mock.ts with actual Claude API calls via fetch().
 * Uses the same Model/Agent interface so PiAgentBindingMode works unchanged.
 *
 * JTBD: When the Factory runs its first live synthesis, I want real LLM
 * responses from Claude Haiku driving each role agent, so the synthesis
 * produces actual code rather than mock stubs.
 */

import type {
  Model,
  ModelResponse,
  ToolSchema,
  BeforeToolCallResult,
  AgentConfig,
  AgentMessage,
} from "./pi-agent-mock.js"

// ─── Token Tracking ─────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

const globalTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

export function getGlobalTokenUsage(): Readonly<TokenUsage> {
  return { ...globalTokenUsage }
}

export function resetGlobalTokenUsage(): void {
  globalTokenUsage.inputTokens = 0
  globalTokenUsage.outputTokens = 0
}

const TOKEN_BUDGET = 50_000

export function isOverBudget(): boolean {
  return (globalTokenUsage.inputTokens + globalTokenUsage.outputTokens) > TOKEN_BUDGET
}

// ─── Anthropic API Types ────────────────────────────────────────────

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | AnthropicContentBlock[]
}

interface AnthropicContentBlock {
  type: "text" | "tool_use" | "tool_result"
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface AnthropicResponse {
  id: string
  content: AnthropicContentBlock[]
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"
  usage: { input_tokens: number; output_tokens: number }
}

// ─── Real Model ─────────────────────────────────────────────────────

export function createRealModel(provider: string, modelId: string): Model {
  return {
    provider,
    modelId,
    async generate(prompt: string): Promise<ModelResponse> {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set")

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Anthropic API error ${response.status}: ${errText}`)
      }

      const data = (await response.json()) as AnthropicResponse

      globalTokenUsage.inputTokens += data.usage.input_tokens
      globalTokenUsage.outputTokens += data.usage.output_tokens

      const text = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")

      return {
        text,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        },
      }
    },
  }
}

// ─── Real Agent ─────────────────────────────────────────────────────

export class RealAnthropicAgent {
  private readonly config: AgentConfig
  private readonly messages: AgentMessage[] = []
  private readonly conversationHistory: AnthropicMessage[] = []
  private turnCount = 0
  private readonly maxTurns: number

  constructor(config: AgentConfig, maxTurns = 5) {
    this.config = config
    this.maxTurns = maxTurns
  }

  /**
   * Send a prompt to the agent. Makes a real Anthropic API call with
   * tools. Handles tool-use loops up to maxTurns.
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

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set")

    // Add user message to conversation
    this.conversationHistory.push({ role: "user", content: text })

    const newMessages: AgentMessage[] = []

    // Agentic loop: keep going while the model wants to use tools
    let continueLoop = true
    while (continueLoop && this.turnCount < this.maxTurns && !isOverBudget()) {
      this.turnCount++

      // Build tool schemas for API
      const tools: AnthropicTool[] = this.config.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }))

      const body: Record<string, unknown> = {
        model: this.config.model.modelId,
        max_tokens: 4096,
        system: this.config.systemPrompt,
        messages: this.conversationHistory,
      }

      if (tools.length > 0) {
        body.tools = tools
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errText = await response.text()
        const errMsg: AgentMessage = {
          role: "assistant",
          content: `[API Error ${response.status}: ${errText.slice(0, 200)}]`,
        }
        newMessages.push(errMsg)
        this.messages.push(errMsg)
        return newMessages
      }

      const data = (await response.json()) as AnthropicResponse

      globalTokenUsage.inputTokens += data.usage.input_tokens
      globalTokenUsage.outputTokens += data.usage.output_tokens

      // Process content blocks
      const assistantContentBlocks: AnthropicContentBlock[] = data.content
      const toolResultBlocks: AnthropicContentBlock[] = []
      let hasToolUse = false

      // Add assistant response to conversation history
      this.conversationHistory.push({
        role: "assistant",
        content: assistantContentBlocks,
      })

      for (const block of assistantContentBlocks) {
        if (block.type === "text" && block.text) {
          newMessages.push({ role: "assistant", content: block.text })
        } else if (block.type === "tool_use" && block.name && block.id) {
          hasToolUse = true
          const toolName = block.name
          const toolInput = (block.input ?? {}) as Record<string, unknown>

          // Check beforeToolCall hook
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
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: blockedResult,
              })
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
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: outputStr,
              })
            } catch (err) {
              const errStr = `Tool error: ${err instanceof Error ? err.message : String(err)}`
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: errStr,
              })
            }
          } else {
            toolResultBlocks.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Unknown tool: ${toolName}`,
            })
          }
        }
      }

      // If there were tool uses, add tool results and continue the loop
      if (hasToolUse && toolResultBlocks.length > 0) {
        this.conversationHistory.push({
          role: "user",
          content: toolResultBlocks,
        })
        continueLoop = data.stop_reason === "tool_use"
      } else {
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
