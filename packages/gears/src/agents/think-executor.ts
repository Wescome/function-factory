/**
 * @factory/gears — ThinkExecutor
 *
 * Durable Object that owns the execution substrate for a single atom.
 * Extends Think<Env> for runFiber durability and workspace access.
 * Does NOT own an LLM loop — ConductingAgent (Mastra Agent) handles inference.
 *
 * Dispatch: ff-pipeline queue consumer POSTs an AtomDirective JSON body to
 * `/execute-atom`. ThinkExecutor looks up its own CoordinatorDO binding to
 * avoid passing DO stubs across Worker RPC boundaries (unstable/unsupported).
 *
 * onFiberRecovered(): log only — stale-bead alarm in CoordinatorDO handles re-dispatch.
 */

import { Think, type FiberRecoveryContext } from '@cloudflare/think'
import { Workspace } from '@cloudflare/shell'
import { RequestContext } from '@mastra/core/request-context'
import type { AtomDirective, SuccessCondition } from '@factory/schemas'
import type { WorkspaceLike } from '@cloudflare/think/tools/workspace'
import type { ExecutionBead } from '../beads/types.js'
import { claimHook, releaseHook, failHook, getNextReady, BeadsNotSeededError } from '../beads/hook.js'
import { buildConductingAgent, type ConductorEnv } from './conducting-agent.js'

interface Env extends ConductorEnv {
  COORDINATOR_DO: DurableObjectNamespace
  SYNTHESIS_QUEUE: Queue
  ATOM_RESULTS: Queue
}

function buildAtomPrompt(directive: AtomDirective): string {
  // v2.0: `instructions` is canonical; v1 `instruction` is the deprecated alias.
  return directive.instructions ?? directive.instruction ?? ''
}

async function evaluateCondition(
  condition: SuccessCondition,
  workspace: WorkspaceLike,
  lastOutput: string,
): Promise<boolean> {
  switch (condition.type) {
    case 'exit-code':
      return true
    case 'file-exists':
      return (await workspace.stat(condition.path)) !== null
    case 'output-contains':
      return lastOutput.includes(condition.substring)
    case 'output-matches':
      return new RegExp(condition.pattern).test(lastOutput)
    case 'always':
      return true
    case 'composite':
      for (const sub of condition.all) {
        if (!(await evaluateCondition(sub, workspace, lastOutput))) return false
      }
      return true
    default: {
      const _: never = condition
      throw new Error('Unknown SuccessCondition type: ' + (_ as any).type)
    }
  }
}

/**
 * Query CoordinatorDO for the next ready bead in the molecule and enqueue it.
 * Dispatches at most one bead per completion event. Downstream chaining
 * happens naturally when that ThinkExecutor completes and calls
 * dispatchNextBead again.
 *
 * A while-loop is unsafe here: getNextReady() is a pure SELECT on the
 * CoordinatorDO SQLite — it has no side effects. claimBead() (the mutation
 * that transitions ready → in_progress) is only called when the dispatched
 * queue message is consumed by a separate ThinkExecutor DO invocation. Because
 * claim happens asynchronously in a different DO, the CoordinatorDO state does
 * not advance between loop iterations, so the same ready bead would be returned
 * on every call, producing an unbounded storm of duplicate queue messages.
 *
 * The queue message uses the atom-execute envelope shape expected by
 * queue-handler.ts: directive fields are nested under `atomSpec`, with
 * executableSpecificationId and runId promoted to the top level for routing.
 * workflowId is threaded from nextDirective.workflowId so the atom-results
 * consumer can route correctly without relying solely on ledger.workflowId.
 */
