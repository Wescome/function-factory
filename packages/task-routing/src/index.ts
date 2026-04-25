/**
 * @module task-routing
 *
 * Maps task kinds to provider/model pairs. The Factory's model routing
 * layer — stages and gates call resolve() to get a target, then use
 * the target to make the actual LLM call.
 *
 * Default routing table optimized for cost: Haiku for structured/planning
 * work, Sonnet for critic/synthesis where quality matters more.
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

export interface RouteTarget {
  provider: 'anthropic' | 'openai' | 'deepseek'
  model: string
}

const DEFAULT_ROUTES: Record<TaskKind, RouteTarget> = {
  planning:      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  structured:    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  interpretive:  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  critic:        { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  synthesis:     { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  validation:    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  // Stage 6 roles — Haiku for planning/testing, Sonnet for code/decisions
  planner:       { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  coder:         { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tester:        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  verifier:      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
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
