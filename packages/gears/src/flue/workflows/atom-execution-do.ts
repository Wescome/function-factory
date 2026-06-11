/**
 * FlueAtomExecutionWorkflow — Durable Object class for the atom-execution Flue workflow.
 *
 * Hand-authored equivalent of what @flue/cli generates in _entry.ts lines 419–435.
 * resolveCloudflareExtension returns identity when the workflow module has no
 * `cloudflare` export — so .base(Agent) === Agent and .wrap() is a no-op here.
 *
 * Consumes @flue/runtime/internal directly (same imports as _entry.ts lines 6-28).
 * virtual:flue/packaged-skills → literal {} — skills are workspace-discovered from
 * .agents/skills/ at runtime (GD-003), not bundled.
 *
 * SPEC-FF-GEARS-001 §1/§3 — @factory/gears is the complete execution substrate.
 */

import { Agent, getAgentByName } from 'agents'
import {
  Bash,
  InMemoryFs,
  createFlueContext,
  InMemorySessionStore,
  InMemoryRunStore,
  createDurableRunStore,
  CLOUDFLARE_WORKFLOW_INTERNAL_METADATA_PATH,
  createSqlSessionStore,
  SqliteEventStreamStore,
  bashFactoryToSessionEnv,
  resolveModel,
  handleWorkflowRequest,
  handleRunRouteRequest,
  handleStreamRead,
  handleStreamHead,
  failRecoveredRun,
} from '@flue/runtime/internal'
import {
  runWithCloudflareContext,
  cfSandboxToSessionEnv,
  FlueRegistry,
  createCloudflareRunRegistry,
} from '@flue/runtime/cloudflare'
import { run as atomExecutionRun } from './atom-execution.js'

export { FlueRegistry }

// ── Constants ─────────────────────────────────────────────────────────────────

const WORKFLOW_NAME = 'atom-execution'
const IDENTITY = {
  bindingName: 'FLUE_ATOM_EXECUTION_WORKFLOW',
  className:   'FlueAtomExecutionWorkflow',
} as const

// Skills are workspace-discovered from .agents/skills/ at runtime (GD-003).
const skills         = {}
const packagedSkills = {}
const systemPrompt   = ''

// ── Module-level stores (per-isolate singletons) ───────────────────────────────

const memoryWorkflowSessionStore = new InMemorySessionStore()
const memoryRunStore             = new InMemoryRunStore()
const eventStreamStores          = new WeakMap<object, SqliteEventStreamStore>()

// ── Sandbox / env factories ───────────────────────────────────────────────────

async function createDefaultEnv() {
  const fs = new InMemoryFs()
  return bashFactoryToSessionEnv(() => new Bash({
    fs,
    network: { dangerouslyAllowFullInternetAccess: true },
  }))
}

function resolveSandbox(sandbox: unknown) {
  if (
    sandbox &&
    typeof sandbox === 'object' &&
    Object.getPrototypeOf(sandbox)?.constructor?.name === 'DurableObject'
  ) {
    return cfSandboxToSessionEnv(sandbox as any)
  }
  return null
}

// ── Per-instance helpers ──────────────────────────────────────────────────────

function eventStreamStoreFor(doInstance: any): SqliteEventStreamStore {
  const existing = eventStreamStores.get(doInstance)
  if (existing) return existing
  const sql = doInstance?.ctx?.storage?.sql
  if (!sql) throw new Error('[flue] Durable Object SQLite storage unavailable — FlueAtomExecutionWorkflow requires SQLite-backed storage.')
  const store = new SqliteEventStreamStore(sql)
  eventStreamStores.set(doInstance, store)
  return store
}

function runStoreFor(doInstance: any) {
  return doInstance?.ctx?.storage?.sql
    ? createDurableRunStore(doInstance.ctx.storage.sql)
    : memoryRunStore
}

function runRegistryFor(reqEnv: any) {
  return createCloudflareRunRegistry(reqEnv?.FLUE_REGISTRY)
}

function workflowContextFor(
  id: string, runId: string | undefined, payload: unknown, doInstance: any,
  req: Request, initialEventIndex: number, dispatchId?: string,
) {
  const sql          = doInstance?.ctx?.storage?.sql
  const defaultStore = sql ? createSqlSessionStore(sql) : memoryWorkflowSessionStore
  return createFlueContext({
    id,
    ...(runId !== undefined ? { runId } : {}),
    ...(dispatchId !== undefined ? { dispatchId } : {}),
    payload,
    env:            doInstance?.env ?? {},
    req,
    initialEventIndex,
    agentConfig:    { systemPrompt, skills, packagedSkills, model: undefined, resolveModel },
    createDefaultEnv,
    defaultStore,
    resolveSandbox,
  })
}

function runWithInstance<T>(doInstance: any, fn: () => T): T {
  return runWithCloudflareContext({
    env:           doInstance.env,
    agentInstance: doInstance,
    storage:       doInstance.ctx.storage,
    durableObjectIdentity: {
      bindingName: IDENTITY.bindingName,
      className:   IDENTITY.className,
      name:        doInstance.name,
      id:          doInstance.ctx.id.toString(),
    },
  }, fn)
}

// ── Route parsing (mirrors _entry.ts lines 385–413) ──────────────────────────

function parseWorkflowStart(request: Request): boolean {
  if (request.method !== 'POST') return false
  const segs = new URL(request.url).pathname.split('/').filter(Boolean)
  return segs.length === 2
    && segs[0] === 'workflows'
    && decodeURIComponent(segs[1] || '') === WORKFLOW_NAME
}

