/**
 * @factory/gears — ConsentBeadAuditProcessor
 *
 * Mastra outputProcessor that enforces I4 fail-closed consent at the
 * processOutputStep boundary — after the LLM response is received, before
 * the tool call is dispatched to the executor.
 *
 * Enforcement chain: ConsentBeadAuditProcessor (writes ConsentBead + throws
 * on denied) → ToolCallFilter (secondary gate) → tool executor (never reached
 * if either threw). NFR-02, AC-6.
 */

import { BaseProcessor } from '@mastra/core/processors'
import type { ProcessOutputStepArgs } from '@mastra/core/processors'
import type { AtomDirective } from '@factory/schemas'

export class ConsentDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly beadId: string,
  ) {
    super(`ConsentDenied: tool '${toolName}' is not in permittedTools for bead '${beadId}'`)
    this.name = 'ConsentDeniedError'
  }
}

export class ConsentBeadAuditProcessor extends BaseProcessor<'consent-bead-audit'> {
  readonly id = 'consent-bead-audit' as const

  constructor(
    private readonly coordinatorDO: DurableObjectStub,
    private readonly directive: AtomDirective,
  ) {
    super()
  }

  async processOutputStep(args: ProcessOutputStepArgs): Promise<(typeof args)['messages']> {
    const { toolCalls, messages } = args
    if (!toolCalls?.length) return messages

    for (const toolCall of toolCalls) {
      // Write ConsentBead record before checking the allowlist — the audit
      // entry exists even for denied calls, which is the intended audit trail.
      const res = await this.coordinatorDO.fetch(
        new Request('https://do/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            beadId:     this.directive.atomId,
            toolName:   toolCall.toolName,
            toolCallId: toolCall.toolCallId,
          }),
        })
      )
      if (!res.ok) {
        console.warn(
          '[ConsentBeadAuditProcessor] /consent write failed: status=' +
            res.status +
            ' beadId=' + this.directive.atomId +
            ' toolName=' + toolCall.toolName
        )
      }

      // I4 fail-closed: throw before the tool executor is reached.
      // v2.0: permittedTools is deprecated-optional; canonical source is toolPolicy.permittedTools.
      const permittedTools = this.directive.permittedTools ?? this.directive.toolPolicy.permittedTools
      if (!permittedTools.includes(toolCall.toolName)) {
        throw new ConsentDeniedError(toolCall.toolName, this.directive.atomId)
      }
    }

    return messages
  }
}
