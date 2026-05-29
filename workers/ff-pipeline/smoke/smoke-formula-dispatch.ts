/**
 * smoke-formula-dispatch.ts — end-to-end smoke for IP-1 Formula Compiler
 *
 * Tests the full dispatch chain: ArangoDB reads/writes + Gas City HTTP (CALL 1/2/3).
 * Requires local Gas City running at GC_BASE_URL and local ArangoDB at ARANGO_URL.
 *
 * Usage:
 *   cd workers/ff-pipeline
 *   GC_BASE_URL=http://localhost:8372 GC_TOKEN=$(cat ~/.gc/cities.toml | ...) \
 *   npx tsx smoke/smoke-formula-dispatch.ts
 *
 * Or with env file:
 *   source smoke/.env.local && npx tsx smoke/smoke-formula-dispatch.ts
 */

import { compileAndDispatchFormula } from "../src/compilers/formula-compiler.js"
import type {
  FormulaCompilerDeps,
  FormulaCompilerEnv,
  FormArtifact,
  DispatchLogRow,
  CoherenceVRRow,
} from "../src/compilers/formula-compiler.js"
import { ArangoClient } from "../../../packages/arango-client/src/index.js"

// ── Config from environment ────────────────────────────────────────────────

const GC_BASE_URL = process.env.GC_BASE_URL ?? "http://localhost:8372"
const GC_TOKEN = process.env.GC_TOKEN ?? ""
const GC_CITY_NAME = process.env.GC_CITY_NAME ?? "phase0-city"
const GC_AGENT_NAME = process.env.GC_AGENT_NAME ?? "coder"
const GC_RIG = process.env.GC_RIG ?? "test-repo"
const GC_RIG_ROOT = process.env.GC_RIG_ROOT ?? "/Users/wes/phase0-city/rigs/test-repo"

const ARANGO_URL = process.env.ARANGO_URL ?? "http://localhost:8529"
const ARANGO_DB = process.env.ARANGO_DB ?? "function_factory"
const ARANGO_USER = process.env.ARANGO_USER ?? "root"
const ARANGO_PASSWORD = process.env.ARANGO_PASSWORD ?? "factory-dev"

if (!GC_TOKEN) {
  console.error("GC_TOKEN is required. Get it from: cat /Users/wes/phase0-city/.gc/controller.token")
  process.exit(1)
}

// ── ArangoDB client ────────────────────────────────────────────────────────

const db = new ArangoClient({
  url: ARANGO_URL,
  database: ARANGO_DB,
  auth: { type: "basic", username: ARANGO_USER, password: ARANGO_PASSWORD },
})

// ── Minimal test EP ────────────────────────────────────────────────────────
// The compiler reads this via `ep as unknown as {...}` so we pass only the
// fields it actually accesses.

// SMOKE_RUN_ID env var: reuse a prior run to test idempotency.
const runId = process.env.SMOKE_RUN_ID ?? Date.now().toString(36).toUpperCase()
const testEp = {
  id: `EP-SMOKE-${runId}`,
  functionId: `FN-SMOKE-${runId}`,
  intentSpecificationId: `IS-SMOKE-${runId}`,
  executableSpecificationId: `ES-SMOKE-${runId}`,
  instructionTuning: {
    inputExecutableSpecificationHash: `sha256-smoke-hash-${runId}`,
  },
  adapter: {
    adapterId: "adapter.coding",
    executionRequest: {
      parameters: { task: `smoke-${runId}`, lang: "typescript" },
    },
  },
  roles: [
    {
      roleId: "planner",
      instruction: `Plan a minimal smoke test task ${runId}: write a single file hello-${runId}.txt with content "smoke ok".`,
      inputs: [],
      outputs: [`PLAN-${runId}.md`],
    },
    {
      roleId: "coder",
      instruction: `Create hello-${runId}.txt in the rig root containing exactly: smoke ok`,
      inputs: [`PLAN-${runId}.md`],
      outputs: [`hello-${runId}.txt`],
    },
    {
      roleId: "verifier",
      instruction: `Verify hello-${runId}.txt exists and contains "smoke ok". If correct, approve.`,
      inputs: [`hello-${runId}.txt`],
      outputs: [],
    },
  ],
}

