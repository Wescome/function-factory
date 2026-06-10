// Type stubs for @flue/runtime — SPEC-FF-GEARS-001 §6
// Replace when @flue/runtime publishes official types.

declare module '@flue/runtime' {
  export interface AgentProfile {
    name:           string
    model:          string
    instructions:   string
    skills?:        unknown[]
    tools?:         unknown[]
    subagents?:     unknown[]
    thinkingLevel?: 'none' | 'low' | 'medium' | 'high'
    compaction?:    unknown
    durability?:    unknown
  }

  export function defineAgentProfile(profile: AgentProfile): AgentProfile

  export type WorkflowRouteHandler = (
    c: unknown,
    next: () => Promise<unknown>,
  ) => Promise<unknown>

  export interface FlueContext<TPayload = unknown> {
    init: (agent: unknown) => Promise<unknown>
    payload: TPayload
    env: Record<string, string>
  }

  export function configureProvider(
    provider: string,
    config: {
      baseUrl: string
      headers: Record<string, string>
      apiKey: string
    },
  ): void

  export function createAgent(
    factory: (opts?: unknown) => {
      model: string
      [key: string]: unknown
    },
  ): unknown
}