async function dispatchNextBead(
  coordinatorDO: DurableObjectStub,
  moleculeId: string,
  queue: Queue | undefined,
  atomResultsQueue: Queue,
  directive: AtomDirective,
): Promise<void> {
  if (!queue) {
    console.error('[ThinkExecutor] SYNTHESIS_QUEUE not bound — bead chain stalled')
    return
  }
  // Cache the result of the first getNextReady() call. If queue.send() fails
  // (a transient network/DO fault), the retry loop reuses this cached value so
  // the same bead is not fetched again. A re-fetch is only performed when
  // getNextReady() itself threw on the first attempt (cachedNext stays null).
  let cachedNext: ExecutionBead | null = null
  let firstCallThrew = false
  try {
    cachedNext = await getNextReady(coordinatorDO, moleculeId)
    if (cachedNext === null) return
    if (!cachedNext.payload) {
      console.error(`[ThinkExecutor] bead ${cachedNext.id} has no payload — skipping dispatch`)
      return
    }
    let nextDirective: AtomDirective
    try {
      nextDirective = JSON.parse(cachedNext.payload) as AtomDirective
    } catch (parseErr) {
      const parseErrMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      console.error(`[ThinkExecutor] bead ${cachedNext.id} has corrupt payload — cannot parse JSON: ${parseErrMsg}`)
      // Transition the corrupt bead to failed so it does not remain ready and
      // get re-dispatched infinitely by the stale-bead alarm.
      try {
        await failHook(coordinatorDO, cachedNext.id, 'corrupt-payload', `JSON.parse failed: ${parseErrMsg}`)
      } catch (failErr) {
        console.error(`[ThinkExecutor] failHook failed for corrupt bead ${cachedNext.id}: ${failErr instanceof Error ? failErr.message : String(failErr)}`)
      }
      return
    }
    await queue.send({
      type: 'atom-execute',
      executableSpecificationId: nextDirective.executableSpecificationId,
      runId: nextDirective.runId,
      workflowId: nextDirective.workflowId ?? null,
      atomId: nextDirective.atomId,
      atomSpec: nextDirective,
      sharedContext: {},
      upstreamArtifacts: {},
      maxRetries: 3,
      dryRun: false,
    })
    console.log(`[ThinkExecutor] dispatched next bead ${cachedNext.id} for molecule ${moleculeId}`)
  } catch (err) {
    if (cachedNext === null) {
      // getNextReady() itself threw — mark so the retry loop re-fetches.
      firstCallThrew = true
    }
    const errMsg = err instanceof Error ? err.message : String(err)
    // Permanent failure: molecule was never seeded — cannot recover via retry.
    // BeadsNotSeededError is thrown by getNextReady when CoordinatorDO returns 422.
    // Using instanceof instead of string matching avoids silent fall-through if the
    // error message wording changes.
    if (err instanceof BeadsNotSeededError) {
      console.error(`[ThinkExecutor] dispatchNextBead permanent failure — molecule ${moleculeId} not seeded: ${errMsg}`)
      try {
        await (atomResultsQueue as unknown as { send(body: unknown): Promise<void> }).send({
          executableSpecificationId: directive.executableSpecificationId,
          atomId: directive.atomId,
          result: {
            atomId: directive.atomId,
            verdict: {
              decision: 'fail',
              confidence: 1.0,
              reason: `Molecule not seeded — dispatchNextBead permanent failure: ${errMsg}`,
            },
            codeArtifact: null,
            testReport: null,
            critiqueReport: null,
            retryCount: 0,
          },
          workflowId: (directive as AtomDirective & { workflowId?: string | null }).workflowId ?? null,
          runId: directive.runId,
        })
      } catch (pubErr) {
        console.error(`[ThinkExecutor] Failed to publish not-seeded failure for molecule ${moleculeId}: ${pubErr instanceof Error ? pubErr.message : String(pubErr)}`)
      }
      return
    }
    // Transient DO-connectivity or network fault. The stale-bead alarm in
    // CoordinatorDO only rescues beads with status='in_progress' — it cannot
    // rescue a ready bead whose dispatch was dropped here. Retry with backoff
    // before abandoning, to avoid permanently stranding the next ready bead.
    //
    // If the first getNextReady() succeeded (cachedNext is set), reuse its
    // result on every retry — re-fetching would race with the stale-bead alarm
    // and could return the same bead a second time, producing duplicate queue
    // messages for a single bead.
    const retryDelaysMs = [1_000, 3_000]
    let lastRetryErr: unknown = err
    for (const delayMs of retryDelaysMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
      try {
        // Only re-fetch when the first call itself threw; otherwise reuse the
        // cached bead to prevent duplicate dispatch of the same bead.
        const retryNext = firstCallThrew
          ? await getNextReady(coordinatorDO, moleculeId)
          : cachedNext
        if (retryNext === null) return
        if (!retryNext.payload) {
          console.error(`[ThinkExecutor] bead ${retryNext.id} has no payload on retry — skipping dispatch`)
          return
        }
        let retryDirective: AtomDirective
        try {
          retryDirective = JSON.parse(retryNext.payload) as AtomDirective
        } catch (parseErr) {
          const parseErrMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
          console.error(`[ThinkExecutor] bead ${retryNext.id} has corrupt payload on retry — cannot parse JSON: ${parseErrMsg}`)
          try {
            await failHook(coordinatorDO, retryNext.id, 'corrupt-payload', `JSON.parse failed: ${parseErrMsg}`)
          } catch (failErr) {
            console.error(`[ThinkExecutor] failHook failed for corrupt bead ${retryNext.id}: ${failErr instanceof Error ? failErr.message : String(failErr)}`)
          }
          return
        }
        await queue.send({
          type: 'atom-execute',
          executableSpecificationId: retryDirective.executableSpecificationId,
          runId: retryDirective.runId,
          workflowId: retryDirective.workflowId ?? null,
          atomId: retryDirective.atomId,
          atomSpec: retryDirective,
          sharedContext: {},
          upstreamArtifacts: {},
          maxRetries: 3,
          dryRun: false,
        })
        console.log(`[ThinkExecutor] dispatched next bead ${retryNext.id} for molecule ${moleculeId} (after retry)`)
        return
      } catch (retryErr) {
        lastRetryErr = retryErr
      }
    }
    // All retries exhausted. The molecule may be permanently stranded — log the
    // error with enough context for an operator to manually re-dispatch.
    console.error(
      `[ThinkExecutor] dispatchNextBead failed for molecule ${moleculeId} after retries — next ready bead may be stranded`,
      lastRetryErr,
    )
  }
}

