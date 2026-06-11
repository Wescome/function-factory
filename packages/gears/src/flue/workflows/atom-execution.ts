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
  registerProvider,
  registerApiProvider,
  type FlueContext,
  type FlueHarness,
  type WorkflowRouteHandler,
  type SandboxFactory,
} from '@flue/runtime'
import { getSandbox } from '@cloudflare/sandbox'
import { cfSandboxToSessionEnv, getCloudflareAIBindingApiProvider } from '@flue/runtime/cloudflare'
import { InMemoryFs, Bash, bashFactoryToSessionEnv } from '@flue/runtime/internal'
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
  // Fail-fast guard: a missing DO-env binding otherwise surfaces as a silent
  // 401 (ofox/cloudflare auth) or a TypeError deep in storeFullOutput. Convert
  // it into a clear, attributable error at the entry point.
  if (!env.WORKSPACE_BUCKET)  throw new Error('FlueAtomExecutionWorkflow: WORKSPACE_BUCKET missing from DO env')
  if (!env.CF_API_TOKEN)      throw new Error('FlueAtomExecutionWorkflow: CF_API_TOKEN missing from DO env')
  if (!env.ANTHROPIC_API_KEY) throw new Error('FlueAtomExecutionWorkflow: ANTHROPIC_API_KEY missing from DO env')

  // Route anthropic/openai directly — no gateway.
  configureProvider('anthropic', { apiKey: env.ANTHROPIC_API_KEY })
  configureProvider('openai',    { apiKey: env.OPENAI_API_KEY })

  // Register Cloudflare Workers AI binding so cloudflare/* models resolve
  // via env.AI.run() — no API key required, billed to the CF account.
  // registerProvider wires model resolution; registerApiProvider wires the executor.
  // gateway: false bypasses Cloudflare's default AI Gateway. The default gateway
  // is the suspected component that emits the final inference chunk but never
  // closes the SSE body, leaving streamCloudflareWorkersAi (and thus
  // session.skill()) hanging. Routing directly to the Workers AI binding avoids it.
  registerProvider('cloudflare', { api: 'cloudflare-ai-binding', binding: env.AI as any, gateway: false })
  registerApiProvider(getCloudflareAIBindingApiProvider())

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
    let sandboxOutputRef: string | undefined = undefined
    if (result.stdout.length > 4096) {
      try { sandboxOutputRef = await storeFullOutput(result.stdout, directive.directiveId, env) }
      catch { /* non-fatal — rawOutput has first 4096 chars */ }
    }

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

  // Resolve the working directory once. Both the session env's cwd and the
  // agent's cwd MUST agree, otherwise relative writes (AGENTS.md) and the
  // workspace delta scan target the wrong directory (see SPEC-FF-JUSTBASH-004).
  const cwd          = directive.workingDir ?? '/workspace'
  const skillContent = directive.envVars['SKILL_CONTENT'] ?? ''

  // Clone repo into container if a URL was supplied. Not every container atom
  // needs a clone — some just need a persistent filesystem — so skip silently
  // when REPO_URL is absent.
  if (needsContainer && directive.envVars['REPO_URL']) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sandbox = getSandbox(env.SANDBOX as any, workflowId)
    await sandbox.gitCheckout(directive.envVars['REPO_URL'], {
      branch:    directive.envVars['REPO_BRANCH'] ?? 'main',
      targetDir: cwd,
      depth:     1,
    })
  }

  // Skill discovery happens AT init(agent) time from <cwd>/.agents/skills/<name>/SKILL.md,
  // so the skill file must exist BEFORE init() runs — not after.
  // Container path: the sandbox exists before init(), so write directly into it.
  if (needsContainer && skillContent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const skillSandbox = getSandbox(env.SANDBOX as any, workflowId)
    await skillSandbox.writeFile(
      `${cwd}/.agents/skills/${directive.skillRef}/SKILL.md`,
      skillContent,
    )
  }

  const agent = needsContainer
    ? createAgent<AtomExecutionPayload, Env>(({ id: agentRunId, env: e } = { id: workflowId, env, payload: undefined }) => {
        const sandboxFactory: SandboxFactory = {
          createSessionEnv: ({ id }) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cfSandboxToSessionEnv(getSandbox(e.SANDBOX as any, id), cwd),
        }
        return { profile, sandbox: sandboxFactory, cwd }
      })
    : createAgent(() => {
        // Virtual path: InMemoryFs is created inside Flue's createDefaultEnv() during
        // init(). To pre-populate the skill before discovery, provide a custom
        // SandboxFactory that builds its own InMemoryFs with the skill pre-written.
        if (!skillContent) return { profile, cwd }
        const sandboxFactory: SandboxFactory = {
          createSessionEnv: async () => {
            const fs = new InMemoryFs()
            await fs.writeFile(
              `${cwd}/.agents/skills/${directive.skillRef}/SKILL.md`,
              skillContent,
            )
            return bashFactoryToSessionEnv(() => new Bash({
              fs,
              network: { dangerouslyAllowFullInternetAccess: true },
            }))
          },
        }
        return { profile, sandbox: sandboxFactory, cwd }
      })

  const harness = await init(agent)

  const agentsMd = directive.envVars['AGENTS_MD'] ?? ''
  if (agentsMd) {
    await harness.fs.writeFile('AGENTS.md', agentsMd)
  }

  const session = await harness.session(`atom-${directive.directiveId}`)

  let stdout   = ''
  let timedOut = false

  // streamCloudflareWorkersAi (@flue/runtime) only resolves session.skill() once
  // the SSE body fully closes — it deliberately does NOT break on
  // finish_reason: "stop" because it keeps reading for the trailing usage chunk.
  // If CF Workers AI / AI Gateway emits the final chunk but never closes the HTTP
  // body, session.skill() hangs forever and ac.abort() can't rescue a stream the
  // binding considers already finished. Promise.race against a sleep() timeout is
  // the guaranteed escape hatch: the AbortController still attempts real
  // cancellation, but the race ensures the workflow always unblocks.
  const ac = new AbortController()
  let response: Awaited<ReturnType<typeof session.skill>> | null = null
  const timeoutPromise = sleep(directive.timeoutMs).then(() => {
    timedOut = true
    ac.abort()
    return null as typeof response
  })
  try {
    response = await Promise.race([
      session.skill(directive.skillRef, {
        args:   { instruction: directive.instruction },
        signal: ac.signal,
      }),
      timeoutPromise,
    ])
    if (response) stdout = response.text ?? ''
  } catch (err) {
    // AbortError when the timeout fires; other errors captured as stdout
    if (!timedOut) stdout = String(err)
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
  scanRoot = '/workspace',
): Promise<Array<{ virtualPath: string; kind: 'added' | 'deleted'; content?: string }>> {
  const result   = await harness.shell(`find ${scanRoot} -type f 2>/dev/null`)
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
