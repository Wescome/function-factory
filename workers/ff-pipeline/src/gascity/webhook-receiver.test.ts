import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  ensureCollection: vi.fn(async () => {}),
  ensureIndex: vi.fn(async () => {}),
  get: vi.fn(async (): Promise<unknown | null> => null),
  queryOne: vi.fn(async (): Promise<unknown | null> => null),
  save: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
  saveEdge: vi.fn(async () => ({})),
}))

vi.mock("@factory/arango-client", () => ({
  createClientFromEnv: () => mocks,
}))

const basePayload = {
  fn_id: "FN-GC-DISPATCH-WIRE",
  is_id: "IS-GC-DISPATCH-WIRE",
  es_id: "ES-GC-DISPATCH-WIRE",
  ep_id: "EP-GC-DISPATCH-WIRE-001",
  form_id: "FORM-GC-DISPATCH-WIRE-001",
  factory_attempt: 1,
  bead_id: "gc-11",
  outcome: "approved",
}

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    ARANGO_URL: "https://arango.example.com:8529",
    ARANGO_DATABASE: "function_factory_test",
    ARANGO_JWT: "test-jwt",
    ENVIRONMENT: "test",
    GAS_CITY_HMAC_SECRET_V1: "test-secret",
    GATES: { evaluateCoherenceVerification: vi.fn() },
    FACTORY_PIPELINE: { create: vi.fn(), get: vi.fn() },
    COORDINATOR: { idFromName: vi.fn(), get: vi.fn() },
    ATOM_EXECUTOR: { idFromName: vi.fn(), get: vi.fn() },
    SYNTHESIS_QUEUE: { send: vi.fn() },
    SYNTHESIS_RESULTS: { send: vi.fn() },
    ATOM_RESULTS: { send: vi.fn() },
    GITHUB_APP_ID: "app-id",
    GITHUB_APP_PRIVATE_KEY: "private-key",
    ...overrides,
  }
}

async function signedRequest(payload: Record<string, unknown>, overrides: HeadersInit = {}) {
  const body = JSON.stringify(payload)
  const signature = await hmac("test-secret", body)
  return new Request("https://factory.test/webhooks/gascity", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GC-Key-ID": "v1",
      "X-GC-Signature": `sha256=${signature}`,
      ...overrides,
    },
    body,
  })
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function dispatchLog(overrides: Record<string, unknown> = {}) {
  return {
    _key: "dispatch-1",
    fn_id: "FN-GC-DISPATCH-WIRE",
    is_id: "IS-GC-DISPATCH-WIRE",
    es_id: "ES-GC-DISPATCH-WIRE",
    ep_id: "EP-GC-DISPATCH-WIRE-001",
    form_id: "FORM-GC-DISPATCH-WIRE-001",
    factory_attempt: 1,
    outcome: "dispatched",
    gc_bead_id: "gc-11",
    ...overrides,
  }
}

