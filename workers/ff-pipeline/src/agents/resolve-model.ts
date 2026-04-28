/**
 * Resolve the model for an agent from task-routing config.
 *
 * Agents should NOT hardcode provider/model. They get their model
 * from the routing config, which determines whether to use Workers AI
 * (dev/test) or ofox.ai (production).
 */

import type { Model } from '@weops/gdk-ai'
import { resolve, type TaskKind } from '@factory/task-routing'

export function resolveAgentModel(taskKind: TaskKind, apiKey: string): Model<any> {
  const { primary } = resolve(taskKind)

  if (primary.provider === 'cloudflare') {
    return {
      id: primary.model,
      name: `Workers AI ${primary.model}`,
      api: 'openai-completions' as any,
      provider: 'cloudflare',
      baseUrl: 'https://api.cloudflare.com/client/v4/ai/run',
      reasoning: false,
      input: ['text'] as any,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768,
      maxTokens: 2048,
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
