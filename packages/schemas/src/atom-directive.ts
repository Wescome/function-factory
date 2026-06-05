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

export const SuccessCondition: z.ZodType<SuccessConditionType> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('exit-code'), expectedCode: z.number().int().default(0) }),
    z.object({ type: z.literal('output-contains'), substring: z.string().min(1) }),
    z.object({ type: z.literal('output-matches'), pattern: z.string().min(1) }),
    z.object({ type: z.literal('file-exists'), path: z.string().min(1) }),
    z.object({
      type: z.literal('composite'),
      all: z.array(SuccessCondition).min(2).max(8), // max depth 3
    }),
  ])
)

export type SuccessConditionType =
  | { type: 'exit-code'; expectedCode: number }
  | { type: 'output-contains'; substring: string }
  | { type: 'output-matches'; pattern: string }
  | { type: 'file-exists'; path: string }
  | { type: 'composite'; all: SuccessConditionType[] }

export const RetryPolicy = z.object({
  maxAttempts: z.number().int().min(1).max(5).default(3),
  backoffMs: z.number().int().min(0).default(1000),
  isolatedRetry: z.boolean().default(true),
})

export const AtomDirective = z.object({
  directiveId: z.string().regex(/^DIR-[A-Z0-9]+-\d+$/),
  atomRef: z.string().min(1),
  workGraphVersion: z.string().min(1),
  repoId: z.string().min(1),
  instruction: z.string().min(10).max(2000),
  workingDir: z.string().default('.'),
  permittedTools: z.array(ToolPermission).min(1),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  successCondition: SuccessCondition,
  retryPolicy: RetryPolicy,
  dependsOn: z.array(z.string()).default([]),
  envVars: z.record(z.string(), z.string()).default({}),
  sandboxConfig: z.object({
    memoryMb: z.number().int().min(128).max(4096).default(512),
    persistFilesystem: z.boolean().default(false),
  }).default({}),
})

export type AtomDirective = z.infer<typeof AtomDirective>
export type RetryPolicy = z.infer<typeof RetryPolicy>
export type ToolPermission = z.infer<typeof ToolPermission>
