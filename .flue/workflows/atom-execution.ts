/**
 * atom-execution.ts — Flue workflow: Conducting Agent atom executor
 *
 * Replaces the retired Conducting Agent CF Worker fetch handler.
 * One workflow invocation per atom execution attempt.
 *
 * SPEC-FF-JUSTBASH-004 | Implementation sequence Step 9
 */

import {
  createAgent,
  type FlueContext,
  type FlueHarness,
  type WorkflowRouteHandler,
} from '@flue/runtime'
import { getSandbox } from '@cloudflare/sandbox'
import { createHash } from 'node:crypto'
import { AtomDirective } from '@factory/schemas'
import { PROFILE_BY_ROLE } from '@factory/gears/flue'
import { claimHook, releaseHook, failHook, getNextReady } from '@factory/gears/beads'
import type { ConductingAgentTraceFragment } from '@factory/gears/beads'

// Suppress unused import warning — claimHook is part of the public API exported from this module
void (claimHook satisfies typeof claimHook)

export const route: WorkflowRouteHandler = async (_c, next) => next()

interface Env {
  COORDINATOR_DO:        DurableObjectNamespace
  SANDBOX_OUTPUT_BUCKET: R2Bucket
  // Sandbox DO namespace — typed as unknown to avoid DurableObjectNamespace<Sandbox>
  // generic mismatch; getSandbox handles the cast internally
  Sandbox:               unknown
  ANTHROPIC_API_KEY:     string
  OPENAI_API_KEY:        string
  DEEPSEEK_API_KEY:      string
  GITHUB_TOKEN:          string
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
    // Should not happen — maxAttempts is validated as >= 1 by Zod schema.
    throw new Error('executeWithRetry: no trace produced (maxAttempts must be >= 1)')
  }
  return lastTrace
}

// ── Flue session ──────────────────────────────────────────────────────────────

type SessionResult = {
  stdout:     string
  timedOut:   boolean
  durationMs: number
  harness:    FlueHarness  // for file-exists checks
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

  // createAgent: verified API — AgentRuntimeConfig with profile + optional sandbox
  const agent = needsContainer
    ? createAgent<AtomExecutionPayload, Env>(({ id: agentRunId, env: e } = { id: workflowId, env }) => ({
        profile,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sandbox: getSandbox(e.Sandbox as any, agentRunId),
        cwd:     directive.workingDir ?? '/workspace',
      }))
    : createAgent(() => ({
        profile,
        cwd: directive.workingDir ?? '/workspace',
        // no sandbox field = virtual sandbox (just-bash)
      }))

  // ctx.init() — verified API, available inside FlueContext workflow run()
  const harness = await init(agent)

  // Inject AGENTS.md if provided (written by Mediation Agent at commission)
  const agentsMd = directive.envVars['AGENTS_MD'] ?? ''
  if (agentsMd) {
    // harness.fs.writeFile — verified API
    await harness.fs.writeFile('AGENTS.md', agentsMd)
  }

  // harness.session() — verified API, optional name?: string
  const session = await harness.session(`atom-${directive.directiveId}`)

  let stdout   = ''
  let timedOut = false

  try {
    // session.skill(name, { args?, result? }) — verified API
    // name = declared skill name (= skillRef by convention)
    // No result schema — we want text output for evaluateSuccessCondition
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

  // suppress agentId unused warning — captured in writeAudit via CoordinatorDO
  void agentId

  return { stdout, timedOut, durationMs: Date.now() - start, harness }
}

// ── SuccessCondition evaluation — async for file-exists (Gap 4) ───────────────

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
      // harness.shell() — verified API
      const check = await harness.shell(`test -f ${condition.path} && echo exists`)
      return check.stdout.trim() === 'exists'
    }
    case 'composite':
      return (await Promise.all(
        condition.all.map(c => evaluateSuccessCondition(c, result, harness))
      )).every(Boolean)
  }
}

// ── CandidatePatch via harness VFS delta ──────────────────────────────────────
// Closes on_failure.ts TODO: "capture filesystem diff, stderr, exit code"

export async function extractWorkspaceDelta(
  harness:   FlueHarness,
  seedPaths: Set<string>,
): Promise<Array<{ virtualPath: string; kind: 'added' | 'deleted'; content?: string }>> {
  // harness.shell() — verified API
  const result   = await harness.shell('find /workspace -type f 2>/dev/null')
  const allPaths = result.stdout.split('\n').map(p => p.trim()).filter(Boolean)
  const deltas: Array<{ virtualPath: string; kind: 'added' | 'deleted'; content?: string }> = []

  for (const vPath of allPaths) {
    if (seedPaths.has(vPath)) continue
    // harness.fs.readFile() — verified API
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
  await env.SANDBOX_OUTPUT_BUCKET.put(key, output)
  return `r2://${key}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
