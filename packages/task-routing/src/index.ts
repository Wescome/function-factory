/**
 * @module task-routing
 *
 * Maps task kinds to provider/model pairs via ofox.ai unified gateway.
 *
 * v2: adds pass-level overrides (passId), new TaskKinds (semantic_review,
 * runtime_check), and cloudflare (Workers AI) as a fallback provider.
 *
 * Resolution order:
 *   1. If passId provided -> check route.passOverrides[passId]
 *   2. If no override     -> use route primary/fallback
 *   3. If no route        -> use config default
 *
 * Model IDs use ofox.ai identifiers: claude-opus-4.6 (dots),
 * gemini-3.1-pro-preview (-preview suffix), z-ai (not zhipu),
 * moonshotai (not moonshot).
 */

// ── Types (plain TS, no Zod) ──

export type TaskKind =
  // Pipeline stage kinds (Stages 1-5)
  | 'planning'
  | 'structured'
  | 'interpretive'
  | 'synthesis'
  | 'validation'
  | 'runtime_check'
  | 'semantic_review'
  // Stage 6 synthesis role kinds
  | 'planner'
  | 'coder'
  | 'critic'
  | 'tester'
  | 'verifier'

export type Provider =
  | 'deepseek'
  | 'google'
  | 'anthropic'
  | 'z-ai'
  | 'moonshotai'
  | 'minimax'
  | 'openai'
  | 'cloudflare'

export interface RouteTarget {
  provider: Provider | string
  model: string
}

export interface PassOverride {
  primary: RouteTarget
  fallback?: RouteTarget
}

export interface Route {
  kind: TaskKind
  primary: RouteTarget
  fallback?: RouteTarget
  passOverrides?: Record<string, PassOverride>
}

export interface RoutingConfig {
  routes: Route[]
  default: RouteTarget
}

// ── Resolution result ──

export interface ResolvedRoute {
  primary: RouteTarget
  fallback?: RouteTarget | undefined
  /** Which resolution path was taken */
  resolvedVia: 'pass-override' | 'route-default' | 'config-default'
  /** The passId that matched (if any) */
  passId?: string | undefined
}

// ── Default config ──

export const DEFAULT_CONFIG: RoutingConfig = {
  routes: [
    // Planning tier (signal, pressure, capability, simple compiler passes)
    {
      kind: 'planning',
      primary: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      fallback: { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
      passOverrides: {
        // Stage 2: Pressure synthesis — needs causal reasoning
        'stage_2_pressure': {
          primary: { provider: 'deepseek', model: 'deepseek-v4-pro' },
          fallback: { provider: 'google', model: 'gemini-3.1-pro-preview' },
        },
        // Stage 3: Capability mapping — needs disciplined scoping
        'stage_3_capability': {
          primary: { provider: 'google', model: 'gemini-3.1-pro-preview' },
          fallback: { provider: 'deepseek', model: 'deepseek-v4-pro' },
        },
        // Stage 1: Signal ingestion — trivial extraction, Workers AI
        'stage_1_signal': {
          primary: { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
          fallback: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        },
        // Compiler pass 0: Normalize — extraction
        'pass_0_normalize': {
          primary: { provider: 'deepseek', model: 'deepseek-v4-flash' },
          fallback: { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
        },
        // Compiler pass 1: Atoms — decomposition
        'pass_1_atoms': {
          primary: { provider: 'deepseek', model: 'deepseek-v4-flash' },
          fallback: { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
        },
      },
    },

    // Structured tier (contracts, invariants, validations, dependencies)
    {
      kind: 'structured',
      primary: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      fallback: { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
      passOverrides: {
        'pass_2_contracts': {
          primary: { provider: 'deepseek', model: 'deepseek-v4-flash' },
          fallback: { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
        },
        'pass_3_invariants': {
          primary: { provider: 'z-ai', model: 'glm-5' },
          fallback: { provider: 'deepseek', model: 'deepseek-v4-pro' },
        },
        'pass_4_dependencies': {
          primary: { provider: 'deepseek', model: 'deepseek-v4-flash' },
          fallback: { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
        },
        'pass_5_validations': {
          primary: { provider: 'z-ai', model: 'glm-5' },
          fallback: { provider: 'deepseek', model: 'deepseek-v4-pro' },
        },
      },
    },

    // Interpretive tier (function proposal, ambiguity resolution)
    {
      kind: 'interpretive',
      primary: { provider: 'google', model: 'gemini-3.1-pro-preview' },
      fallback: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    },

    // Synthesis tier (assembly, cross-referencing)
    {
      kind: 'synthesis',
      primary: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      fallback: { provider: 'google', model: 'gemini-3.1-pro-preview' },
    },

    // Semantic review (Opus only — judgment, not reasoning)
    {
      kind: 'semantic_review',
      primary: { provider: 'anthropic', model: 'claude-opus-4.6' },
      fallback: { provider: 'google', model: 'gemini-3.1-pro-preview' },
    },

    // Validation (high-volume, cost-sensitive)
    {
      kind: 'validation',
      primary: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      fallback: { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
    },

    // Runtime check (Stage 7 monitoring, Gate 3)
    {
      kind: 'runtime_check',
      primary: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      fallback: { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
    },

    // Stage 6 roles
    {
      kind: 'planner',
      primary: { provider: 'google', model: 'gemini-3.1-pro-preview' },
      fallback: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    },
    {
      kind: 'coder',
      primary: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      fallback: { provider: 'anthropic', model: 'claude-opus-4.6' },
    },
    {
      kind: 'critic',
      primary: { provider: 'anthropic', model: 'claude-opus-4.6' },
      fallback: { provider: 'google', model: 'gemini-3.1-pro-preview' },
    },
    {
      kind: 'tester',
      primary: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      fallback: { provider: 'moonshotai', model: 'kimi-k2.6' },
    },
    {
      kind: 'verifier',
      primary: { provider: 'google', model: 'gemini-3.1-pro-preview' },
      fallback: { provider: 'anthropic', model: 'claude-opus-4.6' },
    },
  ],
  default: { provider: 'deepseek', model: 'deepseek-v4-flash' },
}

// ── Resolution functions ──

/**
 * Look up the provider/model pair for a pipeline task.
 *
 * @param kind   - task kind (broad category)
 * @param opts   - optional: passId for pass-level override, config override
 */
export function resolve(
  kind: TaskKind,
  opts?: { passId?: string; config?: RoutingConfig },
): ResolvedRoute {
  const config = opts?.config ?? DEFAULT_CONFIG
  const passId = opts?.passId

  const route = config.routes.find((r) => r.kind === kind)

  if (!route) {
    return {
      primary: config.default,
      resolvedVia: 'config-default',
    }
  }

  // Check pass-level override first
  if (passId && route.passOverrides?.[passId]) {
    const override = route.passOverrides[passId]!
    return {
      primary: override.primary,
      fallback: override.fallback ?? route.fallback,
      resolvedVia: 'pass-override',
      passId,
    }
  }

  return {
    primary: route.primary,
    fallback: route.fallback,
    resolvedVia: 'route-default',
  }
}

/**
 * Resolve with automatic fallback attempt. Calls `fn` with the primary
 * target; if it throws, retries with the fallback (if one exists).
 */
export async function resolveAndCall<T>(
  kind: TaskKind,
  fn: (target: RouteTarget) => Promise<T>,
  opts?: { passId?: string; config?: RoutingConfig },
): Promise<T> {
  const { primary, fallback } = resolve(kind, opts)

  try {
    return await fn(primary)
  } catch (err) {
    if (fallback) {
      return await fn(fallback)
    }
    throw err
  }
}
