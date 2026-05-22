import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import type { FormulaCompilerResult } from "./compilers/formula-compiler.js"

const mocks = vi.hoisted(() => {
  const dbGet = vi.fn(async (_collection: string, _key: string): Promise<Record<string, unknown> | null> => ({
    _key: "EP-1",
    id: "EP-1",
  }))
  return {
    dbGet,
    createClientFromEnv: vi.fn(() => ({
      get: dbGet,
    })),
    buildFormulaCompilerDeps: vi.fn(() => ({ marker: "deps" })),
    compileAndDispatchFormula: vi.fn(async (): Promise<FormulaCompilerResult> => ({
      outcome: "dispatched",
      form_id: "FORM-1",
      dispatch_log_key: "DL-1",
    })),
  }
})

vi.mock("cloudflare:workers", () => {
  class WorkflowEntrypoint {
    env: unknown
    constructor() {}
  }
  class DurableObject {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }
  return { WorkflowEntrypoint, DurableObject }
})

vi.mock("agents", () => {
  class Agent {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
    async runFiber(_name: string, fn: (ctx: unknown) => Promise<unknown>) {
      return fn({ id: "mock-fiber", stash: () => {}, snapshot: null })
    }
    stash() {}
    async onFiberRecovered() {}
  }
  const callable = () => (_target: unknown, _context: unknown) => _target
  return { Agent, callable }
})

vi.mock("@cloudflare/sandbox", () => ({
  Sandbox: class {},
  getSandbox: () => ({}),
}))

vi.mock("@cloudflare/containers", () => ({
  Container: class {},
  getContainer: () => ({}),
}))

vi.mock("@factory/arango-client", () => ({
  createClientFromEnv: mocks.createClientFromEnv,
}))

vi.mock("./compilers/formula-compiler-adapter.js", () => ({
  buildFormulaCompilerDeps: mocks.buildFormulaCompilerDeps,
}))

vi.mock("./compilers/formula-compiler.js", () => ({
  compileAndDispatchFormula: mocks.compileAndDispatchFormula,
}))

interface MockExecutionContext {
  waitUntil: Mock<(promise: Promise<unknown>) => void>
  passThroughOnException: Mock<() => void>
}

function createCtx(): MockExecutionContext {
  return {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      promise.catch(() => undefined)
    }),
    passThroughOnException: vi.fn(),
  }
}

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    ARANGO_URL: "https://arango.example.com:8529",
    ARANGO_DATABASE: "function_factory_test",
    ARANGO_JWT: "test-jwt",
    ENVIRONMENT: "test",
    OPERATOR_CONTROL_TOKEN: "operator-token",
    GAS_CITY_BASE_URL: "https://gas-city.test",
    GAS_CITY_CITY_NAME: "phase0-city",
    GAS_CITY_BEARER_TOKEN: "gas-token",
    GAS_CITY_AGENT_NAME: "factory-agent",
    GAS_CITY_RIG: "factory-rig",
    GAS_CITY_RIG_ROOT: "/factory",
    GAS_CITY_WEBHOOK_URL: "https://factory.test/webhooks/gascity",
    GATES: { evaluateCoherenceVerification: vi.fn() },
    FACTORY_PIPELINE: {
      create: vi.fn(),
      get: vi.fn(),
    },
    COORDINATOR: {
      idFromName: vi.fn(),
      get: vi.fn(),
    },
    ATOM_EXECUTOR: {
      idFromName: vi.fn(),
      get: vi.fn(),
    },
    SYNTHESIS_QUEUE: {
      send: vi.fn(),
    },
    SYNTHESIS_RESULTS: {
      send: vi.fn(),
    },
    ATOM_RESULTS: {
      send: vi.fn(),
    },
    ...overrides,
  }
}