// ── Env bindings ───────────────────────────────────────────────────────────

const env: FormulaCompilerEnv = {
  GAS_CITY_BASE_URL: GC_BASE_URL,
  GAS_CITY_CITY_NAME: GC_CITY_NAME,
  GAS_CITY_BEARER_TOKEN: GC_TOKEN,
  GAS_CITY_AGENT_NAME: GC_AGENT_NAME,
  GAS_CITY_RIG: GC_RIG,
  GAS_CITY_RIG_ROOT: GC_RIG_ROOT,
  GAS_CITY_WEBHOOK_URL: "http://localhost:9999/webhook/release", // placeholder — IP-4 not wired yet
  FACTORY_MAX_ITERATIONS: "3",
  GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1: "3",
}

// ── Real deps ──────────────────────────────────────────────────────────────

let gcCallCount = 0

const deps: FormulaCompilerDeps = {
  async fetchCoherenceVR(esId: string): Promise<CoherenceVRRow | null> {
    const rows = await db.query<CoherenceVRRow>(
      `FOR vr IN verification_reports
         FILTER @esId IN vr.source_refs
         FILTER vr.kind == "coherence"
         FILTER vr.status == "passed"
         SORT vr.created_at DESC
         LIMIT 1
         RETURN vr`,
      { esId },
    )
    return rows[0] ?? null
  },

  async getDispatchLogByIdempotencyKey(
    idempotencyKey: string,
    factoryAttempt: number,
    excludeKey?: string,
  ): Promise<DispatchLogRow | null> {
    const rows = await db.query<DispatchLogRow>(
      `FOR dl IN dispatch_log
         FILTER dl.idempotency_key == @idempotencyKey
         FILTER dl.factory_attempt == @factoryAttempt
         FILTER @excludeKey == null OR dl._key != @excludeKey
         LIMIT 1
         RETURN dl`,
      { idempotencyKey, factoryAttempt, excludeKey: excludeKey ?? null },
    )
    return rows[0] ?? null
  },

  async getFormulaByKey(key: string): Promise<FormArtifact | null> {
    return db.get<FormArtifact>("formulas", key)
  },

  async writeFormAndDispatchLog(form: FormArtifact, dispatchLog: DispatchLogRow): Promise<void> {
    await db.save("formulas", form as unknown as Record<string, unknown>)
    await db.save("dispatch_log", dispatchLog as unknown as Record<string, unknown>)
  },

  async updateFormulaVersion(formKey: string, version: string): Promise<void> {
    await db.update("formulas", formKey, { formula_version: version })
  },

  async updateDispatchLog(key: string, patch: Partial<DispatchLogRow>): Promise<void> {
    await db.update("dispatch_log", key, patch as unknown as Record<string, unknown>)
  },

  async emitUncertaintyEntry(entry) {
    console.error("[UNCERTAINTY]", JSON.stringify(entry, null, 2))
  },

  async httpFetch(url: string, init?: RequestInit): Promise<Response> {
    gcCallCount++
    console.log(`  GC call #${gcCallCount}: ${init?.method ?? "GET"} ${url.split("/v0")[1]?.split("?")[0] ?? url}`)
    return fetch(url, init)
  },

  now(): string {
    return new Date().toISOString()
  },

  async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  },
}

// ── Ensure collections exist ───────────────────────────────────────────────

async function ensureCollections(): Promise<void> {
  for (const col of ["formulas", "dispatch_log", "verification_reports"]) {
    await db.ensureCollection(col)
  }
}

// ── Seed Coherence VR for the test EP ─────────────────────────────────────

