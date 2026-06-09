import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"

// The execute bridge route (POST /__pi-container/execute) is the Gas City
// pi-rpc runtime entry point. Gap 2 closure: it MUST enforce operator
// authorization before reaching the PI_CONTAINER stub, identical to the other
// /__pi-container/* control routes (status, restart) and /dispatch-formula.

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

// PI_CONTAINER stub is wired so we can assert the auth gate short-circuits
// BEFORE the container is ever touched.
function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: "test",
    OPERATOR_CONTROL_TOKEN: "operator-token",
    PI_CONTAINER: {
      idFromName: vi.fn(() => "pi-id"),
      get: vi.fn(() => ({
        fetch: vi.fn(async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      })),
    },
    ...overrides,
  }
}

async function postExecute(body: unknown, options: {
  env?: Record<string, unknown>
  headers?: HeadersInit
  ctx?: MockExecutionContext
} = {}) {
  const { default: worker } = await import("../index.js")
  const ctx = options.ctx ?? createCtx()
  const request = new Request("https://host/__pi-container/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
  const env = createEnv(options.env)
  const response = await worker.fetch(
    request,
    env as never,
    ctx as unknown as ExecutionContext,
  )
  return { response, ctx, env }
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe("POST /__pi-container/execute auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 before container access when no auth header is present", async () => {
    const { response, env } = await postExecute(
      { step_name: "GeneratePatch", session_id: "run-1" },
    )

    expect(response.status).toBe(401)
    expect(await responseBody(response)).toEqual({ error: "operator authorization required" })
    // The auth gate short-circuits before the PI_CONTAINER stub is touched.
    expect((env.PI_CONTAINER.get as Mock)).not.toHaveBeenCalled()
  })

  it("returns 403 when the supplied bearer token is wrong", async () => {
    const { response, env } = await postExecute(
      { step_name: "GeneratePatch", session_id: "run-1" },
      { headers: { Authorization: "Bearer wrong-token" } },
    )

    expect(response.status).toBe(403)
    expect(await responseBody(response)).toEqual({ error: "operator authorization rejected" })
    expect((env.PI_CONTAINER.get as Mock)).not.toHaveBeenCalled()
  })

  it("reaches the container when the bearer token matches", async () => {
    const { response, env } = await postExecute(
      {
        step_name: "GeneratePatch",
        role_name: "Coder",
        session_id: "run-1",
        inputs: {},
        declared_outputs: ["Patch"],
      },
      { headers: { Authorization: "Bearer operator-token" } },
    )

    expect(response.status).toBe(200)
    expect((env.PI_CONTAINER.get as Mock)).toHaveBeenCalledOnce()
  })

  it("accepts the X-FF-Operator-Token header as an alternative to bearer", async () => {
    const { response, env } = await postExecute(
      {
        step_name: "GeneratePatch",
        session_id: "run-1",
        inputs: {},
        declared_outputs: ["Patch"],
      },
      { headers: { "X-FF-Operator-Token": "operator-token" } },
    )

    expect(response.status).toBe(200)
    expect((env.PI_CONTAINER.get as Mock)).toHaveBeenCalledOnce()
  })
})