async function postDispatchFormula(body: unknown, options: {
  env?: Record<string, unknown>
  headers?: HeadersInit
  ctx?: MockExecutionContext
} = {}) {
  const { default: worker } = await import("./index.js")
  const ctx = options.ctx ?? createCtx()
  const request = new Request("https://host/dispatch-formula", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer operator-token",
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
  const response = await worker.fetch(
    request,
    createEnv(options.env) as never,
    ctx as unknown as ExecutionContext,
  )
  return { response, ctx }
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe("POST /dispatch-formula", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dbGet.mockResolvedValue({ _key: "EP-1", id: "EP-1" })
    mocks.compileAndDispatchFormula.mockResolvedValue({
      outcome: "dispatched",
      form_id: "FORM-1",
      dispatch_log_key: "DL-1",
      gc_bead_id: "bead-1",
      gc_workflow_id: "workflow-1",
    })
  })

  it("returns 401 before database access when operator authorization is missing", async () => {
    const { response } = await postDispatchFormula(
      { epId: "EP-1" },
      { headers: { Authorization: "" } },
    )

    expect(response.status).toBe(401)
    expect(await responseBody(response)).toEqual({ error: "operator authorization required" })
    expect(mocks.createClientFromEnv).not.toHaveBeenCalled()
    expect(mocks.compileAndDispatchFormula).not.toHaveBeenCalled()
  })

  it("returns 401 before database access when operator authorization is invalid", async () => {
    const { response } = await postDispatchFormula(
      { epId: "EP-1" },
      { headers: { Authorization: "Bearer wrong-token" } },
    )

    expect(response.status).toBe(401)
    expect(await responseBody(response)).toEqual({ error: "operator authorization rejected" })
    expect(mocks.createClientFromEnv).not.toHaveBeenCalled()
    expect(mocks.compileAndDispatchFormula).not.toHaveBeenCalled()
  })

  it("returns 400 when epId is missing", async () => {
    const { response } = await postDispatchFormula({})

    expect(response.status).toBe(400)
    expect(await responseBody(response)).toEqual({ error: "epId required" })
    expect(mocks.createClientFromEnv).not.toHaveBeenCalled()
  })

  it("returns 500 with the missing Gas City env vars before database access", async () => {
    const { response } = await postDispatchFormula(
      { epId: "EP-1" },
      {
        env: {
          GAS_CITY_BASE_URL: "",
          GAS_CITY_BEARER_TOKEN: undefined,
        },
      },
    )

    expect(response.status).toBe(500)
    expect(await responseBody(response)).toEqual({
      error: "Gas City env vars not configured",
      missing: ["GAS_CITY_BASE_URL", "GAS_CITY_BEARER_TOKEN"],
    })
    expect(mocks.createClientFromEnv).not.toHaveBeenCalled()
  })

  it("returns 404 when the execution packet does not exist", async () => {
    mocks.dbGet.mockResolvedValueOnce(null)

    const { response } = await postDispatchFormula({ epId: "EP-MISSING" })

    expect(response.status).toBe(404)
    expect(await responseBody(response)).toEqual({ error: "EP not found", epId: "EP-MISSING" })
    expect(mocks.dbGet).toHaveBeenCalledWith("execution_packets", "EP-MISSING")
    expect(mocks.compileAndDispatchFormula).not.toHaveBeenCalled()
  })

  it("returns 202 for a fresh dispatch and defaults factoryAttempt to 1", async () => {
    const ctx = createCtx()

    const { response } = await postDispatchFormula({ epId: "EP-1" }, { ctx })

    expect(response.status).toBe(202)
    expect(await responseBody(response)).toEqual({
      accepted: true,
      outcome: "dispatched",
      form_id: "FORM-1",
      dispatch_log_key: "DL-1",
      gc_bead_id: "bead-1",
      gc_workflow_id: "workflow-1",
    })
    expect(mocks.buildFormulaCompilerDeps).toHaveBeenCalledOnce()
    expect(mocks.compileAndDispatchFormula).toHaveBeenCalledWith(expect.objectContaining({
      ep: { _key: "EP-1", id: "EP-1" },
      factoryAttempt: 1,
    }))
    expect(ctx.waitUntil).toHaveBeenCalledOnce()
    await ctx.waitUntil.mock.calls[0]![0]
  })

  it("returns 200 for replayed dispatch", async () => {
    mocks.compileAndDispatchFormula.mockResolvedValueOnce({
      outcome: "dispatched",
      form_id: "FORM-1",
      dispatch_log_key: "DL-1",
      replay: true,
    })

    const { response } = await postDispatchFormula({ epId: "EP-1", factoryAttempt: 2, priorEsId: "ES-OLD" })

    expect(response.status).toBe(200)
    expect(await responseBody(response)).toEqual({
      accepted: true,
      outcome: "dispatched",
      form_id: "FORM-1",
      dispatch_log_key: "DL-1",
      replay: true,
    })
    expect(mocks.compileAndDispatchFormula).toHaveBeenCalledWith(expect.objectContaining({
      factoryAttempt: 2,
      priorEsId: "ES-OLD",
    }))
  })

  it.each([
    "missing_coherence_vr",
    "unregistered_adapter",
    "reserved_key_collision",
    "resume_missing_form",
    "form_key_collision",
    "form_determinism_violation",
  ])("returns 422 for compiler halt error %s", async (error) => {
    mocks.compileAndDispatchFormula.mockResolvedValueOnce({
      outcome: "failed",
      error,
    })

    const { response } = await postDispatchFormula({ epId: "EP-1" })

    expect(response.status).toBe(422)
    expect(await responseBody(response)).toEqual({ outcome: "failed", error })
  })

  it("returns 500 for uncaught exceptions", async () => {
    mocks.compileAndDispatchFormula.mockRejectedValueOnce(new Error("ArangoDB unavailable"))

    const { response } = await postDispatchFormula({ epId: "EP-1" })

    expect(response.status).toBe(500)
    expect(await responseBody(response)).toEqual({ error: "ArangoDB unavailable" })
  })

  it("returns 500 when ArangoDB throws during EP lookup", async () => {
    mocks.dbGet.mockRejectedValueOnce(new Error("ArangoDB unavailable"))

    const { response } = await postDispatchFormula({ epId: "EP-1" })

    expect(response.status).toBe(500)
    expect(await responseBody(response)).toEqual({ error: "ArangoDB unavailable" })
  })
})
