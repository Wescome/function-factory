export type GuardrailAction = 'allow' | 'warn' | 'block' | 'halt'

export interface ToolCallSignature {
  toolName: string
  argsHash: string
}

export interface GuardrailDecision {
  action: GuardrailAction
  reason?: string
}

export interface GuardrailThresholds {
  exactFailWarn: number
  exactFailHalt: number
  sameToolWarn: number
  sameToolHalt: number
}

const DEFAULT_THRESHOLDS: GuardrailThresholds = {
  exactFailWarn: 2,
  exactFailHalt: 5,
  sameToolWarn: 3,
  sameToolHalt: 8,
}

export class ToolGuardrail {
  constructor(
    private storage: DurableObjectStorage,
    private runId: string,
    private stageId: string,
    private thresholds: GuardrailThresholds = DEFAULT_THRESHOLDS,
  ) {}

  private key(suffix: string) {
    return `toolguard:${this.runId}:${this.stageId}:${suffix}`
  }

  async recordFailure(sig: ToolCallSignature): Promise<GuardrailDecision> {
    const exactKey = this.key(`exact:${sig.toolName}:${sig.argsHash}`)
    const toolKey = this.key(`tool:${sig.toolName}`)

    const [exactCount, toolCount] = await Promise.all([
      this.increment(exactKey),
      this.increment(toolKey),
    ])

    if (exactCount >= this.thresholds.exactFailHalt) {
      return {
        action: 'halt',
        reason: `exact failure threshold tripped: ${exactCount}/${this.thresholds.exactFailHalt}`,
      }
    }
    if (toolCount >= this.thresholds.sameToolHalt) {
      return {
        action: 'halt',
        reason: `same-tool failure threshold tripped: ${toolCount}/${this.thresholds.sameToolHalt}`,
      }
    }
    if (exactCount >= this.thresholds.exactFailWarn) {
      return {
        action: 'warn',
        reason: `exact failure warning threshold tripped: ${exactCount}/${this.thresholds.exactFailWarn}`,
      }
    }
    if (toolCount >= this.thresholds.sameToolWarn) {
      return {
        action: 'warn',
        reason: `same-tool failure warning threshold tripped: ${toolCount}/${this.thresholds.sameToolWarn}`,
      }
    }

    return { action: 'allow' }
  }

  async recordNoProgress(sig: ToolCallSignature): Promise<GuardrailDecision> {
    const noProgressKey = this.key(`noprog:${sig.toolName}`)
    const toolKey = this.key(`tool:${sig.toolName}`)

    const [noProgressCount, toolFailureCount] = await Promise.all([
      this.increment(noProgressKey),
      this.storage.get<number>(toolKey),
    ])
    const toolCount = toolFailureCount ?? 0

    if (noProgressCount >= this.thresholds.sameToolHalt) {
      return {
        action: 'halt',
        reason: `same-tool no-progress threshold tripped: ${noProgressCount}/${this.thresholds.sameToolHalt}`,
      }
    }
    if (toolCount >= this.thresholds.sameToolHalt) {
      return {
        action: 'halt',
        reason: `same-tool failure threshold tripped: ${toolCount}/${this.thresholds.sameToolHalt}`,
      }
    }
    if (noProgressCount >= this.thresholds.sameToolWarn) {
      return {
        action: 'warn',
        reason: `same-tool no-progress warning threshold tripped: ${noProgressCount}/${this.thresholds.sameToolWarn}`,
      }
    }
    if (toolCount >= this.thresholds.sameToolWarn) {
      return {
        action: 'warn',
        reason: `same-tool failure warning threshold tripped: ${toolCount}/${this.thresholds.sameToolWarn}`,
      }
    }

    return { action: 'allow' }
  }

  async reset(): Promise<void> {
    const entries = await this.storage.list({ prefix: this.key('') })
    const keys = Array.from(entries.keys())
    if (keys.length > 0) {
      await this.storage.delete(keys)
    }
  }

  private async increment(key: string): Promise<number> {
    const current = (await this.storage.get<number>(key)) ?? 0
    const next = current + 1
    await this.storage.put(key, next)
    return next
  }
}

export async function hashArgs(args: unknown): Promise<string> {
  const keys = args !== null && typeof args === 'object'
    ? Object.keys(args).sort()
    : undefined
  const canonical = args === undefined
    ? 'undefined'
    : JSON.stringify(args, keys)
  const bytes = new TextEncoder().encode(canonical ?? 'null')
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
