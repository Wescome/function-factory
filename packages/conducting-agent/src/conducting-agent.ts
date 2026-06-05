// Conducting Agent — stateless CF Worker
// SPEC-CONDUCTING-AGENT-001
// No Factory ontology awareness. Receives AtomDirective, runs session, reports trace.

import { AtomDirective } from '@factory/schemas'
import { SessionNotInitialized } from '@factory/knowing-state-sdk'
import type { GasCitySessionRequest, GasCitySessionResponse, ConductingAgentTraceFragment } from './types.js'

export type Env = {
  GAS_CITY_SUPERVISOR_URL: string
  MEDIATION_AGENT: DurableObjectNamespace
  SANDBOX_OUTPUT_BUCKET: R2Bucket
  VERTICAL_SLICE_MAX_PARALLEL: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/execute') {
      return handleExecute(request, env)
    }

    return new Response('Not found', { status: 404 })
  },
}

// ── Main execution handler ──────────────────────────────────────────────────

async function handleExecute(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { repoId: string; executionId: string; sessionId: string }

  // I2 — Retrieval enforcement: pull AtomDirective from Mediation Agent
  const doId = env.MEDIATION_AGENT.idFromName(`mediation-agent:${body.repoId}`)
  const doStub = env.MEDIATION_AGENT.get(doId)

  const dispatchResponse = await doStub.fetch('https://do/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionId: body.executionId, sessionId: body.sessionId }),
  })

  const dispatched = await dispatchResponse.json() as { status: string; atom?: unknown }

  if (dispatched.status === 'blocked') {
    return Response.json({ status: 'blocked', reason: 'mediation-agent-not-active' })
  }
  if (dispatched.status === 'complete') {
    return Response.json({ status: 'complete' })
  }

  // Validate AtomDirective schema
  const parseResult = AtomDirective.safeParse(dispatched.atom)
  if (!parseResult.success) {
    await reportTrace(doStub, {
      executionId: body.executionId,
      directiveId: 'unknown',
      atomRef: 'unknown',
      workGraphVersion: 'unknown',
      repoId: body.repoId,
      outcome: 'failure',
      rawOutput: JSON.stringify(parseResult.error.issues),
      durationMs: 0,
      attemptNumber: 1,
      producedAt: new Date().toISOString(),
    })
    return Response.json({ status: 'error', reason: 'invalid-directive' })
  }

  const directive = parseResult.data

  // Execute with retry loop
  const trace = await executeWithRetry(directive, body.executionId, body.repoId, env)

  // Report to Mediation Agent
  await reportTrace(doStub, trace)

  return Response.json({ status: 'executed', outcome: trace.outcome })
}

// ── Execution loop with vertical slice retry ────────────────────────────────

async function executeWithRetry(
  directive: AtomDirective,
  executionId: string,
  repoId: string,
  env: Env
): Promise<ConductingAgentTraceFragment> {
  const { maxAttempts, backoffMs, isolatedRetry } = directive.retryPolicy
  let lastTrace: ConductingAgentTraceFragment | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(backoffMs)

    const sessionResult = await runGasCitySession(directive, env)

    const rawOutput = sessionResult.stdout.slice(0, 4096) // post_execution.ts hook
    const fullOutput = sessionResult.stdout.length > 4096
      ? await storeFullOutput(sessionResult.stdout, directive.directiveId, env)
      : undefined

    const success = evaluateSuccessCondition(directive.successCondition, sessionResult)
    const outcome = sessionResult.outcome === 'timeout' ? 'timeout'
      : success ? 'success'
      : 'failure'

    lastTrace = {
      executionId,
      directiveId: directive.directiveId,
      atomRef: directive.atomRef,
      workGraphVersion: directive.workGraphVersion,
      repoId,
      outcome,
      rawOutput,
      ...(fullOutput !== undefined ? { sandboxOutputRef: fullOutput } : {}),
      durationMs: sessionResult.durationMs,
      attemptNumber: attempt,
      producedAt: new Date().toISOString(),
    }

    if (outcome === 'success') return lastTrace

    // on_failure.ts hook: capture sandbox state
    // TODO: capture filesystem diff, stderr, exit code

    if (!isolatedRetry || attempt >= maxAttempts) break
  }

  if (!lastTrace) throw new Error('executeWithRetry: no trace produced — maxAttempts must be >= 1')
  return lastTrace
}

// ── Gas City session ────────────────────────────────────────────────────────

async function runGasCitySession(
  directive: AtomDirective,
  env: Env
): Promise<GasCitySessionResponse> {
  const sessionReq: GasCitySessionRequest = {
    repoId: directive.repoId,
    workingDir: directive.workingDir,
    memoryMb: directive.sandboxConfig.memoryMb,
    envVars: directive.envVars,
    permittedTools: directive.permittedTools,
    instruction: directive.instruction,
    timeoutMs: directive.timeoutMs,
  }

  const response = await fetch(`${env.GAS_CITY_SUPERVISOR_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionReq),
  })

  return response.json() as Promise<GasCitySessionResponse>
}

// ── SuccessCondition evaluation ─────────────────────────────────────────────
// Deterministic — no LLM involvement (SPEC-CONDUCTING-AGENT-001 §2.1 step 5)

function evaluateSuccessCondition(
  condition: AtomDirective['successCondition'],
  result: GasCitySessionResponse
): boolean {
  switch (condition.type) {
    case 'exit-code':
      return result.exitCode === condition.expectedCode
    case 'output-contains':
      return result.stdout.includes(condition.substring)
    case 'output-matches':
      return new RegExp(condition.pattern).test(result.stdout)
    case 'file-exists':
      // TODO: query sandbox filesystem
      return false
    case 'composite':
      return condition.all.every(c => evaluateSuccessCondition(c, result))
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function reportTrace(doStub: DurableObjectStub, trace: ConductingAgentTraceFragment): Promise<void> {
  await doStub.fetch('https://do/trace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trace),
  })
}

async function storeFullOutput(output: string, directiveId: string, env: Env): Promise<string> {
  const key = `sandbox-output/${directiveId}/${Date.now()}.txt`
  await env.SANDBOX_OUTPUT_BUCKET.put(key, output)
  // TODO: generate presigned URL with 24h TTL
  return `r2://${key}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
