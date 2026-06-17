/**
 * @factory/gears — buildPlannerAgent
 *
 * Factory function that constructs a Mastra Agent for structured LLM inference
 * during compiler passes. Unlike buildConductingAgent, this agent has no tools
 * (no workspace, no execute, no sandbox) and no ConsentBeadAuditProcessor or
 * CommitTracingProcessor — compiler passes are pure structured inference, not
 * tool-driven atom execution.
 *
 * SPEC-FF-CA-REWRITE-001 §buildPlannerAgent
 * CA-INV-005: All LLM calls in ca-compiler-workflow go through this function.
 */

import { Agent } from '@mastra/core/agent'
import { Memory, ModelByInputTokens } from '@mastra/memory'
import { D1Store } from '@mastra/cloudflare-d1'
import {
  UnicodeNormalizer,
  PromptInjectionDetector,
  ModerationProcessor,
  PIIDetector,
} from '@mastra/core/processors'
import { MODEL_BY_ROLE } from './models.js'

export interface PlannerAgentEnv {
  DB: D1Database
  CLOUDFLARE_ACCOUNT_ID: string
  CF_API_TOKEN: string
}

export function buildPlannerAgent(
  role: 'planner',
  env: PlannerAgentEnv,
): Agent {
  const modelId = MODEL_BY_ROLE[role].modelId
  const model = modelId.startsWith('cloudflare/')
    ? {
        id: modelId as `${string}/${string}`,
        url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
        apiKey: env.CF_API_TOKEN,
      }
    : modelId
  const safetyModel = 'openai/gpt-4o'

  return new Agent({
    id: `planner-agent-${role}`,
    name: `PlannerAgent[${role}]`,
    // System prompt is provided per-step via generate({ instructions }) at call
    // time. The Agent type requires a default; an empty string is the minimal
    // valid value and is overridden by every ca-compiler-workflow step.
    instructions: '',
    model,
    memory: new Memory({
      storage: new D1Store({ id: 'ca-planner-memory', binding: env.DB }),
      options: {
        observationalMemory: {
          model: new ModelByInputTokens({
            upTo: {
              10_000: 'google/gemini-2.5-flash',
              40_000: 'openai/gpt-4o',
              1_000_000: 'openai/gpt-4.5',
            },
          }),
        },
      },
    }),
    inputProcessors: [
      new UnicodeNormalizer(),
      new PromptInjectionDetector({ model: safetyModel }),
      new ModerationProcessor({ model: safetyModel }),
      new PIIDetector({ model: safetyModel }),
    ],
    outputProcessors: [
      new PIIDetector({ model: safetyModel }),
    ],
  })
}
