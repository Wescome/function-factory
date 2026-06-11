/**
 * atom-execution.ts — Flue workflow run() for the Conducting Agent atom executor.
 *
 * Lives in @factory/gears per SPEC-FF-GEARS-001 §1/§3: consumers never import
 * @flue/runtime or @cloudflare/sandbox directly — gears is the execution substrate.
 *
 * SPEC-FF-JUSTBASH-004
 */

import {
  createAgent,
  configureProvider,
  type FlueContext,
  type FlueHarness,
  type WorkflowRouteHandler,
  type SandboxFactory,
} from '@flue/runtime'
import { getSandbox } from '@cloudflare/sandbox'
import { cfSandboxToSessionEnv } from '@flue/runtime/cloudflare'
import { createHash } from 'node:crypto'
import { AtomDirective } from '@factory/schemas'
import { PROFILE_BY_ROLE } from '../agents.js'
import { claimHook, releaseHook, failHook, getNextReady } from '../../beads/hook.js'
import type { ConductingAgentTraceFragment } from '../../beads/coordinator-do.js'

// Suppress unused import warning — claimHook is part of the public API exported from this module
void (claimHook satisfies typeof claimHook)

export const route: WorkflowRouteHandler = async (_c, next) => next()

interface Env {
  COORDINATOR_DO:   DurableObjectNamespace
  WORKSPACE_BUCKET: R2Bucket
  // SANDBOX DO namespace — typed as unknown to avoid DurableObjectNamespace<Sandbox>
  // generic mismatch; getSandbox handles the cast internally
  SANDBOX:           unknown
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY:    string
  DEEPSEEK_API_KEY:  string
  GITHUB_TOKEN:      string
  OFOX_API_KEY:      string
  // CF_API_TOKEN required for kimi-k2.6 — env.AI.run() returns empty for kimi,
  // so cloudflare provider is overridden to use the REST API directly (same as providers.ts).
  CF_API_TOKEN:      string
  AI:                unknown
}

interface AtomExecutionPayload {
  repoId:           string
  agentId:          string
  workGraphId:      string
  workGraphVersion: string
  moleculeId:       string
}

export async function run({
  init,
  payload,
  env,
  id,       // workflow run id — used for sandbox identity
}: FlueContext<AtomExecutionPayload, Env>) {
  // Route non-CF models through ofox.ai (unified gateway, mirrors providers.ts).
  // Must run in this isolate before init(agent) freezes the resolved model.
  // CF-hosted models use the Workers AI binding registered by _entry.ts on isolate boot.
  const ofox = { baseUrl: 'https://api.ofox.ai/v1', apiKey: env.OFOX_API_KEY } as const
  configureProvider('anthropic', ofox)
  configureProvider('openai',    ofox)

  // kimi-k2.6 is on CF Workers AI but env.AI.run() returns empty — use REST API.
  // Same workaround as providers.ts lines 18-44.
  configureProvider('cloudflare', {
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/cb56a846c70a38987f31cf6e2b85cb57/ai/run/',
    apiKey:  env.CF_API_TOKEN,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
  })

  const { repoId, agentId, workGraphId, workGraphVersion, moleculeId } = payload

  // GD-002: deterministic Coordinator DO key per WorkGraph execution
  const runId  = createHash('sha256').update(workGraphId + workGraphVersion).digest('hex')
  const doId   = env.COORDINATOR_DO.idFromName(`coordinator:${runId}`)
  const doStub = env.COORDINATOR_DO.get(doId)

  // Gap 6: initialize run context on DO so writeAudit() and recordOutcome() have it
  // idempotent — safe to call on every workflow invocation
  await doStub.fetch(new Request('http://do/init', {
    method: 'POST',
    body: JSON.stringify([runId, repoId]),
  }))

  // Claim next ready bead
  const bead = await getNextReady(doStub, moleculeId)
  if (!bead) return { status: 'complete' }

  const parseResult = AtomDirective.safeParse(JSON.parse(bead.payload ?? '{}'))
  if (!parseResult.success) {
    await failHook(doStub, bead.id, agentId,
      JSON.stringify({ error: 'invalid-directive', issues: parseResult.error.issues }))
    return { status: 'error', reason: 'invalid-directive' }
  }

  const directive = parseResult.data
  const trace     = await executeWithRetry(directive, bead.id, agentId, id, env, init)

  if (trace.outcome === 'success') {
    await releaseHook(doStub, bead.id, agentId, JSON.stringify(trace))
  } else {
    await failHook(doStub, bead.id, agentId, JSON.stringify(trace))
  }

  return { status: 'executed', outcome: trace.outcome }
}

// ── Execution loop ────────────────────────────────────────────────────────────

