/**
 * ArchitectAgent — reasoning agent that produces briefing scripts
 * for the synthesis pipeline.
 *
 * Plain TypeScript class (no Durable Object lifecycle needed).
 * Can be converted to extend Agent from 'agents' SDK when ready.
 */

export interface BriefingScript {
  goal: string
  successCriteria: string[]
  architecturalContext: string
  strategicAdvice: string
  knownGotchas: string[]
  validationLoop: string
}

export interface BriefingInput {
  signal: Record<string, unknown>
  specContent?: string
  memoryDigest?: string
  mentorRules?: string[]
}

type ModelCaller = (taskKind: string, system: string, user: string) => Promise<string>

export interface ArchitectAgentOpts {
  callModel: ModelCaller
}

const BRIEFING_REQUIRED_FIELDS: (keyof BriefingScript)[] = [
  'goal',
  'successCriteria',
  'architecturalContext',
  'strategicAdvice',
  'knownGotchas',
  'validationLoop',
]

export class ArchitectAgent {
  private callModel: ModelCaller

  constructor(opts: ArchitectAgentOpts) {
    this.callModel = opts.callModel
  }

  async produceBriefingScript(input: BriefingInput): Promise<BriefingScript> {
    const system = [
      'You are an architect agent producing a briefing script for a synthesis pipeline.',
      'Respond with a JSON object containing exactly these fields:',
      '  goal (string): the primary objective',
      '  successCriteria (string[]): measurable success conditions',
      '  architecturalContext (string): relevant architectural background',
      '  strategicAdvice (string): high-level strategic guidance',
      '  knownGotchas (string[]): pitfalls and edge cases to watch for',
      '  validationLoop (string): how to validate the outcome',
      'Respond ONLY with valid JSON. No markdown, no explanation.',
    ].join('\n')

    const userParts: string[] = [
      `Signal: ${JSON.stringify(input.signal)}`,
    ]

    if (input.specContent) {
      userParts.push(`\nSpecification:\n${input.specContent}`)
    }

    if (input.memoryDigest) {
      userParts.push(`\nMemory digest:\n${input.memoryDigest}`)
    }

    if (input.mentorRules && input.mentorRules.length > 0) {
      userParts.push(`\nMentor rules:\n${input.mentorRules.map((r) => `- ${r}`).join('\n')}`)
    }

    const raw = await this.callModel('architect', system, userParts.join('\n'))

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`ArchitectAgent: model returned invalid JSON: ${raw.slice(0, 200)}`)
    }

    this.validateBriefingScript(parsed)
    return parsed as BriefingScript
  }

  private validateBriefingScript(obj: unknown): asserts obj is BriefingScript {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('ArchitectAgent: model response is not an object')
    }

    const record = obj as Record<string, unknown>

    for (const field of BRIEFING_REQUIRED_FIELDS) {
      if (!(field in record)) {
        throw new Error(`ArchitectAgent: missing required field "${field}"`)
      }
    }

    if (typeof record.goal !== 'string') {
      throw new Error('ArchitectAgent: "goal" must be a string')
    }
    if (!Array.isArray(record.successCriteria)) {
      throw new Error('ArchitectAgent: "successCriteria" must be an array')
    }
    if (typeof record.architecturalContext !== 'string') {
      throw new Error('ArchitectAgent: "architecturalContext" must be a string')
    }
    if (typeof record.strategicAdvice !== 'string') {
      throw new Error('ArchitectAgent: "strategicAdvice" must be a string')
    }
    if (!Array.isArray(record.knownGotchas)) {
      throw new Error('ArchitectAgent: "knownGotchas" must be an array')
    }
    if (typeof record.validationLoop !== 'string') {
      throw new Error('ArchitectAgent: "validationLoop" must be a string')
    }
  }
}
