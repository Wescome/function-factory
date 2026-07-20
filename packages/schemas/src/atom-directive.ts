/**
 * AtomDirective — substrate-ready dispatch directive produced by the Mediation Agent
 * from a compiled execution-plan atom.
 *
 * SPEC-FF-ILAYER-EXEC-001 §8 v2.0: canonical field definitions.
 *
 * v2.0 changes:
 *   - Added: workGraphId, model, instructions, thinkingLevel, toolPolicy,
 *     toolSchemas, specFiles, invariantIds, dependsOn, eluciationArtifactId,
 *     d1ArtifactRef, policyBeadId
 *   - Renamed: instruction → instructions
 *   - Removed from spec (kept as @deprecated optional for migration):
 *     directiveId, atomRef, executableSpecificationId, repoId, skillRef,
 *     role, timeoutMs, retryPolicy, successCondition, permittedTools,
 *     sandboxConfig, workflowId, workingDir, envVars
 */

import { z } from "zod"

// ── v1 supporting schemas (deprecated — kept for migration only) ──────────────

/**
 * @deprecated v1 only. Removed in v2.0 spec (SPEC-FF-ILAYER-EXEC-001 §8).
 */
export const AtomRole = z.enum(['planner', 'coder', 'critic', 'tester', 'verifier'])
/** @deprecated v1 only. Removed in v2.0 spec. */
export type AtomRole = z.infer<typeof AtomRole>

/** @deprecated v1 only. Removed in v2.0 spec. */
export const SuccessConditionBase = z.discriminatedUnion('type', [
  z.object({ type: z.literal('exit-code') }),
  z.object({ type: z.literal('output-contains'), substring: z.string() }),
  z.object({ type: z.literal('output-matches'),  pattern: z.string() }),
  z.object({ type: z.literal('file-exists'),      path: z.string() }),
])

// composite references itself — use z.lazy
/** @deprecated v1 only. Removed in v2.0 spec. */
export type SuccessCondition =
  | z.infer<typeof SuccessConditionBase>
  | { type: 'composite'; all: SuccessCondition[] }
  | { type: 'always' }

/** @deprecated v1 only. Removed in v2.0 spec. */
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

/** @deprecated v1 only. Removed in v2.0 spec. */
export const RetryPolicy = z.object({
  maxAttempts:    z.number().int().min(1),
  backoffMs:      z.number().int().min(0),
  isolatedRetry:  z.boolean(),
})
/** @deprecated v1 only. Removed in v2.0 spec. */
export type RetryPolicy = z.infer<typeof RetryPolicy>

/** @deprecated v1 only. Removed in v2.0 spec. */
export const SandboxConfig = z.object({
  persistFilesystem: z.boolean(),
})
/** @deprecated v1 only. Removed in v2.0 spec. */
export type SandboxConfig = z.infer<typeof SandboxConfig>

// ── v2.0 supporting schemas ───────────────────────────────────────────────────

/**
 * Atom-level tool permission policy. SPEC-FF-ILAYER-EXEC-001 §8.
 * Named AtomToolPolicy to avoid collision with gear-types.ts ToolPolicy.
 */
export const AtomToolPolicy = z.object({
  permittedTools: z.array(z.string()),
})
export type AtomToolPolicy = z.infer<typeof AtomToolPolicy>

/**
 * Inline tool schema entry provided to the agent.
 * SPEC-FF-ILAYER-EXEC-001 §8.
 */
export const ToolSchemaEntry = z.object({
  name:             z.string().min(1),
  description:      z.string().min(1),
  parametersSchema: z.record(z.string(), z.unknown()),
})
export type ToolSchemaEntry = z.infer<typeof ToolSchemaEntry>

/**
 * Virtual spec file mounted in the agent workspace.
 * SPEC-FF-ILAYER-EXEC-001 §8. virtualPath must start with `/spec/`.
 */
