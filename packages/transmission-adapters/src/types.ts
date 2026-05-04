/**
 * Transmission adapter types.
 *
 * FactorySpecification is the ONLY input type. It is built from Factory
 * internals (atoms, plans, invariants) by the caller — the adapter never
 * sees raw Factory primitives.
 *
 * CommunicableSpecification is the ONLY output type. It contains a system
 * prompt, a body, and a token estimate — ready to feed to an external agent.
 *
 * The adapter's job: translate from one to the other without leaking
 * Factory vocabulary into the output.
 */

// ── Substrate identifiers ──

export type Substrate =
  | 'coding-agent'
  | 'agents-md'
  | 'claude-md'
  | 'skill-md'
  | 'a2a'

// ── Input (Factory-side) ──

export interface FactorySpecification {
  /** What must be done (derived from atom.title + atom.verifies) */
  intent: string
  /** How to do it (derived from plan.approach) */
  approach?: string | undefined
  /** Files to modify */
  targetFiles?: string[] | undefined
  /** Invariants expressed as plain English */
  constraints?: string[] | undefined
  /** Grounding data */
  context?: {
    fileContents?: Array<{
      path: string
      exports?: string[] | undefined
      functions?: string[] | undefined
      content?: string | undefined
    }> | undefined
    decisions?: string[] | undefined
    lessons?: string[] | undefined
    mentorRules?: string[] | undefined
  } | undefined
  /** Only present on retry cycles */
  repair?: {
    notes?: string | undefined
    previousFiles?: string[] | undefined
    issues?: string[] | undefined
  } | undefined
}

// ── Output (agent-facing) ──

export interface CommunicableSpecification {
  /** Adapted system prompt for this substrate */
  systemPrompt: string
  /** The task description / context document */
  body: string
  /** Rough token estimate for budget tracking */
  estimatedTokens: number
}
