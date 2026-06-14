/**
 * @factory/gears — buildConductingAgent
 *
 * Factory function that constructs a Mastra Agent for atom execution.
 * Called by ThinkExecutor.executeAtom() inside the ThinkExecutor DO on every
 * invocation — the agent is constructed locally, never serialized or shared
 * across DO boundaries (D-3 resolved).
 *
 * FR-09: T2 input/output processor chains wired here.
 * NFR-02: I4 fail-closed consent via ConsentBeadAuditProcessor in outputProcessors.
 */

import { Agent } from '@mastra/core/agent'
import type { ToolsInput } from '@mastra/core/agent'
import { Memory, ModelByInputTokens } from '@mastra/memory'
import { D1Store } from '@mastra/cloudflare-d1'
import type { OutputProcessorOrWorkflow } from '@mastra/core/processors'
import {
  UnicodeNormalizer,
  PromptInjectionDetector,
  ModerationProcessor,
  PIIDetector,
  ToolCallFilter,
  BatchPartsProcessor,
} from '@mastra/core/processors'
import { createWorkspaceTools } from '@cloudflare/think/tools/workspace'
import type { WorkspaceLike } from '@cloudflare/think/tools/workspace'
import { createExecuteTool } from '@cloudflare/think/tools/execute'
import { createSandboxTools } from '@cloudflare/think/tools/sandbox'
import type { AtomDirective } from '@factory/schemas'
import { MODEL_BY_ROLE } from './models.js'
import { ConsentBeadAuditProcessor } from '../processors/consent-bead-audit-processor.js'

export interface ConductorEnv {
  DB: D1Database
  LOADER: WorkerLoader
  SANDBOX?: unknown
}

function buildSystemPrompt(directive: AtomDirective): string {
  return [
    `You are a ${directive.role} agent executing atom '${directive.atomRef}'.`,
    '',
    directive.instruction,
  ].join('\n')
}

export function buildConductingAgent(
  directive: AtomDirective,
  coordinatorDO: DurableObjectStub,
  thinkExecutorDO: WorkspaceLike,
  env: ConductorEnv,
): Agent {
  const { modelId } = MODEL_BY_ROLE[directive.role]
  const safetyModel = 'openai/gpt-4o'

  return new Agent({
    id: `conducting-agent-${directive.atomId}`,
    name: `ConductingAgent[${directive.role}]`,
    instructions: buildSystemPrompt(directive),
    model: modelId,
    tools: async () => {
      const workspaceTools = createWorkspaceTools(thinkExecutorDO)
      return {
        ...workspaceTools,
        execute: createExecuteTool({ tools: workspaceTools, loader: env.LOADER }),
        ...createSandboxTools(env.SANDBOX),
      } as ToolsInput
    },
    memory: new Memory({
      storage: new D1Store({ id: 'gears-agent-memory', binding: env.DB }),
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
      new ConsentBeadAuditProcessor(coordinatorDO, directive),
      // ToolCallFilter strips tool call history from message context — placed
      // here as the secondary structural gate after ConsentBeadAuditProcessor
      // throws on denied calls (FR-09, NFR-02). Type cast required: the class
      // only implements input-side methods; the processor runner skips it for
      // output steps, making it a no-op at this position. If ConsentBead
      // threw, execution never reaches the tool executor regardless.
      new ToolCallFilter() as unknown as OutputProcessorOrWorkflow,
      new BatchPartsProcessor(),
      new PIIDetector({ model: safetyModel }),
    ],
  })
}
