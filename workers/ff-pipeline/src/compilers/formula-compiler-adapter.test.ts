import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import type { ArangoClient } from "@factory/arango-client"
import type { DispatchLogRow, FormArtifact, UncertaintyEmission } from "./formula-compiler.js"
import { buildFormulaCompilerDeps } from "./formula-compiler-adapter.js"

interface MockDb {
  ensureCollection: Mock<(collection: string) => Promise<void>>
  query: Mock<(aql: string, bindVars?: Record<string, unknown>) => Promise<Record<string, unknown>[]>>
  get: Mock<(collection: string, key: string) => Promise<Record<string, unknown> | null>>
  save: Mock<(collection: string, doc: Record<string, unknown>) => Promise<Record<string, unknown>>>
  update: Mock<(collection: string, key: string, patch: Record<string, unknown>) => Promise<Record<string, unknown>>>
}

function makeDb(): MockDb {
  return {
    ensureCollection: vi.fn(async (_collection: string) => undefined),
    query: vi.fn(async (_aql: string, _bindVars?: Record<string, unknown>) => []),
    get: vi.fn(async (_collection: string, _key: string) => null),
    save: vi.fn(async (_collection: string, doc: Record<string, unknown>) => doc),
    update: vi.fn(async (_collection: string, _key: string, patch: Record<string, unknown>) => patch),
  }
}

function buildDeps(db: MockDb) {
  return buildFormulaCompilerDeps(db as unknown as ArangoClient, {
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
  })

  it("writeFormAndDispatchLog saves the form before the dispatch log", async () => {
    const db = makeDb()
    const deps = buildDeps(db)
    const form = { _key: "FORM-1" } as unknown as FormArtifact
    const dispatchLog = { _key: "DL-1" } as unknown as DispatchLogRow

    await deps.writeFormAndDispatchLog(form, dispatchLog)

    expect(db.save).toHaveBeenCalledTimes(2)
    expect(db.save.mock.calls[0]).toEqual(["formulas", form])
    expect(db.save.mock.calls[1]).toEqual(["dispatch_log", dispatchLog])
  })

  it("emitUncertaintyEntry swallows save failures after warning", async () => {
    const db = makeDb()
    db.save.mockRejectedValueOnce(new Error("collection missing"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const deps = buildDeps(db)

    await expect(deps.emitUncertaintyEntry({
      pass_or_skill: "formula-compiler",
      reason: "missing evidence",
      suggested_resolution: "rerun verification",
      blocking_for: ["dispatch"],
      timestamp: "2026-05-21T00:00:00.000Z",
    } satisfies UncertaintyEmission)).resolves.toBeUndefined()

    expect(db.ensureCollection).toHaveBeenCalledWith("uncertainty_entries")
    expect(warn).toHaveBeenCalledWith("[UNCERTAINTY_EMIT_FAILED]", expect.any(Error))
  })
})
