/**
 * @factory/gears — Role-to-model binding map.
 *
 * Model IDs carried forward from the retired Flue profiles (GD-001).
 *
 * BR-FLUE-04: kimi-k2.6 must bypass the CF AI Gateway (gateway flag false).
 * The coderModel binding uses the direct CF Workers AI path — not the AI
 * Gateway REST proxy — to prevent SSE stream hangs on kimi-k2.6 text turns.
 */

export type RoleName = 'planner' | 'coder' | 'critic' | 'tester' | 'verifier'

export interface ModelConfig {
  modelId: string
  /** When true the model must be called via direct Workers AI binding, not CF AI Gateway. */
  bypassGateway?: boolean
  thinkingLevel?: 'low' | 'medium' | 'high'
}

export const MODEL_BY_ROLE: Record<RoleName, ModelConfig> = {
  planner: {
    modelId: 'anthropic/claude-opus-4-6',
  },
  coder: {
    modelId: 'cloudflare/@cf/moonshotai/kimi-k2.6',
    bypassGateway: true,
    thinkingLevel: 'low',
  },
  critic: {
    modelId: 'openai/gpt-5.5',
  },
  tester: {
    modelId: 'openai/gpt-5.5',
  },
  verifier: {
    modelId: 'openai/gpt-5.5',
  },
}