export const SpecFileEntry = z.object({
  virtualPath:    z.string().min(1).startsWith('/spec/'),
  content:        z.string(),
  d1ArtifactRef:  z.string().min(1),
})
export type SpecFileEntry = z.infer<typeof SpecFileEntry>

// ── AtomDirective v2.0 ────────────────────────────────────────────────────────

export const AtomDirective = z.object({
  // ── v2.0 required fields ──────────────────────────────────────────────────

  /** Unique atom identifier — WG-{id}-ATOM-{n} format. */
  atomId: z.string().min(1),

  /** Work-graph identifier this atom belongs to. */
  workGraphId: z.string().min(1),

  /** Execution-plan version used to compute runId. */
  workGraphVersion: z.string().min(1),

  /** SHA-256 deterministic run identifier scoping this directive. */
  runId: z.string().min(1),

  /** LLM model identifier — e.g. `'anthropic/claude-opus-4-6'`. */
  model: z.string().min(1),

  /** Human-readable instructions for the agent. */
  instructions: z.string().min(1),

  /** Tool permission policy. */
  toolPolicy: AtomToolPolicy,

  /** Inline tool schemas provided to the agent. */
  toolSchemas: z.array(ToolSchemaEntry),

  /** Virtual spec files mounted in the agent workspace. */
  specFiles: z.array(SpecFileEntry),

  /** INV-* invariant identifiers this atom must satisfy. */
  invariantIds: z.array(z.string()),

  /** DAG dependency edges — atomIds that must complete before this atom. */
  dependsOn: z.array(z.string()),

  /**
   * ELC-* elucidation artifact lineage reference.
   * Note: spec spells this 'eluciation' (typo preserved for wire-format
   * compatibility with SPEC-FF-ILAYER-EXEC-001 §8).
   */
  eluciationArtifactId: z.string().min(1),

  /** D1 row key of the source work-graph atom. */
  d1ArtifactRef: z.string().min(1),

  /** Bead Graph DO lineage entry identifier. */
  policyBeadId: z.string().min(1),

  // ── v2.0 optional fields ──────────────────────────────────────────────────

  /**
   * Thinking depth budget for the agent.
   * @default 'low'
   */
  thinkingLevel: z.enum(['none', 'low', 'high']).optional().default('low'),

  // ── v1 deprecated fields (kept optional for migration) ───────────────────

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Unique directive identifier (DIRECTIVE-* prefix).
   * Migrate callers to `atomId`.
   */
  directiveId: z.string().min(1).optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Stable atom reference (name@version) for trace correlation.
   */
  atomRef: z.string().min(1).optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Renamed to `instructions` (plural). Use `instructions` instead.
   */
  instruction: z.string().min(1).optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Executable specification identifier for queue routing.
   */
  executableSpecificationId: z.string().min(1).optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Repository identifier.
   */
  repoId: z.string().min(1).optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Declared skill name. Replaced by `specFiles`.
   */
  skillRef: z.string().min(1).optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Atom role. Replaced by `model` field.
   */
  role: AtomRole.optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Execution timeout in milliseconds.
   */
  timeoutMs: z.number().int().min(1000).optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Retry policy for this atom.
   */
  retryPolicy: RetryPolicy.optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Success condition evaluated after execution.
   */
  successCondition: SuccessCondition.optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Flat permitted tools array. Use `toolPolicy.permittedTools` instead.
   */
  permittedTools: z.array(z.string()).optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Sandbox configuration.
   */
  sandboxConfig: SandboxConfig.optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Pipeline workflow identifier for routing atom-results events.
   */
  workflowId: z.string().nullable().optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Working directory inside sandbox.
   */
  workingDir: z.string().optional(),

  /**
   * @deprecated v1 only — not in SPEC-FF-ILAYER-EXEC-001 v2.0.
   * Environment variables injected into the session.
   */
  envVars: z.record(z.string(), z.string()).optional(),
})
export type AtomDirective = z.infer<typeof AtomDirective>
