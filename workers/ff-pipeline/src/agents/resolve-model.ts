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

export function resolveAgentModel(taskKind: TaskKind, routingConfig?: RoutingConfig): Model<any> {
  const { primary } = resolve(taskKind, { config: routingConfig })

  if (primary.provider === 'cloudflare') {
    // Use Workers AI OpenAI-compatible REST API — supports proper tool calling
    // unlike the env.AI.run() binding which doesn't handle multi-turn tool loops.
    // Account ID from memory: cb56a846c70a38987f31cf6e2b85cb57
    return {
      id: primary.model,
      name: `Workers AI ${primary.model} (REST)`,
      api: 'openai-completions' as any,
      provider: 'cloudflare',
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/cb56a846c70a38987f31cf6e2b85cb57/ai/v1',
      reasoning: false,
      input: ['text'] as any,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768,
      maxTokens: 4096,
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
    maxTokens: 4096,
  }
}
