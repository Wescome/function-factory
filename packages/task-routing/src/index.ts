/**
 * @module task-routing
 *
 * Maps task kinds to provider/model pairs.
 *
 * v4: Workers AI is THE provider. CF paid plan includes it.
 * ofox.ai is production-only — not for dev/test/iteration.
 * We proved ofox.ai works. Workers AI handles everything now.
 *
 * Resolution order:
 *   1. If passId provided -> check route.passOverrides[passId]
 *   2. If no override     -> use route primary/fallback
 *   3. If no route        -> use config default
 */

// ── Types (plain TS, no Zod) ──

export type TaskKind =
  | 'planning'
  | 'structured'
  | 'interpretive'
  | 'synthesis'
  | 'validation'
  | 'runtime_check'
  | 'semantic_review'
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

// ── Workers AI models ──

const CF_PRIMARY: RouteTarget = { provider: 'cloudflare', model: '@cf/moonshotai/kimi-k2.6' }

// ── Default config: Workers AI for everything ──

export const DEFAULT_CONFIG: RoutingConfig = {
  routes: [
    { kind: 'planning', primary: CF_PRIMARY },
    { kind: 'structured', primary: CF_PRIMARY },
    { kind: 'interpretive', primary: CF_PRIMARY },
    { kind: 'synthesis', primary: CF_PRIMARY },
    { kind: 'semantic_review', primary: CF_PRIMARY },
    { kind: 'validation', primary: CF_PRIMARY },
    { kind: 'runtime_check', primary: CF_PRIMARY },
    { kind: 'planner', primary: CF_PRIMARY },
    { kind: 'coder', primary: CF_PRIMARY },
    { kind: 'critic', primary: CF_PRIMARY },
    { kind: 'tester', primary: CF_PRIMARY },
    { kind: 'verifier', primary: CF_PRIMARY },
  ],
  default: CF_PRIMARY,
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
