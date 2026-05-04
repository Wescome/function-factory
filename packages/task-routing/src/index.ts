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
  | 'crystallizer'
  | 'probe'
  | 'planner'
  | 'coder'
  | 'critic'
  | 'tester'
  | 'verifier'
  | 'governor'

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

const CF_70B: RouteTarget = { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }
const CF_KIMI_K26: RouteTarget = { provider: 'cloudflare', model: '@cf/moonshotai/kimi-k2.6' }
const CF_GPT_OSS: RouteTarget = { provider: 'cloudflare', model: '@cf/openai/gpt-oss-120b' }
const DEEPSEEK_PRO: RouteTarget = { provider: 'deepseek', model: 'deepseek-v4-pro' }
const GEMINI_PRO: RouteTarget = { provider: 'google', model: 'gemini-3.1-pro-preview' }

// ── Default config ──
// Pipeline stages (1-5): Workers AI llama-70b (zero cost)
// Agent roles (Stage 6): Workers AI kimi-k2.6 (agent-first, single auth, CF billing)
//   deepseek-v4-pro: BL6 training inertia — produces function-call JSON for every schema

export const DEFAULT_CONFIG: RoutingConfig = {
  routes: [
    // Pipeline stages (1-5): llama-70b primary, deepseek-v4-pro fallback (cross-provider)
    // Fallback only triggers on retriable errors (timeout, network, 5xx)
    // Cross-provider fallback eliminates correlated Workers AI platform failures
    { kind: 'planning', primary: CF_70B, fallback: DEEPSEEK_PRO },
    { kind: 'structured', primary: CF_70B, fallback: DEEPSEEK_PRO },
    { kind: 'interpretive', primary: CF_70B, fallback: DEEPSEEK_PRO },
    { kind: 'synthesis', primary: CF_70B, fallback: DEEPSEEK_PRO },
    { kind: 'validation', primary: CF_70B, fallback: DEEPSEEK_PRO },
    { kind: 'runtime_check', primary: CF_70B, fallback: DEEPSEEK_PRO },
    { kind: 'semantic_review', primary: CF_70B, fallback: DEEPSEEK_PRO },
    // Crystallizer + Probe: llama-70b primary, deepseek-v4-pro fallback
    { kind: 'crystallizer', primary: CF_70B, fallback: DEEPSEEK_PRO },
    { kind: 'probe', primary: CF_70B, fallback: DEEPSEEK_PRO },
    // Agent roles (Stage 6): kimi-k2.6 via REST API (agent-first, proven 3/5 atoms)
    { kind: 'planner', primary: CF_KIMI_K26, fallback: CF_70B },
    { kind: 'coder', primary: CF_KIMI_K26, fallback: CF_70B },
    { kind: 'critic', primary: CF_KIMI_K26, fallback: CF_70B },
    { kind: 'tester', primary: CF_KIMI_K26, fallback: CF_70B },
    { kind: 'verifier', primary: CF_KIMI_K26, fallback: CF_70B },
    // Governor: gpt-oss-120b (reasoning separation + schema compliance)
    { kind: 'governor', primary: CF_GPT_OSS, fallback: CF_KIMI_K26 },
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

/**
 * Classify whether an error is retriable (worth trying a fallback provider).
 *
 * Retriable: timeout, network failures, 5xx server errors, empty responses.
 * Non-retriable: JSON parse errors, schema validation errors, application logic errors.
 * Unknown (non-Error) values: treat as retriable to maximize resilience.
 */
export function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return true // unknown errors: try fallback
  const msg = err.message.toLowerCase()
  const retriablePatterns = ['timeout', 'econnrefused', 'econnreset', '502', '503', '504', 'fetch failed', 'network', 'empty response']
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true
  return retriablePatterns.some(p => msg.includes(p))
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
    if (fallback && isRetriableError(err)) {
      return await fn(fallback)
    }
    throw err
  }
}