async function executeWithRetry(
  directive:  AtomDirective,
  beadId:     string,
  agentId:    string,
  workflowId: string,
  env:        Env,
  init:       FlueContext<AtomExecutionPayload, Env>['init'],
): Promise<ConductingAgentTraceFragment> {
  const { maxAttempts, backoffMs, isolatedRetry } = directive.retryPolicy
  let lastTrace: ConductingAgentTraceFragment | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(backoffMs)

    const result = await runFlueSession(directive, agentId, workflowId, env, init)

    const rawOutput        = result.stdout.slice(0, 4096)
    const sandboxOutputRef: string | undefined = result.stdout.length > 4096
      ? await storeFullOutput(result.stdout, directive.directiveId, env)
      : undefined

    const success = await evaluateSuccessCondition(directive.successCondition, result, result.harness)
    const outcome: 'success' | 'failure' | 'timeout' = result.timedOut
      ? 'timeout'
      : success ? 'success' : 'failure'

    lastTrace = {
      executionId:      `${beadId}-attempt-${attempt}`,
      directiveId:      directive.directiveId,
      atomRef:          directive.atomRef,
      workGraphVersion: directive.workGraphVersion,
      repoId:           directive.repoId,
      outcome,
      rawOutput,
      sandboxOutputRef,
      durationMs:       result.durationMs,
      attemptNumber:    attempt,
      producedAt:       new Date().toISOString(),
    }

    if (outcome === 'success') return lastTrace
    if (!isolatedRetry || attempt >= maxAttempts) break
  }

  if (!lastTrace) {
    throw new Error('executeWithRetry: no trace produced (maxAttempts must be >= 1)')
  }
  return lastTrace
}

// ── Flue session ──────────────────────────────────────────────────────────────

type SessionResult = {
  stdout:     string
  timedOut:   boolean
  durationMs: number
  harness:    FlueHarness
}

async function runFlueSession(
  directive:  AtomDirective,
  agentId:    string,
  workflowId: string,
  env:        Env,
  init:       FlueContext<AtomExecutionPayload, Env>['init'],
): Promise<SessionResult> {
  const start = Date.now()

  // Gap 3: use directive.role directly — deriveRole() heuristic deleted
  const profile = PROFILE_BY_ROLE[directive.role]

  // Sandbox: CF Container for git/persistent atoms, virtual for everything else
  const needsContainer = directive.permittedTools.includes('git') ||
                         directive.sandboxConfig.persistFilesystem

  const agent = needsContainer
    ? createAgent<AtomExecutionPayload, Env>(({ id: agentRunId, env: e } = { id: workflowId, env, payload: undefined }) => {
        const sandboxFactory: SandboxFactory = {
          createSessionEnv: ({ id }) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cfSandboxToSessionEnv(getSandbox(e.SANDBOX as any, id)),
        }
        return { profile, sandbox: sandboxFactory, cwd: directive.workingDir ?? '/workspace' }
      })
    : createAgent(() => ({
        profile,
        cwd: directive.workingDir ?? '/workspace',
      }))

  const harness = await init(agent)

  const agentsMd = directive.envVars['AGENTS_MD'] ?? ''
  if (agentsMd) {
    await harness.fs.writeFile('AGENTS.md', agentsMd)
  }

  const session = await harness.session(`atom-${directive.directiveId}`)

  let stdout   = ''
  let timedOut = false

  try {
    const response = await Promise.race([
      session.skill(directive.skillRef, {
        args: { instruction: directive.instruction },
      }),
      sleep(directive.timeoutMs).then(() => { timedOut = true; return null }),
    ])
    if (response) stdout = response.text ?? ''
  } catch (err) {
    stdout = String(err)
  }

  void agentId

  return { stdout, timedOut, durationMs: Date.now() - start, harness }
}

// ── SuccessCondition evaluation — async for file-exists (BR-KSP-18) ──────────

async function evaluateSuccessCondition(
  condition: AtomDirective['successCondition'],
  result:    SessionResult,
  harness:   FlueHarness,
): Promise<boolean> {
  switch (condition.type) {
    case 'exit-code':       return !result.timedOut
    case 'output-contains': return result.stdout.includes(condition.substring)
    case 'output-matches':  return new RegExp(condition.pattern).test(result.stdout)
    case 'file-exists': {
      const check = await harness.shell(`test -f ${condition.path} && echo exists`)
      return check.stdout.trim() === 'exists'
    }
    case 'composite':
      return (await Promise.all(
        condition.all.map(c => evaluateSuccessCondition(c, result, harness))
      )).every(Boolean)
  }
}

// ── Workspace delta capture ───────────────────────────────────────────────────

export async function extractWorkspaceDelta(
  harness:   FlueHarness,
  seedPaths: Set<string>,
): Promise<Array<{ virtualPath: string; kind: 'added' | 'deleted'; content?: string }>> {
  const result   = await harness.shell('find /workspace -type f 2>/dev/null')
  const allPaths = result.stdout.split('\n').map(p => p.trim()).filter(Boolean)
  const deltas: Array<{ virtualPath: string; kind: 'added' | 'deleted'; content?: string }> = []

  for (const vPath of allPaths) {
    if (seedPaths.has(vPath)) continue
    const content = await harness.fs.readFile(vPath)
    deltas.push({ virtualPath: vPath, kind: 'added', content })
  }
  for (const seedPath of seedPaths) {
    if (!allPaths.includes(seedPath))
      deltas.push({ virtualPath: seedPath, kind: 'deleted' })
  }
  return deltas
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function storeFullOutput(output: string, directiveId: string, env: Env): Promise<string> {
  const key = `sandbox-output/${directiveId}/${Date.now()}.txt`
  await (env.WORKSPACE_BUCKET as R2Bucket).put(key, output)
  return `r2://${key}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