export class ThinkExecutor extends Think<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/execute-atom' && request.method === 'POST') {
      const directive = await request.json() as AtomDirective
      const result = await this.executeAtom(directive)
      if (result instanceof Response) return result
      return new Response(null, { status: 204 })
    }
    return super.fetch(request)
  }

  async executeAtom(directive: AtomDirective): Promise<Response | void> {
    if (!directive.runId) {
      throw new Error('AtomDirective.runId is required — CoordinatorDO key would be coordinator:undefined')
    }
    // /execute-atom bypasses super.fetch(), so Think.onStart() never runs — init workspace manually.
    if (!this.workspace) this.workspace = new Workspace({ sql: this.ctx.storage.sql, name: () => this.name })
    const coordinatorDO = this.env.COORDINATOR_DO.get(
      this.env.COORDINATOR_DO.idFromName(`coordinator:${directive.runId}`),
    )

    // INVARIANT: This DO is named think-{executableSpecificationId}-{atomId} (see
    // queue-handler.ts). Because the name is per-atom, this.ctx.id is stable across
    // all retry attempts of the same atom — the same DO instance is always reused.
    // Therefore this.ctx.id.toString() will reliably match the assigned_to column
    // set by claimBead on releaseHook/failHook calls below.
    //
    // WARNING: If the DO naming scheme is ever changed (e.g. to a shared/pooled DO),
    // agentId MUST be derived from the request payload (e.g. directive.atomId or a
    // dedicated agentId field) instead of this.ctx.id, or the assigned_to match will
    // silently fail for concurrent agents executing different atoms.
    const claimedBead = await claimHook(coordinatorDO, directive.atomId, this.ctx.id.toString())
    if (claimedBead === null) {
      return new Response(JSON.stringify({ status: 'skipped', reason: 'already_claimed' }), { status: 200 })
    }

    let lastOutput = ''

    try {
      await this.runFiber('atom-execution', async (ctx) => {
        ctx.stash({ atomId: directive.atomId, runId: directive.runId })

        const mastraAgent = buildConductingAgent(
          directive,
          coordinatorDO,
          this.workspace,
          this.env,
        )

        const result = await mastraAgent.generate(
          buildAtomPrompt(directive),
          {
            memory: {
              thread: directive.runId,
              // v1 deprecated field; omit entirely when absent (exactOptionalPropertyTypes).
              ...(directive.repoId !== undefined && { resource: directive.repoId }),
            },
            requestContext: new RequestContext([['directive', directive]]),
          },
        )

        lastOutput = typeof result.text === 'string' ? result.text : ''
      })

      // v2.0: successCondition is deprecated-optional; default to 'always' when absent.
      const succeeded = await evaluateCondition(
        directive.successCondition ?? { type: 'always' },
        this.workspace,
        lastOutput,
      )

      if (succeeded) {
        await releaseHook(coordinatorDO, directive.atomId, this.ctx.id.toString(), lastOutput)
      } else {
        await failHook(coordinatorDO, directive.atomId, this.ctx.id.toString(), 'success-condition-not-met')
      }
      await dispatchNextBead(coordinatorDO, claimedBead.molecule_id, this.env.SYNTHESIS_QUEUE, this.env.ATOM_RESULTS, directive)
    } catch (err) {
      let failHookSucceeded = false
      try {
        await failHook(
          coordinatorDO,
          directive.atomId,
          this.ctx.id.toString(),
          err instanceof Error ? err.message : String(err),
        )
        failHookSucceeded = true
      } catch (failErr) {
        console.error('[ThinkExecutor] failHook failed — bead will be re-hooked by stale-bead alarm', failErr)
      }
      // Only dispatch next bead if failHook succeeded. If failHook failed, the bead
      // is still in_progress — dispatching next could race with the stale-bead alarm
      // and produce duplicate queue messages for a downstream sibling.
      if (failHookSucceeded) {
        await dispatchNextBead(coordinatorDO, claimedBead.molecule_id, this.env.SYNTHESIS_QUEUE, this.env.ATOM_RESULTS, directive)
      }
    }
  }

  override async onFiberRecovered(ctx: FiberRecoveryContext): Promise<void> {
    console.log(
      `[ThinkExecutor] fiber recovered — not re-running atom. id=${ctx.id} name=${ctx.name} snapshot=${JSON.stringify(ctx.snapshot)}`,
    )
  }
}
