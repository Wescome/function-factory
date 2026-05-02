/**
 * Resolve the model for an agent from task-routing config.
 *
 * Agents should NOT hardcode provider/model. They get their model
 * from the routing config, which determines whether to use Workers AI
 * (dev/test) or ofox.ai (production).
 *
 * API key routing:
 *   - ofox.ai models: agents pass OFOX_API_KEY via getApiKey callback
 *   - Workers AI models: agents pass CF_API_TOKEN via getApiKey callback
 *   The model object itself never carries an API key.
 */

import type { Model } from '@weops/gdk-ai'
import { resolve, type TaskKind, type RoutingConfig } from '@factory/task-routing'

/**
 * Pick the right API key per resolved model: ofox.ai key for external
 * providers, CF_API_TOKEN for Cloudflare Workers AI REST API.
 */
export function keyForModel(
  model: { provider: string },
  env: { CF_API_TOKEN?: string; OFOX_API_KEY?: string },
): string {
  if (model.provider === 'cloudflare') {
    if (!env.CF_API_TOKEN) console.warn('[keyForModel] CF_API_TOKEN not set')
    return env.CF_API_TOKEN ?? ''
  }
  if (!env.OFOX_API_KEY) console.warn(`[keyForModel] OFOX_API_KEY not set for ${model.provider}`)
  return env.OFOX_API_KEY ?? ''
}

export function resolveAgentModel(taskKind: TaskKind, routingConfig?: RoutingConfig): Model<any> {
  const { primary } = resolve(taskKind, { ...(routingConfig ? { config: routingConfig } : {}) })

  if (primary.provider === 'cloudflare') {
    const isKimi = primary.model.includes('kimi')
    const isGptOss = primary.model.includes('gpt-oss')
    return {
      id: primary.model,
      name: `Workers AI ${primary.model} (REST)`,
      api: 'openai-completions' as any,
      provider: 'cloudflare',
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/cb56a846c70a38987f31cf6e2b85cb57/ai/v1',
      reasoning: isGptOss,
      input: ['text'] as any,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: isKimi ? 262144 : isGptOss ? 128000 : 32768,
      maxTokens: isKimi ? 65536 : isGptOss ? 32768 : 8192,
    }
  }

  return {
    id: `${primary.provider}/${primary.model}`,
    name: `${primary.provider} ${primary.model} via ofox.ai`,
    api: 'openai-completions' as any,
    provider: primary.provider,
    baseUrl: 'https://api.ofox.ai/v1',
    reasoning: false,
    input: ['text'] as any,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  }
}
