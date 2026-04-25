/**
 * @module task-routing
 *
 * Maps task kinds to provider/model pairs via ofox.ai unified gateway.
 * April 2026 routing config: DeepSeek V4 Flash default, Gemini for
 * proposals, Opus for Critic only, GLM-5 for invariants/validations.
 */

export type TaskKind =
  // Pipeline stage kinds (Stages 1-5)
  | 'planning'
  | 'structured'
  | 'interpretive'
  | 'critic'
  | 'synthesis'
  | 'validation'
  // Stage 6 synthesis role kinds
  | 'planner'
  | 'coder'
  | 'tester'
  | 'verifier'

export type Provider =
  | 'deepseek'
  | 'google'
  | 'anthropic'
  | 'z-ai'
  | 'moonshotai'
  | 'minimax'

export interface RouteTarget {
  provider: Provider
  model: string
}

const DEFAULT_ROUTES: Record<TaskKind, RouteTarget> = {
  // Stage 1: Signal ingestion — extraction, cheap
  planning:      { provider: 'deepseek', model: 'deepseek-v4-flash' },

  // Stages 2-3 compile passes: classification + structured output
  structured:    { provider: 'deepseek', model: 'deepseek-v4-flash' },

  // Stage 4: Function proposal — needs design judgment
  interpretive:  { provider: 'google',   model: 'gemini-3.1-pro-preview' },

  // Semantic review (Critic) — Opus only, latent associative reasoning
  critic:        { provider: 'anthropic', model: 'claude-opus-4.6' },

  // Compile passes 3+5: invariant/validation generation — mid-tier reasoning
  synthesis:     { provider: 'z-ai',     model: 'glm-5' },

  // Validation / runtime checks — cheap
  validation:    { provider: 'deepseek', model: 'deepseek-v4-flash' },

  // Stage 6 roles
  planner:       { provider: 'google',   model: 'gemini-3.1-pro-preview' },
  coder:         { provider: 'deepseek', model: 'deepseek-v4-pro' },
  tester:        { provider: 'deepseek', model: 'deepseek-v4-pro' },
  verifier:      { provider: 'google',   model: 'gemini-3.1-pro-preview' },
}

let overrides: Partial<Record<TaskKind, RouteTarget>> = {}

export function resolve(taskKind: TaskKind): RouteTarget {
  return overrides[taskKind] ?? DEFAULT_ROUTES[taskKind]
}

export async function resolveAndCall(
  taskKind: TaskKind,
  callFn: (target: RouteTarget) => Promise<string>,
): Promise<string> {
  const target = resolve(taskKind)
  return callFn(target)
}

export function setOverride(taskKind: TaskKind, target: RouteTarget): void {
  overrides[taskKind] = target
}

export function clearOverrides(): void {
  overrides = {}
}