describe("handleGasCityWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue(null)
    mocks.queryOne.mockResolvedValue(dispatchLog())
    mocks.save.mockResolvedValue({})
    mocks.update.mockResolvedValue({})
    mocks.saveEdge.mockResolvedValue({})
  })

  it("accepts an approved callback, writes fidelity evidence, and transitions to accepted", async () => {
    const { handleGasCityWebhook } = await import("./webhook-receiver.js")
    const response = await handleGasCityWebhook(await signedRequest(basePayload), createEnv() as never)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      accepted: true,
      lifecycle_state: "accepted",
      outcome: "approved",
    })
    expect(mocks.save).toHaveBeenCalledWith("completion_events", expect.objectContaining({
      _key: "gc-11",
      fidelity_verdict_id: expect.stringMatching(/^VR-[A-F0-9]{16}$/),
    }))
    expect(mocks.save).toHaveBeenCalledWith("fidelity_verdicts", expect.objectContaining({
      verification: "fidelity",
      variant: "gascity",
      overall: "pass",
      gc_outcome: "approved",
      source_refs: [
        "FN-GC-DISPATCH-WIRE",
        "IS-GC-DISPATCH-WIRE",
        "ES-GC-DISPATCH-WIRE",
        "EP-GC-DISPATCH-WIRE-001",
        "FORM-GC-DISPATCH-WIRE-001",
      ],
    }))
    expect(mocks.update).toHaveBeenCalledWith("specs_functions", "FN-GC-DISPATCH-WIRE", expect.objectContaining({
      state: "accepted",
    }))
    expect(mocks.saveEdge).toHaveBeenCalledWith(
      "lifecycle_transitions",
      "specs_functions/FN-GC-DISPATCH-WIRE",
      "specs_functions/FN-GC-DISPATCH-WIRE",
      expect.objectContaining({ from: "dispatched", to: "accepted" }),
    )
    expect(mocks.ensureCollection).toHaveBeenCalledWith("lifecycle_transitions", { type: "edge" })
    expect(mocks.ensureIndex).toHaveBeenCalledWith("completion_events", expect.objectContaining({
      fields: ["bead_id"],
      unique: true,
    }))
  })

  it("rejects invalid signatures before writing completion evidence", async () => {
    const { handleGasCityWebhook } = await import("./webhook-receiver.js")
    const request = await signedRequest(basePayload, { "X-GC-Signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000" })

    const response = await handleGasCityWebhook(request, createEnv() as never)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "invalid_signature" })
    expect(mocks.save).toHaveBeenCalledWith("webhook_rejections", expect.objectContaining({
      reason: "invalid_signature",
    }))
    expect(mocks.save).not.toHaveBeenCalledWith("completion_events", expect.anything())
  })

  it("fails closed on orphan bead IDs", async () => {
    const { handleGasCityWebhook } = await import("./webhook-receiver.js")
    mocks.queryOne.mockResolvedValueOnce(null)

    const response = await handleGasCityWebhook(await signedRequest(basePayload), createEnv() as never)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "orphan_bead", bead_id: "gc-11" })
    expect(mocks.save).toHaveBeenCalledWith("webhook_rejections", expect.objectContaining({
      reason: "orphan_bead",
    }))
    expect(mocks.save).not.toHaveBeenCalledWith("fidelity_verdicts", expect.anything())
  })

  it("returns duplicate when the bead completion is already recorded", async () => {
    const { handleGasCityWebhook } = await import("./webhook-receiver.js")
    mocks.get.mockResolvedValueOnce({ _key: "gc-11", fidelity_verdict_id: "VR-DUPLICATE000001" })

    const response = await handleGasCityWebhook(await signedRequest(basePayload), createEnv() as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      duplicate: true,
      bead_id: "gc-11",
      vr_id: "VR-DUPLICATE000001",
    })
    expect(mocks.queryOne).not.toHaveBeenCalled()
  })

  it("maps revise to rejected and writes an amendment signal only", async () => {
    const { handleGasCityWebhook } = await import("./webhook-receiver.js")
    const response = await handleGasCityWebhook(await signedRequest({
      ...basePayload,
      outcome: "revise",
      remediation: "Verifier found missing tests.",
    }), createEnv() as never)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      accepted: true,
      lifecycle_state: "rejected",
      outcome: "revise",
    })
    expect(mocks.save).toHaveBeenCalledWith("fidelity_verdicts", expect.objectContaining({
      overall: "fail",
      gc_outcome: "revise",
      remediation: "Verifier found missing tests.",
    }))
    expect(mocks.update).toHaveBeenCalledWith("specs_functions", "FN-GC-DISPATCH-WIRE", expect.objectContaining({
      state: "rejected",
    }))
    expect(mocks.save).toHaveBeenCalledWith("specs_signals", expect.objectContaining({
      signalType: "internal",
      source: "gascity:webhook",
      subtype: "gascity:revise",
      raw: expect.objectContaining({
        outcome: "revise",
        remediation: "Verifier found missing tests.",
      }),
    }))
  })

  it("halts amendment and writes an incident when revise exceeds max amendment depth", async () => {
    const { handleGasCityWebhook } = await import("./webhook-receiver.js")
    mocks.queryOne.mockResolvedValueOnce(dispatchLog({ factory_attempt: 4 }))
    const response = await handleGasCityWebhook(await signedRequest({
      ...basePayload,
      factory_attempt: 4,
      outcome: "revise",
      remediation: "Repeated verifier failure.",
    }), createEnv() as never)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      accepted: true,
      lifecycle_state: "rejected",
      outcome: "revise",
      amendment_halted: true,
      incident_id: expect.stringMatching(/^INC-GC-AMENDMENT-DEPTH-[A-F0-9]{12}$/),
    })
    expect(mocks.save).toHaveBeenCalledWith("specs_incidents", expect.objectContaining({
      incidentType: "gascity_amendment_depth_exceeded",
      functionIds: ["FN-GC-DISPATCH-WIRE"],
      severity: "sev3",
      status: "open",
      max_amendment_depth: 3,
      factory_attempt: 4,
      raw: expect.objectContaining({
        outcome: "revise",
        remediation: "Repeated verifier failure.",
      }),
    }))
    expect(mocks.save).not.toHaveBeenCalledWith("specs_signals", expect.anything())
  })
})
