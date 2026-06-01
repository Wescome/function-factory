import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import type { ArtifactClient } from "../artifact-client.js"
import type { DispatchLogRow, FormArtifact, UncertaintyEmission } from "./formula-compiler.js"
import { buildFormulaCompilerDeps } from "./formula-compiler-adapter.js"

interface MockDb {
  query: Mock<(collection: string, params: Record<string, unknown>) => Promise<Record<string, unknown>[]>>
  get: Mock<(collection: string, key: string) => Promise<Record<string, unknown> | null>>
  insert: Mock<(collection: string, doc: Record<string, unknown>) => Promise<void>>
  patch: Mock<(collection: string, key: string, patch: Record<string, unknown>) => Promise<void>>
}

function makeDb(): MockDb {
  return {
    query: vi.fn(async (_collection: string, _params: Record<string, unknown>) => []),
    get: vi.fn(async (_collection: string, _key: string) => null),
    insert: vi.fn(async (_collection: string, _doc: Record<string, unknown>) => undefined),
    patch: vi.fn(async (_collection: string, _key: string, _patch: Record<string, unknown>) => undefined),
  }
}

function buildDeps(db: MockDb) {
  return buildFormulaCompilerDeps(db as unknown as ArtifactClient, {
    GAS_CITY_BASE_URL: "https://gas-city.test",
    GAS_CITY_CITY_NAME: "phase0-city",
    GAS_CITY_BEARER_TOKEN: "token",
    GAS_CITY_AGENT_NAME: "factory-agent",
    GAS_CITY_RIG: "factory-rig",
    GAS_CITY_RIG_ROOT: "/factory",
    GAS_CITY_WEBHOOK_URL: "https://factory.test/webhooks/gascity",
  })
}

describe("buildFormulaCompilerDeps", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("fetchCoherenceVR queries the latest passed coherence verification report for an ES", async () => {
    const db = makeDb()
    db.query.mockResolvedValueOnce([{ _key: "VR-1" }])
    const deps = buildDeps(db)

    const row = await deps.fetchCoherenceVR("ES-123")

    expect(row).toEqual({ _key: "VR-1" })
    expect(db.query).toHaveBeenCalledOnce()
    const [collection, params] = db.query.mock.calls[0]!
    expect(collection).toBe("verification_reports")
    expect(params).toEqual({ kind: "coherence", status: "passed" })
  })

  it("getDispatchLogByIdempotencyKey uses null excludeKey by default and filters non-null excludeKey", async () => {
    const db = makeDb()
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ _key: "DL-2" }])
    const deps = buildDeps(db)

    await expect(deps.getDispatchLogByIdempotencyKey("idem-1", 1)).resolves.toBeNull()
    await expect(deps.getDispatchLogByIdempotencyKey("idem-1", 1, "DL-1")).resolves.toEqual({ _key: "DL-2" })

    expect(db.query).toHaveBeenCalledTimes(2)
    const [collectionWithoutExclude, paramsWithoutExclude] = db.query.mock.calls[0]!
    expect(collectionWithoutExclude).toBe("dispatch_log")
    expect(paramsWithoutExclude).toEqual({
      idempotency_key: "idem-1",
      factory_attempt: 1,
    })

    const [, paramsWithExclude] = db.query.mock.calls[1]!
    expect(paramsWithExclude).toEqual({
      idempotency_key: "idem-1",
      factory_attempt: 1,
    })
  })

  it("writeFormAndDispatchLog saves the form before the dispatch log", async () => {
    const db = makeDb()
    const deps = buildDeps(db)
    const form = { _key: "FORM-1" } as unknown as FormArtifact
    const dispatchLog = { _key: "DL-1" } as unknown as DispatchLogRow

    await deps.writeFormAndDispatchLog(form, dispatchLog)

    expect(db.insert).toHaveBeenCalledTimes(2)
    expect(db.insert.mock.calls[0]).toEqual(["formulas", form])
    expect(db.insert.mock.calls[1]).toEqual(["dispatch_log", dispatchLog])
  })

  it("writeFormAndDispatchLog propagates a form save failure and does not write dispatch_log", async () => {
    const db = makeDb()
    const failure = new Error("form write failed")
    db.insert.mockRejectedValueOnce(failure)
    const deps = buildDeps(db)

    await expect(deps.writeFormAndDispatchLog(
      { _key: "FORM-1" } as unknown as FormArtifact,
      { _key: "DL-1" } as unknown as DispatchLogRow,
    )).rejects.toThrow("form write failed")

    expect(db.insert).toHaveBeenCalledTimes(1)
    expect(db.insert.mock.calls[0]?.[0]).toBe("formulas")
  })

  it("writeFormAndDispatchLog propagates a dispatch log save failure after the form save", async () => {
    const db = makeDb()
    db.insert
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("dispatch log write failed"))
    const deps = buildDeps(db)

    await expect(deps.writeFormAndDispatchLog(
      { _key: "FORM-1" } as unknown as FormArtifact,
      { _key: "DL-1" } as unknown as DispatchLogRow,
    )).rejects.toThrow("dispatch log write failed")

    expect(db.insert).toHaveBeenCalledTimes(2)
    expect(db.insert.mock.calls[0]?.[0]).toBe("formulas")
    expect(db.insert.mock.calls[1]?.[0]).toBe("dispatch_log")
  })

  it("emitUncertaintyEntry swallows save failures after warning", async () => {
    const db = makeDb()
    db.insert.mockRejectedValueOnce(new Error("collection missing"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const deps = buildDeps(db)

    await expect(deps.emitUncertaintyEntry({
      pass_or_skill: "formula-compiler",
      reason: "missing evidence",
      suggested_resolution: "rerun verification",
      blocking_for: ["dispatch"],
      timestamp: "2026-05-21T00:00:00.000Z",
    } satisfies UncertaintyEmission)).resolves.toBeUndefined()

    expect(db.insert).toHaveBeenCalledWith(
      "uncertainty_entries",
      expect.objectContaining({ reason: "missing evidence" }),
    )
    expect(warn).toHaveBeenCalledWith("[UNCERTAINTY_EMIT_FAILED]", expect.any(Error))
  })
})