async function seedCoherenceVR(): Promise<string> {
  const vrKey = `VR-SMOKE-COHERENCE-${runId}`
  const existing = await db.get<CoherenceVRRow>("verification_reports", vrKey)
  if (existing) {
    console.log(`  coherence VR already exists: ${vrKey}`)
    return vrKey
  }
  await db.save("verification_reports", {
    _key: vrKey,
    kind: "coherence",
    status: "passed",
    source_refs: [testEp.executableSpecificationId],
    created_at: new Date().toISOString(),
    explicitness: "explicit",
    notes: "seeded by smoke test",
  })
  console.log(`  seeded coherence VR: ${vrKey}`)
  return vrKey
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Formula Compiler Smoke Test ===")
  console.log(`Gas City:  ${GC_BASE_URL}/v0/city/${GC_CITY_NAME}`)
  console.log(`ArangoDB:  ${ARANGO_URL}/${ARANGO_DB}`)
  console.log(`Run ID:    ${runId}`)
  console.log(`EP ID:     ${testEp.id}`)
  console.log("")

  console.log("[1] Ensuring collections...")
  await ensureCollections()

  console.log("[2] Seeding coherence VR...")
  await seedCoherenceVR()

  console.log("[3] Running compileAndDispatchFormula...")
  const result = await compileAndDispatchFormula({
    ep: testEp as unknown as import("@factory/schemas").TrellisExecutionPacket,
    factoryAttempt: 1,
    env,
    deps,
  })

  console.log("")
  console.log("=== Result ===")
  console.log(JSON.stringify(result, null, 2))
  console.log("")

  // ── Verify ──────────────────────────────────────────────────────────────

  let pass = true

  if (result.outcome !== "dispatched") {
    console.error(`FAIL: expected outcome=dispatched, got ${result.outcome}`)
    if (result.error) console.error(`      error: ${result.error}`)
    pass = false
  } else {
    console.log("PASS: outcome=dispatched")
  }

  if (result.form_id) {
    const form = await db.get<FormArtifact>("formulas", result.form_id)
    if (!form) {
      console.error(`FAIL: FORM-* not found in ArangoDB (key=${result.form_id})`)
      pass = false
    } else {
      console.log(`PASS: FORM-* persisted (${result.form_id})`)
      if (form.formula_version !== "2") {
        console.error(`FAIL: formula_version expected "2", got "${form.formula_version}"`)
        pass = false
      } else {
        console.log(`PASS: formula_version="${form.formula_version}"`)
      }
    }
  }

  if (result.dispatch_log_key) {
    const dl = await db.get<DispatchLogRow>("dispatch_log", result.dispatch_log_key)
    if (!dl) {
      console.error(`FAIL: dispatch_log not found (key=${result.dispatch_log_key})`)
      pass = false
    } else {
      console.log(`PASS: dispatch_log persisted (outcome=${dl.outcome})`)
      if (!dl.gc_bead_id) {
        console.error("FAIL: dispatch_log.gc_bead_id is null")
        pass = false
      } else {
        console.log(`PASS: gc_bead_id=${dl.gc_bead_id}`)
      }
      if (!dl.gc_workflow_id) {
        console.error("FAIL: dispatch_log.gc_workflow_id is null")
        pass = false
      } else {
        console.log(`PASS: gc_workflow_id=${dl.gc_workflow_id}`)
      }
      if (!dl.labels_sent || dl.labels_sent.length < 5) {
        console.error(`FAIL: labels_sent expected 5, got ${dl.labels_sent?.length ?? 0}`)
        pass = false
      } else {
        console.log(`PASS: labels_sent=${JSON.stringify(dl.labels_sent)}`)
      }
    }
  }

  if (result.gc_bead_id) {
    console.log(`\nGas City bead: ${result.gc_bead_id}`)
  }

  // Idempotency check: if this was a replay of a prior run, zero Gas City calls expected.
  const isReplay = !!process.env.SMOKE_RUN_ID
  if (isReplay) {
    console.log("")
    if (gcCallCount === 0) {
      console.log("PASS (idempotency): zero Gas City HTTP calls — returned from durable barrier")
    } else {
      console.error(`FAIL (idempotency): expected 0 GC calls on replay, got ${gcCallCount}`)
      pass = false
    }
  } else {
    console.log(`\nGC calls made: ${gcCallCount} (expected 3 for fresh dispatch)`)
    if (gcCallCount !== 3) {
      console.error(`FAIL: expected 3 GC calls, got ${gcCallCount}`)
      pass = false
    } else {
      console.log("PASS: exactly 3 Gas City calls (CALL1+CALL2+CALL3)")
    }
    console.log(`\nTo test idempotency, re-run with: SMOKE_RUN_ID=${runId}`)
  }

  console.log("")
  if (pass) {
    console.log("=== SMOKE PASS ===")
    process.exit(0)
  } else {
    console.log("=== SMOKE FAIL ===")
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err)
  process.exit(1)
})
