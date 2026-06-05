// AtomDirective — canonical schema for the I-layer / execution-substrate boundary
// SPEC-CONDUCTING-AGENT-001 §1.2 — authoritative definition
// Referenced by: SPEC-MEDIATION-AGENT-DO-001, SPEC-COMMISSIONING-AGENT-001,
//                SPEC-ARCHITECT-AGENT-DO-001

import { z } from 'zod'

export const ToolPermission = z.enum([
  'shell',     // shell.schema.json tool set
  'git',       // git.schema.json tool set
  'compiler',  // compiler.schema.json tool set
  'read-only', // subset of shell: cat, ls, find, grep, head, tail, wc only
])

// Recursive type — use z.infer only; no manual type declaration
const BaseSuccessCondition = z.discriminatedUnion('type', [
  z.object({ type: z.literal('exit-code'), expectedCode: z.number().int().default(0) }),
  z.object({ type: z.literal('output-contains'), substring: z.string().min(1) }),
  z.object({ type: z.literal('output-matches'), pattern: z.string().min(1) }),
  z.object({ type: z.literal('file-exists'), path: z.string().min(1) }),
])

type BaseSuccessCondition = z.infer<typeof BaseSuccessCondition>

export type SuccessConditionType = BaseSuccessCondition | { type: 'composite'; all: SuccessConditionType[] }

export const SuccessCondition: z.ZodType<SuccessConditionType> = z.lazy(() =>
  z.union([
    BaseSuccessCondition,
    z.object({ type: z.literal('composite'), all: z.array(SuccessCondition).min(2).max(8) }),
  ])
)

export const RetryPolicy = z.object({
  maxAttempts: z.number().int().min(1).max(5).default(3),
  backoffMs: z.number().int().min(0).default(1000),
  isolatedRetry: z.boolean().default(true),
})

export const AtomDirective = z.object({
  // ── Identity ────────────────────────────────────────────────────────────
  directiveId: z.string().regex(/^DIR-[A-Z0-9]+-\d+$/),
  atomRef: z.string().min(1),
  workGraphVersion: z.string().min(1),
  repoId: z.string().min(1),

  // ── Execution instruction ────────────────────────────────────────────────
  // Must be procedural (sequence of steps), never conceptual.
  instruction: z.string().min(10).max(2000),
  workingDir: z.string().default('.'),

  // ── Tool permissions ─────────────────────────────────────────────────────
  // Explicit allowlist. Any tool call outside this set is rejected.
  permittedTools: z.array(ToolPermission).min(1),

  // ── Timing ──────────────────────────────────────────────────────────────
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),

  // ── Success definition ───────────────────────────────────────────────────
  successCondition: SuccessCondition,

  // ── Retry policy ────────────────────────────────────────────────────────
  retryPolicy: RetryPolicy,

  // ── DAG ordering ────────────────────────────────────────────────────────
  // directiveIds that must complete successfully before this one starts.
  dependsOn: z.array(z.string()).default([]),

  // ── Context injection ────────────────────────────────────────────────────
  envVars: z.record(z.string(), z.string()).default({}),

  // ── Sandbox configuration ────────────────────────────────────────────────
  sandboxConfig: z.object({
    memoryMb: z.number().int().min(128).max(4096).default(512),
    persistFilesystem: z.boolean().default(false),
  }).default({}),
})

export type AtomDirective = z.infer<typeof AtomDirective>
export type RetryPolicy = z.infer<typeof RetryPolicy>
export type ToolPermission = z.infer<typeof ToolPermission>
