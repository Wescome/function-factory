/**
 * @module task-routing
 *
 * Maps task kinds to provider/model pairs.
 *
 * v3: Workers AI (cloudflare) as PRIMARY for cost-sensitive tiers.
 * ofox.ai as fallback for quality-critical tasks only.
 * CF Workers AI is included in the paid plan — essentially free.
 *
 * Resolution order:
 *   1. If passId provided -> check route.passOverrides[passId]
 *   2. If no override     -> use route primary/fallback
 *   3. If no route        -> use config default
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
  resolvedVia: 'pass-override' | 'route-default' | 'config-default'
  passId?: string | undefined
}

// ── Providers ──

const CF_70B: RouteTarget = { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }
const DEEPSEEK_FLASH: RouteTarget = { provider: 'deepseek', model: 'deepseek-v4-flash' }
const DEEPSEEK_PRO: RouteTarget = { provider: 'deepseek', model: 'deepseek-v4-pro' }
const GEMINI_PRO: RouteTarget = { provider: 'google', model: 'gemini-3.1-pro-preview' }
const CLAUDE_OPUS: RouteTarget = { provider: 'anthropic', model: 'claude-opus-4.6' }

// ── Default config ──
// Workers AI is primary for cost-sensitive tiers (Stages 1-5, validation).
// ofox.ai providers are fallback for quality-critical roles (critic, coder).

export const DEFAULT_CONFIG: RoutingConfig = {
  routes: [
    // Planning tier: Workers AI primary (signal, pressure, capability, compiler passes)
    {
      kind: 'planning',
      primary: CF_70B,
      fallback: DEEPSEEK_FLASH,
    },

    // Structured tier: Workers AI primary (contracts, invariants, deps, validations)
    {
      kind: 'structured',
      primary: CF_70B,
      fallback: DEEPSEEK_FLASH,
    },

    // Interpretive tier: Workers AI primary (function proposal)
    {
      kind: 'interpretive',
      primary: CF_70B,
      fallback: GEMINI_PRO,
    },

    // Synthesis tier: Workers AI primary (assembly)
    {
      kind: 'synthesis',
      primary: CF_70B,
      fallback: DEEPSEEK_PRO,
    },

    // Semantic review: quality-critical — ofox.ai primary
    {
      kind: 'semantic_review',
      primary: CLAUDE_OPUS,
      fallback: GEMINI_PRO,
    },

    // Validation: Workers AI primary (high-volume, cost-sensitive)
    {
      kind: 'validation',
      primary: CF_70B,
      fallback: DEEPSEEK_FLASH,
    },

    // Runtime check: Workers AI primary
    {
      kind: 'runtime_check',
      primary: CF_70B,
      fallback: DEEPSEEK_FLASH,
    },

    // Stage 6 roles — quality-critical roles use ofox.ai, others use Workers AI
    {
      kind: 'planner',
      primary: CF_70B,
      fallback: GEMINI_PRO,
    },
    {
      kind: 'coder',
      primary: DEEPSEEK_PRO,
      fallback: CF_70B,
    },
    {
      kind: 'critic',
      primary: CLAUDE_OPUS,
      fallback: CF_70B,
    },
    {
      kind: 'tester',
      primary: CF_70B,
      fallback: DEEPSEEK_PRO,
    },
    {
      kind: 'verifier',
      primary: GEMINI_PRO,
      fallback: CF_70B,
    },
  ],
  default: CF_70B,
}

// ── Resolution functions ──

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
