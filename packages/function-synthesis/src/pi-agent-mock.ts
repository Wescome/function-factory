/**
 * Mock implementations of @mariozechner/pi-ai and @mariozechner/pi-agent-core.
 *
 * These provide the interface contract that PiAgentBindingMode programs
 * against. Swap for real packages when available on npm.
 *
 * JTBD: When the Factory needs a concrete agent execution substrate,
 * I want typed mock interfaces for model routing and stateful agent
 * execution, so I can build and test the binding mode without external
 * package dependencies.
 */

// ─── pi-ai: Model Routing ────────────────────────────────────────────

export interface Model {
  readonly provider: string
  readonly modelId: string
  generate(prompt: string): Promise<ModelResponse>
}

export interface ModelResponse {
  readonly text: string
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
}

export function getModel(provider: string, modelId: string): Model {
  return {
    provider,
    modelId,
    async generate(prompt: string): Promise<ModelResponse> {
      return {
        text: `[mock response from ${provider}/${modelId}]`,
        usage: { inputTokens: prompt.length, outputTokens: 50 },
      }
    },
  }
}

// ─── pi-agent-core: Stateful Agent ───────────────────────────────────

export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export interface BeforeToolCallResult {
  readonly block: boolean
  readonly reason?: string | undefined
}

export interface AgentConfig {
  readonly model: Model
  readonly systemPrompt: string
  readonly tools: readonly ToolSchema[]
  readonly beforeToolCall?: ((toolName: string, input: Record<string, unknown>) => BeforeToolCallResult) | undefined
  readonly afterToolCall?: ((toolName: string, input: Record<string, unknown>, output: Record<string, unknown>) => void) | undefined
}

export interface AgentMessage {
  readonly role: "assistant" | "tool"
  readonly content: string
  readonly toolCall?: {
    readonly name: string
    readonly input: Record<string, unknown>
    readonly output: Record<string, unknown>
  } | undefined
}

export class Agent {
  private readonly config: AgentConfig
  private readonly messages: AgentMessage[] = []

  constructor(config: AgentConfig) {
    this.config = config
  }

  /**
   * Send a prompt to the agent. The agent generates a response,
   * optionally calling tools (subject to beforeToolCall/afterToolCall hooks).
   *
   * In this mock implementation, the model generates text and may
   * attempt one tool call per prompt to exercise the hook machinery.
   */
  async prompt(text: string, options?: { attemptToolCall?: string | undefined }): Promise<AgentMessage[]> {
    const response = await this.config.model.generate(
      `${this.config.systemPrompt}\n\nUser: ${text}`,
    )

    const newMessages: AgentMessage[] = []

    // If a tool call is requested (for testing hooks), attempt it
    if (options?.attemptToolCall !== undefined) {
      const toolName = options.attemptToolCall
      const tool = this.config.tools.find((t) => t.name === toolName)
      const input: Record<string, unknown> = {}

      // Check beforeToolCall hook
      if (this.config.beforeToolCall !== undefined) {
        const hookResult = this.config.beforeToolCall(toolName, input)
        if (hookResult.block) {
          // Tool call blocked - record but do not execute
          newMessages.push({
            role: "tool",
            content: `BLOCKED: ${hookResult.reason ?? "unauthorized"}`,
            toolCall: {
              name: toolName,
              input,
              output: { blocked: true, reason: hookResult.reason ?? "unauthorized" },
            },
          })
          this.messages.push(...newMessages)
          return newMessages
        }
      }

      // Execute the tool if found
      if (tool !== undefined) {
        const output = await tool.execute(input)

        // afterToolCall hook
        if (this.config.afterToolCall !== undefined) {
          this.config.afterToolCall(toolName, input, output)
        }

        newMessages.push({
          role: "tool",
          content: JSON.stringify(output),
          toolCall: { name: toolName, input, output },
        })
      }
    }

    // Add the assistant response
    newMessages.push({
      role: "assistant",
      content: response.text,
    })

    this.messages.push(...newMessages)
    return newMessages
  }

  getMessages(): readonly AgentMessage[] {
    return this.messages
  }
}
