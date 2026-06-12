/**
 * HTTP handler for `POST /trigger-synthesis`.
 *
 * Extracted from index.ts so it can be unit-tested without importing the
 * worker's barrel (`./index`), which re-exports Flue DO/Workflow classes from
 * `@factory/gears` / `@factory/factory-graph` plus `@cloudflare/sandbox` and
 * `agents`. Those are prebuilt ESM modules that statically import the
 * `cloudflare:*` protocol; Node's test-time ESM loader rejects that protocol
 * (`ERR_UNSUPPORTED_ESM_URL_SCHEME`), and that rejection happens during native
 * module linking — before any `vi.mock` or Vitest alias can intercept it.
 *
 * This module keeps a CLEAN import graph: the only static import is a
 * type-only import of `PipelineEnv`. It never touches `@factory/gears`,
 * `@flue/runtime`, `@cloudflare/sandbox`, `agents`, or any `cloudflare:*`
 * module, so the route can be exercised directly under Node.
 */

import type { PipelineEnv } from './types'

interface TriggerSynthesisBody {
  workflowId?: string
  executableSpecificationId?: string
  executableSpecification?: import('./coordinator/state').PipelineExecutableSpecification
  trellisExecutionPacket?: unknown
  dryRun?: boolean
}

/**
 * Validate the request, accept it with 202, and fire-and-forget the DO
 * dispatch + workflow event in `ctx.waitUntil`. Returns 400 when required
 * fields are missing.
 */
export async function handleTriggerSynthesis(
  request: Request,
  env: PipelineEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const body = (await request.json()) as TriggerSynthesisBody

  if (
    !body.workflowId
    || !body.executableSpecificationId
    || !body.executableSpecification
    || !body.trellisExecutionPacket
  ) {
    return new Response(
      JSON.stringify({
        error:
          'Missing required fields: workflowId, executableSpecificationId, executableSpecification, trellisExecutionPacket',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Fire-and-forget: DO work + event sending happens in background
  const workflow = await env.FACTORY_PIPELINE.get(body.workflowId)
  const executableSpecificationId = body.executableSpecificationId
  const executableSpecification = body.executableSpecification
  const trellisExecutionPacket = body.trellisExecutionPacket
  const dryRun = body.dryRun ?? false

  ctx.waitUntil(
    (async () => {
      try {
        const doId = env.COORDINATOR.idFromName(`synth-${executableSpecificationId}`)
        const stub = env.COORDINATOR.get(doId)
        const doResponse = await stub.fetch(
          new Request('https://do/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ executableSpecification, trellisExecutionPacket, dryRun }),
          }),
        )

        const result = (await doResponse.json()) as {
          verdict: { decision: string; confidence: number; reason: string }
          tokenUsage: number
          repairCount: number
        }

        await workflow.sendEvent({
          type: 'synthesis-complete',
          payload: {
            verdict: result.verdict,
            tokenUsage: result.tokenUsage,
            repairCount: result.repairCount,
          },
        })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        await workflow.sendEvent({
          type: 'synthesis-complete',
          payload: {
            verdict: { decision: 'fail', confidence: 1.0, reason: `Trigger error: ${errorMessage}` },
            tokenUsage: 0,
            repairCount: 0,
          },
        })
      }
    })(),
  )

  return new Response(JSON.stringify({ accepted: true, executableSpecificationId }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  })
}
