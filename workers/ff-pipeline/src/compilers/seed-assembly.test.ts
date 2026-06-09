/**
 * seed-assembly.test.ts — TDD tests for workspace seed assembly
 * (IS-WORKSPACE-SEEDING v2).
 *
 * Acceptance criteria covered here (unit-level):
 *   AC-1  — IS content in seed (`issue`)
 *   AC-2  — ES acceptance criteria in seed (`acceptance[]`)
 *   AC-3  — Rig files in seed (`files[]`)
 *   AC-4  — Lineage entry in seed (`files[]` → lineage.json)
 *   AC-9  — Fail-closed on IS/ES fetch failure → seed_resolution_failed
 *   AC-11 — Fail-closed on missing rig file → seed_resolution_failed
 *   AC-12 — Fail-closed on invalid rig path → seed_invalid_path
 *   AC-13 — Fail-closed on oversized bundle → seed_too_large
 *   AC-14 — Determinism (byte-identical JSON on repeat)
 */

import { describe, it, expect } from "vitest"
import { assembleSeed, type FormulaCompilerDeps } from "./formula-compiler.js"
import { parseSeedWorkspace } from "../coding-adapter-workspace.js"

// ─── Mock deps ──────────────────────────────────────────────────────────────

type DepOverrides = Partial<
  Pick<FormulaCompilerDeps, "fetchIntentSpec" | "fetchExecutableSpec" | "putSeed" | "getRigFile">
>

function makeDeps(over: DepOverrides = {}): FormulaCompilerDeps {
  const rigStore: Record<string, string> = {
    "src/foo.ts": "export const foo = 1\n",
    "README.md": "# Project\n",
  }
  const base: Pick<
    FormulaCompilerDeps,
    "fetchIntentSpec" | "fetchExecutableSpec" | "putSeed" | "getRigFile"
  > = {
    fetchIntentSpec: async (_id: string) => ({
      body: "Implement the widget so it renders.",
      acceptanceCriteria: [],
    }),
    fetchExecutableSpec: async (_id: string) => ({
      body: "ES body text",
      acceptanceCriteria: ["Widget renders", "Tests pass"],
    }),
    putSeed: async (_key: string, _json: string) => {},
    getRigFile: async (path: string) => rigStore[path] ?? null,
  }
  // The compiler-level deps we don't exercise in assembleSeed are stubbed as
  // throwing functions so an accidental use is loud.
  const unused = () => {
    throw new Error("dep not expected during seed assembly")
  }
  return {
    fetchCoherenceVR: unused as never,
    getDispatchLogByIdempotencyKey: unused as never,
    getFormulaByKey: unused as never,
    writeFormAndDispatchLog: unused as never,
    writeDispatchLogOnly: unused as never,
    updateFormulaVersion: unused as never,
    updateDispatchLog: unused as never,
    emitUncertaintyEntry: unused as never,
    httpFetch: unused as never,
    now: () => "2026-05-30T00:00:00.000Z",
    sleep: unused as never,
    ...base,
    ...over,
  } as FormulaCompilerDeps
}

const EP = {
  id: "EP-SEED-001",
  intentSpecificationId: "IS-SEED-001",
  executableSpecificationId: "ES-SEED-001",
  parameters: { rig_files: ["src/foo.ts", "README.md"] },
}

const FORM_KEY = "FORM-ABCDEF0123456789"
const ATTEMPT = 1

// ─── Happy path (AC-1..4) ────────────────────────────────────────────────────