function parseRunRoute(request: Request): { action: 'get' } | { action: 'ds-stream'; runId: string } | null {
  const url = new URL(request.url)
  if (url.pathname === CLOUDFLARE_WORKFLOW_INTERNAL_METADATA_PATH) return { action: 'get' }
  const segs = url.pathname.split('/').filter(Boolean)
  if (segs.length < 2 || segs[0] !== 'runs') return null
  let runId: string
  try { runId = decodeURIComponent(segs[1] || '') } catch { return null }
  if (!runId || segs[2]) return null
  if (request.method === 'GET' || request.method === 'HEAD') return { action: 'ds-stream', runId }
  return null
}

// ── Workflow dispatcher (mirrors _entry.ts lines 332–373) ────────────────────

async function dispatchWorkflow(request: Request, doInstance: any): Promise<Response | null> {
  const instanceId = doInstance.name
  const runRoute   = parseRunRoute(request)

  if (runRoute) {
    if (runRoute.action === 'ds-stream') {
      const store      = eventStreamStoreFor(doInstance)
      const streamPath = 'runs/' + runRoute.runId
      if (request.method === 'HEAD') return handleStreamHead(store, streamPath)
      return handleStreamRead({ store, path: streamPath, request })
    }
    return handleRunRouteRequest({
      owner:    { kind: 'workflow', workflowName: WORKFLOW_NAME, instanceId },
      runId:    instanceId,
      runStore: runStoreFor(doInstance),
    })
  }

  if (!parseWorkflowStart(request)) return null

  const registry = runRegistryFor(doInstance.env)
  return runWithInstance(doInstance, () => handleWorkflowRequest({
    request,
    workflowName: WORKFLOW_NAME,
    runId:        instanceId,
    handler:      atomExecutionRun as any,
    runStore:     runStoreFor(doInstance),
    ...(registry ? { runRegistry: registry } : {}),
    eventStreamStore: eventStreamStoreFor(doInstance),
    createContext: (id_: string, runId: string | undefined, payload: unknown, req: Request, idx: number | undefined, dispatchId?: string) =>
      workflowContextFor(id_, runId, payload, doInstance, req, idx ?? 0, dispatchId),
    startWorkflowAdmission: (runId: string, runFn: () => unknown) => {
      if (typeof doInstance.runFiber !== 'function') {
        throw new Error('[flue] "agents" package lacks runFiber — upgrade it.')
      }
      return doInstance.runFiber(
        'flue:workflow:' + runId,
        () => runWithInstance(doInstance, runFn),
      )
    },
  }))
}

// ── Fiber recovery (mirrors _entry.ts lines 315–330) ─────────────────────────

async function handleFiberRecovered(ctx: any, doInstance: any) {
  if (!ctx.name || ctx.name !== 'flue:workflow:' + doInstance.name) return
  const interruptedRunId = doInstance.name
  const registry = runRegistryFor(doInstance.env)
  await failRecoveredRun({
    owner:    { kind: 'workflow', workflowName: WORKFLOW_NAME, instanceId: interruptedRunId },
    id:       interruptedRunId,
    runId:    interruptedRunId,
    request:  new Request('https://flue.invalid/workflows/' + encodeURIComponent(WORKFLOW_NAME), { method: 'POST' }),
    error:    new Error('Flue workflow execution was interrupted.'),
    runStore: runStoreFor(doInstance),
    ...(registry ? { runRegistry: registry } : {}),
    eventStreamStore: eventStreamStoreFor(doInstance),
    createContext: (id_: string, recoveredRunId: string | undefined, payload: unknown, req: Request, idx: number | undefined) =>
      workflowContextFor(id_, recoveredRunId, payload, doInstance, req, idx ?? 0),
  })
}

// ── DO class (mirrors _entry.ts lines 419–435) ───────────────────────────────

export class FlueAtomExecutionWorkflow extends Agent<any, any> {
  override async onRequest(request: Request): Promise<Response> {
    const res = await dispatchWorkflow(request, this as any)
    return res ?? new Response('not found', { status: 404 })
  }

  override async onFiberRecovered(ctx: any) {
    if (ctx.name?.startsWith('flue:workflow:')) {
      return handleFiberRecovered(ctx, this as any)
    }
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(this)) as any
    if (typeof proto?.onFiberRecovered === 'function') {
      return proto.onFiberRecovered.call(this, ctx)
    }
  }
}

// ── Outer-Worker routing helper ───────────────────────────────────────────────
// Called from workers/ff-pipeline/src/index.ts fetch handler to route
// /workflows/atom-execution and /runs/:runId requests to this DO.

export async function routeAtomExecutionWorkflow(
  request: Request,
  namespace: DurableObjectNamespace,
): Promise<Response | null> {
  const url  = new URL(request.url)
  const segs = url.pathname.split('/').filter(Boolean)

  const isStart = request.method === 'POST'
    && segs.length === 2
    && segs[0] === 'workflows'
    && segs[1] === WORKFLOW_NAME

  const isRun = segs[0] === 'runs'
    && segs.length >= 2
    && (request.method === 'GET' || request.method === 'HEAD')

  if (!isStart && !isRun) return null

  const instanceId = isRun
    ? decodeURIComponent(segs[1] || '')
    : crypto.randomUUID()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub = await getAgentByName(namespace as any, instanceId)
  return stub.fetch(request)
}
