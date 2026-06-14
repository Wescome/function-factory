/**
 * AtomDirective — substrate-ready dispatch directive produced by the Mediation Agent
 * from a compiled execution-plan atom.
 *
 * SPEC-FF-GEARS-001 §5: adds `skillRef` and `role` fields.
 * SPEC-CONDUCTING-AGENT-001 §1.2 remains canonical for all other fields.
 *
 * `role` is the authoritative role source, populated at compile time by the
 * Mediation Agent from `Gear.role`. It replaces the deleted `deriveRole()`
 * heuristic.
 *
 * `skillRef` is the declared skill name passed to `session.skill()` at
 * workflow execution. Populated from `Gear.skillRef`.
 */

import { z } from "zod"

export const AtomRole = z.enum(['planner', 'coder', 'critic', 'tester', 'verifier'])
export type AtomRole = z.infer<typeof AtomRole>

// ── SuccessCondition ──────────────────────────────────────────────────────────

export const SuccessConditionBase = z.discriminatedUnion('type', [
  z.object({ type: z.literal('exit-code') }),
  z.object({ type: z.literal('output-contains'), substring: z.string() }),
  z.object({ type: z.literal('output-matches'),  pattern: z.string() }),
  z.object({ type: z.literal('file-exists'),      path: z.string() }),
])

// composite references itself — use z.lazy
export type SuccessCondition =
  | z.infer<typeof SuccessConditionBase>
  | { type: 'composite'; all: SuccessCondition[] }
  | { type: 'always' }

export const SuccessCondition: z.ZodType<SuccessCondition> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('exit-code') }),
    z.object({ type: z.literal('output-contains'), substring: z.string() }),
    z.object({ type: z.literal('output-matches'),  pattern: z.string() }),
    z.object({ type: z.literal('file-exists'),      path: z.string() }),
    z.object({ type: z.literal('composite'),        all: z.array(SuccessCondition) }),
    z.object({ type: z.literal('always') }),
  ])
)

// ── RetryPolicy ───────────────────────────────────────────────────────────────

export const RetryPolicy = z.object({
  maxAttempts:    z.number().int().min(1),
  backoffMs:      z.number().int().min(0),
  isolatedRetry:  z.boolean(),
})
export type RetryPolicy = z.infer<typeof RetryPolicy>

// ── SandboxConfig ─────────────────────────────────────────────────────────────

export const SandboxConfig = z.object({
  persistFilesystem: z.boolean(),
})
export type SandboxConfig = z.infer<typeof SandboxConfig>

// ── AtomDirective ─────────────────────────────────────────────────────────────

export const AtomDirective = z.object({
  /** Unique directive identifier — DIRECTIVE-* prefix. */
  directiveId: z.string().min(1),

  /** Unique atom identifier (ATOM-* prefix). */
  atomId: z.string().min(1),

  /** Stable atom reference (name@version) for trace correlation. */
  atomRef: z.string().min(1),

  /** Human-readable instruction for the agent. */
  instruction: z.string().min(1),

  /** Execution-plan run identifier scoping this directive. */
  runId: z.string().min(1),

  /** Executable specification identifier — used by queue consumers to route
   *  to the correct AtomExecutor DO via idFromName(`atom-${executableSpecificationId}-${atomId}`). */
  executableSpecificationId: z.string().min(1),

  /** Repository identifier. */
  repoId: z.string().min(1),

  /** Execution-plan version used to compute runId. */
  workGraphVersion: z.string().min(1),

  /** Declared skill name — passed to session.skill() at workflow execution.
   *  Populated from Gear.skillRef by the Mediation Agent compile step. */
  skillRef: z.string().min(1),

  /**
   * Authoritative role for this atom. Selects the correct AgentProfile via
   * PROFILE_BY_ROLE[directive.role]. Populated from Gear.role by the
   * Mediation Agent compile step. Never derived heuristically.
   */
  role: AtomRole,

  /** Execution timeout in milliseconds. */
  timeoutMs: z.number().int().min(1000),

  /** Retry policy for this atom. */
  retryPolicy: RetryPolicy,

  /** Condition evaluated after execution to determine success/failure. */
  successCondition: SuccessCondition,

  /** Tools the agent is permitted to use. */
  permittedTools: z.array(z.string()),

  /** Sandbox configuration. */
  sandboxConfig: SandboxConfig,

  /** Pipeline workflow identifier for routing atom-results events.
   *  Populated from the queue message body by queue-handler.ts.
   *  Optional — atom-results consumer falls back to ledger.workflowId when absent or null. */
  workflowId: z.string().nullable().optional(),

  /** Working directory inside sandbox. */
  workingDir: z.string().optional(),

  /** Environment variables injected into the session. */
  envVars: z.record(z.string(), z.string()),
})
export type AtomDirective = z.infer<typeof AtomDirective>