describe("assembleSeed — happy path", () => {
  it("assembles a SeedWorkspace with issue, acceptance, rig files and lineage", async () => {
    const result = await assembleSeed(EP, FORM_KEY, ATTEMPT, makeDeps())
    expect(result.outcome).toBe("ok")
    if (result.outcome !== "ok") return

    const seed = parseSeedWorkspace(result.json)
    // AC-1
    expect(seed.issue).toBe("Implement the widget so it renders.")
    // AC-2
    expect(seed.acceptance).toEqual(["Widget renders", "Tests pass"])
    // AC-3
    const foo = seed.files.find((f) => f.path === "src/foo.ts")
    const readme = seed.files.find((f) => f.path === "README.md")
    expect(foo?.content).toBe("export const foo = 1\n")
    expect(readme?.content).toBe("# Project\n")
    // AC-4
    const lineage = seed.files.find((f) => f.path === "lineage.json")
    expect(lineage).toBeDefined()
    const parsedLineage = JSON.parse(lineage!.content)
    expect(parsedLineage).toEqual({
      form_id: FORM_KEY,
      ep_id: "EP-SEED-001",
      is_id: "IS-SEED-001",
      es_id: "ES-SEED-001",
      factory_attempt: 1,
    })
  })

  it("tolerates absent rig_files (only lineage.json present)", async () => {
    const ep = { ...EP, parameters: {} }
    const result = await assembleSeed(ep, FORM_KEY, ATTEMPT, makeDeps())
    expect(result.outcome).toBe("ok")
    if (result.outcome !== "ok") return
    const seed = parseSeedWorkspace(result.json)
    expect(seed.files.map((f) => f.path)).toEqual(["lineage.json"])
  })
})

// ─── Fail-closed paths ───────────────────────────────────────────────────────

describe("assembleSeed — fail-closed", () => {
  it("AC-9: IS not found → seed_resolution_failed", async () => {
    const result = await assembleSeed(
      EP,
      FORM_KEY,
      ATTEMPT,
      makeDeps({ fetchIntentSpec: async () => null }),
    )
    expect(result.outcome).toBe("seed_resolution_failed")
    if (result.outcome === "ok") return
    expect(result.detail).toContain("IS-SEED-001")
  })

  it("AC-9: ES not found → seed_resolution_failed", async () => {
    const result = await assembleSeed(
      EP,
      FORM_KEY,
      ATTEMPT,
      makeDeps({ fetchExecutableSpec: async () => null }),
    )
    expect(result.outcome).toBe("seed_resolution_failed")
    if (result.outcome === "ok") return
    expect(result.detail).toContain("ES-SEED-001")
  })

  it("AC-11: missing rig file → seed_resolution_failed naming the path", async () => {
    const result = await assembleSeed(
      EP,
      FORM_KEY,
      ATTEMPT,
      makeDeps({ getRigFile: async () => null }),
    )
    expect(result.outcome).toBe("seed_resolution_failed")
    if (result.outcome === "ok") return
    expect(result.detail).toContain("src/foo.ts")
  })

  it("AC-12: unsafe path (..) → seed_invalid_path", async () => {
    const ep = { ...EP, parameters: { rig_files: ["../../etc/passwd"] } }
    const result = await assembleSeed(ep, FORM_KEY, ATTEMPT, makeDeps())
    expect(result.outcome).toBe("seed_invalid_path")
    if (result.outcome === "ok") return
    expect(result.detail).toContain("../../etc/passwd")
  })

  it("AC-12: leading slash path → seed_invalid_path", async () => {
    const ep = { ...EP, parameters: { rig_files: ["/abs/path"] } }
    const result = await assembleSeed(ep, FORM_KEY, ATTEMPT, makeDeps())
    expect(result.outcome).toBe("seed_invalid_path")
  })

  it("AC-13: oversized bundle → seed_too_large", async () => {
    const big = "x".repeat(600_000)
    const ep = { ...EP, parameters: { rig_files: ["src/foo.ts"] } }
    const result = await assembleSeed(
      ep,
      FORM_KEY,
      ATTEMPT,
      makeDeps({ getRigFile: async () => big }),
    )
    expect(result.outcome).toBe("seed_too_large")
    if (result.outcome === "ok") return
    expect(result.detail).toContain("bytes")
  })
})

// ─── Determinism (AC-14) ─────────────────────────────────────────────────────

describe("assembleSeed — determinism", () => {
  it("AC-14: two calls with same inputs produce byte-identical JSON", async () => {
    const a = await assembleSeed(EP, FORM_KEY, ATTEMPT, makeDeps())
    const b = await assembleSeed(EP, FORM_KEY, ATTEMPT, makeDeps())
    expect(a.outcome).toBe("ok")
    expect(b.outcome).toBe("ok")
    if (a.outcome !== "ok" || b.outcome !== "ok") return
    expect(a.json).toBe(b.json)
  })
})
